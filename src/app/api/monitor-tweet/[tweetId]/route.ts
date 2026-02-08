import { NextRequest, NextResponse } from 'next/server';
import { getMonitoringData } from '@/lib/models/monitoring';
import { getEngagements, getDeletedCount } from '@/lib/models/monitoring-engagements';

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

    const { job, snapshots } = await getMonitoringData(tweetId);

    if (!job) {
      return NextResponse.json(
        { error: 'Monitoring job not found for this tweet' },
        { status: 404 }
      );
    }

    // Fetch realtime data if enabled
    let realtimeData = null;
    if (job.realtime_enabled) {
      const [engagersResult, deletedCount] = await Promise.all([
        getEngagements(tweetId, { limit: 20, sortBy: 'importance' }),
        getDeletedCount(tweetId),
      ]);

      realtimeData = {
        engagers: {
          total: engagersResult.total,
          top: engagersResult.engagements.map(e => ({
            user_id: e.user_id,
            username: e.username,
            name: e.name,
            action_type: e.action_type,
            importance_score: e.importance_score,
            followers: e.followers,
            engagement_url: e.engagement_url,
            first_seen_at: e.first_seen_at,
          })),
        },
        deleted_count: deletedCount,
      };
    }

    // Calculate time remaining (5 days = 120 hours)
    const now = new Date();
    const startedAt = new Date(job.started_at);
    const monitorDurationMs = 5 * 24 * 60 * 60 * 1000; // 5 days
    const elapsed = now.getTime() - startedAt.getTime();
    const remaining = Math.max(0, monitorDurationMs - elapsed);
    const isActive = job.status === 'active' && remaining > 0;

    return NextResponse.json({
      success: true,
      job: {
        tweet_id: job.tweet_id,
        tweet_url: job.tweet_url,
        status: job.status,
        started_at: job.started_at,
        created_at: job.created_at,
        realtime_enabled: job.realtime_enabled,
      },
      snapshots: snapshots.map(s => ({
        timestamp: s.timestamp,
        likeCount: s.likeCount,
        retweetCount: s.retweetCount,
        replyCount: s.replyCount,
        quoteCount: s.quoteCount,
        viewCount: s.viewCount,
        bookmarkCount: s.bookmarkCount,
        quoteViewSum: s.quoteViewSum,
        quoteTweetCount: s.quoteTweetCount,
      })),
      stats: {
        total_snapshots: snapshots.length,
        is_active: isActive,
        hours_remaining: Math.floor(remaining / (60 * 60 * 1000)),
        minutes_remaining: Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000)),
      },
      realtime: realtimeData,
    });
  } catch (error) {
    console.error('Error fetching monitoring data:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to fetch monitoring data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

