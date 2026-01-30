import { Collection } from 'mongodb';
import clientPromise from '../../mongodb';

// ===== TypeScript Interfaces =====

export interface Engagement {
  _id?: string;
  campaign_id: string;
  tweet_id: string; // Original tweet being engaged with
  tweet_category?: 'main_twt' | 'influencer_twt' | 'investor_twt'; // denormalized from socap_tweets
  user_id: string;
  action_type: 'retweet' | 'reply' | 'quote' | 'like';
  timestamp: Date;
  text?: string; // for replies/quotes
  engagement_tweet_id?: string; // ID of the actual quote/reply tweet (for quotes and replies)
  engagement_tweet_url?: string; // Derived https://twitter.com/i/web/status/<id>
  account_profile: {
    username: string;
    name: string;
    bio?: string;
    location?: string; // User-provided location (may be inaccurate)
    account_based_in?: string; // Accurate location from Twitter API (for heatmap)
    followers: number;
    verified: boolean;
  };
  importance_score: number;
  account_categories: string[]; // from categorizeEngager
  /**
   * For quote tweet engagements, stores the last known viewCount of the
   * quote tweet itself. This allows the QuotesWorker to compute non-negative
   * per-quote deltas over time without double-counting.
   *
   * Optional for backward compatibility and for non-quote engagements.
   */
  quote_view_count?: number;
  /**
   * Optional full metrics for the quote tweet when available.
   */
  quote_metrics?: {
    viewCount?: number;
    likeCount?: number;
    retweetCount?: number;
    replyCount?: number;
    quoteCount?: number;
    bookmarkCount?: number;
  };
  last_seen_at: Date;
  created_at: Date;
}

export interface EngagementInput {
  campaign_id: string;
  tweet_id: string;
  tweet_category?: 'main_twt' | 'influencer_twt' | 'investor_twt';
  user_id: string;
  action_type: 'retweet' | 'reply' | 'quote' | 'like';
  timestamp: Date;
  text?: string;
  engagement_tweet_id?: string; // ID of the actual quote/reply tweet
  engagement_tweet_url?: string;
  account_profile: {
    username: string;
    name: string;
    bio?: string;
    location?: string; // User-provided location (may be inaccurate)
    account_based_in?: string; // Accurate location from Twitter API (for heatmap)
    followers: number;
    verified: boolean;
  };
  importance_score: number;
  account_categories: string[];
  /**
   * Optional last known view count for quote tweet engagements.
   * Only relevant when action_type === 'quote'; ignored for others.
   */
  quote_view_count?: number;
  /**
   * Optional full metrics for the quote tweet when available.
   */
  quote_metrics?: {
    viewCount?: number;
    likeCount?: number;
    retweetCount?: number;
    replyCount?: number;
    quoteCount?: number;
    bookmarkCount?: number;
  };
}

// ===== Collection Getter =====

export async function getEngagementsCollection(): Promise<Collection<Engagement>> {
  const client = await clientPromise;
  const db = client.db();
  return db.collection<Engagement>('socap_engagements');
}

// ===== Indexes =====

export async function createEngagementIndexes(): Promise<void> {
  const collection = await getEngagementsCollection();
  
  // Unique index prevents duplicates
  await collection.createIndex(
    { tweet_id: 1, user_id: 1, action_type: 1 },
    { unique: true }
  );
  
  await collection.createIndex({ campaign_id: 1, created_at: -1 });
  await collection.createIndex({ tweet_id: 1, timestamp: -1 });
  await collection.createIndex({ campaign_id: 1, tweet_category: 1, timestamp: -1 });
  await collection.createIndex({ importance_score: -1 });
  await collection.createIndex({ campaign_id: 1, importance_score: -1 });
  await collection.createIndex({ user_id: 1, campaign_id: 1 });
  await collection.createIndex({ 'account_profile.username': 1 });
  
  // Index for heatmap aggregation (location-based queries)
  await collection.createIndex({
    campaign_id: 1,
    'account_profile.account_based_in': 1,
  });

  // Additional covering indexes for filtered/sorted queries and time-series
  await collection.createIndex({ campaign_id: 1, timestamp: -1 });
  await collection.createIndex({
    campaign_id: 1,
    action_type: 1,
    importance_score: -1,
    timestamp: -1,
  });
  await collection.createIndex({
    campaign_id: 1,
    tweet_category: 1,
    action_type: 1,
    timestamp: -1,
  });
  await collection.createIndex({
    campaign_id: 1,
    action_type: 1,
    importance_score: -1,
    'account_profile.followers': -1,
    timestamp: -1,
  });
}

