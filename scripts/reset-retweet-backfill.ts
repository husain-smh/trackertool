/**
 * Reset Retweet Backfill Script
 * 
 * This script resets the worker state for retweet jobs, allowing them to
 * re-backfill all retweeters from scratch. Use this when:
 * - Retweet backfill was interrupted and didn't complete
 * - You want to refresh all retweet data
 * - The backfill_complete flag was incorrectly set
 * 
 * Usage:
 *   npx tsx scripts/reset-retweet-backfill.ts <campaignId> [tweetId]
 * 
 * Examples:
 *   # Reset all retweet jobs for a campaign
 *   npx tsx scripts/reset-retweet-backfill.ts 507f1f77bcf86cd799439011
 * 
 *   # Reset retweet job for a specific tweet only
 *   npx tsx scripts/reset-retweet-backfill.ts 507f1f77bcf86cd799439011 1234567890
 */

import clientPromise from '../src/lib/mongodb';

async function resetRetweetBackfill(campaignId: string, tweetId?: string): Promise<void> {
  console.log('='.repeat(60));
  console.log('RESET RETWEET BACKFILL');
  console.log('='.repeat(60));
  console.log(`Campaign ID: ${campaignId}`);
  if (tweetId) {
    console.log(`Tweet ID: ${tweetId}`);
  }
  console.log('');
  
  const client = await clientPromise;
  const db = client.db();
  const workerStateCollection = db.collection('socap_worker_state');
  
  // Build query
  const query: Record<string, any> = {
    campaign_id: campaignId,
    job_type: 'retweets',
  };
  
  if (tweetId) {
    query.tweet_id = tweetId;
  }
  
  // First, show what we're about to reset
  const toReset = await workerStateCollection.find(query).toArray();
  
  if (toReset.length === 0) {
    console.log('❌ No retweet worker states found matching criteria.');
    console.log('   Make sure the campaign ID is correct and jobs have been run at least once.');
    return;
  }
  
  console.log(`Found ${toReset.length} retweet worker state(s) to reset:`);
  console.log('');
  
  for (const state of toReset) {
    console.log(`  Tweet: ${state.tweet_id}`);
    console.log(`    - backfill_complete: ${(state as any).backfill_complete ?? 'undefined'}`);
    console.log(`    - cursor: ${state.cursor ? 'exists' : 'null'}`);
    console.log(`    - last_success: ${state.last_success ? state.last_success.toISOString() : 'null'}`);
  }
  
  console.log('');
  console.log('Resetting worker states...');
  
  // Reset the worker states to trigger a fresh backfill
  const result = await workerStateCollection.updateMany(
    query,
    {
      $set: {
        cursor: null,
        last_success: null,
        backfill_complete: false,
        last_error: null,
        retry_count: 0,
        updated_at: new Date(),
      },
    }
  );
  
  console.log(`✅ Reset ${result.modifiedCount} worker state(s).`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. The next job scheduler run will pick up these tweets');
  console.log('  2. The retweet worker will start a fresh backfill');
  console.log('  3. Monitor logs for "[RetweetsWorker] Starting fresh backfill" messages');
  console.log('');
  console.log('To trigger jobs immediately, run:');
  console.log(`  npx tsx scripts/job-scheduler.ts`);
}

// Main execution
const campaignId = process.argv[2];
const tweetId = process.argv[3];

if (!campaignId) {
  console.error('Usage: npx tsx scripts/reset-retweet-backfill.ts <campaignId> [tweetId]');
  console.error('');
  console.error('Arguments:');
  console.error('  campaignId  - Required. The campaign ID to reset retweet backfills for.');
  console.error('  tweetId     - Optional. Specific tweet ID to reset (resets all if omitted).');
  process.exit(1);
}

resetRetweetBackfill(campaignId, tweetId)
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });

