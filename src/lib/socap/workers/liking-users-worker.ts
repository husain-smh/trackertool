import { BaseWorker } from './base-worker';
import { Job } from '../job-queue';
import { WorkerState } from '../../models/socap/worker-state';
import { createOrUpdateEngagement } from '../../models/socap/engagements';
import { processEngagement } from '../engagement-processor';
import { updateWorkerState } from '../../models/socap/worker-state';
import { getEngagementsByTweet } from '../../models/socap/engagements';
import { getValidAccessToken, fetchLikingUsers } from '../twitter-oauth';
import { getCampaignById } from '../../models/socap/campaigns';

/**
 * Liking Users Worker
 * 
 * Fetches users who have liked a main tweet using OAuth 2.0.
 * 
 * IMPORTANT NOTES:
 * - Only works for main tweets (not influencer/investor tweets)
 * - Requires client to have authorized their Twitter account via OAuth
 * - Twitter API privacy restriction: Can only see likes on tweets authored by authenticated user
 * - Rate Limit: 75 requests / 15 minutes per user
 * 
 * Key behavior:
 * - Backfill: Fetches ALL liking users by paginating through the entire list
 * - Only marks backfill_complete when ALL pages have been fetched
 * - If interrupted, resumes backfill from the saved cursor (via pagination_token)
 * - Delta mode: After backfill, fetches new liking users (first page only)
 * 
 * This worker is INDEPENDENT and OPT-IN:
 * - Only runs for campaigns with features.track_liking_users = true
 * - Requires valid OAuth for client's email
 * - Gracefully skips if no OAuth found (logs warning, marks as success)
 */
export class LikingUsersWorker extends BaseWorker {
  protected async processJob(job: Job, state: WorkerState): Promise<void> {
    const tweetId = job.tweet_id;
    const campaignId = job.campaign_id;
    
    // Get campaign to check if liking users tracking is enabled
    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }
    
    // Check if liking users tracking is enabled for this campaign
    if (!campaign.features?.track_liking_users) {
      console.log(`[LikingUsersWorker] Liking users tracking not enabled for campaign ${campaignId} - skipping`);
      // Mark as success (not an error - feature just not enabled)
      await updateWorkerState(campaignId, tweetId, 'liking_users', {
        last_success: new Date(),
        backfill_complete: true, // Don't retry
      });
      return;
    }
    
    // Get tweet category - only process main tweets
    const { getTweetByTweetId } = await import('../../models/socap/tweets');
    const tweet = await getTweetByTweetId(tweetId);
    
    if (!tweet) {
      throw new Error(`Tweet not found: ${tweetId} in campaign ${campaignId}`);
    }
    
    if (tweet.category !== 'main_twt') {
      console.log(`[LikingUsersWorker] Tweet ${tweetId} is not a main tweet (category: ${tweet.category}) - skipping`);
      // Mark as success - this is expected behavior
      await updateWorkerState(campaignId, tweetId, 'liking_users', {
        last_success: new Date(),
        backfill_complete: true, // Don't retry
      });
      return;
    }
    
    // Get valid access token for client
    // Use client_id from campaign - this should match what was used during OAuth authorization
    const clientId = campaign.client_id || campaign.client_info?.email || '';
    const accessToken = await getValidAccessToken(clientId);
    
    if (!accessToken) {
      console.log(`[LikingUsersWorker] No valid OAuth access token for client ${clientId} - skipping tweet ${tweetId}`);
      // This is a soft error - client hasn't authorized yet
      // Don't throw error, just log and mark as success to avoid retries
      await updateWorkerState(campaignId, tweetId, 'liking_users', {
        last_success: new Date(),
        last_error: 'No OAuth access token available. Client needs to authorize their Twitter account.',
        backfill_complete: true, // Don't retry until client authorizes
      });
      return;
    }
    
    // Check if backfill has been completed
    const needsBackfill = !state.backfill_complete;
    
