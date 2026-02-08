/**
 * SOCAP Database Models - Index Initialization
 * 
 * This file exports all models and provides a function to initialize all indexes.
 */

export * from './campaigns';
export * from './tweets';
export * from './quote-tweets';
export * from './nested-quote-tweets';
export * from './engagements';
export * from './worker-state';
export * from './metric-snapshots';
export * from './utils';

import {
  createCampaignIndexes,
  createTweetIndexes,
  createQuoteTweetIndexes,
  createNestedQuoteTweetIndexes,
  createEngagementIndexes,
  createWorkerStateIndexes,
  createMetricSnapshotIndexes,
} from './indexes';

/**
 * Initialize all SOCAP database indexes
 * Call this once during application startup or database setup
 */
export async function initializeSocapIndexes(): Promise<void> {
  try {
    console.log('🚀 Initializing SOCAP database indexes...');
    
    await createCampaignIndexes();
    console.log('✅ Campaign indexes created');
    
    await createTweetIndexes();
    console.log('✅ Tweet indexes created');

    await createQuoteTweetIndexes();
    console.log('✅ Quote tweet indexes created');

    await createNestedQuoteTweetIndexes();
    console.log('✅ Nested quote tweet indexes created');
    
    await createEngagementIndexes();
    console.log('✅ Engagement indexes created');
    
    await createWorkerStateIndexes();
    console.log('✅ Worker state indexes created');
    
    await createMetricSnapshotIndexes();
    console.log('✅ Metric snapshot indexes created');
    
    console.log('✅ All SOCAP indexes initialized!');
  } catch (error) {
    console.error('❌ Error initializing SOCAP indexes:', error);
    throw error;
  }
}

