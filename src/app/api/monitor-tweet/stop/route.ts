import { NextRequest, NextResponse } from 'next/server';
import { stopMonitoringJob, getMonitoringJobByTweetId } from '@/lib/models/monitoring';
import { extractTweetIdFromUrl } from '@/lib/utils/tweet-utils';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tweetUrl, tweetId } = body;

    let finalTweetId: string | null = null;

    // Get tweet ID from either URL or direct ID
    if (tweetId) {
      finalTweetId = tweetId;
    } else if (tweetUrl) {
      finalTweetId = extractTweetIdFromUrl(tweetUrl);
    }

    if (!finalTweetId) {
      return NextResponse.json(
        { error: 'Either tweetUrl or tweetId is required' },
        { status: 400 }
      );
    }

    // Check if job exists
    const job = await getMonitoringJobByTweetId(finalTweetId);
    if (!job) {
      return NextResponse.json(
        { error: 'No active monitoring job found for this tweet' },
        { status: 404 }
      );
    }

    if (job.status === 'completed') {
      return NextResponse.json(
        { 
          message: 'Monitoring for this tweet has already been completed',
          tweet_id: finalTweetId,
        },
        { status: 200 }
      );
    }

    // Stop the monitoring job
    await stopMonitoringJob(finalTweetId);

    return NextResponse.json({
      success: true,
      message: 'Monitoring stopped successfully',
      tweet_id: finalTweetId,
    });
  } catch (error) {
    console.error('Error stopping tweet monitoring:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to stop monitoring',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

