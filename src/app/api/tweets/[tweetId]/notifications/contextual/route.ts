import { NextRequest, NextResponse } from 'next/server';
import { getTweet } from '@/lib/models/tweets';
import { getTweetEngagementsCollection } from '@/lib/models/tweet-engagements';
import { updateTweetEngagementLlmFields } from '@/lib/models/tweet-engagements';
import { getEngagers } from '@/lib/models/tweets';

type ActionType = 'quote' | 'reply' | 'retweet' | 'like';

function parseKey(key: string): { actionType: ActionType; userId: string } | null {
  if (typeof key !== 'string') return null;
  const [actionTypeRaw, userIdRaw] = key.split(':');
  const actionType = actionTypeRaw as ActionType;
  const userId = userIdRaw?.trim();
  // NOTE: only quote/reply keys are editable via PATCH (see PATCH handler).
  if ((actionType !== 'quote' && actionType !== 'reply') || !userId) return null;
  return { actionType, userId };
}

function fallbackNotification(actionType: ActionType, account?: { name?: string; username?: string }): string {
  const name = account?.name?.trim() || 'Someone';
  const username = account?.username?.trim();
  const who = username ? `${name} (@${username})` : name;

  switch (actionType) {
    case 'like':
      return `${who} liked your post.`;
    case 'retweet':
      return `${who} retweeted your post.`;
    case 'quote':
      return `${who} quote tweeted your post.`;
    case 'reply':
      return `${who} replied to your post.`;
    default: {
      // Exhaustive check (keeps TS honest if we add new action types later)
      const _never: never = actionType;
      return `${String(_never)} happened.`;
    }
  }
}

