import { NextRequest, NextResponse } from 'next/server';
import {
  AutoAnalysisJob,
  claimNextAnalysisJob,
  releaseAnalysisJobClaim,
  markAnalysisJobComplete,
  markAnalysisJobFailed,
  incrementRetryCount,
} from '@/lib/models/auto-analysis-jobs';
import { analyzeTweet } from '@/lib/tweet-analysis-orchestrator';

const MAX_RETRIES = 3;

interface JobResult {
  tweet_id: string;
  success: boolean;
  error?: string;
}

interface BatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  jobs: JobResult[];
}

async function processAnalysisJob(
  job: AutoAnalysisJob,
  jobType: 'first' | 'second'
): Promise<JobResult> {
  const tweetId = job.tweet_id;

  try {
    console.log(`[cron-auto-analysis] Running ${jobType} analysis for ${tweetId}`);

    await analyzeTweet(tweetId, job.tweet_url, {
      reanalyze: true,
      authorUsername: job.x_username,
    });

    const newStatus = jobType === 'first' ? 'first_done' : 'complete';
    const timestampField = jobType === 'first' ? 'first_analysis_at' : 'second_analysis_at';

    await markAnalysisJobComplete(tweetId, newStatus, {
      [timestampField]: new Date(),
    });

    console.log(`[cron-auto-analysis] ${jobType} analysis complete for ${tweetId}`);

    return { tweet_id: tweetId, success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[cron-auto-analysis] ${jobType} analysis failed for ${tweetId}:`, msg);

    // Check if we've exceeded max retries
    if (job.retry_count + 1 >= MAX_RETRIES) {
      await markAnalysisJobFailed(tweetId, `Exceeded ${MAX_RETRIES} retries: ${msg}`);
    } else {
      await incrementRetryCount(tweetId);
      await releaseAnalysisJobClaim(tweetId);
    }

    return { tweet_id: tweetId, success: false, error: msg };
  }
}

async function processJobsBatch(
  workerId: string,
  jobType: 'first' | 'second',
  maxJobs: number
): Promise<BatchResult> {
  const jobs: AutoAnalysisJob[] = [];

  // Claim up to maxJobs atomically
  for (let i = 0; i < maxJobs; i++) {
    const job = await claimNextAnalysisJob(workerId, jobType);
    if (!job) break;
    jobs.push(job);
  }

  if (jobs.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, jobs: [] };
  }

  console.log(`[cron-auto-analysis] Claimed ${jobs.length} jobs for ${jobType} analysis (worker: ${workerId})`);

  // Process all claimed jobs in parallel
  const results = await Promise.allSettled(
    jobs.map(job => processAnalysisJob(job, jobType))
  );

  // Aggregate results
  const jobResults: JobResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      jobResults.push(result.value);
      if (result.value.success) {
        succeeded++;
      } else {
        failed++;
      }
    } else {
      // Promise rejected (shouldn't happen as processAnalysisJob catches errors)
      failed++;
      jobResults.push({
        tweet_id: 'unknown',
        success: false,
        error: result.reason?.message || 'Promise rejected',
      });
    }
  }

  return {
    processed: jobs.length,
    succeeded,
    failed,
    jobs: jobResults,
  };
}

export async function GET(request: NextRequest) {
  const cronStart = Date.now();
  const { searchParams } = new URL(request.url);

  // Parse maxJobs param (default 5, max 10)
  const maxJobs = Math.min(10, Math.max(1, Number(searchParams.get('maxJobs') ?? 5)));

  // Generate unique worker ID for this invocation
  const workerId = `analysis-worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    console.log(`[cron-auto-analysis] Starting with maxJobs=${maxJobs}, worker=${workerId}`);

    // Process first analysis jobs (48h)
    const firstResults = await processJobsBatch(workerId, 'first', maxJobs);

    // Process second analysis jobs (96h)
    const secondResults = await processJobsBatch(workerId, 'second', maxJobs);

    const totalElapsed = Date.now() - cronStart;

    console.log(
      `[cron-auto-analysis] Complete: first=${firstResults.succeeded}/${firstResults.processed}, ` +
      `second=${secondResults.succeeded}/${secondResults.processed}, elapsed=${totalElapsed}ms`
    );

    return NextResponse.json({
      success: true,
      first_analysis: {
        processed: firstResults.processed,
        succeeded: firstResults.succeeded,
        failed: firstResults.failed,
        jobs: firstResults.jobs,
      },
      second_analysis: {
        processed: secondResults.processed,
        succeeded: secondResults.succeeded,
        failed: secondResults.failed,
        jobs: secondResults.jobs,
      },
      worker_id: workerId,
      elapsed_ms: totalElapsed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[cron-auto-analysis] Fatal error:', error);
    return NextResponse.json(
      {
        error: 'Failed to process auto-analysis',
        details: error instanceof Error ? error.message : 'Unknown error',
        worker_id: workerId,
        elapsed_ms: Date.now() - cronStart,
      },
      { status: 500 }
    );
  }
}
