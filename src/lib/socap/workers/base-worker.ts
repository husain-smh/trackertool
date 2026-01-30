import { Job } from '../job-queue';
import {
  getWorkerState,
  updateWorkerState,
  WorkerState,
} from '../../models/socap/worker-state';

/**
 * Base class for all SOCAP workers
 * Provides common functionality for state management and error handling
 */
export abstract class BaseWorker {
  protected workerId: string;
  
  constructor(workerId?: string) {
    this.workerId = workerId || `worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Main execution method - called by worker orchestrator
   */
  async execute(job: Job): Promise<void> {
    // Load worker state
    let state = await getWorkerState(job.campaign_id, job.tweet_id, job.job_type);
    
    if (!state) {
      // Create state if it doesn't exist
      const { createWorkerState } = await import('../../models/socap/worker-state');
      state = await createWorkerState({
        campaign_id: job.campaign_id,
        tweet_id: job.tweet_id,
        job_type: job.job_type,
      });
    }
    
    // Check if worker is blocked (rate limit, etc.)
    if (state.blocked_until && state.blocked_until > new Date()) {
      console.log(
        `Worker blocked until ${state.blocked_until} for ${job.job_type} on tweet ${job.tweet_id}`
      );
      return; // Skip this job, will retry later
    }
    
    try {
      // Call the specific worker's process method
      await this.processJob(job, state);
      
      // Update state on success
      await updateWorkerState(job.campaign_id, job.tweet_id, job.job_type, {
        last_success: new Date(),
        blocked_until: null,
        last_error: null,
        retry_count: 0,
      });
    } catch (error) {
      // Handle errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Error processing job ${job._id}:`, errorMessage);
      
      // Check if it's a rate limit error
      if (this.isRateLimitError(error)) {
        const retryAfter = this.getRetryAfter(error);
        const blockedUntil = new Date(Date.now() + retryAfter * 1000);
        
        await updateWorkerState(job.campaign_id, job.tweet_id, job.job_type, {
          blocked_until: blockedUntil,
          last_error: errorMessage,
          retry_count: (state.retry_count || 0) + 1,
        });
        
        throw error; // Re-throw to mark job as failed
      }
      
      // Check if it's a cursor expiration error
      if (this.isCursorExpiredError(error)) {
        await updateWorkerState(job.campaign_id, job.tweet_id, job.job_type, {
          cursor: null,
          last_error: errorMessage,
          retry_count: (state.retry_count || 0) + 1,
        });
        
        throw error; // Re-throw to mark job as failed
      }
      
      // Other errors
      await updateWorkerState(job.campaign_id, job.tweet_id, job.job_type, {
        last_error: errorMessage,
        retry_count: (state.retry_count || 0) + 1,
      });
      
      throw error;
    }
  }
  
  /**
   * Abstract method - each worker implements its own processing logic
   */
  protected abstract processJob(job: Job, state: WorkerState): Promise<void>;
  
  /**
   * Check if error is a rate limit error
   */
  protected isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      return (
        error.message.includes('rate limit') ||
        error.message.includes('429') ||
        error.message.includes('RateLimitError')
      );
    }
    return false;
  }
  
  /**
   * Extract retry-after seconds from error
   */
  protected getRetryAfter(error: unknown): number {
    // Default to 60 seconds
    if (error instanceof Error && 'retryAfter' in error) {
      return (error as any).retryAfter || 60;
    }
    return 60;
  }
  
  /**
   * Check if error is a cursor expiration error
   */
  protected isCursorExpiredError(error: unknown): boolean {
    if (error instanceof Error) {
      return (
        error.message.includes('cursor') &&
        (error.message.includes('expired') || error.message.includes('invalid'))
      );
    }
    return false;
  }
}

