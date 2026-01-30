import { NextRequest, NextResponse } from 'next/server';
import { getMonitoringJobByTweetId, updateMonitoringJobSettings } from '@/lib/models/monitoring';

/**
 * GET /api/monitor-tweet/[tweetId]/settings
 * Get current monitoring settings
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

    const job = await getMonitoringJobByTweetId(tweetId);
    if (!job) {
      return NextResponse.json(
        { error: 'Monitoring job not found for this tweet' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      settings: {
        realtime_enabled: job.realtime_enabled ?? false,
        notification_threshold: job.notification_threshold ?? 5,
        slack_webhook_url: job.slack_webhook_url ? '***configured***' : null,
      },
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch settings',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/monitor-tweet/[tweetId]/settings
 * Update monitoring settings
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tweetId: string }> }
) {
  try {
    const { tweetId } = await params;
    const body = await request.json();
    const { notification_threshold, slack_webhook_url, realtime_enabled } = body;

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

    // Build update object
    const update: {
      realtime_enabled?: boolean;
      notification_threshold?: number;
      slack_webhook_url?: string;
    } = {};

    if (typeof realtime_enabled === 'boolean') {
      update.realtime_enabled = realtime_enabled;
    }

    if (typeof notification_threshold === 'number' && notification_threshold > 0) {
      update.notification_threshold = notification_threshold;
    }

    if (typeof slack_webhook_url === 'string') {
      update.slack_webhook_url = slack_webhook_url;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No valid settings to update' },
        { status: 400 }
      );
    }

    const updatedJob = await updateMonitoringJobSettings(tweetId, update);

    return NextResponse.json({
      success: true,
      settings: {
        realtime_enabled: updatedJob?.realtime_enabled ?? false,
        notification_threshold: updatedJob?.notification_threshold ?? 5,
        slack_webhook_url: updatedJob?.slack_webhook_url ? '***configured***' : null,
      },
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json(
      {
        error: 'Failed to update settings',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