// ===== CRUD Operations =====

export async function createOrUpdateEngagement(input: EngagementInput): Promise<Engagement> {
  const collection = await getEngagementsCollection();
  
  // Prepare fields that should be updated on both insert and update
  const updateFields: Partial<Engagement> = {
    campaign_id: input.campaign_id,
    tweet_id: input.tweet_id,
    tweet_category: input.tweet_category,
    user_id: input.user_id,
    action_type: input.action_type,
    timestamp: input.timestamp,
    text: input.text,
    engagement_tweet_id: input.engagement_tweet_id,
    engagement_tweet_url: input.engagement_tweet_url,
    account_profile: input.account_profile,
    importance_score: input.importance_score,
    account_categories: input.account_categories,
    last_seen_at: new Date(), // Always update last_seen_at
  };
  
  // Only update quote_view_count when explicitly provided.
  // This preserves any existing stored baseline when callers
  // don't have a fresh view count (e.g. retweets / replies or
  // older code paths).
  if (typeof input.quote_view_count === 'number') {
    updateFields.quote_view_count = input.quote_view_count;
  }
  // Persist quote metrics only when provided
  if (input.quote_metrics) {
    updateFields.quote_metrics = input.quote_metrics;
  }
  
  // CRITICAL: Include campaign_id in the match criteria to prevent cross-campaign contamination
  // This ensures engagements from different campaigns don't overwrite each other
  const result = await collection.findOneAndUpdate(
    {
      campaign_id: input.campaign_id,
      tweet_id: input.tweet_id,
      user_id: input.user_id,
      action_type: input.action_type,
    },
    {
      $set: updateFields,
      $setOnInsert: {
        // Only set created_at when creating a new document
        created_at: input.timestamp,
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
    }
  );
  
  return result as Engagement;
}

export async function getEngagementsByCampaign(
  campaignId: string,
  options?: {
    limit?: number;
    offset?: number;
    sort?: 'importance_score' | 'timestamp';
    category?: 'main_twt' | 'influencer_twt' | 'investor_twt';
    action_type?: 'retweet' | 'reply' | 'quote' | 'like';
    min_importance?: number;
  }
): Promise<Engagement[]> {
  const collection = await getEngagementsCollection();
  
  const query: any = { campaign_id: campaignId };
  
  // Filter by tweet category (need to join with tweets collection)
  if (options?.category) {
    // This will be handled in aggregation pipeline
  }
  
  if (options?.action_type) {
    query.action_type = options.action_type;
  }
  
  if (options?.min_importance) {
    query.importance_score = { $gte: options.min_importance };
  }
  
  const sortField = options?.sort === 'timestamp' ? 'timestamp' : 'importance_score';
  const sortOrder = -1; // Descending
  
  let cursor = collection.find(query).sort({ [sortField]: sortOrder });
  
  if (options?.offset) {
    cursor = cursor.skip(options.offset);
  }
  
  if (options?.limit) {
    cursor = cursor.limit(options.limit);
  }
  
  return await cursor.toArray();
}

export async function getEngagementsByTweet(tweetId: string): Promise<Engagement[]> {
  const collection = await getEngagementsCollection();
  return await collection.find({ tweet_id: tweetId }).sort({ timestamp: -1 }).toArray();
}

export async function getEngagementsByUser(
  campaignId: string,
  userId: string
): Promise<Engagement[]> {
  const collection = await getEngagementsCollection();
  return await collection
    .find({ campaign_id: campaignId, user_id: userId })
    .sort({ timestamp: 1 })
    .toArray();
}

export async function getEngagementCountByCampaign(campaignId: string): Promise<number> {
  const collection = await getEngagementsCollection();
  return await collection.countDocuments({ campaign_id: campaignId });
}

export async function getUniqueEngagersByCampaign(campaignId: string): Promise<number> {
  const collection = await getEngagementsCollection();
  const result = await collection.distinct('user_id', { campaign_id: campaignId });
  return result.length;
}

/**
 * Get potential viewers: important people who follow top engagers but haven't engaged.
 * 
 * Simple logic:
 * 1. Get top engagers (sorted by importance_score) - these are accounts that engaged
 * 2. Find important people who follow these top engagers (from following_index)
 *    - If important person A follows top engager X, A might have seen your post
 * 3. Filter out important people who have already engaged
 * 4. Return only accounts with importance_score > 0
 * 5. For each potential viewer, track which top engagers they follow
 * 
 * Example: Top engager X engaged with your post.
 *          Important person A follows X (from following_index).
 *          A might have seen your post (because they follow X).
 *          If A hasn't engaged, A is a potential viewer.
 */
export async function getPotentialViewersByCampaign(
  campaignId: string,
  options?: {
    topEngagersLimit?: number; // How many top engagers to consider (default: 30)
    minImportanceScore?: number; // Minimum importance score for potential viewers (default: 0)
    limit?: number; // Max results to return (default: 100)
  }
): Promise<Array<{
  user_id: string;
  username: string;
  name: string;
  bio?: string;
  location?: string;
  followers: number;
  verified: boolean;
  importance_score: number;
  connected_to_engagers: Array<{
    user_id: string;
    username: string;
    name: string;
  }>;
}>> {
  const { getFollowingIndexCollection } = await import('../../models/ranker');
  const followingIndexCollection = await getFollowingIndexCollection();
  const engagementsCollection = await getEngagementsCollection();
  
  const topEngagersLimit = options?.topEngagersLimit ?? 30;
  const minImportanceScore = options?.minImportanceScore ?? 0;
  const resultLimit = options?.limit ?? 100;
  
  // Step 1: Get top engagers for this campaign (sorted by importance_score)
  const topEngagers = await engagementsCollection
    .aggregate([
      { $match: { campaign_id: campaignId } },
      {
        $group: {
          _id: '$user_id',
          maxImportanceScore: { $max: '$importance_score' },
          account_profile: { $first: '$account_profile' },
        },
      },
      { $sort: { maxImportanceScore: -1 } },
      { $limit: topEngagersLimit },
    ])
    .toArray();
  
  if (topEngagers.length === 0) {
    return [];
  }
  
  // Build a map of top engagers with their profile info
  const topEngagersMap = new Map<string, { user_id: string; username: string; name: string }>();
  for (const engager of topEngagers as any[]) {
    topEngagersMap.set(engager._id, {
      user_id: engager._id,
      username: engager.account_profile?.username || '',
      name: engager.account_profile?.name || engager.account_profile?.username || '',
    });
  }
  
  const topEngagerUserIds = Array.from(topEngagersMap.keys());
  
  // Step 2: Get important people who follow these top engagers
  // The following_index stores: followed_user_id -> [important people who follow them]
  const topEngagerIndexEntries = await followingIndexCollection
    .find({ followed_user_id: { $in: topEngagerUserIds } })
    .toArray();
  
  // Build a map: important_person_id -> [top_engager_ids they follow]
  // These important people are potential viewers (they follow engagers, might have seen the post)
  const importantPersonToEngagersMap = new Map<string, Set<string>>();
  const potentialViewerUserIds = new Set<string>();
  
  for (const entry of topEngagerIndexEntries) {
    const engagerId = entry.followed_user_id;
    if (Array.isArray(entry.followed_by)) {
      for (const importantPerson of entry.followed_by) {
        if (importantPerson.user_id) {
          // This important person follows this top engager
          if (!importantPersonToEngagersMap.has(importantPerson.user_id)) {
            importantPersonToEngagersMap.set(importantPerson.user_id, new Set());
          }
          importantPersonToEngagersMap.get(importantPerson.user_id)!.add(engagerId);
          potentialViewerUserIds.add(importantPerson.user_id);
        }
      }
    }
  }
  
  if (potentialViewerUserIds.size === 0) {
    return [];
  }
  
  // Step 3: Get the following_index entries for these potential viewers
  // to get their importance_score and profile info
  const potentialViewerEntries = await followingIndexCollection
    .find({
      followed_user_id: { $in: Array.from(potentialViewerUserIds) },
      importance_score: { $gt: minImportanceScore },
    })
    .sort({ importance_score: -1 })
    .limit(resultLimit * 2) // Get more to account for filtering
    .toArray();
  
  // Step 4: Get all user_ids that have engaged with this campaign
  const engagedUserIds = new Set(
    await engagementsCollection.distinct('user_id', { campaign_id: campaignId })
  );
  
  // Step 4: Filter out accounts that have engaged
  const filteredPotentialViewers = potentialViewerEntries
    .filter((entry) => !engagedUserIds.has(entry.followed_user_id))
    .slice(0, resultLimit);
  
  if (filteredPotentialViewers.length === 0) {
    return [];
  }
  
  // Step 5: Try to enrich with profile data from engagements (even from other campaigns)
  // This gives us name, bio, followers, verified status if the user has engaged elsewhere
  const filteredPotentialViewerUserIds = filteredPotentialViewers.map((entry) => entry.followed_user_id);
  
  const profileDataMap = new Map<string, {
    name: string;
    bio?: string;
    location?: string;
    followers: number;
    verified: boolean;
  }>();
  
  const recentEngagements = await engagementsCollection
    .aggregate([
      { $match: { user_id: { $in: filteredPotentialViewerUserIds } } },
      {
        $sort: { last_seen_at: -1 }, // Get most recent profile data
      },
      {
        $group: {
          _id: '$user_id',
          account_profile: { $first: '$account_profile' },
        },
      },
    ])
    .toArray();
  
  for (const eng of recentEngagements as any[]) {
    if (eng.account_profile) {
      profileDataMap.set(eng._id, {
        name: eng.account_profile.name || '',
        bio: eng.account_profile.bio,
        location: eng.account_profile.location,
        followers: eng.account_profile.followers || 0,
        verified: eng.account_profile.verified || false,
      });
    }
  }
  
  // Step 5: Format results with enriched profile data and which engagers they follow
  const potentialViewers = filteredPotentialViewers
    .map((entry) => {
      const profileData = profileDataMap.get(entry.followed_user_id);
      const engagerIdsTheyFollow = importantPersonToEngagersMap.get(entry.followed_user_id) || new Set();
      
      // Get the top engagers this important person follows
      const connectedToEngagers = Array.from(engagerIdsTheyFollow)
        .map((engagerId) => topEngagersMap.get(engagerId))
        .filter((engager): engager is { user_id: string; username: string; name: string } => engager !== undefined);
      
      return {
        user_id: entry.followed_user_id,
        username: entry.followed_username,
        name: profileData?.name || entry.followed_username, // Fallback to username if no name
        bio: profileData?.bio,
        location: profileData?.location,
        followers: profileData?.followers || 0,
        verified: profileData?.verified || false,
        importance_score: entry.importance_score,
        connected_to_engagers: connectedToEngagers,
      };
    })
    .filter((viewer) => viewer.connected_to_engagers.length > 0); // Only return viewers who follow at least one engager
  
  return potentialViewers;
}

/**
 * Get all unique engagers for a campaign, grouped by user_id.
 * Returns one record per user with their highest importance_score, follower count,
 * and all their engagement actions.
 * 
 * This is optimized for displaying all accounts that have engaged with the campaign.
 */
export async function getAllUniqueEngagersByCampaign(
  campaignId: string,
  options?: {
    action_type?: 'retweet' | 'reply' | 'quote' | 'like';
  }
): Promise<Engagement[]> {
  const collection = await getEngagementsCollection();
  
  const matchStage: any = { campaign_id: campaignId };
  if (options?.action_type) {
    matchStage.action_type = options.action_type;
  }
  
  // Use aggregation to group by user_id and get the best record for each user
  const pipeline: any[] = [
    { $match: matchStage },
    {
      $sort: {
        // Sort by importance_score first, then by followers for tie-breaking
        importance_score: -1,
        'account_profile.followers': -1,
        timestamp: -1, // Most recent as final tie-breaker
      },
    },
    {
      $group: {
        _id: '$user_id',
        // Keep the first document (which has highest importance_score due to sort)
        doc: { $first: '$$ROOT' },
        // Collect all actions for this user
        allActions: {
          $push: {
            action_type: '$action_type',
            tweet_id: '$tweet_id',
            tweet_category: '$tweet_category',
            timestamp: '$timestamp',
            engagement_tweet_id: '$engagement_tweet_id',
          },
        },
        // Keep track of max importance_score and max followers
        maxImportanceScore: { $max: '$importance_score' },
        maxFollowers: { $max: '$account_profile.followers' },
      },
    },
    {
      $project: {
        _id: '$doc._id',
        campaign_id: '$doc.campaign_id',
        tweet_id: '$doc.tweet_id', // Keep one tweet_id for reference
        tweet_category: '$doc.tweet_category',
        user_id: '$doc.user_id',
        action_type: '$doc.action_type', // Keep one action_type for reference
        timestamp: '$doc.timestamp',
        text: '$doc.text',
        engagement_tweet_id: '$doc.engagement_tweet_id',
        account_profile: '$doc.account_profile',
        // Use the max importance_score
        importance_score: '$maxImportanceScore',
        account_categories: '$doc.account_categories',
        quote_view_count: '$doc.quote_view_count',
        last_seen_at: '$doc.last_seen_at',
        created_at: '$doc.created_at',
        // Store all actions in a custom field (we'll handle this in frontend)
        _all_actions: '$allActions',
      },
    },
    {
      $sort: {
        // Sort by importance_score descending, then by followers descending for zero-importance accounts
        importance_score: -1,
        'account_profile.followers': -1,
      },
    },
  ];
  
  const results = await collection.aggregate(pipeline).toArray();
  
  // Convert back to Engagement format, but we need to handle the _all_actions field
  // The frontend will group these properly, so we return them as-is
  return results as any[];
}

/**
 * Get time-bucketed engagement counts for a campaign.
 *
 * This is the core of the "robust chart vs time" system:
 * we bucket by the actual engagement timestamp coming from the
 * Twitter API (or best approximation), not by when workers ran.
 */
export async function getEngagementTimeSeriesByCampaign(
  campaignId: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
    granularity?: 'half_hour' | 'hour' | 'day';
    action_type?: 'retweet' | 'reply' | 'quote' | 'like';
    category?: 'main_twt' | 'influencer_twt' | 'investor_twt';
  }
): Promise<
  Array<{
    bucket_start: Date;
    retweets: number;
    replies: number;
    quotes: number;
    likes: number;
    total: number;
  }>
