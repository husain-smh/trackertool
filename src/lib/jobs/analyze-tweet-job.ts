/**
 * Background job for analyzing tweets
 * Runs async without blocking API responses
 */

import { analyzeTweet, type AnalysisResult } from '../tweet-analysis-orchestrator';
import { logger } from '../logger';
import { metricsTracker } from '../metrics-tracker';

export interface JobStatus {
  id: string;
  tweetId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number; // 0-100
  result?: AnalysisResult;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

class JobQueue {
  private jobs: Map<string, JobStatus> = new Map();
  private running: Set<string> = new Set();

  /**
   * Add a job to the queue
   */
  async enqueue(
    tweetId: string,
    tweetUrl: string,
    options: {
      reanalyze?: boolean;
      authorName?: string;
      authorUsername?: string;
    } = {}
  ): Promise<string> {
    const jobId = `job_${tweetId}_${Date.now()}`;
    
    const job: JobStatus = {
      id: jobId,
      tweetId,
      status: 'pending',
      progress: 0,
      startedAt: new Date(),
    };

    this.jobs.set(jobId, job);

    // Start processing immediately (fire and forget)
    this.processJob(jobId, tweetId, tweetUrl, options).catch(error => {
      logger.error('Job processing error', error, { jobId, tweetId });
    });

    return jobId;
  }

  /**
   * Process a job
   */
  private async processJob(
    jobId: string,
    tweetId: string,
    tweetUrl: string,
    options: {
      reanalyze?: boolean;
      authorName?: string;
      authorUsername?: string;
    }
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    if (this.running.has(jobId)) {
      logger.warn('Job already running', { jobId, tweetId });
      return;
    }

    this.running.add(jobId);
    job.status = 'running';
    job.progress = 10;

    const jobMetricId = metricsTracker.start('job_analyze_tweet', { jobId, tweetId });

    try {
      logger.info('Processing job', { jobId, tweetId });
      job.progress = 20;

      const result = await analyzeTweet(tweetId, tweetUrl, options);
      
      job.progress = 90;
      job.result = result;
      job.status = 'completed';
      job.completedAt = new Date();
      job.progress = 100;

      logger.info('Job completed', { jobId, tweetId });
      metricsTracker.end(jobMetricId, true);
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();

      logger.error('Job failed', error, { jobId, tweetId });
      metricsTracker.end(jobMetricId, false, job.error);
    } finally {
      this.running.delete(jobId);
    }
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): JobStatus | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get job status by tweet ID
   */
  getJobByTweetId(tweetId: string): JobStatus | null {
    for (const job of this.jobs.values()) {
      if (job.tweetId === tweetId) {
        return job;
      }
    }
    return null;
  }

  /**
   * Clean up old completed jobs (keep last 1000)
   */
  cleanup() {
    const allJobs = Array.from(this.jobs.entries())
      .sort((a, b) => {
        const timeA = a[1].completedAt?.getTime() || a[1].startedAt.getTime();
        const timeB = b[1].completedAt?.getTime() || b[1].startedAt.getTime();
        return timeB - timeA;
      })
      .slice(0, 1000);

    this.jobs.clear();
    allJobs.forEach(([id, job]) => {
      this.jobs.set(id, job);
    });
  }
}

export const jobQueue = new JobQueue();

// Cleanup old jobs every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    jobQueue.cleanup();
  }, 10 * 60 * 1000);
}

