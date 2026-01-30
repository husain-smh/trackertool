/**
 * Database Initialization Script for Twitter Ranker
 * 
 * Run this once to create all necessary indexes for optimal performance.
 * You can run it multiple times safely - MongoDB will skip existing indexes.
 * 
 * Usage:
 * 1. Create a page or API route that calls initializeRankerDatabase()
 * 2. Or run from a Node script
 */

import { createIndexes as createRankerIndexes } from './models/ranker';
import { createTweetsIndexes } from './models/tweets';
import { createMonitoringIndexes } from './models/monitoring';
import { createLocationCacheIndexes } from './models/location-cache';
import { createTweetLocationEnrichmentJobIndexes } from './models/tweet-location-enrichment-jobs';
import { createTweetLikersSyncJobIndexes } from './models/tweet-likers-sync-jobs';
import { createTweetLikersStateIndexes } from './models/tweet-likers-state';
import { createRateLimitStateIndexes } from './models/rate-limit-state';
import { logger } from './logger';

export async function initializeRankerDatabase(): Promise<void> {
  const operationId = `init-db-${Date.now()}`;
  
  try {
    logger.info('Initializing Twitter Ranker database', { 
      operation: 'initializeRankerDatabase',
      operationId 
    });
    
    logger.info('Creating indexes for optimal performance', { 
      operation: 'createIndexes',
      operationId 
    });
    
    // Ranker DB is used by multiple Social Capital subsystems.
    // Create indexes for all collections that need to be performant.
    await Promise.all([
      createRankerIndexes(),
      createTweetsIndexes(),
      createMonitoringIndexes(),
      createLocationCacheIndexes(),
      createTweetLocationEnrichmentJobIndexes(),
      createTweetLikersSyncJobIndexes(),
      createTweetLikersStateIndexes(),
      createRateLimitStateIndexes(),
    ]);
    
    logger.info('Database initialization complete', { 
      operation: 'initializeRankerDatabase',
      operationId,
      indexes: {
        important_people: ['username', 'user_id', 'is_active'],
        following_index: ['followed_user_id', 'followed_username', 'importance_score', 'followed_by.user_id'],
        engagement_rankings: ['tweet_id', 'analyzed_at'],
        tweets: ['tweet_id', 'status', 'metrics.last_updated', 'created_at'],
        engagers: ['tweet_id', 'tweet_id+userId', 'importance_score', 'followers', 'username', 'account_based_in*'],
        monitoring_jobs: ['tweet_id', 'status', 'started_at'],
        metric_snapshots: ['tweet_id', 'timestamp'],
        username_location_cache: ['username', 'status', 'updated_at'],
        tweet_location_enrichment_jobs: ['tweet_id', 'status', 'retry_after', 'updated_at'],
        tweet_likers_sync_jobs: ['tweet_id', 'status', 'retry_after', 'updated_at'],
        tweet_likers_state: ['tweet_id', 'blocked_until'],
        rate_limit_state: ['next_allowed_at'],
      }
    });
    
    logger.info('System ready for use', { operationId });
    
  } catch (error) {
    logger.error('Database initialization failed', error, { 
      operation: 'initializeRankerDatabase',
      operationId 
    });
    throw error;
  }
}