> {
  const collection = await getEngagementsCollection();

  const match: any = {
    campaign_id: campaignId,
  };

  if (options?.startDate || options?.endDate) {
    match.timestamp = {};
    if (options.startDate) {
      match.timestamp.$gte = options.startDate;
    }
    if (options.endDate) {
      match.timestamp.$lte = options.endDate;
    }
  }

  if (options?.action_type) {
    match.action_type = options.action_type;
  }

  if (options?.category) {
    match.tweet_category = options.category;
  }

  const pipeline: any[] = [
    { $match: match },
  ];

  // Determine bucketing behavior.
  // - 'half_hour' → 30-minute buckets
  // - 'hour'     → hourly buckets (default)
  // - 'day'      → daily buckets
  let dateTruncSpec: any;
  if (options?.granularity === 'day') {
    dateTruncSpec = {
      date: '$timestamp',
      unit: 'day',
    };
  } else if (options?.granularity === 'half_hour') {
    dateTruncSpec = {
      date: '$timestamp',
      unit: 'minute',
      binSize: 30,
    };
  } else {
    dateTruncSpec = {
      date: '$timestamp',
      unit: 'hour',
    };
  }

  pipeline.push(
    {
      $group: {
        _id: {
          bucket_start: {
            $dateTrunc: dateTruncSpec,
          },
        },
        retweets: {
          $sum: {
            $cond: [{ $eq: ['$action_type', 'retweet'] }, 1, 0],
          },
        },
        replies: {
          $sum: {
            $cond: [{ $eq: ['$action_type', 'reply'] }, 1, 0],
          },
        },
        quotes: {
          $sum: {
            $cond: [{ $eq: ['$action_type', 'quote'] }, 1, 0],
          },
        },
        likes: {
          $sum: {
            $cond: [{ $eq: ['$action_type', 'like'] }, 1, 0],
          },
        },
        total: { $sum: 1 },
      },
    },
    {
      $sort: {
        '_id.bucket_start': 1,
      },
    }
  );

  const results = await collection.aggregate(pipeline).toArray();

  return results.map((r: any) => ({
    bucket_start: r._id.bucket_start,
    retweets: r.retweets ?? 0,
    replies: r.replies ?? 0,
    quotes: r.quotes ?? 0,
    likes: r.likes ?? 0,
    total: r.total ?? 0,
  }));
}

export async function getEngagementById(engagementId: string): Promise<Engagement | null> {
  const collection = await getEngagementsCollection();
  const { ObjectId } = await import('mongodb');
  
  if (!ObjectId.isValid(engagementId)) {
    return null;
  }
  
  return await collection.findOne({ _id: new ObjectId(engagementId) } as any);
}

/**
 * Get the latest engagement timestamp for a campaign.
 * This helps identify when engagement data was last updated.
 */
export async function getLatestEngagementTimestamp(
  campaignId: string
): Promise<Date | null> {
  const collection = await getEngagementsCollection();
  
  const latest = await collection
    .findOne(
      { campaign_id: campaignId },
      { sort: { timestamp: -1 }, projection: { timestamp: 1 } }
    );
  
  return latest?.timestamp ? new Date(latest.timestamp) : null;
}

