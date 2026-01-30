import { claimJob, completeJob, failJob, Job } from '../job-queue';
import { RetweetsWorker } from './retweets-worker';
import { RepliesWorker } from './replies-worker';
import { QuotesWorker } from './quotes-worker';
import { MetricsWorker } from './metrics-worker';
import { LikingUsersWorker } from './liking-users-worker';
import { LocationEnrichmentWorker } from './location-enrichment-worker';
import { BaseWorker } from './base-worker';

/**
 * Worker Orchestrator
 * Manages worker pool and job distribution
 */
export class WorkerOrchestrator {
  private workers: Map<string, BaseWorker>;
  private concurrency: number;
  private isRunning: boolean = false;
  
  constructor(concurrency: number = 5) {
    this.concurrency = concurrency;
    this.workers = new Map();
  }
  
  /**
   * Process a single job
   */
  private async processJob(job: Job, workerId: string): Promise<void> {
    let worker: BaseWorker;
    
    // Get or create appropriate worker
    const workerKey = `${job.job_type}-${workerId}`;
    if (!this.workers.has(workerKey)) {
      switch (job.job_type) {
        case 'retweets':
          worker = new RetweetsWorker(workerId);
          break;
        case 'replies':
          worker = new RepliesWorker(workerId);
          break;
        case 'quotes':
          worker = new QuotesWorker(workerId);
          break;
        case 'metrics':
          worker = new MetricsWorker(workerId);
          break;
        case 'liking_users':
          worker = new LikingUsersWorker(workerId);
          break;
        case 'location_enrichment':
          worker = new LocationEnrichmentWorker(workerId);
          break;
        default:
          throw new Error(`Unknown job type: ${job.job_type}`);
      }
      this.workers.set(workerKey, worker);
    } else {
      worker = this.workers.get(workerKey)!;
    }
    
    try {
      // Execute worker
      await worker.execute(job);
      
      // Mark job as completed
      if (job._id) {
        await completeJob(job._id);
      }
      
      // If this was an engagement job (not metrics or location_enrichment), trigger alert detection
      if (job.job_type !== 'metrics' && job.job_type !== 'location_enrichment') {
        try {
          const { detectAndQueueAlerts } = await import('../alert-detector');
          await detectAndQueueAlerts(job.campaign_id);
        } catch (error) {
          // Log but don't fail the job
          console.error('Error detecting alerts:', error);
        }
      } else if (job.job_type === 'metrics') {
        // If this was a metrics job, check if we should create snapshot
        try {
          const { processMetricSnapshots } = await import('../metric-snapshot-processor');
          await processMetricSnapshots(job.campaign_id);
        } catch (error) {
          // Log but don't fail the job
          console.error('Error processing metric snapshot:', error);
        }
      }
      
      // Note: liking_users jobs also trigger alert detection since they're engagement jobs
    } catch (error) {
      // Mark job as failed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (job._id) {
        await failJob(job._id, errorMessage);
      }
      throw error;
    }
  }
  
  /**
   * Process jobs with concurrency limit
   */
  async processJobs(maxJobs: number = 100): Promise<{
    processed: number;
    completed: number;
    failed: number;
  }> {
    const stats = {
      processed: 0,
      completed: 0,
      failed: 0,
    };
    
    const workerId = `orchestrator-${Date.now()}`;
    const activeJobs: Promise<void>[] = [];
    
    while (stats.processed < maxJobs) {
      // Claim a job
      const job = await claimJob(workerId);
      
      if (!job) {
        // No more jobs available
        break;
      }
      
      stats.processed++;
      
      // Create job processing promise
      const jobPromise = this.processJob(job, workerId)
        .then(() => {
          stats.completed++;
        })
        .catch(() => {
          stats.failed++;
        })
        .finally(() => {
          // Remove from active jobs
          const index = activeJobs.indexOf(jobPromise);
          if (index > -1) {
            activeJobs.splice(index, 1);
          }
        });
      
      activeJobs.push(jobPromise);
      
      // Wait if we've reached concurrency limit
      if (activeJobs.length >= this.concurrency) {
        await Promise.race(activeJobs);
      }
    }
    
    // Wait for all remaining jobs to complete
    await Promise.all(activeJobs);
    
    return stats;
  }
  
  /**
   * Start continuous processing (for long-running worker service)
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    
    this.isRunning = true;
    
    while (this.isRunning) {
      try {
        await this.processJobs(100);
        
        // Small delay before next batch
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error('Error in worker orchestrator:', error);
        // Continue processing despite errors
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
  
  /**
   * Stop continuous processing
   */
  stop(): void {
    this.isRunning = false;
  }
}

// Re-export BaseWorker for convenience
export { BaseWorker } from './base-worker';

