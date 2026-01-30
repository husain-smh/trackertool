import { getTweet, updateEngagersWithRanking, upsertLikersAsEngagers } from '@/lib/models/tweets';
import { getOrCreateTweetLikersState, updateTweetLikersState } from '@/lib/models/tweet-likers-state';
import { getXOAuthByClientId } from '@/lib/models/x-oauth';
import { rankEngagers } from '@/lib/models/ranker';
import { fetchLikingUsers, getValidAccessToken } from '@/lib/x-oauth';
import { tryAcquireRateLimitSlot } from '@/lib/models/rate-limit-state';

function isRateLimitError(err: unknown): err is Error & { retryAfter?: number; isRateLimit?: boolean } {
  return Boolean(err && typeof err === 'object' && ('isRateLimit' in err || 'retryAfter' in err));
}

export interface TweetLikersSyncRun {
  ok: boolean;
  tweetId: string;
  clientId: string | null;
  requiresOauth?: boolean;
  /**
   * True when we have finished the backfill (cursor exhausted).
   * Note: likes can still change later; callers can enqueue delta runs.
   */
  backfillComplete: boolean;
  cursor: string | null;
  /**
   * Whether we intentionally didn't perform a request due to throttling.
   * Callers should reschedule the job after retryAfterSeconds.
   */
  throttled?: boolean;
  /**
   * Whether X rate-limited us (429). Callers should reschedule after retryAfterSeconds.
   */
  rateLimited?: boolean;
  retryAfterSeconds?: number;
  blockedUntil?: Date | null;
  stats: {
    pagesProcessed: number;
    usersSeen: number;
    upserted: number;
    modified: number;
  };
  error?: string;
}

/**
 * Process exactly ONE page of liking_users for a tweet.
 *
 * This function is designed to be called from a cron/worker in serverless:
 * - no sleeps
 * - idempotent
 * - persists cursor + blocked_until in tweet_likers_state
 * - respects global and per-client throttles via Mongo
 */
