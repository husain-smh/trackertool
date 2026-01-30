import { Collection, ObjectId } from 'mongodb';
import { getDb } from '../mongodb-ranker';
import type { AIReport } from '../generate-ai-report';
import { enqueueTweetLocationEnrichmentJob } from './tweet-location-enrichment-jobs';

// ===== TypeScript Interfaces =====

export interface TweetMetrics {
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  viewCount: number;
  bookmarkCount: number;
  last_updated: Date;
}

export interface TweetMetricsHistory {
  timestamp: Date;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  viewCount: number;
}

export interface Tweet {
  _id?: ObjectId;
  tweet_id: string;
  tweet_url: string;
  author_name: string;
  author_username?: string;
  /**
   * The main tweet text (critical for SOCAP-style contextual LLM notifications).
   * Stored from twitterapi.io /twitter/tweets.
   */
  text?: string;
  /**
   * The original published timestamp of the tweet on X/Twitter.
   * Pulled from twitterapi.io /twitter/tweets (when available).
   *
   * Note: this is different from `created_at` (our DB record creation time)
   * and `analyzed_at` (when our analysis completed).
   */
  tweet_created_at?: Date;
  status: 'pending' | 'analyzing' | 'completed' | 'failed';
  total_engagers: number;
  engagers_above_10k: number;
  engagers_below_10k: number;
  created_at: Date;
  analyzed_at?: Date;
  error?: string;
  ai_report?: AIReport;
  metrics?: TweetMetrics;
  metrics_history?: TweetMetricsHistory[];
}

export interface Engager {
  _id?: ObjectId;
  tweet_id: string; // Reference to tweet
  userId: string;
  username: string;
  name: string;
  bio?: string;
  location?: string;
  /**
   * Accurate location string from twitterapi.io user_about about_profile.account_based_in.
   * Populated asynchronously by our location enrichment job.
   */
  account_based_in?: string | null;
  /**
   * Enrichment status to avoid infinite retries and to support progress UI.
   */
  account_based_in_status?: 'pending' | 'done' | 'no_data' | 'error';
  account_based_in_updated_at?: Date;
  followers: number;
  verified: boolean;
  
  // Engagement types
  replied: boolean;
  retweeted: boolean;
  quoted: boolean;
  /**
   * True if this user liked the tweet (from official X API /2/tweets/:id/liking_users).
   *
   * NOTE: The X "liking_users" endpoint does not provide a like timestamp,
   * so we treat this as a boolean fact rather than a time-series signal.
   */
  liked?: boolean;
  
  // Engagement timestamps (when each engagement occurred)
  replied_at?: Date;
  retweeted_at?: Date;
  quoted_at?: Date;
  
  // Ranking data (filled after ranking job)
  importance_score?: number;
  followed_by?: string[]; // Array of important usernames
  
  created_at: Date; // When this record was created in our database
}

export interface EngagerInput {
  userId: string;
  username: string;
  name: string;
  bio?: string;
  location?: string;
  followers: number;
  verified: boolean;
  replied: boolean;
  retweeted: boolean;
  quoted: boolean;
  liked?: boolean;
  // Engagement timestamps (when each engagement occurred)
  replied_at?: Date;
  retweeted_at?: Date;
  quoted_at?: Date;
}

// ===== Collection Helpers =====

export async function getTweetsCollection(): Promise<Collection<Tweet>> {
  const db = await getDb();
  return db.collection<Tweet>('tweets');
}

export async function getEngagersCollection(): Promise<Collection<Engager>> {
  const db = await getDb();
  return db.collection<Engager>('engagers');
}

export async function countLikersForTweet(tweetId: string): Promise<number> {
  const collection = await getEngagersCollection();
  const cleanedTweetId = String(tweetId || '').trim();
  if (!cleanedTweetId) return 0;
  return await collection.countDocuments({ tweet_id: cleanedTweetId, liked: true });
}

// ===== Database Operations =====

/**
 * Create a new tweet analysis entry
 */
export async function createTweet(
  tweetId: string,
  tweetUrl: string,
  authorName: string,
  authorUsername?: string
): Promise<Tweet> {
  const collection = await getTweetsCollection();
  
  const tweet: Tweet = {
    tweet_id: tweetId,
    tweet_url: tweetUrl,
    author_name: authorName,
    author_username: authorUsername,
    status: 'pending',
    total_engagers: 0,
    engagers_above_10k: 0,
    engagers_below_10k: 0,
    created_at: new Date(),
  };
  
  await collection.insertOne(tweet);
  return tweet;
}

