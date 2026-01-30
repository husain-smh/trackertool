import { getEngagersCollection } from '@/lib/models/tweets';
import { TwitterApiError } from '@/lib/external-api';
import { fetchUserAbout, extractAccountBasedIn } from '@/lib/socap/user-about-api';
import {
  getCachedAccountBasedIn,
  upsertAccountBasedInCache,
} from '@/lib/models/location-cache';

export type TweetLocationEnrichmentStats = {
  processed: number;
  updated: number;
  cached_hits: number;
  no_data: number;
  errors: number;
  remaining: number;
};

function normalizeUsername(username: string): string {
  return (username || '').trim().replace(/^@/, '');
}

export async function processTweetLocationEnrichmentBatch(input: {
  tweetId: string;
  batchSize?: number;
  delayBetweenRequestsMs?: number;
  qps?: number;
  concurrency?: number;
}): Promise<{
  stats: TweetLocationEnrichmentStats;
  rateLimited: boolean;
  retryAfterSeconds?: number;
  done: boolean;
}> {
  const tweetId = String(input.tweetId || '').trim();
  if (!tweetId) {
    return {
      stats: { processed: 0, updated: 0, cached_hits: 0, no_data: 0, errors: 0, remaining: 0 },
      rateLimited: false,
      done: true,
    };
  }

  const batchSize = Math.max(1, input.batchSize ?? 25);
  const delayBetweenRequestsMs = Math.max(0, input.delayBetweenRequestsMs ?? 800);
  const qps = Math.max(0, input.qps ?? 0);
  const concurrency = Math.max(1, input.concurrency ?? 1);

  const engagersCollection = await getEngagersCollection();

  // IMPORTANT: use $and to combine multiple $or clauses (object literal would overwrite keys).
  const baseMissingFilter: any = {
    $and: [
      { tweet_id: tweetId },
      {
        $or: [
          { account_based_in: { $exists: false } },
          { account_based_in: null },
          { account_based_in: '' },
        ],
      },
      {
        $or: [
          { account_based_in_status: { $exists: false } },
          { account_based_in_status: { $in: ['pending', 'error'] } },
        ],
      },
    ],
  };

  const candidates = await engagersCollection
    .find(baseMissingFilter, {
      projection: {
        userId: 1,
        username: 1,
        followers: 1,
        importance_score: 1,
      },
    })
    .sort({ importance_score: -1, followers: -1 })
    .limit(batchSize)
    .toArray();

  const stats: TweetLocationEnrichmentStats = {
    processed: 0,
    updated: 0,
    cached_hits: 0,
    no_data: 0,
    errors: 0,
    remaining: 0,
  };

  // SOCAP-style throughput control: schedule request *starts* globally (intervalMs) with max in-flight.
  const intervalMs = qps > 0 ? Math.max(delayBetweenRequestsMs, Math.ceil(1000 / Math.max(1, qps))) : delayBetweenRequestsMs;
  let nextStartAt = Date.now();
  let scheduleChain = Promise.resolve();
  async function scheduleRequestStart(): Promise<void> {
    const startPromise = (scheduleChain = scheduleChain
      .catch(() => undefined)
      .then(async () => {
        const now = Date.now();
        const waitMs = Math.max(0, nextStartAt - now);
        nextStartAt = Math.max(nextStartAt, now) + intervalMs;
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }));
    await startPromise;
  }

  let isRateLimited = false;
  let retryAfterSeconds = 300;

  const queue = (candidates as any[]).map((row) => ({
    usernameRaw: String(row.username || ''),
  }));

  const inFlight = new Set<Promise<void>>();

  const runOne = async (usernameRaw: string) => {
    const username = normalizeUsername(usernameRaw);
    if (!username) return;

    // Cache-first
    const cached = await getCachedAccountBasedIn(username);
    if (cached && (cached.status === 'done' || cached.status === 'no_data')) {
      await engagersCollection.updateOne(
        { tweet_id: tweetId, username: usernameRaw },
        {
          $set: {
            account_based_in: cached.account_based_in,
            account_based_in_status: cached.status === 'done' ? 'done' : 'no_data',
            account_based_in_updated_at: new Date(),
          },
        },
      );
      stats.processed += 1;
      stats.updated += 1;
      stats.cached_hits += 1;
      if (cached.status === 'no_data') stats.no_data += 1;
      return;
    }

    // API call (rate-controlled)
    try {
      await scheduleRequestStart();
      const about = await fetchUserAbout(username, 2, 'shared');
      const accountBasedIn = extractAccountBasedIn(about) ?? null;
      const status = accountBasedIn ? 'done' : 'no_data';

      await upsertAccountBasedInCache({
        username,
        account_based_in: accountBasedIn,
        status: accountBasedIn ? 'done' : 'no_data',
      });

      await engagersCollection.updateOne(
        { tweet_id: tweetId, username: usernameRaw },
        {
          $set: {
            account_based_in: accountBasedIn,
            account_based_in_status: status,
            account_based_in_updated_at: new Date(),
          },
        },
      );

      stats.processed += 1;
      stats.updated += 1;
      if (!accountBasedIn) stats.no_data += 1;
    } catch (error) {
      stats.processed += 1;
      stats.errors += 1;

      // Mark this engager as error so we can retry later.
      await engagersCollection.updateOne(
        { tweet_id: tweetId, username: usernameRaw },
        {
          $set: {
            account_based_in_status: 'error',
            account_based_in_updated_at: new Date(),
          },
        },
      );

      if (error instanceof TwitterApiError && error.statusCode === 429) {
        isRateLimited = true;
        retryAfterSeconds = error.context?.retryAfter ?? 300;
        return;
      }

      if (error instanceof TwitterApiError && error.statusCode === 404) {
        // User not found: treat as no_data and cache it to avoid repeated calls.
        await upsertAccountBasedInCache({
          username,
          account_based_in: null,
          status: 'no_data',
          last_error: error.message,
        });
        await engagersCollection.updateOne(
          { tweet_id: tweetId, username: usernameRaw },
          {
            $set: {
              account_based_in: null,
              account_based_in_status: 'no_data',
              account_based_in_updated_at: new Date(),
            },
          },
        );
      } else {
        // Cache errors too (sticky until manual clear, but keeps us from thrashing).
        await upsertAccountBasedInCache({
          username,
          account_based_in: null,
          status: 'error',
          last_error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  };

  while (queue.length > 0) {
    if (isRateLimited) break;
    const next = queue.shift();
    if (!next) break;
    const p = runOne(next.usernameRaw).finally(() => inFlight.delete(p));
    inFlight.add(p);
    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }
  }

  await Promise.all(inFlight);

  stats.remaining = await engagersCollection.countDocuments(baseMissingFilter);

  if (isRateLimited) {
    return {
      stats,
      rateLimited: true,
      retryAfterSeconds,
      done: false,
    };
  }

  return { stats, rateLimited: false, done: stats.remaining === 0 };
}


