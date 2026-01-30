import { NextRequest, NextResponse } from 'next/server';
import { countLikersForTweet, getTweet } from '@/lib/models/tweets';
import { getXOAuthByClientId } from '@/lib/models/x-oauth';
import { getOrCreateTweetLikersState } from '@/lib/models/tweet-likers-state';
import { getTweetLikersSyncJob } from '@/lib/models/tweet-likers-sync-jobs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tweetId: string }> }
) {
  const { tweetId } = await params;

  const tweet = await getTweet(tweetId);
  if (!tweet) {
    return NextResponse.json({ success: false, error: 'Tweet not found' }, { status: 404 });
  }

  const authorUsername = tweet.author_username;
  const clientId = authorUsername || null;

  const state = await getOrCreateTweetLikersState(tweetId);
  const oauth = clientId ? await getXOAuthByClientId(clientId) : null;
  const [job, likerCount] = await Promise.all([
    getTweetLikersSyncJob(tweetId),
    countLikersForTweet(tweetId),
  ]);

  return NextResponse.json({
    success: true,
    tweet_id: tweetId,
    client_id: clientId,
    has_oauth: Boolean(oauth && oauth.status === 'active'),
    oauth_status: oauth?.status || null,
    blocked_until: state.blocked_until,
    backfill_complete: state.backfill_complete,
    cursor: state.cursor,
    last_success: state.last_success,
    last_error: state.last_error,
    progress: {
      // Total likes from tweet metrics (can change over time, so treat as informative not absolute).
      likes_total: tweet.metrics?.likeCount ?? null,
      likers_synced: likerCount,
    },
    job: job
      ? {
          status: job.status,
          retry_after: job.retry_after,
          retry_count: job.retry_count,
          max_retries: job.max_retries,
          last_error: job.last_error ?? null,
          stats: job.stats ?? null,
          updated_at: job.updated_at,
        }
      : null,
  });
}

