import { NextRequest, NextResponse } from 'next/server';
import { getLocationHeatmapData, distributeRegionEngagements } from '@/lib/socap/heatmap-aggregator';
import { getCampaignById } from '@/lib/models/socap/campaigns';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

/**
 * GET /api/socap/campaigns/[id]/heatmap
 * Get location heatmap data for a campaign
 * 
 * Query parameters:
 * - distribute_regions: boolean (default: true) - Distribute region-level data across countries
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await params;
    const { searchParams } = new URL(request.url);
    
    // Verify campaign exists
    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
      return NextResponse.json(
        {
          success: false,
          error: 'Campaign not found',
        },
        { status: 404 }
      );
    }
    
    // Get distribution option (default: true)
    const distributeRegions = searchParams.get('distribute_regions') !== 'false';
    
    // Aggregate location data
    const heatmapData = await getLocationHeatmapData(campaignId);
    
    // Optionally distribute region-level data across countries
    let locations = heatmapData.locations;
    if (distributeRegions) {
      locations = distributeRegionEngagements(heatmapData.locations);
    }
    
    return NextResponse.json({
      success: true,
      data: {
        locations,
        total_engagements: heatmapData.total_engagements,
        total_locations: heatmapData.total_locations,
        metadata: heatmapData.metadata,
      },
    });
  } catch (error) {
    logger.error('Error fetching heatmap data', error, {
      operation: 'get-heatmap-data',
    });
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch heatmap data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

