/**
 * Script to regenerate alerts for a campaign
 * 
 * This will:
 * 1. Run detectAndQueueAlerts to create new alerts for valid engagements
 * 2. Only creates alerts for engagements that belong to the campaign
 * 3. Respects deduplication (won't create duplicate alerts)
 * 
 * Usage:
 *   npx tsx scripts/regenerate-alerts.ts <campaign-id>
 */

import { detectAndQueueAlerts } from '../src/lib/socap/alert-detector';
import { getCampaignById } from '../src/lib/models/socap/campaigns';

async function regenerateAlerts(campaignId: string): Promise<void> {
  console.log(`\n=== Regenerating Alerts for Campaign: ${campaignId} ===`);
  
  // Verify campaign exists
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    console.error(`❌ Campaign ${campaignId} not found!`);
    process.exit(1);
  }
  
  console.log(`✓ Campaign found: ${campaign.launch_name || campaignId}`);
  console.log(`✓ Importance threshold: ${campaign.alert_preferences.importance_threshold}`);
  console.log(`✓ Alert spacing: ${campaign.alert_preferences.alert_spacing_minutes || 'default'} minutes`);
  
  console.log(`\n🔄 Running alert detection...`);
  
  try {
    const alertsQueued = await detectAndQueueAlerts(campaignId);
    
    console.log(`\n✅ Success!`);
    console.log(`  New alerts queued: ${alertsQueued}`);
    console.log(`\nNote: This only creates alerts for valid engagements.`);
    console.log(`      Invalid alerts (marked as skipped) are ignored.`);
    console.log(`      Deduplication prevents duplicate alerts.`);
  } catch (error) {
    console.error(`\n❌ Error regenerating alerts:`, error);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage:');
    console.error('  npx tsx scripts/regenerate-alerts.ts <campaign-id>');
    console.error('\nExample:');
    console.error('  npx tsx scripts/regenerate-alerts.ts 507f1f77bcf86cd799439011');
    process.exit(1);
  }
  
  const campaignId = args[0];
  await regenerateAlerts(campaignId);
  
  console.log('\n✅ Script completed successfully!');
  process.exit(0);
}

main();

