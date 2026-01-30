import { Collection, ObjectId } from 'mongodb';
import { getDb } from '../mongodb-ranker';

// ===== TypeScript Interfaces =====

export interface Tweet {
  _id?: ObjectId;
  tweet_id: string;
  tweet_url: string;
  author_name: string;
  status: 'pending' | 'analyzing' | 'completed' | 'failed';
  total_engagers: number;
  engagers_above_10k: number;
  engagers_below_10k: number;
  created_at: Date;
  analyzed_at?: Date;
  error_message?: string;
}

export interface Engager {
  _id?: ObjectId;
  tweet_id: string; // Reference to tweet
  userId: string;
  username: string;
  name: string;
  bio?: string;
  location?: string;
  followers: number;
  verified: boolean;
  // Engagement types
  replied: boolean;
  retweeted: boolean;
  quoted: boolean;
  // Ranking data
  importance_score: number;
  followed_by_usernames: string[]; // Simplified array of usernames
  // Metadata
  created_at: Date;
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
}

export interface AnalysisJob {
  tweet_id: string;
  tweet_url: string;
  author_name: string;
  engagers: EngagerInput[];
}

// ===== Helper Functions =====

export async function getTweetsCollection(): Promise<Collection<Tweet>> {
  const db = await getDb();
  return db.collection<Tweet>('tweets');
}

export async function getEngagersCollection(): Promise<Collection<Engager>> {
  const db = await getDb();
  return db.collection<Engager>('engagers');
}

// ===== Database Operations =====

/**
 * Create a new tweet record
 */
export async function createTweet(
  tweet_id: string,
  tweet_url: string,
  author_name: string,
  total_engagers: number
): Promise<Tweet> {
  const collection = await getTweetsCollection();
  
  const tweet: Tweet = {
    tweet_id,
    tweet_url,
    author_name,
    status: 'pending',
    total_engagers,
    engagers_above_10k: 0,
    engagers_below_10k: 0,
    created_at: new Date(),
  };
  
  await collection.insertOne(tweet as any);
  
  return tweet;
}

/**
 * Store engagers for a tweet (before ranking)
 */
export async function storeEngagers(
  tweet_id: string,
  engagers: EngagerInput[]
): Promise<void> {
  const collection = await getEngagersCollection();
  
  const engagerDocs: Engager[] = engagers.map(e => ({
    tweet_id,
    userId: e.userId,
    username: e.username,
    name: e.name,
    bio: e.bio,
    location: e.location,
    followers: e.followers || 0,
    verified: e.verified || false,
    replied: e.replied || false,
    retweeted: e.retweeted || false,
    quoted: e.quoted || false,
    importance_score: 0, // Will be updated by ranking job
    followed_by_usernames: [], // Will be populated by ranking job
    created_at: new Date(),
  }));
  
  if (engagerDocs.length > 0) {
    await collection.insertMany(engagerDocs as any);
  }
}

/**
 * Update tweet status
 */
export async function updateTweetStatus(
  tweet_id: string,
  status: Tweet['status'],
  error_message?: string
): Promise<void> {
  const collection = await getTweetsCollection();
  
  const update: any = {
    status,
    ...(status === 'completed' && { analyzed_at: new Date() }),
    ...(error_message && { error_message }),
  };
  
  await collection.updateOne(
    { tweet_id },
    { $set: update }
  );
}

/**
 * Update engager with ranking data
 */
export async function updateEngagerRanking(
  tweet_id: string,
  userId: string,
  importance_score: number,
  followed_by_usernames: string[]
): Promise<void> {
  const collection = await getEngagersCollection();
  
  await collection.updateOne(
    { tweet_id, userId },
    {
      $set: {
        importance_score,
        followed_by_usernames,
      }
    }
  );
}

/**
 * Update tweet statistics after ranking
 */
export async function updateTweetStatistics(tweet_id: string): Promise<void> {
  const collection = await getEngagersCollection();
  
  // Count engagers above and below 10k
  const above10k = await collection.countDocuments({
    tweet_id,
    followers: { $gte: 10000 }
  });
  
  const below10k = await collection.countDocuments({
    tweet_id,
    followers: { $lt: 10000 }
  });
  
  // Update tweet record
  const tweetsCollection = await getTweetsCollection();
  await tweetsCollection.updateOne(
    { tweet_id },
    {
      $set: {
        engagers_above_10k: above10k,
        engagers_below_10k: below10k,
      }
    }
  );
}

/**
 * Get tweet by ID
 */
export async function getTweetById(tweet_id: string): Promise<Tweet | null> {
  const collection = await getTweetsCollection();
  return await collection.findOne({ tweet_id });
}

/**
 * Get all tweets (paginated)
 */
export async function getAllTweets(
  limit: number = 50,
  skip: number = 0
): Promise<Tweet[]> {
  const collection = await getTweetsCollection();
  return await collection
    .find()
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
}

/**
 * Get engagers for a tweet (paginated, with filters)
 */
export async function getEngagers(
  tweet_id: string,
  options: {
    limit?: number;
    skip?: number;
    minFollowers?: number;
    maxFollowers?: number;
    sortBy?: 'importance_score' | 'followers' | 'username';
    sortOrder?: 'asc' | 'desc';
    engagementType?: 'replied' | 'retweeted' | 'quoted';
  } = {}
): Promise<Engager[]> {
  const collection = await getEngagersCollection();
  
  const {
    limit = 50,
    skip = 0,
    minFollowers,
    maxFollowers,
    sortBy = 'importance_score',
    sortOrder = 'desc',
    engagementType,
  } = options;
  
  // Build filter
  const filter: any = { tweet_id };
  
  if (minFollowers !== undefined) {
    filter.followers = { ...filter.followers, $gte: minFollowers };
  }
  
  if (maxFollowers !== undefined) {
    filter.followers = { ...filter.followers, $lte: maxFollowers };
  }
  
  if (engagementType) {
    filter[engagementType] = true;
  }
  
  // Build sort
  const sort: any = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
  
  return await collection
    .find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .toArray();
}

/**
 * Get engager count for a tweet
 */
export async function getEngagerCount(
  tweet_id: string,
  minFollowers?: number,
  maxFollowers?: number
): Promise<number> {
  const collection = await getEngagersCollection();
  
  const filter: any = { tweet_id };
  
  if (minFollowers !== undefined) {
    filter.followers = { ...filter.followers, $gte: minFollowers };
  }
  
  if (maxFollowers !== undefined) {
    filter.followers = { ...filter.followers, $lte: maxFollowers };
  }
  
  return await collection.countDocuments(filter);
}

/**
 * Delete tweet and all its engagers
 */
export async function deleteTweet(tweet_id: string): Promise<void> {
  const tweetsCollection = await getTweetsCollection();
  const engagersCollection = await getEngagersCollection();
  
  await Promise.all([
    tweetsCollection.deleteOne({ tweet_id }),
    engagersCollection.deleteMany({ tweet_id }),
  ]);
}