/**
 * Store engagers for a tweet
 */
export async function storeEngagers(
  tweetId: string,
  engagers: EngagerInput[]
): Promise<void> {
  const collection = await getEngagersCollection();
  
  const engagerDocs: Engager[] = engagers.map(e => ({
    tweet_id: tweetId,
    userId: e.userId,
    username: e.username,
    name: e.name,
    bio: e.bio,
    location: e.location,
    account_based_in: null,
    account_based_in_status: 'pending',
    account_based_in_updated_at: undefined,
    followers: e.followers,
    verified: e.verified,
    replied: e.replied,
    retweeted: e.retweeted,
    quoted: e.quoted,
    liked: Boolean(e.liked),
    replied_at: e.replied_at,
    retweeted_at: e.retweeted_at,
    quoted_at: e.quoted_at,
    created_at: new Date(),
  }));
  
  if (engagerDocs.length > 0) {
    await collection.insertMany(engagerDocs);
  }
  
  // Update tweet stats
  const tweetsCollection = await getTweetsCollection();
  const above10k = engagers.filter(e => e.followers >= 10000).length;
  const below10k = engagers.length - above10k;
  
  await tweetsCollection.updateOne(
    { tweet_id: tweetId },
    {
      $set: {
        total_engagers: engagers.length,
        engagers_above_10k: above10k,
        engagers_below_10k: below10k,
        status: 'analyzing',
      },
    }
  );

  // Queue tweet-scoped location enrichment (runs asynchronously via cron).
  // This is idempotent (upsert), so it's safe to call on re-analysis too.
  await enqueueTweetLocationEnrichmentJob(tweetId);
}

/**
 * Update tweet status
 */
export async function updateTweetStatus(
  tweetId: string,
  status: Tweet['status'],
  error?: string
): Promise<void> {
  const collection = await getTweetsCollection();
  
  const update: any = {
    status,
  };
  
  if (status === 'completed') {
    update.analyzed_at = new Date();
  }
  
  if (error) {
    update.error = error;
  }
  
  await collection.updateOne(
    { tweet_id: tweetId },
    { $set: update }
  );
}

/**
 * Update engagers with ranking data
 */
export async function updateEngagersWithRanking(
  tweetId: string,
  rankedEngagers: Array<{
    userId: string;
    importance_score: number;
    followed_by: string[];
  }>
): Promise<void> {
  const collection = await getEngagersCollection();
  
  // Bulk update operations
  const bulkOps = rankedEngagers.map(re => ({
    updateOne: {
      filter: { tweet_id: tweetId, userId: re.userId },
      update: {
        $set: {
          importance_score: re.importance_score,
          followed_by: re.followed_by,
        },
      },
    },
  }));
  
  if (bulkOps.length > 0) {
    await collection.bulkWrite(bulkOps);
  }
}

/**
 * Delete all engagers for a tweet (used for re-analysis)
 */
export async function deleteEngagersByTweetId(tweetId: string): Promise<number> {
  const collection = await getEngagersCollection();
  const result = await collection.deleteMany({ tweet_id: tweetId });
  return result.deletedCount;
}

/**
 * Get tweet by ID
 */
export async function getTweet(tweetId: string): Promise<Tweet | null> {
  const collection = await getTweetsCollection();
  return await collection.findOne({ tweet_id: tweetId });
}

/**
 * Lightweight tweet data for list views (excludes heavy fields like ai_report, metrics_history)
 */
export interface TweetListItem {
  _id?: ObjectId;
  tweet_id: string;
  tweet_url: string;
  author_name: string;
  author_username?: string;
  status: 'pending' | 'analyzing' | 'completed' | 'failed';
  total_engagers: number;
  engagers_above_10k: number;
  engagers_below_10k: number;
  created_at: Date;
  analyzed_at?: Date;
}

/**
 * Get all tweets (paginated) - OPTIMIZED VERSION
 * Uses projection to fetch only lightweight fields needed for list views.
 * This dramatically reduces data transfer (excludes ai_report, metrics_history, etc.)
 */
