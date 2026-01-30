import { NextRequest, NextResponse } from 'next/server';
import {
  claimNextTweetLikersSyncJob,
  markTweetLikersSyncJobCompleted,
  markTweetLikersSyncJobFailed,
  markTweetLikersSyncJobPending,
  markTweetLikersSyncJobRetrying,
} from '@/lib/models/tweet-likers-sync-jobs';
import { processTweetLikersPage } from '@/lib/likers-sync/tweet-likers-sync';

export const maxDuration = 60;

/**
 * GET /api/cron/sync-likers
 *
 * Drains tweet liker-sync jobs in small, rate-limit-safe steps.
 *
 * Query:
 * - maxJobs: number (default 2)
 * - appMinIntervalMs: number (default 36000 => ~25/15min per-app)
 * - clientMinIntervalMs: number (default 180000 => ~5/15min per-user)
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const maxJobs = Math.max(1, Number(searchParams.get('maxJobs') ?? 2));
  const appMinIntervalMs = Math.max(0, Number(searchParams.get('appMinIntervalMs') ?? 36_000));
  const clientMinIntervalMs = Math.max(0, Number(searchParams.get('clientMinIntervalMs') ?? 180_000));

  const workerId = `identitylabs-likers-${Date.now()}`;
  const results: any[] = [];

  let processedJobs = 0;
  let completedJobs = 0;
  let retriedJobs = 0;
  let failedJobs = 0;

  while (processedJobs < maxJobs) {
    const job = await claimNextTweetLikersSyncJob(workerId);
    if (!job) break;

    processedJobs += 1;
    try {
      const run = await processTweetLikersPage({
        tweetId: job.tweet_id,
        appMinIntervalMs,
        clientMinIntervalMs,
      });

      const stats = {
        pages_processed: run.stats.pagesProcessed,
        users_seen: run.stats.usersSeen,
        upserted: run.stats.upserted,
        modified: run.stats.modified,
        backfill_complete: run.backfillComplete,
      };

      if (run.requiresOauth) {
        await markTweetLikersSyncJobFailed({
          tweetId: job.tweet_id,
          error: 'OAuth required (tweet author must connect their X account).',
          stats,
        });
        failedJobs += 1;
        results.push({ tweet_id: job.tweet_id, status: 'failed', reason: 'requires_oauth', ...run });
        continue;
      }

      if (run.rateLimited || run.throttled) {
        await markTweetLikersSyncJobRetrying({
          tweetId: job.tweet_id,
          error: run.rateLimited ? 'Rate limited (429)' : 'Throttled (app/client gate)',
          retryAfterSeconds: run.retryAfterSeconds ?? 60,
          stats,
        });
        retriedJobs += 1;
        results.push({ tweet_id: job.tweet_id, status: 'retrying', ...run });
        continue;
      }

      if (run.backfillComplete) {
        await markTweetLikersSyncJobCompleted({
          tweetId: job.tweet_id,
          stats,
        });
        completedJobs += 1;
        results.push({ tweet_id: job.tweet_id, status: 'completed', ...run });
      } else {
        await markTweetLikersSyncJobPending({
          tweetId: job.tweet_id,
          stats,
        });
        results.push({ tweet_id: job.tweet_id, status: 'pending', ...run });
      }
    } catch (error) {
      failedJobs += 1;
      await markTweetLikersSyncJobFailed({
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

