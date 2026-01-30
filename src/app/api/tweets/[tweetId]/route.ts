import { NextRequest, NextResponse } from 'next/server';
import { getTweet, getEngagers, getEngagersStats, GetEngagersOptions } from '@/lib/models/tweets';

// GET - Get tweet details and optionally engagers
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tweetId: string }> }
) {
  try {
    const { tweetId } = await params;
    const { searchParams } = new URL(request.url);
    
    // Check if requesting engagers list
    const includeEngagers = searchParams.get('include_engagers') === 'true';
    
    // Get tweet
    const tweet = await getTweet(tweetId);
    
    if (!tweet) {
      return NextResponse.json(
        { error: 'Tweet not found' },
        { status: 404 }
      );
    }
    
    // Get stats
    const stats = await getEngagersStats(tweetId);
    
    // Optionally get engagers
    let engagersData = null;
    
    if (includeEngagers) {
      const options: GetEngagersOptions = {
        limit: parseInt(searchParams.get('limit') || '50'),
        skip: parseInt(searchParams.get('skip') || '0'),
        sortBy: (searchParams.get('sort_by') as any) || 'importance_score',
        sortOrder: (searchParams.get('sort_order') as any) || 'desc',
      };
      
      // Filters
      const minFollowers = searchParams.get('min_followers');
      if (minFollowers) options.minFollowers = parseInt(minFollowers);
      
      const maxFollowers = searchParams.get('max_followers');
      if (maxFollowers) options.maxFollowers = parseInt(maxFollowers);
      
      const engagementType = searchParams.get('engagement_type');
      if (engagementType) options.engagementType = engagementType as any;
      
      const verifiedOnly = searchParams.get('verified_only');
      if (verifiedOnly === 'true') options.verifiedOnly = true;
      
      engagersData = await getEngagers(tweetId, options);
    }
    
    return NextResponse.json({
      success: true,
      tweet,
      stats,
      engagers: engagersData,
    });
    
  } catch (error) {
    console.error('Error fetching tweet:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to fetch tweet',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

