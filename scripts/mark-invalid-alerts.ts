/**
 * Script to mark invalid alerts as skipped
 * 
 * Invalid alerts are those where the engagement's tweet_id doesn't belong to the campaign.
 * This happens when engagements were created with wrong campaign_id (from deleted campaigns).
 * 
 * Usage:
 *   npx tsx scripts/mark-invalid-alerts.ts <campaign-id>
 * 
 * Or for all campaigns:
 *   npx tsx scripts/mark-invalid-alerts.ts --all
 */

import clientPromise from '../src/lib/mongodb';
import { getTweetsByCampaign } from '../src/lib/models/socap/tweets';
import { getCampaignById } from '../src/lib/models/socap/campaigns';
import { getAlertsByCampaign } from '../src/lib/models/socap/alert-queue';
import { getEngagementById } from '../src/lib/models/socap/engagements';
import { markAlertAsSkipped } from '../src/lib/models/socap/alert-queue';

async function markInvalidAlertsForCampaign(campaignId: string): Promise<{
  totalAlerts: number;
  invalidAlerts: number;
  markedCount: number;
  errors: number;
}> {
  console.log(`\n=== Processing Campaign: ${campaignId} ===`);
  
  // Verify campaign exists
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    console.error(`❌ Campaign ${campaignId} not found!`);
    return { totalAlerts: 0, invalidAlerts: 0, markedCount: 0, errors: 1 };
  }
  
  console.log(`✓ Campaign found: ${campaign.launch_name || campaignId}`);
  
  // Get all tweets for this campaign
  const campaignTweets = await getTweetsByCampaign(campaignId);
  const validTweetIds = new Set(campaignTweets.map(t => t.tweet_id));
  
  console.log(`✓ Found ${campaignTweets.length} tweets in campaign`);
  console.log(`  Valid tweet IDs: ${Array.from(validTweetIds).slice(0, 5).join(', ')}${validTweetIds.size > 5 ? '...' : ''}`);
  
  // Get all alerts for this campaign
  const alerts = await getAlertsByCampaign(campaignId, { limit: 10000 });
  console.log(`✓ Found ${alerts.length} total alerts for campaign`);
  
  // Check each alert
  const invalidAlerts: Array<{
    alertId: string;
    engagementId: string;
    engagementTweetId: string;
    reason: string;
  }> = [];
  
  for (const alert of alerts) {
    try {
      const engagement = await getEngagementById(alert.engagement_id);
      
      if (!engagement) {
        invalidAlerts.push({
          alertId: String(alert._id),
          engagementId: alert.engagement_id,
          engagementTweetId: 'MISSING',
          reason: 'engagement_not_found',
        });
        continue;
      }
      
      // Check if engagement's tweet_id belongs to this campaign
      if (!validTweetIds.has(engagement.tweet_id)) {
        invalidAlerts.push({
          alertId: String(alert._id),
          engagementId: alert.engagement_id,
          engagementTweetId: engagement.tweet_id,
          reason: 'tweet_id_mismatch',
        });
      }
    } catch (error) {
      console.error(`Error checking alert ${alert._id}:`, error);
      invalidAlerts.push({
        alertId: String(alert._id),
        engagementId: alert.engagement_id,
        engagementTweetId: 'ERROR',
        reason: 'check_error',
      });
    }
  }
  
  console.log(`\n📊 Results:`);
  console.log(`  Total alerts: ${alerts.length}`);
  console.log(`  Invalid alerts found: ${invalidAlerts.length}`);
  
  if (invalidAlerts.length === 0) {
    console.log(`\n✅ No invalid alerts found! Campaign is clean.`);
    return { totalAlerts: alerts.length, invalidAlerts: 0, markedCount: 0, errors: 0 };
  }
  
  // Show sample of invalid alerts
  console.log(`\n📋 Sample of invalid alerts (first 5):`);
  for (const invalid of invalidAlerts.slice(0, 5)) {
    console.log(`  - Alert ${invalid.alertId}: engagement tweet_id ${invalid.engagementTweetId} (${invalid.reason})`);
  }
  if (invalidAlerts.length > 5) {
    console.log(`  ... and ${invalidAlerts.length - 5} more`);
  }
  
  // Ask for confirmation (in script, we'll proceed but log clearly)
  console.log(`\n⚠️  About to mark ${invalidAlerts.length} alerts as 'skipped' with reason 'invalid_tweet_id'`);
  console.log(`   This will mark them as invalid but NOT delete them.`);
  
  // Mark invalid alerts as skipped
  let markedCount = 0;
  let errors = 0;
  
  for (const invalid of invalidAlerts) {
    try {
      const success = await markAlertAsSkipped(invalid.alertId, `invalid_tweet_id: ${invalid.reason}`);
      if (success) {
        markedCount++;
      } else {
        errors++;
        console.error(`Failed to mark alert ${invalid.alertId}`);
      }
    } catch (error) {
      errors++;
      console.error(`Error marking alert ${invalid.alertId}:`, error);
    }
  }
  
  console.log(`\n✅ Completed:`);
  console.log(`  Marked as skipped: ${markedCount}`);
  console.log(`  Errors: ${errors}`);
  
  return {
    totalAlerts: alerts.length,
    invalidAlerts: invalidAlerts.length,
    markedCount,
    errors,
  };
}

async function markInvalidAlertsForAllCampaigns(): Promise<void> {
  const client = await clientPromise;
  const db = client.db();
  const campaignsCollection = db.collection('socap_campaigns');
  
  const campaigns = await campaignsCollection.find({}).toArray();
  console.log(`Found ${campaigns.length} campaigns to process\n`);
  
  const totalStats = {
    totalAlerts: 0,
    invalidAlerts: 0,
    markedCount: 0,
    errors: 0,
  };
  
  for (const campaign of campaigns) {
    const campaignId = String(campaign._id);
    const stats = await markInvalidAlertsForCampaign(campaignId);
    
    totalStats.totalAlerts += stats.totalAlerts;
    totalStats.invalidAlerts += stats.invalidAlerts;
    totalStats.markedCount += stats.markedCount;
    totalStats.errors += stats.errors;
  }
  
  console.log(`\n\n🎯 FINAL SUMMARY:`);
  console.log(`  Total alerts checked: ${totalStats.totalAlerts}`);
  console.log(`  Invalid alerts found: ${totalStats.invalidAlerts}`);
  console.log(`  Successfully marked: ${totalStats.markedCount}`);
  console.log(`  Errors: ${totalStats.errors}`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage:');
    console.error('  npx tsx scripts/mark-invalid-alerts.ts <campaign-id>');
    console.error('  npx tsx scripts/mark-invalid-alerts.ts --all');
    process.exit(1);
  }
  
  try {
    if (args[0] === '--all') {
      await markInvalidAlertsForAllCampaigns();
    } else {
      const campaignId = args[0];
      await markInvalidAlertsForCampaign(campaignId);
    }
    
    console.log('\n✅ Script completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  }
}

main();

