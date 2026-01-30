import { getTweet, getEngagersCollection } from '@/lib/models/tweets';
import {
  getTweetEngagementsByUsers,
  updateTweetEngagementLlmFields,
  type TweetEngagement,
} from '@/lib/models/tweet-engagements';
import {
  generateEngagementNotifications,
  type EngagementNotificationSuggestion,
} from '@/lib/generate-engagement-notifications';

type ActionType = 'quote' | 'reply';

function toKey(action: ActionType, userId: string) {
  return `${action}:${userId}`;
}

const HARD_MAX_ENGAGERS_PER_TYPE = 5000; // safety cap (prevents runaway LLM cost)
const MONGO_IN_CHUNK_SIZE = 500;
// Keep this small enough that the model can return a complete JSON response
// without getting truncated mid-string (which breaks JSON.parse).
const LLM_BATCH_SIZE = 10;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clampOptionalLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  // Allow 0 to intentionally disable (keeps backwards compatibility for callers)
  return Math.max(0, Math.min(HARD_MAX_ENGAGERS_PER_TYPE, Math.floor(n)));
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function getEngagementsChunked(
  tweetId: string,
  actionType: ActionType,
  userIds: string[]
): Promise<TweetEngagement[]> {
  if (userIds.length === 0) return [];
  const chunks = chunk(userIds, MONGO_IN_CHUNK_SIZE);
  const parts = await Promise.all(chunks.map((ids) => getTweetEngagementsByUsers(tweetId, actionType, ids)));
  return parts.flat();
}

async function getRankedEngagersAboveImportance(
  tweetId: string,
  engagementType: 'quoted' | 'replied',
  minImportanceExclusive: number,
  maxToReturn: number | undefined
): Promise<Array<{ userId: string; importance: number; followers: number }>> {
  if (maxToReturn === 0) return [];

  const limit = typeof maxToReturn === 'number' ? Math.min(maxToReturn, HARD_MAX_ENGAGERS_PER_TYPE) : HARD_MAX_ENGAGERS_PER_TYPE;
  const collection = await getEngagersCollection();

  const docs = await collection
    .find(
      {
        tweet_id: tweetId,
        [engagementType]: true,
        importance_score: { $gt: minImportanceExclusive },
      },
      {
        projection: { userId: 1, followers: 1, importance_score: 1 },
      }
    )
    .sort({ importance_score: -1 })
    .limit(limit)
    .toArray();

  return docs.flatMap((e) => {
    const score = e.importance_score;
    if (!isFiniteNumber(score) || score <= minImportanceExclusive) return [];
    return [{ userId: e.userId, importance: score, followers: e.followers ?? 0 }];
  });
}

export type GenerateContextualNotificationsOptions = {
  limitQuotes?: number;
  limitReplies?: number;
  minImportanceScore?: number;
};

export type GeneratedContextualNotification = {
  key: string;
  action_type: ActionType;
  user_id: string;
  notification: string;
  sentiment: 'positive' | 'neutral' | 'critical' | null;
};

/**
 * Generate & persist contextual notifications for a tweet.
 *
 * - Generates one notification per quote/reply engagement above the threshold
 * - Filters to `importance_score > minImportanceScore` (strictly greater)
 * - Requires tweet.text + engagement texts (stored in tweet_engagements)
 * - Persists to tweet_engagements.llm_copy + llm_sentiment + llm_generated_at
 */
