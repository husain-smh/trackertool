import { NextRequest, NextResponse } from 'next/server';
import {
  claimNextTweetLocationEnrichmentJob,
  markTweetLocationEnrichmentJobCompleted,
  markTweetLocationEnrichmentJobFailed,
  markTweetLocationEnrichmentJobPending,
  markTweetLocationEnrichmentJobRetrying,
} from '@/lib/models/tweet-location-enrichment-jobs';
import { processTweetLocationEnrichmentBatch } from '@/lib/location-enrichment/tweet-location-enrichment';

export const maxDuration = 60;

/**
 * GET /api/cron/enrich-locations
 * Runs tweet-scoped location enrichment jobs in small batches.
 *
 * Query:
 * - maxJobs: number (default 3)
 * - batchSize: number (default 25)
 * - delayMs: number (default 800)
 * - qps: number (default 0 = disabled; uses delayMs only)
 * - concurrency: number (default 1)
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const maxJobs = Math.max(1, Number(searchParams.get('maxJobs') ?? 3));
  const batchSize = Math.max(1, Number(searchParams.get('batchSize') ?? 25));
  const delayMs = Math.max(0, Number(searchParams.get('delayMs') ?? 800));
  const qps = Math.max(0, Number(searchParams.get('qps') ?? 0));
  const concurrency = Math.max(1, Number(searchParams.get('concurrency') ?? 1));

  const workerId = `identitylabs-location-${Date.now()}`;

  const results: any[] = [];
  let processedJobs = 0;
  let completedJobs = 0;
  let retriedJobs = 0;
  let failedJobs = 0;

  while (processedJobs < maxJobs) {
    const job = await claimNextTweetLocationEnrichmentJob(workerId);
    if (!job) break;

    processedJobs += 1;
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
        results.push({ tweet_id: job.tweet_id, status: 'retrying', ...run });
        continue;
      }

      if (run.done) {
        await markTweetLocationEnrichmentJobCompleted({
          tweetId: job.tweet_id,
          stats: run.stats,
        });
        completedJobs += 1;
        results.push({ tweet_id: job.tweet_id, status: 'completed', ...run });
      } else {
        // more remaining; keep pending
        await markTweetLocationEnrichmentJobPending({
          tweetId: job.tweet_id,
          stats: run.stats,
        });
        results.push({ tweet_id: job.tweet_id, status: 'pending', ...run });
      }
    } catch (error) {
      failedJobs += 1;
      await markTweetLocationEnrichmentJobFailed({
        tweetId: job.tweet_id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      results.push({
        tweet_id: job.tweet_id,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    success: true,
    processed_jobs: processedJobs,
    completed_jobs: completedJobs,
    retried_jobs: retriedJobs,
    failed_jobs: failedJobs,
    elapsed_ms: Date.now() - startedAt,
    results,
  });
}


