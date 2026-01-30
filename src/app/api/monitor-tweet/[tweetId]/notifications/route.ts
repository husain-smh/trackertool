import { NextRequest, NextResponse } from 'next/server';
import { getNotifications, NotificationStatus } from '@/lib/models/monitoring-notifications';
import { getMonitoringJobByTweetId } from '@/lib/models/monitoring';

/**
 * GET /api/monitor-tweet/[tweetId]/notifications
 * Get notifications for a monitored tweet
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
    const statusParam = searchParams.get('status');
    const limitParam = searchParams.get('limit');
    const skipParam = searchParams.get('skip');

    let status: NotificationStatus | NotificationStatus[] | undefined;
    if (statusParam) {
      if (statusParam.includes(',')) {
        status = statusParam.split(',') as NotificationStatus[];
      } else {
        status = statusParam as NotificationStatus;
      }
    }

    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const skip = skipParam ? parseInt(skipParam, 10) : 0;

    const { notifications, total } = await getNotifications(tweetId, {
      status,
      limit,
      skip,
    });

    return NextResponse.json({
      success: true,
      notifications: notifications.map(n => ({
        id: n._id?.toString(),
        tweet_id: n.tweet_id,
        engagement_id: n.engagement_id,
        user_id: n.user_id,
        action_type: n.action_type,
        generated_text: n.generated_text,
        edited_text: n.edited_text,
        final_text: n.final_text,
        status: n.status,
        importance_score: n.importance_score,
        engager_username: n.engager_username,
        engager_name: n.engager_name,
        engager_followers: n.engager_followers,
        generated_at: n.generated_at,
        edited_at: n.edited_at,
        sent_at: n.sent_at,
        sent_by: n.sent_by,
      })),
      total,
      limit,
      skip,
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch notifications',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