/**
 * GET /api/tweets/:tweetId/notifications/contextual
 *
 * Returns already-generated SOCAP-style notifications stored on tweet_engagements:
 * - action_type: quote/reply
 * - llm_copy: notification text
 * - engagement_tweet_url: source link (quote/reply tweet)
 *
 * This endpoint does NOT generate new notifications; use:
 * POST /api/tweets/:tweetId/notifications/generate-contextual
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tweetId: string }> }
) {
  try {
    const { tweetId } = await params;

    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 60)));

    const tweet = await getTweet(tweetId);
    if (!tweet) {
      return NextResponse.json({ success: false, error: 'Tweet not found' }, { status: 404 });
    }

    const collection = await getTweetEngagementsCollection();
    // Fetch a superset, then sort+slice in memory so we can include:
    // - quote/reply even when llm_copy is missing
    // - retweet/like (action-only) engagements
    const fetchCap = Math.max(limit, Math.min(500, limit * 3));
    const docs = await collection
      .find({
        tweet_id: tweetId,
        action_type: { $in: ['quote', 'reply', 'retweet', 'like'] },
      })
      .limit(fetchCap)
      .toArray();

    // Attach importance_score (comes from the ranked engagers collection, not tweet_engagements).
    // Best-effort: if ranker data is missing, we just omit/null it.
    const [quoteRanked, replyRanked, retweetRanked, likeRanked] = await Promise.all([
      getEngagers(tweetId, {
        limit: 200,
        skip: 0,
        sortBy: 'importance_score',
        sortOrder: 'desc',
        engagementType: 'quoted',
      }).catch(() => ({ engagers: [], total: 0 })),
      getEngagers(tweetId, {
        limit: 200,
        skip: 0,
        sortBy: 'importance_score',
        sortOrder: 'desc',
        engagementType: 'replied',
      }).catch(() => ({ engagers: [], total: 0 })),
      getEngagers(tweetId, {
        limit: 200,
        skip: 0,
        sortBy: 'importance_score',
        sortOrder: 'desc',
        engagementType: 'retweeted',
      }).catch(() => ({ engagers: [], total: 0 })),
      getEngagers(tweetId, {
        limit: 200,
        skip: 0,
        sortBy: 'importance_score',
        sortOrder: 'desc',
        engagementType: 'liked',
      }).catch(() => ({ engagers: [], total: 0 })),
    ]);
    const importanceByKey = new Map<string, number>();
    for (const e of quoteRanked.engagers) {
      if (typeof e.importance_score === 'number') importanceByKey.set(`quote:${e.userId}`, e.importance_score);
    }
    for (const e of replyRanked.engagers) {
      if (typeof e.importance_score === 'number') importanceByKey.set(`reply:${e.userId}`, e.importance_score);
    }
    for (const e of retweetRanked.engagers) {
      if (typeof e.importance_score === 'number') importanceByKey.set(`retweet:${e.userId}`, e.importance_score);
    }
    for (const e of likeRanked.engagers) {
      if (typeof e.importance_score === 'number') importanceByKey.set(`like:${e.userId}`, e.importance_score);
    }

    const itemsUnsorted = docs.map((e) => {
      const engagementUrl =
        e.engagement_tweet_url || (e.engagement_tweet_id ? `https://twitter.com/i/web/status/${e.engagement_tweet_id}` : undefined);

      const actionType = e.action_type as ActionType;
      const llmCopy = typeof e.llm_copy === 'string' ? e.llm_copy.trim() : '';

      return {
        key: `${e.action_type}:${e.user_id}`,
        action_type: e.action_type,
        user_id: e.user_id,
        account: {
          username: e.account_profile.username,
          name: e.account_profile.name,
          followers: e.account_profile.followers,
          verified: e.account_profile.verified,
        },
        engagement_tweet_url: engagementUrl,
        engagement_text: typeof e.text === 'string' ? e.text.trim() : undefined,
        importance_score: importanceByKey.get(`${e.action_type}:${e.user_id}`) ?? null,
        notification: llmCopy || fallbackNotification(actionType, { name: e.account_profile.name, username: e.account_profile.username }),
        sentiment: e.llm_sentiment ?? null,
        llm_generated_at: e.llm_generated_at ?? null,
        timestamp: e.timestamp ?? null,
        last_seen_at: e.last_seen_at ?? null,
        created_at: e.created_at ?? null,
      };
    });

    const items = itemsUnsorted
      .sort((a, b) => {
        const aImportance = typeof a.importance_score === 'number' ? a.importance_score : -1;
        const bImportance = typeof b.importance_score === 'number' ? b.importance_score : -1;
        if (bImportance !== aImportance) return bImportance - aImportance;

        const aFollowers = a.account?.followers ?? 0;
        const bFollowers = b.account?.followers ?? 0;
        if (bFollowers !== aFollowers) return bFollowers - aFollowers;

        const aDate =
          (a.llm_generated_at && new Date(a.llm_generated_at)) ||
          (a.timestamp && new Date(a.timestamp)) ||
          (a.last_seen_at && new Date(a.last_seen_at)) ||
          (a.created_at && new Date(a.created_at)) ||
          null;
        const bDate =
          (b.llm_generated_at && new Date(b.llm_generated_at)) ||
          (b.timestamp && new Date(b.timestamp)) ||
          (b.last_seen_at && new Date(b.last_seen_at)) ||
          (b.created_at && new Date(b.created_at)) ||
          null;

        const aTime = aDate instanceof Date && !Number.isNaN(aDate.getTime()) ? aDate.getTime() : 0;
        const bTime = bDate instanceof Date && !Number.isNaN(bDate.getTime()) ? bDate.getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, limit)
      .map(({ timestamp, last_seen_at, created_at, engagement_text, ...rest }) => ({
        ...rest,
        engagement_text: engagement_text || undefined, // include engagement text but don't leak empty strings
      })); // don't leak internal fields to client

    return NextResponse.json({
      success: true,
      data: {
        tweetId,
        tweet_url: tweet.tweet_url,
        items,
      },
    });
  } catch (error) {
    console.error('Error fetching contextual notifications:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch contextual notifications',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/tweets/:tweetId/notifications/contextual
 *
 * Allows a dashboard user to edit the stored notification copy (llm_copy)
 * for a specific engagement ("quote:<userId>" or "reply:<userId>").
 *
 * Body: { key: string, text: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tweetId: string }> }
) {
  try {
    const { tweetId } = await params;
    const body = await request.json().catch(() => ({}));

    const key = body?.key as string | undefined;
    const text = body?.text as string | undefined;
    const parsed = key ? parseKey(key) : null;

    if (!parsed) {
      return NextResponse.json(
        { success: false, error: 'Invalid key. Expected "quote:<userId>" or "reply:<userId>".' },
        { status: 400 }
      );
    }
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'text is required' }, { status: 400 });
    }

    const ok = await updateTweetEngagementLlmFields(tweetId, parsed.userId, parsed.actionType, {
      llm_copy: text.trim(),
      llm_generated_at: new Date(),
    });

    if (!ok) {
      return NextResponse.json(
        { success: false, error: 'Engagement not found (or no changes applied)' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: { tweetId, key } });
  } catch (error) {
    console.error('Error updating contextual notification:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update contextual notification',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