export async function getAllTweets(
  limit = 50,
  skip = 0
): Promise<{ tweets: TweetListItem[]; total: number }> {
  const collection = await getTweetsCollection();
  
  // Only fetch the fields needed for the list view
  // IMPORTANT: This excludes ai_report and metrics_history which can be HUGE
  const projection = {
    tweet_id: 1,
    tweet_url: 1,
    author_name: 1,
    author_username: 1,
    status: 1,
    total_engagers: 1,
    engagers_above_10k: 1,
    engagers_below_10k: 1,
    created_at: 1,
    analyzed_at: 1,
  };
  
  // Run count and find in parallel for better performance
  const [tweets, total] = await Promise.all([
    collection
      .find({}, { projection })
      .sort({ created_at: -1 })
      .limit(limit)
      .skip(skip)
      .toArray(),
    collection.countDocuments(),
  ]);
  
  return { tweets: tweets as TweetListItem[], total };
}

/**
 * Get engagers for a tweet (paginated, filtered, sorted)
 */
export interface GetEngagersOptions {
  limit?: number;
  skip?: number;
  minFollowers?: number;
  maxFollowers?: number;
  sortBy?: 'followers' | 'importance_score' | 'username';
  sortOrder?: 'asc' | 'desc';
  engagementType?: 'replied' | 'retweeted' | 'quoted' | 'liked';
  verifiedOnly?: boolean;
}

export async function getEngagers(
  tweetId: string,
  options: GetEngagersOptions = {}
): Promise<{ engagers: Engager[]; total: number }> {
  const collection = await getEngagersCollection();
  
  const {
    limit = 50,
    skip = 0,
    minFollowers,
    maxFollowers,
    sortBy = 'importance_score',
    sortOrder = 'desc',
    engagementType,
    verifiedOnly,
  } = options;
  
  // Build filter
  const filter: any = { tweet_id: tweetId };
  
  if (minFollowers !== undefined) {
    filter.followers = { ...filter.followers, $gte: minFollowers };
  }
  
  if (maxFollowers !== undefined) {
    filter.followers = { ...filter.followers, $lte: maxFollowers };
  }
  
  if (engagementType) {
    filter[engagementType] = true;
  }
  
  if (verifiedOnly) {
    filter.verified = true;
  }
  
  // Build sort
  const sort: any = {};
  sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
  
  // Get total count
  const total = await collection.countDocuments(filter);
  
  // Get engagers
  const engagers = await collection
    .find(filter)
    .sort(sort)
    .limit(limit)
    .skip(skip)
    .toArray();
  
  return { engagers, total };
}

/**
 * Get engagers count by follower ranges
 */
export async function getEngagersStats(tweetId: string): Promise<{
  total: number;
  above_10k: number;
  below_10k: number;
  replied: number;
  retweeted: number;
  quoted: number;
  liked: number;
  verified: number;
  avg_importance_score: number;
  max_importance_score: number;
}> {
  const collection = await getEngagersCollection();
  
  const total = await collection.countDocuments({ tweet_id: tweetId });
  const above_10k = await collection.countDocuments({ tweet_id: tweetId, followers: { $gte: 10000 } });
  const below_10k = total - above_10k;
  const replied = await collection.countDocuments({ tweet_id: tweetId, replied: true });
  const retweeted = await collection.countDocuments({ tweet_id: tweetId, retweeted: true });
  const quoted = await collection.countDocuments({ tweet_id: tweetId, quoted: true });
  const liked = await collection.countDocuments({ tweet_id: tweetId, liked: true });
  const verified = await collection.countDocuments({ tweet_id: tweetId, verified: true });
  
  // Calculate importance score stats
  const engagers = await collection
    .find({ tweet_id: tweetId, importance_score: { $exists: true } })
    .toArray();
  
  const scores = engagers
    .map(e => e.importance_score || 0)
    .filter(s => s > 0);
  
  const avg_importance_score = scores.length > 0
    ? scores.reduce((sum, s) => sum + s, 0) / scores.length
    : 0;
  
  const max_importance_score = scores.length > 0
    ? Math.max(...scores)
    : 0;
  
  return {
    total,
    above_10k,
    below_10k,
    replied,
    retweeted,
    quoted,
    liked,
    verified,
    avg_importance_score: Math.round(avg_importance_score * 100) / 100,
    max_importance_score,
  };
}

/**
 * Upsert likers into the engagers collection without clobbering existing engagement flags.
 * - Sets liked=true
 * - Updates basic profile fields we know (username/name/bio/followers/verified)
 * - On insert, initializes replied/retweeted/quoted=false and the enrichment fields.
 */
