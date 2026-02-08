import { Collection, ObjectId } from 'mongodb';
import { getDb } from '../mongodb-tooltracker';

// ===== TypeScript Interfaces =====

export interface MonitoringEngagement {
  _id?: ObjectId;
  tweet_id: string;           // Parent tweet being monitored
  user_id: string;
  action_type: 'retweet' | 'reply' | 'quote' | 'like';

  // User profile (store everything from API)
  username: string;
  name: string;
  followers: number;
  following?: number;
  verified: boolean;
  bio?: string;
  location?: string;
  account_created_at?: Date;
  profile_image_url?: string;

  // Engagement details (store all available data)
  engagement_id?: string;       // Tweet ID of the reply/quote (for linking)
  engagement_url?: string;      // Direct URL to the engagement tweet
  engagement_text?: string;     // Text of reply/quote
  engagement_created_at?: Date; // When the engagement was posted

  // For replies specifically
  in_reply_to_user_id?: string;
  in_reply_to_username?: string;
  in_reply_to_tweet_id?: string;
  conversation_id?: string;

  // For quotes specifically
  quote_metrics?: {
    viewCount?: number;
    likeCount?: number;
    retweetCount?: number;
    replyCount?: number;
  };

  // Scoring
  importance_score: number;
  followed_by?: Array<{ username: string; weight: number }>;  // Who important follows them

  // Tracking timestamps
  first_seen_at: Date;
  last_seen_at: Date;
  deleted_at?: Date;
  is_deleted: boolean;

  created_at: Date;
  updated_at: Date;
}

// ===== Collection Helpers =====

export async function getMonitoringEngagementsCollection(): Promise<Collection<MonitoringEngagement>> {
  const db = await getDb();
  return db.collection<MonitoringEngagement>('monitoring_engagements');
}

// ===== Database Operations =====

/**
 * Upsert an engagement record (insert if new, update if exists)
 */
