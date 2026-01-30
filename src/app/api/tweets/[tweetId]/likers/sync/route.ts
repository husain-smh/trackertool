import { NextRequest, NextResponse } from 'next/server';
import { getTweet } from '@/lib/models/tweets';
import { enqueueTweetLikersSyncJob } from '@/lib/models/tweet-likers-sync-jobs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tweetId: string }> }
) {
  const { tweetId } = await params;

  const tweet = await getTweet(tweetId);
  if (!tweet) {
    return NextResponse.json({ success: false, error: 'Tweet not found' }, { status: 404 });
  }

  // Enqueue-only: the cron worker drains this job queue safely.
  await enqueueTweetLikersSyncJob(tweetId);
  return NextResponse.json({
    success: true,
    enqueued: true,
    tweet_id: tweetId,
  });
}

