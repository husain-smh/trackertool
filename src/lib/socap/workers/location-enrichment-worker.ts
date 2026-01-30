/**
 * Location Enrichment Worker
 * 
 * Processes location enrichment jobs for campaigns.
 * Fetches accurate location data for engagers and updates their engagement records.
 * 
 * This worker runs in the background with low priority and doesn't block other jobs.
 */

import { BaseWorker } from './base-worker';
import { Job, enqueueLocationEnrichmentJob } from '../job-queue';
import { WorkerState } from '../../models/socap/worker-state';
import { processLocationEnrichment, getUsersNeedingLocationEnrichment } from '../location-enrichment-service';
import { logger } from '../../logger';

export class LocationEnrichmentWorker extends BaseWorker {
  /**
   * Process location enrichment job for a campaign
   * 
   * Note: For location enrichment, the tweet_id in the job represents the campaign_id
   * since location enrichment is per-campaign, not per-tweet.
   */
  protected async processJob(job: Job, state: WorkerState): Promise<void> {
    const campaignId = job.campaign_id;
    
    // For location enrichment, we process users at the campaign level
    // The job queue uses tweet_id as a placeholder, but we ignore it
    // and process all users in the campaign that need enrichment
    
    logger.info('Processing location enrichment job', {
      campaign_id: campaignId,
      job_id: job._id,
      job_type: job.job_type,
    });
    
    try {
      // Process up to 20 users per job run (configurable)
      // This prevents long-running jobs and allows for better rate limit handling
      const maxUsersPerRun = parseInt(
        process.env.LOCATION_ENRICHMENT_BATCH_SIZE || '20',
        10
      );
      
      // Delay between API requests (default: 1 second to respect rate limits)
      const delayBetweenRequests = parseInt(
        process.env.LOCATION_ENRICHMENT_DELAY_MS || '1000',
        10
      );
      
      const stats = await processLocationEnrichment(
        campaignId,
        maxUsersPerRun,
        delayBetweenRequests
      );
      
      logger.info('Location enrichment job completed', {
        campaign_id: campaignId,
        job_id: job._id,
        stats,
      });
      
      // Check if there are more users that need location enrichment
      // If so, re-queue the job to continue processing
      const remainingUsers = await getUsersNeedingLocationEnrichment(campaignId, 1);
      if (remainingUsers.length > 0 && stats.rateLimited === 0) {
        // Re-queue if there are more users and we didn't hit rate limits
        await enqueueLocationEnrichmentJob(campaignId);
        logger.info('Re-queued location enrichment job for remaining users', {
          campaign_id: campaignId,
          remaining_users: remainingUsers.length,
        });
      }
    } catch (error) {
      logger.error('Location enrichment job failed', error, {
        campaign_id: campaignId,
        job_id: job._id,
      });
      throw error;
    }
  }
  
  /**
   * Check if error is a rate limit error
   * Location enrichment should handle rate limits gracefully
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
   * Get retry delay for rate limit errors
   * Use longer delays for location enrichment since it's low priority
   */
  protected getRetryAfter(error: unknown): number {
    // Default to 5 minutes for location enrichment (longer than other workers)
    if (error instanceof Error && 'retryAfter' in error) {
      return (error as any).retryAfter || 300;
    }
    return 300; // 5 minutes
  }
}

