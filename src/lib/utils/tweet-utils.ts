/**
 * Utility functions for tweet processing
 */

/**
 * Extract tweet ID from Twitter/X URL
 * Supports: twitter.com, x.com, www.twitter.com
 */
export function extractTweetIdFromUrl(tweetUrl: string): string | null {
  const match = tweetUrl.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i);
  
  if (!match || !match[1]) {
    return null;
  }
  
  return match[1];
}

/**
 * Calculate metrics delta between old and new metrics
 */
export interface MetricsDelta {
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  views: number;
}

export function calculateMetricsDelta(
  oldMetrics: { likeCount: number; retweetCount: number; replyCount: number; quoteCount: number; viewCount: number } | null,
  newMetrics: { likeCount: number; retweetCount: number; replyCount: number; quoteCount: number; viewCount: number }
): MetricsDelta {
  if (!oldMetrics) {
    return {
      likes: newMetrics.likeCount,
      retweets: newMetrics.retweetCount,
      replies: newMetrics.replyCount,
      quotes: newMetrics.quoteCount,
      views: newMetrics.viewCount,
    };
  }

  return {
    likes: newMetrics.likeCount - oldMetrics.likeCount,
    retweets: newMetrics.retweetCount - oldMetrics.retweetCount,
    replies: newMetrics.replyCount - oldMetrics.replyCount,
    quotes: newMetrics.quoteCount - oldMetrics.quoteCount,
    views: newMetrics.viewCount - oldMetrics.viewCount,
  };
}

/**
 * Format engagement type string
 */
export function formatEngagementType(type: 'replied' | 'retweeted' | 'quoted'): string {
  const map = {
    replied: 'Replied',
    retweeted: 'Retweeted',
    quoted: 'Quoted',
  };
  return map[type];
}

/**
 * Normalize Twitter data from different API response formats
 * Handles variations in field names and structures
 */
export function normalizeTwitterData(data: any, type: 'tweet' | 'user'): any {
  if (type === 'tweet') {
    return {
      id: data.id || data.tweet_id,
      text: data.text || data.content || '',
      author: data.author || {},
      createdAt: data.created_at || data.createdAt,
      likeCount: data.likeCount || data.likes || 0,
      retweetCount: data.retweetCount || data.retweets || 0,
      replyCount: data.replyCount || data.replies || 0,
      quoteCount: data.quoteCount || data.quotes || 0,
      viewCount: data.viewCount || data.views || 0,
    };
  } else {
    return {
      id: data.id || data.userId || data.user_id,
      username: data.username || data.userName || data.screen_name,
      name: data.name || data.displayName,
      followers: parseInt(data.followers || data.followers_count || '0', 10) || 0,
      verified: Boolean(data.verified || data.isBlueVerified),
      bio: data.bio || data.description || data.profile_bio?.description,
      location: data.location,
    };
  }
}

