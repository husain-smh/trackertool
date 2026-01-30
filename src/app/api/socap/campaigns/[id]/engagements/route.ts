import { NextRequest, NextResponse } from 'next/server';
import { getEngagementsByCampaign } from '@/lib/models/socap/engagements';

// Vercel Pro: Allow up to 30 seconds for this function (handles cold starts + DB queries)
export const maxDuration = 30;

/**
 * GET /socap/campaigns/:id/engagements
 * Get engagements for a campaign with filtering and pagination
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const sort = (searchParams.get('sort') as 'importance_score' | 'timestamp') || 'importance_score';
    const category = searchParams.get('category') as 'main_twt' | 'influencer_twt' | 'investor_twt' | null;
    const actionType = searchParams.get('action_type') as 'retweet' | 'reply' | 'quote' | null;
    const minImportance = searchParams.get('min_importance')
      ? parseInt(searchParams.get('min_importance')!, 10)
      : undefined;
    
    const engagements = await getEngagementsByCampaign(id, {
      limit,
      offset,
      sort,
      category: category || undefined,
      action_type: actionType || undefined,
      min_importance: minImportance,
    });
    
    return NextResponse.json({
      success: true,
      data: {
        engagements,
        pagination: {
          limit,
          offset,
          count: engagements.length,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching engagements:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch engagements',
      },
      { status: 500 }
    );
  }
}

