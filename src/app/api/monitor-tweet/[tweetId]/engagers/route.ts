import { NextRequest, NextResponse } from 'next/server';
import { getEngagements, getDeletedCount } from '@/lib/models/monitoring-engagements';
import { getMonitoringJobByTweetId } from '@/lib/models/monitoring';

/**
 * GET /api/monitor-tweet/[tweetId]/engagers
 * Get all engagers with filters
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tweetId: string }> }
) {
  try {
    const { tweetId } = await params;

    if (!tweetId) {
      return NextResponse.json(
        { error: 'Tweet ID is required' },
        { status: 400 }
      );
    }

    // Verify tweet is being monitored
    const job = await getMonitoringJobByTweetId(tweetId);
    if (!job) {
      return NextResponse.json(
        { error: 'Monitoring job not found for this tweet' },
        { status: 404 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const actionType = searchParams.get('action_type') as 'retweet' | 'reply' | 'quote' | 'like' | null;
    const minImportance = searchParams.get('min_importance');
    const includeDeleted = searchParams.get('include_deleted') === 'true';
    const sortBy = searchParams.get('sort') as 'importance' | 'followers' | 'recent' | null;
    const limitParam = searchParams.get('limit');
    const skipParam = searchParams.get('skip');

    const limit = limitParam ? parseInt(limitParam, 10) : 100;
    const skip = skipParam ? parseInt(skipParam, 10) : 0;

    const { engagements, total } = await getEngagements(tweetId, {
      actionType: actionType || undefined,
      minImportance: minImportance ? parseInt(minImportance, 10) : undefined,
      includeDeleted,
      sortBy: sortBy || 'importance',
      limit,
      skip,
    });

    // Get deleted count separately
    const deletedCount = await getDeletedCount(tweetId);

    return NextResponse.json({
      success: true,
      engagers: engagements.map(e => ({
        id: e._id?.toString(),
        user_id: e.user_id,
        username: e.username,
        name: e.name,
        action_type: e.action_type,
        followers: e.followers,
        verified: e.verified,
        bio: e.bio,
        location: e.location,
        importance_score: e.importance_score,
        followed_by: e.followed_by,
        engagement_id: e.engagement_id,
        engagement_url: e.engagement_url,
        engagement_text: e.engagement_text,
        engagement_created_at: e.engagement_created_at,
        quote_metrics: e.quote_metrics,
        first_seen_at: e.first_seen_at,
        last_seen_at: e.last_seen_at,
        is_deleted: e.is_deleted,
        deleted_at: e.deleted_at,
      })),
      total,
      deleted_count: deletedCount,
      limit,
      skip,
    });
  } catch (error) {
    console.error('Error fetching engagers:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch engagers',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