export async function upsertLikersAsEngagers(
  tweetId: string,
  likers: Array<{
    userId: string;
    username: string;
    name: string;
    bio?: string | null;
    followers: number;
    verified: boolean;
  }>
): Promise<{ upserted: number; modified: number }> {
  const collection = await getEngagersCollection();
  const now = new Date();

  const ops = likers.map(l => ({
    updateOne: {
      filter: { tweet_id: tweetId, userId: l.userId },
      update: {
        $set: {
          username: l.username,
          name: l.name,
          bio: l.bio || undefined,
          followers: l.followers,
          verified: l.verified,
          liked: true,
        },
        $setOnInsert: {
          tweet_id: tweetId,
          userId: l.userId,
          location: undefined,
          account_based_in: null,
          account_based_in_status: 'pending' as const,
          account_based_in_updated_at: undefined,
          replied: false,
          retweeted: false,
          quoted: false,
          replied_at: undefined,
          retweeted_at: undefined,
          quoted_at: undefined,
          created_at: now,
        },
      },
      upsert: true,
    },
  }));

  if (ops.length === 0) return { upserted: 0, modified: 0 };

  const res = await collection.bulkWrite(ops, { ordered: false });
  return { upserted: res.upsertedCount || 0, modified: res.modifiedCount || 0 };
}

// ===== Index Creation =====
export async function createTweetsIndexes(): Promise<void> {
  const tweetsCollection = await getTweetsCollection();
  const engagersCollection = await getEngagersCollection();
  
  // Tweets indexes
  await tweetsCollection.createIndex({ tweet_id: 1 }, { unique: true });
  await tweetsCollection.createIndex({ status: 1 });
  await tweetsCollection.createIndex({ created_at: -1 });
  await tweetsCollection.createIndex({ 'metrics.last_updated': -1 });
  await tweetsCollection.createIndex({ status: 1, 'metrics.last_updated': -1 });
  
  // Engagers indexes
  await engagersCollection.createIndex({ tweet_id: 1 });
  await engagersCollection.createIndex({ tweet_id: 1, userId: 1 }, { unique: true });
  await engagersCollection.createIndex({ followers: -1 });
  await engagersCollection.createIndex({ importance_score: -1 });
  await engagersCollection.createIndex({ username: 1 });
  // Likes-specific indexes for fast filtering / top-likers lists
  await engagersCollection.createIndex({ tweet_id: 1, liked: 1, importance_score: -1 });
  await engagersCollection.createIndex({ tweet_id: 1, liked: 1, followers: -1 });
  // Location enrichment / heatmap indexes
  await engagersCollection.createIndex({ tweet_id: 1, account_based_in_status: 1 });
  await engagersCollection.createIndex({ tweet_id: 1, account_based_in: 1 });
  await engagersCollection.createIndex({ tweet_id: 1, account_based_in_updated_at: -1 });
  // Indexes for engagement timestamps (for time-series queries)
  await engagersCollection.createIndex({ tweet_id: 1, replied_at: 1 });
  await engagersCollection.createIndex({ tweet_id: 1, retweeted_at: 1 });
  await engagersCollection.createIndex({ tweet_id: 1, quoted_at: 1 });
  
  console.log('✅ Tweets indexes created');
}

/**
 * Update tweet with AI report
 */
export async function updateTweetReport(
  tweetId: string,
  report: AIReport
): Promise<void> {
  const collection = await getTweetsCollection();
  
  await collection.updateOne(
    { tweet_id: tweetId },
    {
      $set: {
        ai_report: report,
      },
    }
  );
}

/**
 * Update tweet author info
 */
export async function updateTweetAuthorInfo(
  tweetId: string,
  authorName: string,
  authorUsername?: string
): Promise<void> {
  const collection = await getTweetsCollection();
  await collection.updateOne(
    { tweet_id: tweetId },
    {
      $set: {
        author_name: authorName,
        author_username: authorUsername,
      },
    }
  );
}

/**
 * Update tweet text (main tweet content).
 * We keep this separate from `updateTweetAuthorInfo` to avoid accidental overwrites.
 */
export async function updateTweetText(tweetId: string, text: string | null | undefined): Promise<void> {
  const collection = await getTweetsCollection();
  await collection.updateOne(
    { tweet_id: tweetId },
    {
      $set: {
        text: text ?? undefined,
      },
    }
  );
}

/**
 * Update the original tweet published timestamp (if available).
 */