export async function processTweetLikersPage(input: {
  tweetId: string;
  /**
   * App-level throttle target for the liking_users endpoint.
   * If the real limit is 25/15min, min interval is ~36s.
   */
  appMinIntervalMs?: number;
  /**
   * Per-client throttle target (per OAuth user).
   * If the real limit is 5/15min, min interval is 180s.
   */
  clientMinIntervalMs?: number;
}): Promise<TweetLikersSyncRun> {
  const tweetId = String(input.tweetId || '').trim();
  const appMinIntervalMs = Math.max(0, input.appMinIntervalMs ?? 36_000);
  const clientMinIntervalMs = Math.max(0, input.clientMinIntervalMs ?? 180_000);

  const base: TweetLikersSyncRun = {
    ok: false,
    tweetId,
    clientId: null,
    requiresOauth: false,
    backfillComplete: false,
    cursor: null,
    stats: { pagesProcessed: 0, usersSeen: 0, upserted: 0, modified: 0 },
  };

  const tweet = await getTweet(tweetId);
  if (!tweet) {
    return { ...base, error: 'Tweet not found', backfillComplete: true };
  }

  const clientId = tweet.author_username || null;
  base.clientId = clientId;
  if (!clientId) {
    // Analysis may not have filled author_username yet. We'll retry later.
    await updateTweetLikersState(tweetId, { last_error: 'Tweet missing author_username (cannot determine OAuth client id).' });
    return { ...base, error: 'Tweet missing author_username' };
  }

  const state = await getOrCreateTweetLikersState(tweetId);
  const now = new Date();
  if (state.blocked_until && state.blocked_until > now) {
    const waitSec = Math.max(1, Math.ceil((state.blocked_until.getTime() - now.getTime()) / 1000));
    return {
      ...base,
      ok: true,
      backfillComplete: state.backfill_complete,
      cursor: state.cursor,
      rateLimited: true,
      retryAfterSeconds: waitSec,
      blockedUntil: state.blocked_until,
    };
  }

  const oauth = await getXOAuthByClientId(clientId);
  if (!oauth || oauth.status !== 'active') {
    await updateTweetLikersState(tweetId, {
      last_error: 'No valid OAuth token. The tweet author must connect their X account.',
    });
    return {
      ...base,
      ok: true,
      requiresOauth: true,
      backfillComplete: state.backfill_complete,
      cursor: state.cursor,
      error: 'OAuth required',
    };
  }

  // Enforce cross-instance throttles BEFORE calling X.
  // This is how we stay safe even when many tweets are queued.
  const appGate = await tryAcquireRateLimitSlot({
    key: 'x:liking_users:app',
    minIntervalMs: appMinIntervalMs,
  });
  if (!appGate.acquired) {
    const retryAfterSeconds = Math.max(1, Math.ceil(appGate.waitMs / 1000));
    return {
      ...base,
      ok: true,
      throttled: true,
      backfillComplete: state.backfill_complete,
      cursor: state.cursor,
      retryAfterSeconds,
    };
  }

  const clientGate = await tryAcquireRateLimitSlot({
    key: `x:liking_users:client:${clientId.toLowerCase()}`,
    minIntervalMs: clientMinIntervalMs,
  });
  if (!clientGate.acquired) {
    const retryAfterSeconds = Math.max(1, Math.ceil(clientGate.waitMs / 1000));
    return {
      ...base,
      ok: true,
      throttled: true,
      backfillComplete: state.backfill_complete,
      cursor: state.cursor,
      retryAfterSeconds,
    };
  }

  const accessToken = await getValidAccessToken(clientId);
  if (!accessToken) {
    await updateTweetLikersState(tweetId, {
      last_error: 'No valid OAuth token. The tweet author must connect their X account.',
    });
    return {
      ...base,
      ok: true,
      requiresOauth: true,
      backfillComplete: state.backfill_complete,
      cursor: state.cursor,
      error: 'OAuth required',
    };
  }

  // Backfill mode resumes from cursor; delta mode starts fresh (cursor undefined)
  const backfillComplete = Boolean(state.backfill_complete);
  let cursor: string | undefined = undefined;
  if (!backfillComplete) cursor = state.cursor || undefined;

  try {
    const resp = await fetchLikingUsers(tweetId, accessToken, {
      maxResults: 100,
      paginationToken: cursor,
    });

    base.stats.pagesProcessed = 1;
    base.stats.usersSeen = resp.users.length;

    const mapped = resp.users.map((u) => ({
      userId: u.id,
      username: u.username,
      name: u.name,
      bio: u.description ?? null,
      followers: u.public_metrics?.followers_count || 0,
      verified: Boolean(u.verified),
    }));

    const writeRes = await upsertLikersAsEngagers(tweetId, mapped);
    base.stats.upserted = writeRes.upserted;
    base.stats.modified = writeRes.modified;

    // Cheap ranking: Mongo lookup from following_index, no external API.
    try {
      const ranked = await rankEngagers(
        mapped.map((m) => ({
          userId: m.userId,
          username: m.username,
          name: m.name,
          bio: m.bio || undefined,
          location: undefined,
          followers: m.followers,
          verified: m.verified,
          replied: false,
          retweeted: false,
          quoted: false,
        })),
      );

      await updateEngagersWithRanking(
        tweetId,
        ranked.map((r) => ({
          userId: r.userId,
          importance_score: r.importance_score,
          followed_by: r.followed_by.map((p) => p.username),
        })),
      );
    } catch {
      // Non-fatal.
    }

    let nextCursor = backfillComplete ? undefined : resp.nextToken;
    let nextBackfillComplete = backfillComplete;

    // Delta mode: always stop after first page.
    if (backfillComplete) {
      nextCursor = undefined;
      nextBackfillComplete = true;
    } else {
      // Persist cursor for resuming backfill.
      await updateTweetLikersState(tweetId, { cursor: nextCursor || null, last_error: null });

      // Stop if no more pages or empty
      if (!nextCursor || resp.resultCount === 0) {
        nextBackfillComplete = true;
        nextCursor = undefined;
      }
    }

    await updateTweetLikersState(tweetId, {
      cursor: nextBackfillComplete ? null : nextCursor || null,
      backfill_complete: nextBackfillComplete,
      last_success: new Date(),
      last_error: null,
      blocked_until: null,
    });

    return {
      ...base,
      ok: true,
      backfillComplete: nextBackfillComplete,
      cursor: nextBackfillComplete ? null : nextCursor || null,
    };
  } catch (err) {
    if (isRateLimitError(err)) {
      const retryAfterSec = (err as any).retryAfter || 60;
      const blockedUntil = new Date(Date.now() + retryAfterSec * 1000);
      await updateTweetLikersState(tweetId, {
        blocked_until: blockedUntil,
        last_error: `Rate limit exceeded. Retry after ${retryAfterSec} seconds.`,
      });
      return {
        ...base,
        ok: true,
        rateLimited: true,
        retryAfterSeconds: retryAfterSec,
        blockedUntil,
        backfillComplete: state.backfill_complete,
        cursor: state.cursor,
      };
    }

    const msg = err instanceof Error ? err.message : 'Failed to sync likers';
    await updateTweetLikersState(tweetId, { last_error: msg });
    return { ...base, error: msg, backfillComplete: state.backfill_complete, cursor: state.cursor };
  }
}

