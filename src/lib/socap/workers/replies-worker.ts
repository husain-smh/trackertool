import { BaseWorker } from './base-worker';
import { Job } from '../job-queue';
import { WorkerState } from '../../models/socap/worker-state';
import { fetchTweetReplies } from '../../twitter-api-client';
import { createOrUpdateEngagement } from '../../models/socap/engagements';
import { processEngagement } from '../engagement-processor';
import { updateWorkerState } from '../../models/socap/worker-state';
import { getEngagementsByTweet } from '../../models/socap/engagements';

/**
 * Replies Worker
 * Fetches replies and processes them with delta detection
 */
export class RepliesWorker extends BaseWorker {
  protected async processJob(job: Job, state: WorkerState): Promise<void> {
    const tweetId = job.tweet_id;
    const campaignId = job.campaign_id;
    
    // Determine if this is first run (backfill) or subsequent run (delta)
    const isFirstRun = !state.cursor && !state.last_success;
    
    if (isFirstRun) {
      // First run: Backfill all replies
      await this.backfillReplies(campaignId, tweetId, state);
    } else {
      // Subsequent run: Delta detection
      await this.processDelta(campaignId, tweetId, state);
    }
  }
  
  /**
   * Backfill all existing replies
   */
  private async backfillReplies(
    campaignId: string,
    tweetId: string,
    _state: WorkerState
  ): Promise<void> {
    // State not needed in backfill; keep signature aligned with caller
    void _state;
    let cursor: string | null = null;
    let allProcessed = 0;
    
    while (true) {
      const response = await fetchTweetReplies(tweetId, {
        cursor: cursor || undefined,
        maxPages: 1, // Process one page at a time
      });
      
      // Process each reply
      for (const user of response.data) {
        // Replies API provides engagement timestamp
        const timestamp = user.engagementCreatedAt || new Date();
        
        const engagementInput = await processEngagement(
          campaignId,
          tweetId,
          user,
          'reply',
          timestamp
          // Note: We don't have reply text from FilteredUser, would need to fetch separately
        );
        
        await createOrUpdateEngagement(engagementInput);
        allProcessed++;
      }
      
      // Update cursor
      cursor = response.nextCursor || null;
      
      // Update state after each page
      await updateWorkerState(campaignId, tweetId, 'replies', {
        cursor,
      });
      
      // Stop if no more pages
      if (!response.hasMore || !cursor) {
        break;
      }
    }
    
    // Mark as successful
    await updateWorkerState(campaignId, tweetId, 'replies', {
      last_success: new Date(),
      cursor,
    });
    
    console.log(`Backfilled ${allProcessed} replies for tweet ${tweetId}`);
  }
  
  /**
   * Process delta (new replies only)
   */
  private async processDelta(
    campaignId: string,
    tweetId: string,
    state: WorkerState
  ): Promise<void> {
    // Fetch first page with stored cursor
    const response = await fetchTweetReplies(tweetId, {
      cursor: state.cursor || undefined,
      maxPages: 1,
    });
    
    // Get existing engagements to check timestamps
    const existingEngagements = await getEngagementsByTweet(tweetId);
    const existingReplies = existingEngagements.filter((e) => e.action_type === 'reply');
    const existingUserIds = new Set(existingReplies.map((e) => e.user_id));
    const lastSuccessTime = state.last_success || new Date(0);
    
    let newCount = 0;
    let updatedCount = 0;
    let shouldStop = false;
    
    // Process replies (newest first)
    for (const user of response.data) {
      const timestamp = user.engagementCreatedAt || new Date();
      const isNew = !existingUserIds.has(user.userId);
      
      // Stop condition: if we encounter a reply with timestamp older than last_success,
      // all newer items have been processed
      if (!isNew && timestamp < lastSuccessTime) {
        shouldStop = true;
        break;
      }
      
      const engagementInput = await processEngagement(
        campaignId,
        tweetId,
        user,
        'reply',
        timestamp
      );
      
      await createOrUpdateEngagement(engagementInput);
      
      if (isNew) {
        newCount++;
      } else {
        updatedCount++;
      }
    }
    
    // Update cursor if we got a new one and didn't stop
    if (response.nextCursor && !shouldStop) {
      await updateWorkerState(campaignId, tweetId, 'replies', {
        cursor: response.nextCursor,
      });
    }
    
    // Mark as successful
    await updateWorkerState(campaignId, tweetId, 'replies', {
      last_success: new Date(),
    });
    
    console.log(
      `Delta processed for tweet ${tweetId}: ${newCount} new, ${updatedCount} updated replies`
    );
  }
}

