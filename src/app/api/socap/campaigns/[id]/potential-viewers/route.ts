import { NextRequest, NextResponse } from 'next/server';
import { getPotentialViewersByCampaign } from '@/lib/models/socap/engagements';
import { getCampaignById } from '@/lib/models/socap/campaigns';

export const maxDuration = 30;

/**
 * GET /socap/campaigns/:id/potential-viewers
 * Get potential viewers: accounts that follow top engagers but haven't engaged
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await params;
    
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
    
    const { searchParams } = new URL(request.url);
    const topEngagersLimit = searchParams.get('top_engagers_limit')
      ? parseInt(searchParams.get('top_engagers_limit')!, 10)
      : 30;
    const minImportanceScore = searchParams.get('min_importance')
      ? parseFloat(searchParams.get('min_importance')!)
      : 0;
    const limit = searchParams.get('limit')
      ? parseInt(searchParams.get('limit')!, 10)
      : 100;
    
    const potentialViewers = await getPotentialViewersByCampaign(campaignId, {
      topEngagersLimit,
      minImportanceScore,
      limit,
    });
    
    return NextResponse.json({
      success: true,
      data: {
        potential_viewers: potentialViewers,
        count: potentialViewers.length,
      },
    });
  } catch (error) {
    console.error('Error fetching potential viewers:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch potential viewers',
      },
      { status: 500 }
    );
  }
}