export async function generateAndStoreContextualNotifications(
  tweetId: string,
  options: GenerateContextualNotificationsOptions = {}
): Promise<GeneratedContextualNotification[]> {
  // When limitQuotes/limitReplies are omitted, we generate for ALL engagers above the threshold.
  // (Still protected by HARD_MAX_ENGAGERS_PER_TYPE as a safety cap.)
  const limitQuotes = clampOptionalLimit(options.limitQuotes);
  const limitReplies = clampOptionalLimit(options.limitReplies);
  const minImportanceScore = Math.max(0, Math.min(100, Number(options.minImportanceScore ?? 5)));

  const tweet = await getTweet(tweetId);
  if (!tweet) throw new Error('Tweet not found');
  if (!tweet.text) throw new Error('Main tweet text is missing');

  const minImportanceExclusive = minImportanceScore;

  // Use engagers ranking to define "important" quote/reply users.
  const [quoteCandidates, replyCandidates] = await Promise.all([
    getRankedEngagersAboveImportance(tweetId, 'quoted', minImportanceExclusive, limitQuotes),
    getRankedEngagersAboveImportance(tweetId, 'replied', minImportanceExclusive, limitReplies),
  ]);

  const quoteUserIds = quoteCandidates.map((e) => e.userId);
  const replyUserIds = replyCandidates.map((e) => e.userId);

  const [quoteEngagements, replyEngagements] = await Promise.all([
    getEngagementsChunked(tweetId, 'quote', quoteUserIds),
    getEngagementsChunked(tweetId, 'reply', replyUserIds),
  ]);

  // Build map for quick lookup (in case some users are missing engagement text).
  const engagementMap = new Map<string, TweetEngagement>();
  for (const e of [...quoteEngagements, ...replyEngagements]) {
    engagementMap.set(toKey(e.action_type as ActionType, e.user_id), e);
  }

  const orderedCandidates: Array<{ action: ActionType; userId: string; importance: number; followers: number }> = [
    ...quoteCandidates.map((e) => ({ action: 'quote' as const, ...e })),
    ...replyCandidates.map((e) => ({ action: 'reply' as const, ...e })),
  ].sort((a, b) => {
    if (b.importance !== a.importance) return b.importance - a.importance;
    return (b.followers ?? 0) - (a.followers ?? 0);
  });

  const promptEngagements = orderedCandidates
    .map(({ action, userId }) => engagementMap.get(toKey(action, userId)))
    .filter((e): e is TweetEngagement => Boolean(e))
    .map((e) => ({
      key: toKey(e.action_type as ActionType, e.user_id),
      action_type: e.action_type as ActionType,
      user_id: e.user_id,
      account: {
        username: e.account_profile.username,
        name: e.account_profile.name,
        followers: e.account_profile.followers,
        verified: e.account_profile.verified,
        bio: e.account_profile.bio,
      },
      engagement_tweet_id: e.engagement_tweet_id,
      engagement_tweet_url:
        e.engagement_tweet_url || (e.engagement_tweet_id ? `https://twitter.com/i/web/status/${e.engagement_tweet_id}` : undefined),
      text: e.text,
      timestampISO: e.timestamp ? new Date(e.timestamp).toISOString() : undefined,
    }));

  if (promptEngagements.length === 0) return [];

  const allSuggestions: EngagementNotificationSuggestion[] = [];
  for (const batch of chunk(promptEngagements, LLM_BATCH_SIZE)) {
    let suggestions: EngagementNotificationSuggestion[] = [];
    try {
      suggestions = await generateEngagementNotifications({
        mainTweet: {
          id: tweet.tweet_id,
          url: tweet.tweet_url,
          authorName: tweet.author_name,
          authorUsername: tweet.author_username,
          text: tweet.text,
        },
        engagements: batch,
      });
    } catch (e) {
      // Best-effort: don't let one flaky LLM response take down the endpoint.
      console.error('[ContextualNotifications] LLM generation failed for batch:', {
        tweetId,
        batchSize: batch.length,
      });
      console.error(e);
      continue;
    }

    // Persist results onto the engagement docs (best-effort).
    const byKey = new Map(suggestions.map((s) => [s.key, s]));
    await Promise.all(
      batch.map(async (e) => {
        const s = byKey.get(e.key);
        if (!s) return;
        const [actionType, userId] = e.key.split(':');
        await updateTweetEngagementLlmFields(tweetId, userId, actionType as ActionType, {
          llm_copy: s.notification,
          llm_sentiment: s.sentiment,
          llm_generated_at: new Date(),
        });
      })
    );

    allSuggestions.push(...suggestions);
  }

  return allSuggestions.flatMap((s): GeneratedContextualNotification[] => {
    const [actionTypeRaw, userIdRaw] = s.key.split(':');
    const actionType = actionTypeRaw as ActionType;
    const userId = userIdRaw?.trim();

    if ((actionType !== 'quote' && actionType !== 'reply') || !userId) return [];

    return [
      {
        key: s.key,
        action_type: actionType,
        user_id: userId,
        notification: s.notification,
        sentiment: s.sentiment ?? null,
      },
    ];
  });
}