export async function updateTweetCreatedAt(
  tweetId: string,
  tweetCreatedAt: Date | string | null | undefined
): Promise<void> {
  const collection = await getTweetsCollection();
  const asDate =
    typeof tweetCreatedAt === 'string'
      ? (tweetCreatedAt ? new Date(tweetCreatedAt) : undefined)
      : tweetCreatedAt ?? undefined;

  // Guard against invalid dates; don't write garbage.
  const safeDate =
    asDate instanceof Date && !Number.isNaN(asDate.getTime()) ? asDate : undefined;

  await collection.updateOne(
    { tweet_id: tweetId },
    {
      $set: {
        tweet_created_at: safeDate,
      },
    }
  );
}

/**
 * Update tweet metrics
 */
export async function updateTweetMetrics(
  tweetId: string,
  metrics: Omit<TweetMetrics, 'last_updated'>
): Promise<void> {
  const collection = await getTweetsCollection();
  
  const now = new Date();
  const metricsWithTimestamp: TweetMetrics = {
    ...metrics,
    last_updated: now,
  };
  
  // Get current tweet to check if we should add to history
  const tweet = await collection.findOne({ tweet_id: tweetId });
  
  const update: any = {
    'metrics': metricsWithTimestamp,
  };
  
  // Add to history if metrics exist and have changed
  if (tweet?.metrics) {
    const oldMetrics = tweet.metrics;
    const hasChanged = 
      oldMetrics.likeCount !== metrics.likeCount ||
      oldMetrics.retweetCount !== metrics.retweetCount ||
      oldMetrics.replyCount !== metrics.replyCount ||
      oldMetrics.quoteCount !== metrics.quoteCount ||
      oldMetrics.viewCount !== metrics.viewCount;
    
    if (hasChanged) {
      const historyEntry: TweetMetricsHistory = {
        timestamp: now,
        likeCount: metrics.likeCount,
        retweetCount: metrics.retweetCount,
        replyCount: metrics.replyCount,
        quoteCount: metrics.quoteCount,
        viewCount: metrics.viewCount,
      };
      
      // Keep last 100 history entries
      const existingHistory = tweet.metrics_history || [];
      const updatedHistory = [...existingHistory, historyEntry].slice(-100);
      
      update['metrics_history'] = updatedHistory;
    }
  } else {
    // First time storing metrics, initialize history
    const historyEntry: TweetMetricsHistory = {
      timestamp: now,
      likeCount: metrics.likeCount,
      retweetCount: metrics.retweetCount,
      replyCount: metrics.replyCount,
      quoteCount: metrics.quoteCount,
      viewCount: metrics.viewCount,
    };
    update['metrics_history'] = [historyEntry];
  }
  
  await collection.updateOne(
    { tweet_id: tweetId },
    { $set: update }
  );
}

/**
 * Get tweet metrics
 */
export async function getTweetMetrics(tweetId: string): Promise<TweetMetrics | null> {
  const collection = await getTweetsCollection();
  const tweet = await collection.findOne({ tweet_id: tweetId });
  return tweet?.metrics || null;
}

/**
 * Compare metrics to determine what changed
 */
export interface MetricsComparison {
  hasChanges: boolean;
  changedFields: {
    likes: boolean;
    retweets: boolean;
    replies: boolean;
    quotes: boolean;
    views: boolean;
  };
  deltas: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    views: number;
  };
}

export function compareMetrics(
  oldMetrics: TweetMetrics | null,
  newMetrics: TweetMetrics
): MetricsComparison {
  if (!oldMetrics) {
    return {
      hasChanges: true,
      changedFields: {
        likes: true,
        retweets: true,
        replies: true,
        quotes: true,
        views: true,
      },
      deltas: {
        likes: newMetrics.likeCount,
        retweets: newMetrics.retweetCount,
        replies: newMetrics.replyCount,
        quotes: newMetrics.quoteCount,
        views: newMetrics.viewCount,
      },
    };
  }
  
  const deltas = {
    likes: newMetrics.likeCount - oldMetrics.likeCount,
    retweets: newMetrics.retweetCount - oldMetrics.retweetCount,
    replies: newMetrics.replyCount - oldMetrics.replyCount,
    quotes: newMetrics.quoteCount - oldMetrics.quoteCount,
    views: newMetrics.viewCount - oldMetrics.viewCount,
  };
  
  const changedFields = {
    likes: deltas.likes !== 0,
    retweets: deltas.retweets !== 0,
    replies: deltas.replies !== 0,
    quotes: deltas.quotes !== 0,
    views: deltas.views !== 0,
  };
  
  const hasChanges = Object.values(changedFields).some(changed => changed);
  
  return {
    hasChanges,
    changedFields,
    deltas,
  };
}

