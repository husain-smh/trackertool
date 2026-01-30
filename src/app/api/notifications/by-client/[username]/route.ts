import { NextRequest, NextResponse } from 'next/server';
import { getTweetsCollection } from '@/lib/models/tweets';
import { getTweetEngagementsCollection } from '@/lib/models/tweet-engagements';

interface TweetWithNotifications {
  tweet_id: string;
  tweet_url: string;
  notification_count: number;
  created_at: string;
}

/**
 * GET /api/notifications/by-client/[username]
 *
 * Returns tweets for a specific author (by author_username) that have notifications.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    const normalizedUsername = username.replace(/^@/, '').toLowerCase();

    const tweetsCollection = await getTweetsCollection();
    const engagementsCollection = await getTweetEngagementsCollection();

    // Find all tweets by this author
    const tweets = await tweetsCollection
      .find({
        $or: [
          { author_username: normalizedUsername },
          { author_username: { $regex: new RegExp(`^${normalizedUsername}$`, 'i') } }
        ]
      })
      .project({ tweet_id: 1, tweet_url: 1, created_at: 1 })
      .sort({ created_at: -1 })
      .toArray();

    if (tweets.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          username: normalizedUsername,
          tweets: [],
        },
      });
    }

    const tweetIds = tweets.map(t => t.tweet_id);

    // Count engagements with llm_copy per tweet
    const notificationCounts = await engagementsCollection
      .aggregate([
        {
          $match: {
            tweet_id: { $in: tweetIds },
            llm_copy: { $exists: true, $ne: '' },
          },
        },
        {
          $group: {
            _id: '$tweet_id',
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const countMap = new Map<string, number>();
    for (const item of notificationCounts) {
      countMap.set(item._id, item.count);
    }

    // Build result with only tweets that have notifications
    const tweetsWithNotifications: TweetWithNotifications[] = tweets
      .filter(t => countMap.has(t.tweet_id))
      .map(t => ({
        tweet_id: t.tweet_id,
        tweet_url: t.tweet_url || `https://twitter.com/i/web/status/${t.tweet_id}`,
        notification_count: countMap.get(t.tweet_id) || 0,
        created_at: t.created_at?.toISOString() || new Date().toISOString(),
      }));

    return NextResponse.json({
      success: true,
      data: {
        username: normalizedUsername,
        tweets: tweetsWithNotifications,
      },
    });
  } catch (error) {
    console.error('Error fetching tweets for author:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch tweets for author',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
