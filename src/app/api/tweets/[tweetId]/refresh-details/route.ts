import { NextResponse } from 'next/server';
import { fetchTweetDetails } from '@/lib/external-api';
import {
  getTweet,
  updateTweetAuthorInfo,
  updateTweetCreatedAt,
  updateTweetText,
} from '@/lib/models/tweets';

// POST - Backfill tweet text/author/published timestamp for older records
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tweetId: string }> }
) {
  try {
    const { tweetId } = await params;

    const existing = await getTweet(tweetId);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Tweet not found' }, { status: 404 });
    }

    const details = await fetchTweetDetails(tweetId, 1, 'shared');

    if (details.authorName) {
      await updateTweetAuthorInfo(tweetId, details.authorName, details.authorUsername);
    }
    await updateTweetText(tweetId, details.text);
    await updateTweetCreatedAt(tweetId, details.tweetCreatedAt);

    const updated = await getTweet(tweetId);
    return NextResponse.json({ success: true, tweet: updated });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to refresh tweet details',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

