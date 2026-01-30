import { NextRequest, NextResponse } from 'next/server';
import {
  getNotificationById,
  markNotificationSent,
  updateNotificationText,
} from '@/lib/models/monitoring-notifications';
import { getMonitoringJobByTweetId } from '@/lib/models/monitoring';

/**
 * POST /api/monitor-tweet/[tweetId]/notifications/send
 * Send a notification to Slack
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tweetId: string }> }
) {
  try {
    const { tweetId } = await params;
    const body = await request.json();
    const { notificationId, editedText } = body;

    if (!tweetId) {
      return NextResponse.json(
        { error: 'Tweet ID is required' },
        { status: 400 }
      );
    }

    if (!notificationId) {
      return NextResponse.json(
        { error: 'Notification ID is required' },
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
        { error: 'Notification has already been sent' },
        { status: 400 }
      );
    }

    // If editedText is provided, update the notification first
    if (editedText && typeof editedText === 'string') {
      await updateNotificationText(notificationId, editedText);
    }

    // Get the text to send
    const textToSend = editedText || notification.edited_text || notification.generated_text;

    // Get webhook URL (job-specific or from environment)
    const webhookUrl = job.slack_webhook_url || process.env.SLACK_WEBHOOK_URL;

    if (!webhookUrl) {
      return NextResponse.json(
        { error: 'No Slack webhook URL configured' },
        { status: 400 }
      );
    }

    // Send to Slack
    try {
      const slackResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: textToSend,
          // Optional: Add blocks for richer formatting
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: textToSend,
              },
            },
          ],
        }),
      });

      if (!slackResponse.ok) {
        const errorText = await slackResponse.text();
        console.error('Slack webhook error:', errorText);
        return NextResponse.json(
          { error: 'Failed to send to Slack', details: errorText },
          { status: 500 }
        );
      }
    } catch (slackError) {
      console.error('Slack webhook error:', slackError);
      return NextResponse.json(
        {
          error: 'Failed to send to Slack',
          details: slackError instanceof Error ? slackError.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    // Mark notification as sent
    const updatedNotification = await markNotificationSent(notificationId);

    return NextResponse.json({
      success: true,
      sent_at: updatedNotification?.sent_at,
      notification: {
        id: updatedNotification?._id?.toString(),
        status: updatedNotification?.status,
        final_text: updatedNotification?.final_text,
      },
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    return NextResponse.json(
      {
        error: 'Failed to send notification',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