export async function upsertEngagement(
  engagement: Omit<MonitoringEngagement, '_id' | 'created_at' | 'updated_at' | 'first_seen_at' | 'last_seen_at'>
): Promise<MonitoringEngagement> {
  const collection = await getMonitoringEngagementsCollection();
  const now = new Date();

  const result = await collection.findOneAndUpdate(
    {
      tweet_id: engagement.tweet_id,
      user_id: engagement.user_id,
      action_type: engagement.action_type,
    },
    {
      $set: {
        ...engagement,
        last_seen_at: now,
        updated_at: now,
      },
      $setOnInsert: {
        first_seen_at: now,
        created_at: now,
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
    }
  );

  return result as MonitoringEngagement;
}

/**
 * Bulk upsert engagements for efficiency
 */
export async function bulkUpsertEngagements(
  engagements: Array<Omit<MonitoringEngagement, '_id' | 'created_at' | 'updated_at' | 'first_seen_at' | 'last_seen_at'>>
): Promise<{ upserted: number; modified: number }> {
  if (engagements.length === 0) {
    return { upserted: 0, modified: 0 };
  }

  const collection = await getMonitoringEngagementsCollection();
  const now = new Date();

  const bulkOps = engagements.map((engagement) => ({
    updateOne: {
      filter: {
        tweet_id: engagement.tweet_id,
        user_id: engagement.user_id,
        action_type: engagement.action_type,
      },
      update: {
        $set: {
          ...engagement,
          last_seen_at: now,
          updated_at: now,
        },
        $setOnInsert: {
          first_seen_at: now,
          created_at: now,
        },
      },
      upsert: true,
    },
  }));

  const result = await collection.bulkWrite(bulkOps, { ordered: false });

  return {
    upserted: result.upsertedCount,
    modified: result.modifiedCount,
  };
}

/**
 * Get engagements for a tweet with optional filters
 */
export async function getEngagements(
  tweetId: string,
  options: {
    actionType?: 'retweet' | 'reply' | 'quote' | 'like';
    minImportance?: number;
    includeDeleted?: boolean;
    sortBy?: 'importance' | 'followers' | 'recent';
    limit?: number;
    skip?: number;
  } = {}
): Promise<{ engagements: MonitoringEngagement[]; total: number }> {
  const collection = await getMonitoringEngagementsCollection();

  const filter: Record<string, any> = { tweet_id: tweetId };

  if (options.actionType) {
    filter.action_type = options.actionType;
  }

  if (options.minImportance !== undefined) {
    filter.importance_score = { $gte: options.minImportance };
  }

  if (!options.includeDeleted) {
    filter.is_deleted = { $ne: true };
  }

  // Determine sort order
  let sort: Record<string, 1 | -1> = { importance_score: -1 };
  if (options.sortBy === 'followers') {
    sort = { followers: -1 };
  } else if (options.sortBy === 'recent') {
    sort = { first_seen_at: -1 };
  }

  const [engagements, total] = await Promise.all([
    collection
      .find(filter)
      .sort(sort)
      .skip(options.skip || 0)
      .limit(options.limit || 100)
      .toArray(),
    collection.countDocuments(filter),
  ]);

  return { engagements, total };
}

/**
 * Get engager user IDs for a specific action type
 */
export async function getEngagerUserIds(
  tweetId: string,
  actionType: 'retweet' | 'reply' | 'quote' | 'like'
): Promise<string[]> {
  const collection = await getMonitoringEngagementsCollection();

  const engagements = await collection
    .find(
      { tweet_id: tweetId, action_type: actionType, is_deleted: { $ne: true } },
      { projection: { user_id: 1 } }
    )
    .toArray();

  return engagements.map((e) => e.user_id);
}

/**
 * Mark engagements as deleted
 */
export async function markEngagementsDeleted(
  tweetId: string,
  actionType: 'retweet' | 'reply' | 'quote' | 'like',
  userIds: string[]
): Promise<number> {
  if (userIds.length === 0) return 0;

  const collection = await getMonitoringEngagementsCollection();
  const now = new Date();

  const result = await collection.updateMany(
    {
      tweet_id: tweetId,
      action_type: actionType,
      user_id: { $in: userIds },
    },
    {
      $set: {
        is_deleted: true,
        deleted_at: now,
        updated_at: now,
      },
    }
  );

  return result.modifiedCount;
}

/**
 * Get deleted engagement count for a tweet
 */
export async function getDeletedCount(tweetId: string): Promise<number> {
  const collection = await getMonitoringEngagementsCollection();
  return collection.countDocuments({ tweet_id: tweetId, is_deleted: true });
}

/**
 * Get engagement by ID
 */
export async function getEngagementById(id: string): Promise<MonitoringEngagement | null> {
  const collection = await getMonitoringEngagementsCollection();
  return collection.findOne({ _id: new ObjectId(id) });
}

/**
 * Get high-importance engagers that haven't been notified yet
 */
export async function getUnnotifiedHighImportanceEngagers(
  tweetId: string,
  minImportance: number
): Promise<MonitoringEngagement[]> {
  const collection = await getMonitoringEngagementsCollection();

  // We'll need to join with notifications to find unnotified ones
  // For now, return all high-importance engagers and filter in the caller
  return collection
    .find({
      tweet_id: tweetId,
      importance_score: { $gte: minImportance },
      is_deleted: { $ne: true },
    })
    .sort({ importance_score: -1 })
    .toArray();
}

// ===== Index Creation =====

export async function createMonitoringEngagementsIndexes(): Promise<void> {
  const collection = await getMonitoringEngagementsCollection();

  // Unique compound index for deduplication
  await collection.createIndex(
    { tweet_id: 1, user_id: 1, action_type: 1 },
    { unique: true }
  );

  // For querying by tweet and filtering/sorting
  await collection.createIndex({ tweet_id: 1, action_type: 1, importance_score: -1 });
  await collection.createIndex({ tweet_id: 1, is_deleted: 1 });
  await collection.createIndex({ tweet_id: 1, first_seen_at: -1 });

  console.log('Monitoring engagements indexes created');
}
