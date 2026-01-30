import { BaseWorker } from './base-worker';
import { Job } from '../job-queue';
import { WorkerState } from '../../models/socap/worker-state';
import { fetchTweetRetweets } from '../../twitter-api-client';
import { createOrUpdateEngagement } from '../../models/socap/engagements';
import { processEngagement } from '../engagement-processor';
import { updateWorkerState } from '../../models/socap/worker-state';
import { getEngagementsByTweet } from '../../models/socap/engagements';

/**
 * Retweets Worker
 * Fetches retweeters and processes them with proper backfill continuation.
 * 
 * Key behavior:
 * - Backfill: Fetches ALL retweeters by paginating through the entire list
 * - Only marks backfill_complete when ALL pages have been fetched
 * - If interrupted, resumes backfill from the saved cursor
 * - Delta mode: After backfill, fetches new retweeters (first page only)
 */
export class RetweetsWorker extends BaseWorker {
  protected async processJob(job: Job, state: WorkerState): Promise<void> {
    const tweetId = job.tweet_id;
    const campaignId = job.campaign_id;
    
    // Check if backfill has been completed
    // If backfill_complete is false/undefined, we need to continue or start backfilling
    const needsBackfill = !state.backfill_complete;
    
    if (needsBackfill) {
      // Continue or start backfill - will resume from cursor if one exists
      await this.backfillRetweeters(campaignId, tweetId, state);
    } else {
      // Backfill complete - just fetch new retweeters (delta)
      await this.processDelta(campaignId, tweetId, state);
    }
  }
  
  /**
   * Backfill all existing retweeters
   * Continues from saved cursor if backfill was previously interrupted
   */
  private async backfillRetweeters(
    campaignId: string,
    tweetId: string,
    state: WorkerState
  ): Promise<void> {
    // Resume from saved cursor if available (backfill was interrupted)
    let cursor: string | null = state.cursor || null;
    let allProcessed = 0;
    let pageCount = 0;
    
    const isResume = !!cursor;
    if (isResume) {
      console.log(`[RetweetsWorker] Resuming backfill for tweet ${tweetId} from cursor`);
    } else {
      console.log(`[RetweetsWorker] Starting fresh backfill for tweet ${tweetId}`);
    }
    
    while (true) {
      const response = await fetchTweetRetweets(tweetId, {
        cursor: cursor || undefined,
        maxPages: 1, // Process one page at a time
      });
      
      pageCount++;
      
      // Process each retweeter
      for (const user of response.data) {
        // For retweets, we don't have engagement timestamp from API
        // Use current time as approximation (API returns newest first)
        const timestamp = new Date();
        
        const engagementInput = await processEngagement(
          campaignId,
          tweetId,
          user,
          'retweet',
          timestamp
        );
        
        await createOrUpdateEngagement(engagementInput);
        allProcessed++;
      }
      
      // Update cursor after each page (for resume capability)
      cursor = response.nextCursor || null;
      
      // Save cursor progress after each page - enables resume if interrupted
      await updateWorkerState(campaignId, tweetId, 'retweets', {
        cursor,
      });
      
      console.log(`[RetweetsWorker] Page ${pageCount}: processed ${response.data.length} retweeters (total: ${allProcessed})`);
      
      // Stop if no more pages
      if (!response.hasMore || !cursor) {
        break;
      }
    }
    
    // Backfill complete - mark it as done so future runs go to delta mode
    await updateWorkerState(campaignId, tweetId, 'retweets', {
      last_success: new Date(),
      cursor: null, // Clear cursor - backfill is complete
      backfill_complete: true, // KEY: Mark backfill as done
    });
    
    console.log(`[RetweetsWorker] ✅ Backfill complete for tweet ${tweetId}: ${allProcessed} retweeters across ${pageCount} pages`);
  }
  
  /**
   * Process delta (new retweeters only)
   * Called after backfill is complete - just checks for new retweets
   */
  private async processDelta(
    campaignId: string,
    tweetId: string,
    _state: WorkerState
  ): Promise<void> {
    // Fetch first page (newest retweeters) - no cursor, start fresh
    const response = await fetchTweetRetweets(tweetId, {
      maxPages: 1,
    });
    
    // Get existing engagements to check for duplicates
    const existingEngagements = await getEngagementsByTweet(tweetId);
    const existingUserIds = new Set(
      existingEngagements
        .filter((e) => e.action_type === 'retweet')
        .map((e) => e.user_id)
    );
    
    let newCount = 0;
    let existingCount = 0;
    
    // Process retweeters (newest first from API)
    for (const user of response.data) {
      const isNew = !existingUserIds.has(user.userId);
      
      if (isNew) {
        const timestamp = new Date(); // Approximate timestamp for new retweets
        
        const engagementInput = await processEngagement(
          campaignId,
          tweetId,
          user,
          'retweet',
          timestamp
        );
        
        await createOrUpdateEngagement(engagementInput);
        newCount++;
      } else {
        existingCount++;
        // Once we hit an existing user, all subsequent users in this page
        // are likely also existing (API returns newest first)
        // But we continue processing the full page to be safe
      }
    }
    
    // Mark as successful
    await updateWorkerState(campaignId, tweetId, 'retweets', {
      last_success: new Date(),
    });
    
    console.log(
      `[RetweetsWorker] Delta for tweet ${tweetId}: ${newCount} new, ${existingCount} existing (checked ${response.data.length} users)`
    );
  }
}

