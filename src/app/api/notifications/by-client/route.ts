import { NextResponse } from 'next/server';
import { getTweetsCollection } from '@/lib/models/tweets';
import { getTweetEngagementsCollection } from '@/lib/models/tweet-engagements';

interface AuthorWithNotifications {
  x_username: string;
  display_name: string;
  total_notifications: number;
  tweets_with_notifications: number;
  is_managed_client: boolean;
}

/**
 * GET /api/notifications/by-client
 *
 * Returns all authors (tweet owners) who have notifications on their tweets.
 * Notification = engagement with llm_copy (generated notification text)
 *
 * This includes both managed clients AND any other analyzed tweets.
 */
export async function GET() {
  try {
    const tweetsCollection = await getTweetsCollection();
    const engagementsCollection = await getTweetEngagementsCollection();

    // Find all tweet_ids that have at least one engagement with llm_copy
    const tweetsWithNotifications = await engagementsCollection
      .aggregate([
        {
          $match: {
            llm_copy: { $exists: true, $ne: '' },
          },
        },
        {
          $group: {
            _id: '$tweet_id',
            notification_count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    if (tweetsWithNotifications.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    const tweetIds = tweetsWithNotifications.map(t => t._id);
    const notificationCountMap = new Map<string, number>();
    for (const t of tweetsWithNotifications) {
      notificationCountMap.set(t._id, t.notification_count);
    }

    // Get tweet details to find authors
    const tweets = await tweetsCollection
      .find({ tweet_id: { $in: tweetIds } })
      .project({ tweet_id: 1, author_username: 1, author_name: 1 })
      .toArray();

    // Group by author
    const authorMap = new Map<string, {
      display_name: string;
      total_notifications: number;
      tweet_ids: string[];
    }>();

    for (const tweet of tweets) {
      const username = (tweet.author_username || 'unknown').toLowerCase();
      const displayName = tweet.author_name || tweet.author_username || 'Unknown';
      const notificationCount = notificationCountMap.get(tweet.tweet_id) || 0;

      if (authorMap.has(username)) {
        const existing = authorMap.get(username)!;
        existing.total_notifications += notificationCount;
        existing.tweet_ids.push(tweet.tweet_id);
      } else {
        authorMap.set(username, {
          display_name: displayName,
          total_notifications: notificationCount,
          tweet_ids: [tweet.tweet_id],
        });
      }
    }

    // Build results
    const results: AuthorWithNotifications[] = [];
    for (const [username, data] of authorMap) {
      results.push({
        x_username: username,
        display_name: data.display_name,
        total_notifications: data.total_notifications,
        tweets_with_notifications: data.tweet_ids.length,
        is_managed_client: false, // We can enhance this later if needed
      });
    }

    // Sort by total notifications descending
    results.sort((a, b) => b.total_notifications - a.total_notifications);

    return NextResponse.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error('Error fetching notifications by author:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch notifications by author',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