    if (needsBackfill) {
      // Continue or start backfill - will resume from cursor if one exists
      await this.backfillLikingUsers(campaignId, tweetId, accessToken, state);
    } else {
      // Backfill complete - just fetch new liking users (delta)
      await this.processDelta(campaignId, tweetId, accessToken, state);
    }
  }
  
  /**
   * Backfill all existing liking users
   * Continues from saved pagination token if backfill was previously interrupted
   */
  private async backfillLikingUsers(
    campaignId: string,
    tweetId: string,
    accessToken: string,
    state: WorkerState
  ): Promise<void> {
    // Resume from saved pagination token if available (backfill was interrupted)
    let paginationToken: string | undefined = state.cursor || undefined;
    let allProcessed = 0;
    let pageCount = 0;
    
    const isResume = !!paginationToken;
    if (isResume) {
      console.log(`[LikingUsersWorker] Resuming backfill for tweet ${tweetId} from pagination token`);
    } else {
      console.log(`[LikingUsersWorker] Starting fresh backfill for tweet ${tweetId}`);
    }
    
    try {
      while (true) {
        const response = await fetchLikingUsers(tweetId, accessToken, {
          maxResults: 100,
          paginationToken,
        });
        
        pageCount++;
        
        // Process each liking user
        for (const user of response.users) {
          // Convert LikingUser to processEngagement format
          const userForProcessing = {
            userId: user.id,
            username: user.username,
            name: user.name,
            bio: user.description ?? null,
            location: null, // Not provided by liking users API
            followers: user.public_metrics?.followers_count || 0,
            verified: user.verified || false,
          };
          
          // Use the created_at timestamp if available, otherwise current time
          const timestamp = user.created_at ? new Date(user.created_at) : new Date();
          
          const engagementInput = await processEngagement(
            campaignId,
            tweetId,
            userForProcessing,
            'like',
            timestamp
          );
          
          await createOrUpdateEngagement(engagementInput);
          allProcessed++;
        }
        
        // Update pagination token after each page (for resume capability)
        paginationToken = response.nextToken;
        
        // Save cursor progress after each page - enables resume if interrupted
        await updateWorkerState(campaignId, tweetId, 'liking_users', {
          cursor: paginationToken || null,
        });
        
        console.log(`[LikingUsersWorker] Page ${pageCount}: processed ${response.users.length} liking users (total: ${allProcessed})`);
        
        // Stop if no more pages or empty result
        if (!paginationToken || response.resultCount === 0) {
          break;
        }
        
        // Add a small delay to be respectful to rate limits (200ms between pages)
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Backfill complete - mark it as done so future runs go to delta mode
      await updateWorkerState(campaignId, tweetId, 'liking_users', {
        last_success: new Date(),
        cursor: null, // Clear cursor - backfill is complete
        backfill_complete: true, // KEY: Mark backfill as done
      });
      
      console.log(`[LikingUsersWorker] ✅ Backfill complete for tweet ${tweetId}: ${allProcessed} liking users across ${pageCount} pages`);
    } catch (error) {
      // Check if it's a rate limit error
      if (this.isRateLimitError(error)) {
        const retryAfter = this.getRetryAfter(error);
        const blockedUntil = new Date(Date.now() + retryAfter * 1000);
        
        console.log(`[LikingUsersWorker] Rate limit hit for tweet ${tweetId}. Blocked until ${blockedUntil.toISOString()}`);
        
        await updateWorkerState(campaignId, tweetId, 'liking_users', {
          blocked_until: blockedUntil,
          last_error: `Rate limit exceeded. Will retry after ${retryAfter} seconds.`,
        });
      }
      
      throw error; // Re-throw to be handled by base worker
    }
  }
  
  /**
   * Process delta (new liking users only)
   * Called after backfill is complete - just checks for new likes
   */
  private async processDelta(
    campaignId: string,
    tweetId: string,
    accessToken: string,
    _state: WorkerState
  ): Promise<void> {
    try {
      // Fetch first page (newest liking users) - no pagination token, start fresh
      const response = await fetchLikingUsers(tweetId, accessToken, {
        maxResults: 100,
      });
      
      // Get existing engagements to check for duplicates
      const existingEngagements = await getEngagementsByTweet(tweetId);
      const existingUserIds = new Set(
        existingEngagements
          .filter((e) => e.action_type === 'like')
          .map((e) => e.user_id)
      );
      
      let newCount = 0;
      let existingCount = 0;
      
      // Process liking users (newest first from API)
      for (const user of response.users) {
        const isNew = !existingUserIds.has(user.id);
        
        if (isNew) {
          // Convert LikingUser to processEngagement format
          const userForProcessing = {
            userId: user.id,
            username: user.username,
            name: user.name,
            bio: user.description ?? null,
            location: null,
            followers: user.public_metrics?.followers_count || 0,
            verified: user.verified || false,
          };
          
          const timestamp = user.created_at ? new Date(user.created_at) : new Date();
          
          const engagementInput = await processEngagement(
            campaignId,
            tweetId,
            userForProcessing,
            'like',
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
      await updateWorkerState(campaignId, tweetId, 'liking_users', {
        last_success: new Date(),
      });
      
      console.log(
        `[LikingUsersWorker] Delta for tweet ${tweetId}: ${newCount} new, ${existingCount} existing (checked ${response.users.length} users)`
      );
    } catch (error) {
      // Check if it's a rate limit error
      if (this.isRateLimitError(error)) {
        const retryAfter = this.getRetryAfter(error);
        const blockedUntil = new Date(Date.now() + retryAfter * 1000);
        
        console.log(`[LikingUsersWorker] Rate limit hit for tweet ${tweetId}. Blocked until ${blockedUntil.toISOString()}`);
        
        await updateWorkerState(campaignId, tweetId, 'liking_users', {
          blocked_until: blockedUntil,
          last_error: `Rate limit exceeded. Will retry after ${retryAfter} seconds.`,
        });
      }
      
      throw error; // Re-throw to be handled by base worker
    }
  }
}
