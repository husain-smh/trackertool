/**
 * Location Enrichment Service
 * 
 * Handles fetching accurate location data for engagers and updating their engagement records.
 * Prioritizes users by importance_score first, then by follower count.
 * 
 * This service runs in the background without blocking other jobs.
 */

import { getEngagementsCollection } from '../models/socap/engagements';
import { fetchUserAbout, extractAccountBasedIn } from './user-about-api';
import { logger } from '../logger';
import { TwitterApiError } from '../external-api';

export interface LocationEnrichmentStats {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  rateLimited: number;
}

/**
 * Get users that need location enrichment, prioritized by importance_score and followers
 * 
 * Priority order:
 * 1. Highest importance_score
 * 2. Highest followers (for tie-breaking)
 * 
 * @param campaignId - Campaign ID to process
 * @param limit - Maximum number of users to process (default: 50)
 * @returns Array of unique usernames with their priority scores
 */
export async function getUsersNeedingLocationEnrichment(
  campaignId: string,
  limit: number = 50
): Promise<Array<{ username: string; user_id: string; priority_score: number; importance_score: number; followers: number }>> {
  const collection = await getEngagementsCollection();
  
  // Aggregate to get unique users with their highest importance_score and followers
  const pipeline = [
    {
      $match: {
        campaign_id: campaignId,
        // Only process users who don't have account_based_in yet
        $or: [
          { 'account_profile.account_based_in': { $exists: false } },
          { 'account_profile.account_based_in': '' },
        ],
      },
    },
    {
      $group: {
        _id: '$user_id',
        username: { $first: '$account_profile.username' },
        // Get the highest importance_score for this user
        max_importance_score: { $max: '$importance_score' },
        // Get the highest follower count for this user
        max_followers: { $max: '$account_profile.followers' },
      },
    },
    {
      $project: {
        _id: 0,
        user_id: '$_id',
        username: 1,
        importance_score: '$max_importance_score',
        followers: '$max_followers',
        // Calculate priority score: importance_score * 1000000 + followers
        // This ensures importance_score is the primary sort, followers is secondary
        priority_score: {
          $add: [
            { $multiply: ['$max_importance_score', 1000000] },
            '$max_followers',
          ],
        },
      },
    },
    {
      $sort: { priority_score: -1 }, // Highest priority first
    },
    {
      $limit: limit,
    },
  ];
  
  const results = await collection.aggregate(pipeline).toArray();
  
  return results.map((r: any) => ({
    username: r.username,
    user_id: r.user_id,
    priority_score: r.priority_score,
    importance_score: r.importance_score,
    followers: r.followers,
  }));
}

/**
 * Enrich location for a single user
 * 
 * @param campaignId - Campaign ID
 * @param username - Twitter username (without @)
 * @returns true if location was updated, false otherwise
 */
export async function enrichUserLocation(
  campaignId: string,
  username: string
): Promise<boolean> {
  try {
    // Fetch accurate location from API
    const userAbout = await fetchUserAbout(username, 2, 'shared');
    const accountBasedIn = extractAccountBasedIn(userAbout);
    
    if (!accountBasedIn) {
      // No location data available - mark as processed to avoid retrying
      await markLocationAsProcessed(campaignId, username, null);
      return false;
    }
    
    // Update all engagements for this user in this campaign
    const collection = await getEngagementsCollection();
    const result = await collection.updateMany(
      {
        campaign_id: campaignId,
        'account_profile.username': username,
      },
      {
        $set: {
          'account_profile.account_based_in': accountBasedIn,
        },
      }
    );
    
    logger.info('Location enriched for user', {
      campaign_id: campaignId,
      username,
      account_based_in: accountBasedIn,
      engagements_updated: result.modifiedCount,
    });
    
    return result.modifiedCount > 0;
  } catch (error) {
    if (error instanceof TwitterApiError) {
      // Handle specific error types
      if (error.statusCode === 404) {
        // User not found - mark as processed to avoid retrying
        await markLocationAsProcessed(campaignId, username, null);
        logger.warn('User not found for location enrichment', {
          campaign_id: campaignId,
          username,
        });
        return false;
      }
      
      if (error.statusCode === 429) {
        // Rate limited - don't mark as processed, will retry later
        logger.warn('Rate limited while enriching location', {
          campaign_id: campaignId,
          username,
        });
        throw error; // Re-throw to signal rate limit
      }
      
      if (error.statusCode === 402) {
        // Credits exhausted - don't mark as processed
        logger.error('API credits exhausted for location enrichment', {
          campaign_id: campaignId,
          username,
        });
        throw error;
      }
    }
    
    // Other errors - log and re-throw
    logger.error('Error enriching location', error, {
      campaign_id: campaignId,
      username,
    });
    throw error;
  }
}

