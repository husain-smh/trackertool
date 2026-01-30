import { aggregateCampaignMetrics } from './metric-aggregator';

/**
 * Create metric snapshots for a campaign on a fixed cadence,
 * regardless of job queue status.
 *
 * Design goals (short‑term robustness):
 * - Do NOT require all metrics jobs to be completed before writing a snapshot.
 * - At most one snapshot per hour per campaign (same as before).
 * - Treat snapshots as an eventually‑consistent view of `tweets.metrics`.
 */
export async function processMetricSnapshots(campaignId: string): Promise<void> {
  // Check if we already created a snapshot recently (within last hour)
  const { getLatestMetricSnapshot } = await import('../models/socap/metric-snapshots');
  const latestSnapshot = await getLatestMetricSnapshot(campaignId);

  if (latestSnapshot) {
    const snapshotTime = new Date(latestSnapshot.snapshot_time);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    if (snapshotTime > oneHourAgo) {
      // Already created snapshot recently; skip until next window
      return;
    }
  }

  // Create metric snapshot based on whatever data we currently have.
  // This keeps charts moving forward even if some jobs are still pending.
  await aggregateCampaignMetrics(campaignId);
  console.log(`Created metric snapshot for campaign ${campaignId}`);
}

/**
 * Process metric snapshots for all active campaigns
 */
export async function processAllMetricSnapshots(): Promise<void> {
  const { getActiveCampaigns } = await import('../models/socap/campaigns');
  const activeCampaigns = await getActiveCampaigns();
  
  for (const campaign of activeCampaigns) {
    try {
      await processMetricSnapshots(campaign._id!);
    } catch (error) {
      console.error(`Error processing metric snapshot for campaign ${campaign._id}:`, error);
    }
  }
}

