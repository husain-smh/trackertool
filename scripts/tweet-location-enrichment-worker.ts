/**
 * Tweet Location Enrichment Worker (GitHub Actions friendly)
 *
 * Purpose:
 * - Drains `tweet_location_enrichment_jobs` from MongoDB
 * - For each tweet job, enriches a small batch of engagers with accurate `account_based_in`
 *   using twitterapi.io `user_about` (cache-first).
 *
 * Why this exists:
 * - Vercel/serverless is not reliable for long-running background jobs.
 * - GitHub Actions cron is a simple, cheap worker runtime for now.
 *
 * Run locally:
 *   npx tsx scripts/tweet-location-enrichment-worker.ts --maxJobs 20 --batchSize 25 --qps 1 --concurrency 1
 *
 * Notes:
 * - Locking is done via MongoDB atomic claim (`findOneAndUpdate`).
 * - If we hit 429, we mark job retrying and stop early to avoid hammering.
 */
import 'dotenv/config';

import { getEngagersCollection, getTweetsCollection } from '@/lib/models/tweets';
import {
  claimNextTweetLocationEnrichmentJob,
  enqueueTweetLocationEnrichmentJob,
  getTweetLocationEnrichmentJobsCollection,
  markTweetLocationEnrichmentJobCompleted,
  markTweetLocationEnrichmentJobFailed,
  markTweetLocationEnrichmentJobPending,
  markTweetLocationEnrichmentJobRetrying,
} from '@/lib/models/tweet-location-enrichment-jobs';
import { processTweetLocationEnrichmentBatch } from '@/lib/location-enrichment/tweet-location-enrichment';

function parseArg(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function parseNumber(name: string, fallback: number): number {
  const raw = parseArg(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolean(name: string, fallback: boolean): boolean {
  const raw = parseArg(name);
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return fallback;
}

async function releaseStaleProcessingJobs(staleMinutes: number): Promise<number> {
  const jobsCol = await getTweetLocationEnrichmentJobsCollection();
  const staleBefore = new Date(Date.now() - Math.max(1, staleMinutes) * 60 * 1000);
  const res = await jobsCol.updateMany(
    { status: 'processing', claimed_at: { $lte: staleBefore } },
    {
      $set: {
        status: 'pending',
        claimed_by: null,
        claimed_at: null,
        retry_after: null,
        updated_at: new Date(),
      },
    },
  );
  return (res as any)?.modifiedCount ?? 0;
}

async function seedJobsFromRecentTweets(limit: number): Promise<{ considered: number; enqueued: number }> {
  const safeLimit = Math.max(0, Math.min(200, limit));
  if (safeLimit === 0) return { considered: 0, enqueued: 0 };

  const tweetsCol = await getTweetsCollection();
  const engagersCol = await getEngagersCollection();

  const recentTweets = await tweetsCol
    .find(
      { status: { $in: ['analyzing', 'completed'] } },
      { projection: { tweet_id: 1, analyzed_at: 1, created_at: 1 } },
    )
    .sort({ analyzed_at: -1, created_at: -1 })
    .limit(safeLimit)
    .toArray();

  let enqueued = 0;
  for (const t of recentTweets as any[]) {
    const tweetId = String(t?.tweet_id || '').trim();
    if (!tweetId) continue;

    const missingCount = await engagersCol.countDocuments({
      tweet_id: tweetId,
      $and: [
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
    });

    if (missingCount > 0) {
      await enqueueTweetLocationEnrichmentJob(tweetId);
      enqueued += 1;
    }
  }

  return { considered: recentTweets.length, enqueued };
}

async function main() {
  const maxJobs = Math.max(1, parseNumber('maxJobs', 20));
  const batchSize = Math.max(1, parseNumber('batchSize', 25));
  const delayMs = Math.max(0, parseNumber('delayMs', 1000));
  const qps = Math.max(0, parseNumber('qps', 1));
  const concurrency = Math.max(1, parseNumber('concurrency', 1));
  const staleMinutes = Math.max(1, parseNumber('staleMinutes', 10));

  // Optional: seed jobs for recent analyzed tweets so heatmaps start filling even if the user
  // never opened the heatmap endpoint (older runs / edge cases).
  const seedRecentTweets = Math.max(0, parseNumber('seedRecentTweets', 0));
  const showQueueStats = parseBoolean('showQueueStats', true);

  const workerId = `gh-location-worker-${Date.now()}`;

  const released = await releaseStaleProcessingJobs(staleMinutes);
  if (released > 0) {
    console.log(`Released ${released} stale job(s) back to pending (staleMinutes=${staleMinutes}).`);
  }

  if (seedRecentTweets > 0) {
    const seeded = await seedJobsFromRecentTweets(seedRecentTweets);
    console.log(`Seeded jobs from recent tweets: considered=${seeded.considered} enqueued=${seeded.enqueued}`);
  }

  if (showQueueStats) {
    const jobsCol = await getTweetLocationEnrichmentJobsCollection();
    const now = new Date();
    const counts = await jobsCol
      .aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    const claimable = await jobsCol.countDocuments({
      status: { $in: ['pending', 'retrying'] },
      $or: [{ retry_after: null }, { retry_after: { $lte: now } }],
    });
    console.log('Queue status counts:', counts);
    console.log(`Claimable now: ${claimable}`);
  }

  console.log(
    `Starting worker: maxJobs=${maxJobs} batchSize=${batchSize} delayMs=${delayMs} qps=${qps} concurrency=${concurrency}`,
  );

  let processedJobs = 0;
  let completedJobs = 0;
  let retriedJobs = 0;
  let failedJobs = 0;

  while (processedJobs < maxJobs) {
    const job = await claimNextTweetLocationEnrichmentJob(workerId);
    if (!job) break;

    processedJobs += 1;
    console.log(`\n[${processedJobs}/${maxJobs}] tweet_id=${job.tweet_id} status=processing`);

    try {
      const run = await processTweetLocationEnrichmentBatch({
        tweetId: job.tweet_id,
        batchSize,
        delayBetweenRequestsMs: delayMs,
        qps,
        concurrency,
      });

      if (run.rateLimited) {
        await markTweetLocationEnrichmentJobRetrying({
          tweetId: job.tweet_id,
          error: 'Rate limited (429)',
          retryAfterSeconds: run.retryAfterSeconds ?? 300,
          stats: run.stats,
        });
        retriedJobs += 1;
        console.log(`Rate limited. Marked retrying. remaining=${run.stats.remaining}`);
        // Stop early on 429 so we don't keep hammering.
        break;
      }

      if (run.done) {
        await markTweetLocationEnrichmentJobCompleted({ tweetId: job.tweet_id, stats: run.stats });
        completedJobs += 1;
        console.log(`Completed. updated=${run.stats.updated} remaining=${run.stats.remaining}`);
      } else {
        await markTweetLocationEnrichmentJobPending({ tweetId: job.tweet_id, stats: run.stats });
        console.log(`Partial. updated=${run.stats.updated} remaining=${run.stats.remaining} (re-queued)`);
      }
    } catch (error) {
      failedJobs += 1;
      await markTweetLocationEnrichmentJobFailed({
        tweetId: job.tweet_id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      console.error(`Failed tweet_id=${job.tweet_id}`, error);
    }
  }

  console.log('\nWorker done.');
  console.log(
    JSON.stringify(
      {
        processedJobs,
        completedJobs,
        retriedJobs,
        failedJobs,
        maxJobs,
        batchSize,
        delayMs,
        qps,
        concurrency,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

