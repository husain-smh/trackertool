/**
 * Backfill IdentityLabs engager `account_based_in` (tweet-scoped) for a specific author username.
 *
 * What it does:
 * - Finds all tweets by `author_username`
 * - Enqueues tweet-scoped location enrichment jobs
 * - Processes those jobs in-process (no HTTP), batch-by-batch, using cache-first User About lookups
 *
 * Run:
 *   npx tsx scripts/enrich-user-engagers-locations.ts --username <handle> [--batchSize 25] [--delayMs 800] [--qps 0] [--concurrency 1] [--maxJobs 9999]
 *
 * Notes:
 * - Uses the "shared" Twitter API key path (no dedicated key) via fetchUserAbout default.
 * - Cache is sticky (username_location_cache) unless you manually clear it.
 */

import 'dotenv/config';

import { getTweetsCollection } from '@/lib/models/tweets';
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

function sanitizeUsername(value: string): string {
  return String(value || '').trim().replace(/^@/, '');
}

async function main() {
  const username = sanitizeUsername(parseArg('username') || '');
  if (!username) {
    console.error('Missing required --username <handle>');
    process.exit(1);
  }

  const batchSize = Math.max(1, parseNumber('batchSize', 25));
  const delayMs = Math.max(0, parseNumber('delayMs', 800));
  const qps = Math.max(0, parseNumber('qps', 0));
  const concurrency = Math.max(1, parseNumber('concurrency', 1));
  const maxJobs = Math.max(1, parseNumber('maxJobs', 9999));

  const tweetsCollection = await getTweetsCollection();
  const usernameRegex = new RegExp(`^@?${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

  const tweets = await tweetsCollection
    .find({ author_username: usernameRegex }, { projection: { tweet_id: 1, author_username: 1, status: 1 } })
    .toArray();

  if (tweets.length === 0) {
    console.log(`No tweets found for author_username @${username}`);
    return;
  }

  const tweetIds = tweets.map((t: any) => String(t.tweet_id || '').trim()).filter(Boolean);
  console.log(`Found ${tweetIds.length} tweet(s) for @${username}. Enqueuing enrichment jobs...`);
  const intervalMs = qps > 0 ? Math.max(delayMs, Math.ceil(1000 / Math.max(1, qps))) : delayMs;
  console.log(`Throughput: concurrency=${concurrency}, delayMs=${delayMs}, qps=${qps || '(disabled)'}, intervalMs=${intervalMs}`);

  for (const tweetId of tweetIds) {
    await enqueueTweetLocationEnrichmentJob(tweetId);
  }

  // Print quick visibility into job state (so you can see it is actually queued)
  const jobsCol = await getTweetLocationEnrichmentJobsCollection();
  const jobsForTweets = await jobsCol.countDocuments({ tweet_id: { $in: tweetIds } });
  const claimableForTweets = await jobsCol.countDocuments({
    tweet_id: { $in: tweetIds },
    status: { $in: ['pending', 'retrying'] },
    $or: [{ retry_after: null }, { retry_after: { $lte: new Date() } }],
  });
  console.log(`Jobs created for these tweets: ${jobsForTweets} (claimable now: ${claimableForTweets})`);

  // Safety: release stale "processing" jobs from older runs so this script can make progress.
  // This keeps changes minimal while avoiding "stuck processing forever" states.
  const staleMinutes = 10;
  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);
  const releaseResult = await jobsCol.updateMany(
    {
      tweet_id: { $in: tweetIds },
      status: 'processing',
      claimed_at: { $lte: staleBefore },
    },
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
  if ((releaseResult as any)?.modifiedCount > 0) {
    console.log(`Released ${releaseResult.modifiedCount} stale processing job(s) back to pending.`);
  }

  console.log('Starting in-process enrichment runner...');

  const workerId = `script-enrich-user-${Date.now()}`;
  let processedJobs = 0;
  let completedJobs = 0;
  let retriedJobs = 0;
  let failedJobs = 0;

  // Sanity-check: try to claim one job up-front, and if it fails, print job docs for debugging.
  const firstClaim = await claimNextTweetLocationEnrichmentJob(workerId, { tweetIds });
  if (!firstClaim) {
    console.log('⚠️ Could not claim any jobs despite claimable count. Dumping job docs for these tweets:');
    const docs = await jobsCol
      .find({ tweet_id: { $in: tweetIds } })
      .project({ tweet_id: 1, status: 1, retry_after: 1, claimed_by: 1, claimed_at: 1, updated_at: 1, retry_count: 1, last_error: 1 })
      .toArray();
    console.log(docs);
  }

  let job = firstClaim;
  while (processedJobs < maxJobs && job) {

    processedJobs += 1;
    console.log(`\n[${processedJobs}] Processing tweet_id=${job.tweet_id} ...`);

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
        console.log(`Rate limited. Marked job retrying. remaining=${run.stats.remaining}`);
        // Stop early on 429 so we don't keep hammering.
        break;
      }

      if (run.done) {
        await markTweetLocationEnrichmentJobCompleted({
          tweetId: job.tweet_id,
          stats: run.stats,
        });
        completedJobs += 1;
        console.log(`Completed. updated=${run.stats.updated} remaining=${run.stats.remaining}`);
      } else {
        await markTweetLocationEnrichmentJobPending({
          tweetId: job.tweet_id,
          stats: run.stats,
        });
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

    job = await claimNextTweetLocationEnrichmentJob(workerId, { tweetIds });
  }

  console.log('\nDone.');
  console.log(
    JSON.stringify(
      {
        author: `@${username}`,
        processedJobs,
        completedJobs,
        retriedJobs,
        failedJobs,
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