/**
 * Mark location as processed (even if no location was found)
 * This prevents retrying users who don't have location data available
 * 
 * @param campaignId - Campaign ID
 * @param username - Twitter username
 * @param accountBasedIn - Location data (null if not available)
 */
async function markLocationAsProcessed(
  campaignId: string,
  username: string,
  accountBasedIn: string | null
): Promise<void> {
  const collection = await getEngagementsCollection();
  
  await collection.updateMany(
    {
      campaign_id: campaignId,
      'account_profile.username': username,
    },
    {
      $set: {
        'account_profile.account_based_in': accountBasedIn || null,
      },
    }
  );
}

/**
 * Process location enrichment for a campaign
 * Processes users in priority order (importance_score → followers)
 * 
 * @param campaignId - Campaign ID to process
 * @param maxUsers - Maximum number of users to process in this batch (default: 20)
 * @param delayBetweenRequests - Delay in ms between API requests (default: 1000ms)
 * @returns Statistics about the enrichment process
 */
export async function processLocationEnrichment(
  campaignId: string,
  maxUsers: number = 20,
  delayBetweenRequests: number = 1000
): Promise<LocationEnrichmentStats> {
  const stats: LocationEnrichmentStats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    rateLimited: 0,
  };
  
  try {
    // Get users that need location enrichment, prioritized
    const users = await getUsersNeedingLocationEnrichment(campaignId, maxUsers);
    
    if (users.length === 0) {
      logger.info('No users need location enrichment', { campaign_id: campaignId });
      return stats;
    }
    
    logger.info('Starting location enrichment batch', {
      campaign_id: campaignId,
      user_count: users.length,
    });
    
    // Process users one at a time (API is rate-limited)
    for (const user of users) {
      try {
        // Add delay between requests to respect rate limits
        if (stats.processed > 0) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
        }
        
        const updated = await enrichUserLocation(campaignId, user.username);
        
        stats.processed++;
        if (updated) {
          stats.updated++;
        } else {
          stats.skipped++;
        }
        
        logger.debug('Processed user location enrichment', {
          campaign_id: campaignId,
          username: user.username,
          updated,
          priority_score: user.priority_score,
        });
      } catch (error) {
        stats.processed++;
        stats.errors++;
        
        if (error instanceof TwitterApiError && error.statusCode === 429) {
          stats.rateLimited++;
          // Rate limited - stop processing this batch
          logger.warn('Rate limited during location enrichment batch', {
            campaign_id: campaignId,
            processed: stats.processed,
            remaining: users.length - stats.processed,
          });
          break; // Stop processing, will retry later
        }
        
        // Log error but continue with next user
        logger.error('Error processing user location enrichment', error, {
          campaign_id: campaignId,
          username: user.username,
        });
      }
    }
    
    logger.info('Completed location enrichment batch', {
      campaign_id: campaignId,
      stats,
    });
    
    return stats;
  } catch (error) {
    logger.error('Error in location enrichment process', error, {
      campaign_id: campaignId,
    });
    throw error;
  }
}

/**
 * Queue location enrichment for newly created engagements
 * This is called automatically when engagements are created
 * 
 * @param campaignId - Campaign ID
 * @param username - Twitter username that needs location enrichment
 */
export async function queueLocationEnrichment(
  campaignId: string,
  username: string
): Promise<void> {
  // Location enrichment is handled automatically by the worker
  // This function exists for future extensibility (e.g., explicit queuing)
  // For now, the worker will pick up users that need enrichment
  logger.debug('Location enrichment queued (handled by worker)', {
    campaign_id: campaignId,
    username,
  });
}

