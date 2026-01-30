import { NextRequest, NextResponse } from 'next/server';
import {
  getCampaignById,
  updateCampaignStatus,
  updateCampaign,
  deleteCampaign,
} from '@/lib/models/socap/campaigns';
import { syncCampaignTweets } from '@/lib/socap/campaign-tweet-sync';

/**
 * GET /socap/campaigns/:id
 * Get campaign details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const campaign = await getCampaignById(id);
    
    if (!campaign) {
      return NextResponse.json(
        {
          success: false,
          error: 'Campaign not found',
        },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    console.error('Error fetching campaign:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch campaign',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /socap/campaigns/:id
 * Update campaign (status, preferences, etc.)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    // Handle status update separately
    if (body.status) {
      const success = await updateCampaignStatus(id, body.status);
      
      if (!success) {
        return NextResponse.json(
          {
            success: false,
            error: 'Campaign not found or update failed',
          },
          { status: 404 }
        );
      }
      
      return NextResponse.json({
        success: true,
        message: 'Campaign status updated',
      });
    }
    
    // Handle tweet set updates (maintweets / influencer_twts / investor_twts)
    if (
      Array.isArray(body.maintweets) ||
      Array.isArray(body.influencer_twts) ||
      Array.isArray(body.investor_twts)
    ) {
      const maintweets = Array.isArray(body.maintweets) ? body.maintweets : [];
      const influencer_twts = Array.isArray(body.influencer_twts) ? body.influencer_twts : [];
      const investor_twts = Array.isArray(body.investor_twts) ? body.investor_twts : [];

      const totalUrls =
        (maintweets?.length || 0) +
        (influencer_twts?.length || 0) +
        (investor_twts?.length || 0);

      if (totalUrls === 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'At least one tweet URL is required',
          },
          { status: 400 }
        );
      }

      // First, apply any non-tweet campaign field updates (e.g., alert_preferences)
      const campaignFieldUpdates: any = { ...body };
      delete campaignFieldUpdates.maintweets;
      delete campaignFieldUpdates.influencer_twts;
      delete campaignFieldUpdates.investor_twts;

      if (Object.keys(campaignFieldUpdates).length > 0) {
        const updated = await updateCampaign(id, campaignFieldUpdates);
        if (!updated) {
          return NextResponse.json(
            {
              success: false,
              error: 'Campaign not found or update failed',
            },
            { status: 404 }
          );
        }
      }

      // Then sync tweets
      const syncResult = await syncCampaignTweets({
        campaignId: id,
        maintweets,
        influencer_twts,
        investor_twts,
      });

      return NextResponse.json({
        success: true,
        message: 'Campaign tweets synced',
        data: syncResult,
      });
    }
    
    // Handle other updates (non-status, non-tweet fields)
    const success = await updateCampaign(id, body);
    
    if (!success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Campaign not found or update failed',
        },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: 'Campaign updated',
    });
  } catch (error) {
    console.error('Error updating campaign:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update campaign',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /socap/campaigns/:id
 * Delete campaign
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const success = await deleteCampaign(id);
    
    if (!success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Campaign not found',
        },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: 'Campaign deleted',
    });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete campaign',
      },
      { status: 500 }
    );
  }
}

