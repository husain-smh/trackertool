import { getActiveCampaigns, updateCampaignStatus } from '../models/socap/campaigns';

/**
 * Check and complete campaigns that have passed their monitor window
 */
export async function checkAndCompleteCampaigns(): Promise<{
  completed: number;
  errors: number;
}> {
  const stats = {
    completed: 0,
    errors: 0,
  };
  
  try {
    const activeCampaigns = await getActiveCampaigns();
    const now = new Date();
    
    for (const campaign of activeCampaigns) {
      try {
        // Check if monitor window has ended
        const endDate = new Date(campaign.monitor_window.end_date);
        
        if (now >= endDate) {
          // Campaign window has ended, mark as completed
          await updateCampaignStatus(campaign._id!, 'completed');
          stats.completed++;
          
          console.log(`Campaign ${campaign.launch_name} (${campaign._id}) marked as completed`);
          
          // Optional: Generate final report here
          // await generateFinalReport(campaign._id!);
        }
      } catch (error) {
        console.error(`Error completing campaign ${campaign._id}:`, error);
        stats.errors++;
      }
    }
  } catch (error) {
    console.error('Error checking campaign completion:', error);
    stats.errors++;
  }
  
  return stats;
}

/**
 * Generate final report for a completed campaign
 * (Optional - can be implemented later)
 */
export async function generateFinalReport(campaignId: string): Promise<void> {
  // TODO: Implement final report generation
  // - Aggregate all metrics
  // - Calculate totals
  // - Generate summary
  // - Export to PDF/CSV (optional)
  console.log(`Final report generation for campaign ${campaignId} - not yet implemented`);
}

