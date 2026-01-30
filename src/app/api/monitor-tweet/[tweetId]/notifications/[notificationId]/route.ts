import { NextRequest, NextResponse } from 'next/server';
import {
  getNotificationById,
  updateNotificationText,
  markNotificationSkipped,
} from '@/lib/models/monitoring-notifications';
import { getMonitoringJobByTweetId } from '@/lib/models/monitoring';

/**
 * GET /api/monitor-tweet/[tweetId]/notifications/[notificationId]
 * Get a single notification
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tweetId: string; notificationId: string }> }
) {
  try {
    const { tweetId, notificationId } = await params;

    if (!tweetId || !notificationId) {
      return NextResponse.json(
        { error: 'Tweet ID and Notification ID are required' },
        { status: 400 }
      );
    }

    const notification = await getNotificationById(notificationId);
    if (!notification) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    if (notification.tweet_id !== tweetId) {
      return NextResponse.json(
        { error: 'Notification does not belong to this tweet' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      notification: {
        id: notification._id?.toString(),
        tweet_id: notification.tweet_id,
        engagement_id: notification.engagement_id,
        user_id: notification.user_id,
        action_type: notification.action_type,
        generated_text: notification.generated_text,
        edited_text: notification.edited_text,
        final_text: notification.final_text,
        status: notification.status,
        importance_score: notification.importance_score,
        engager_username: notification.engager_username,
        engager_name: notification.engager_name,
        engager_followers: notification.engager_followers,
        generated_at: notification.generated_at,
        edited_at: notification.edited_at,
        sent_at: notification.sent_at,
        sent_by: notification.sent_by,
      },
    });
  } catch (error) {
    console.error('Error fetching notification:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch notification',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/monitor-tweet/[tweetId]/notifications/[notificationId]
 * Edit notification text
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tweetId: string; notificationId: string }> }
) {
  try {
    const { tweetId, notificationId } = await params;
    const body = await request.json();
    const { editedText, skip } = body;

    if (!tweetId || !notificationId) {
      return NextResponse.json(
        { error: 'Tweet ID and Notification ID are required' },
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

    // Get the notification
    const notification = await getNotificationById(notificationId);
    if (!notification) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    if (notification.tweet_id !== tweetId) {
      return NextResponse.json(
        { error: 'Notification does not belong to this tweet' },
        { status: 400 }
      );
    }

    if (notification.status === 'sent') {
      return NextResponse.json(
        { error: 'Cannot edit a notification that has already been sent' },
        { status: 400 }
      );
    }

    // Handle skip action
    if (skip === true) {
      const updatedNotification = await markNotificationSkipped(notificationId);
      return NextResponse.json({
        success: true,
        notification: {
          id: updatedNotification?._id?.toString(),
          status: updatedNotification?.status,
        },
      });
    }

    // Handle edit action
    if (editedText && typeof editedText === 'string') {
      const updatedNotification = await updateNotificationText(notificationId, editedText);
      return NextResponse.json({
        success: true,
        notification: {
          id: updatedNotification?._id?.toString(),
          status: updatedNotification?.status,
          edited_text: updatedNotification?.edited_text,
          edited_at: updatedNotification?.edited_at,
        },
      });
    }

    return NextResponse.json(
      { error: 'Either editedText or skip must be provided' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error updating notification:', error);
    return NextResponse.json(
      {
        error: 'Failed to update notification',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
