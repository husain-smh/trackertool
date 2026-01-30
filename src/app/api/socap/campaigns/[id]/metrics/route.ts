import { NextRequest, NextResponse } from 'next/server';
import { getMetricSnapshotsByCampaign } from '@/lib/models/socap/metric-snapshots';
import { getCampaignById } from '@/lib/models/socap/campaigns';

// Vercel Pro: Allow up to 30 seconds for this function (handles cold starts + DB queries)
export const maxDuration = 30;

/**
 * GET /socap/campaigns/:id/metrics
 * Get time-series metrics for a campaign
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const granularity = searchParams.get('granularity') || 'hour';
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    
    const campaign = await getCampaignById(id);
    if (!campaign) {
      return NextResponse.json(
        { success: false, error: 'Campaign not found' },
        { status: 404 }
      );
    }

    const options: {
      startDate?: Date;
      endDate?: Date;
      granularity?: 'hour' | 'day';
    } = {
      granularity: granularity === 'day' ? 'day' : 'hour',
    };
    
    if (startDate) {
      options.startDate = new Date(startDate);
    } else if (campaign.chart_min_date) {
      options.startDate = new Date(campaign.chart_min_date);
    }
    
    if (endDate) {
      options.endDate = new Date(endDate);
    }
    
    const snapshots = await getMetricSnapshotsByCampaign(id, options);
    
    return NextResponse.json({
      success: true,
      data: {
        snapshots,
        granularity: options.granularity,
      },
    });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch metrics',
      },
      { status: 500 }
    );
  }
}

