import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getActiveCampaigns } from '@/lib/models/socap/campaigns';
import { enqueueCampaignJobs, enqueueLocationEnrichmentJob } from '@/lib/socap/job-queue';
import { checkAndCompleteCampaigns } from '@/lib/socap/campaign-completion';

// Extend timeout for Vercel Pro (default is 10s for hobby, 60s for pro)
// This route can take longer due to bulk DB operations
export const maxDuration = 60; // seconds

/**
 * POST /socap/workers/trigger
 * Trigger job processing for all active campaigns
 * Called by N8N on schedule (default: every 30 minutes, configurable)
 * 
 * OPTIMIZED: Uses bulk operations and parallel processing
 */
export async function POST() {
  const startTime = Date.now();
  
  try {
    // Run campaign completion check and get active campaigns in parallel
    const [completionStats, activeCampaigns] = await Promise.all([
      checkAndCompleteCampaigns(),
      getActiveCampaigns(),
    ]);
    
    console.log(`Campaign completion check: ${completionStats.completed} completed, ${completionStats.errors} errors`);
    console.log(`Worker trigger: Found ${activeCampaigns.length} active campaigns`);
    
    if (activeCampaigns.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active campaigns to process',
        data: {
          campaigns_processed: 0,
          jobs_enqueued: 0,
          duration_ms: Date.now() - startTime,
        },
      });
    }
    
    // Process all campaigns in parallel (each uses bulkWrite internally)
    const campaignPromises = activeCampaigns.map(async (campaign) => {
      const rawId = campaign._id as unknown;
      const campaignId = (rawId instanceof ObjectId ? rawId.toString() : String(campaign._id || ''));
      
      if (!campaignId) {
        return {
          campaign_id: '',
          campaign_name: campaign.launch_name,
          jobs_enqueued: 0,
          status: 'error' as const,
          error: 'Campaign ID is missing',
        };
      }
      
      try {
        console.log(`Processing campaign: ${campaign.launch_name} (${campaignId})`);
        const jobsEnqueued = await enqueueCampaignJobs(campaignId);
        
        // Also enqueue location enrichment job (runs in background, low priority)
        await enqueueLocationEnrichmentJob(campaignId);
        
        console.log(`✓ Campaign ${campaign.launch_name}: ${jobsEnqueued} jobs enqueued (+ location enrichment)`);
        
        return {
          campaign_id: campaignId,
          campaign_name: campaign.launch_name,
          jobs_enqueued: jobsEnqueued + 1, // +1 for location enrichment job
          status: 'success' as const,
        };
      } catch (error) {
        console.error(`✗ Error enqueuing jobs for campaign ${campaignId}:`, error);
        return {
          campaign_id: campaignId,
          campaign_name: campaign.launch_name,
          jobs_enqueued: 0,
          status: 'error' as const,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
    
    const results = await Promise.all(campaignPromises);
    const totalJobsEnqueued = results.reduce((sum, r) => sum + r.jobs_enqueued, 0);
    const duration = Date.now() - startTime;
    
    console.log(`Worker trigger complete: ${totalJobsEnqueued} total jobs enqueued across ${activeCampaigns.length} campaigns in ${duration}ms`);
    
    return NextResponse.json({
      success: true,
      message: `Processed ${activeCampaigns.length} campaigns`,
      data: {
        campaigns_processed: activeCampaigns.length,
        jobs_enqueued: totalJobsEnqueued,
        duration_ms: duration,
        results,
      },
    });
  } catch (error) {
    console.error('Error triggering workers:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to trigger workers',
        details: error instanceof Error ? error.message : 'Unknown error',
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

