import { getFollowingIndexCollection } from '../models/ranker';
import { categorizeEngager } from '../analyze-engagers';
import { FilteredUser } from '../twitter-api-client';
import type { EngagementInput } from '../models/socap/engagements';
import type { Engager } from '../models/tweets';
import { getTweetByTweetId } from '../models/socap/tweets';

/**
 * Calculate importance score for a user
 * Reuses existing following_index collection
 */
export async function calculateImportanceScore(userId: string): Promise<number> {
  try {
    const followingIndexCollection = await getFollowingIndexCollection();
    
    const entry = await followingIndexCollection.findOne({
      followed_user_id: userId,
    });
    
    if (!entry) {
      return 0;
    }
    
    return entry.importance_score || 0;
  } catch (error) {
    console.error(`Error calculating importance score for user ${userId}:`, error);
    return 0;
  }
}

/**
 * Classify account categories
 * Reuses existing categorizeEngager function
 */
export function classifyAccount(account: {
  username: string;
  name: string;
  bio?: string | null;
  location?: string | null;
  followers: number;
  verified: boolean;
}): string[] {
  // Convert FilteredUser to Engager format for categorizeEngager
  // Note: tweet_id and created_at are required by Engager type but not used by categorizeEngager
  const engager: Engager = {
    tweet_id: '', // Placeholder - not used by categorizeEngager
    created_at: new Date(), // Placeholder - not used by categorizeEngager
    username: account.username || '',
    userId: account.username || '', // categorizeEngager doesn't use userId
    name: account.name || '',
    bio: account.bio || undefined,
    location: account.location || undefined,
    followers: account.followers,
    verified: account.verified,
    replied: false,
    retweeted: false,
    quoted: false,
  };
  
  return categorizeEngager(engager);
}

/**
 * Process and enrich engagement data
 */
export async function processEngagement(
  campaignId: string,
  tweetId: string,
  user: FilteredUser,
  actionType: 'retweet' | 'reply' | 'quote' | 'like',
  timestamp: Date,
  text?: string
): Promise<EngagementInput> {
  // CRITICAL: Verify that the tweet actually belongs to this campaign
  // This prevents creating engagements for tweets from other campaigns (including deleted ones)
  const tweet = await getTweetByTweetId(tweetId);
  if (!tweet) {
    throw new Error(`Tweet ${tweetId} not found in any campaign`);
  }
  
  if (tweet.campaign_id !== campaignId) {
    // Verify the tweet's campaign still exists
    const { getCampaignById } = await import('../models/socap/campaigns');
    const tweetCampaign = await getCampaignById(tweet.campaign_id);
    
    if (!tweetCampaign) {
      throw new Error(
        `Cannot create engagement: Tweet ${tweetId} belongs to deleted campaign ${tweet.campaign_id}, but job is for campaign ${campaignId}`
      );
    }
    
    throw new Error(
      `Cannot create engagement: Tweet ${tweetId} belongs to campaign ${tweet.campaign_id}, but job is for campaign ${campaignId}`
    );
  }
  
  // Figure out tweet category so we can denormalize it onto the engagement.
  // This avoids expensive joins later when filtering by main/influencer/investor.
  const tweetCategory: EngagementInput['tweet_category'] = tweet.category;
  // Calculate importance score
  const importanceScore = await calculateImportanceScore(user.userId);
  
  // Classify account
  const categories = classifyAccount({
    username: user.username || '',
    name: user.name || '',
    bio: user.bio || null,
    location: user.location || null,
    followers: user.followers,
    verified: user.verified,
  });
  
  return {
    campaign_id: campaignId,
    tweet_id: tweetId,
    tweet_category: tweetCategory,
    user_id: user.userId,
    action_type: actionType,
    timestamp,
    text,
    // Store engagement tweet ID if available (for quotes and replies)
    engagement_tweet_id: user.engagementId,
    account_profile: {
      username: user.username || '',
      name: user.name || '',
      bio: user.bio || undefined,
      location: user.location || undefined,
      followers: user.followers,
      verified: user.verified,
    },
    importance_score: importanceScore,
    account_categories: categories,
  };
}

