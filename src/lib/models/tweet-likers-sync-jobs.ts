import { Collection } from 'mongodb';
import { getDb } from '../mongodb-ranker';

export type TweetLikersSyncJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'retrying';

export interface TweetLikersSyncJob {
  _id?: unknown;
  tweet_id: string;
  status: TweetLikersSyncJobStatus;
  claimed_by: string | null;
  claimed_at: Date | null;
  retry_after: Date | null;
  retry_count: number;
  max_retries: number;
  last_error?: string;
  stats?: {
    pages_processed: number;
    users_seen: number;
    upserted: number;
    modified: number;
    backfill_complete: boolean;
  };
  created_at: Date;
  updated_at: Date;
}

export async function getTweetLikersSyncJobsCollection(): Promise<
  Collection<TweetLikersSyncJob>
> {
  const db = await getDb();
  return db.collection<TweetLikersSyncJob>('tweet_likers_sync_jobs');
}

export async function getTweetLikersSyncJob(tweetId: string): Promise<TweetLikersSyncJob | null> {
  const collection = await getTweetLikersSyncJobsCollection();
  const cleanedTweetId = String(tweetId || '').trim();
  if (!cleanedTweetId) return null;
  return await collection.findOne({ tweet_id: cleanedTweetId });
}

export async function createTweetLikersSyncJobIndexes(): Promise<void> {
  const collection = await getTweetLikersSyncJobsCollection();
  await collection.createIndex({ tweet_id: 1 }, { unique: true });
  await collection.createIndex({ status: 1, updated_at: 1 });
  await collection.createIndex({ retry_after: 1 });
  await collection.createIndex({ claimed_by: 1 });
  console.log('✅ Tweet likers sync job indexes created');
}

export async function enqueueTweetLikersSyncJob(tweetId: string): Promise<void> {
  const collection = await getTweetLikersSyncJobsCollection();
  const now = new Date();
  const cleanedTweetId = String(tweetId || '').trim();
  if (!cleanedTweetId) return;

  await collection.updateOne(
    { tweet_id: cleanedTweetId },
    {
      $setOnInsert: {
        tweet_id: cleanedTweetId,
        created_at: now,
        max_retries: 10,
        retry_count: 0,
      },
      $set: {
        status: 'pending',
        claimed_by: null,
        claimed_at: null,
        retry_after: null,
        updated_at: now,
      },
    },
    { upsert: true },
  );
}

export async function claimNextTweetLikersSyncJob(
  workerId: string,
  options?: { tweetIds?: string[] },
): Promise<TweetLikersSyncJob | null> {
  const collection = await getTweetLikersSyncJobsCollection();
  const now = new Date();
  const claimant = String(workerId || '').trim() || `worker-${Date.now()}`;
  const tweetIds = options?.tweetIds?.filter(Boolean);

  const result = await collection.findOneAndUpdate(
    {
      status: { $in: ['pending', 'retrying'] },
      ...(tweetIds && tweetIds.length > 0 ? { tweet_id: { $in: tweetIds } } : {}),
      $or: [{ retry_after: null }, { retry_after: { $lte: now } }],
    },
    {
      $set: {
        status: 'processing',
        claimed_by: claimant,
        claimed_at: now,
        updated_at: now,
      },
    },
    {
      sort: { updated_at: 1 }, // oldest first
      returnDocument: 'after',
    },
  );

  const maybe = (result as any)?.value ?? result;
  return maybe && typeof (maybe as any).tweet_id === 'string' ? (maybe as any) : null;
}

export async function markTweetLikersSyncJobRetrying(input: {
  tweetId: string;
  error: string;
  retryAfterSeconds: number;
  stats?: TweetLikersSyncJob['stats'];
}): Promise<void> {
  const collection = await getTweetLikersSyncJobsCollection();
  const now = new Date();
  const retryAfter = new Date(now.getTime() + Math.max(5, input.retryAfterSeconds) * 1000);

  await collection.updateOne(
    { tweet_id: input.tweetId },
    {
      $set: {
        status: 'retrying',
        retry_after: retryAfter,
        last_error: input.error,
        updated_at: now,
        ...(input.stats ? { stats: input.stats } : {}),
      },
      $inc: { retry_count: 1 },
    },
  );
}

export async function markTweetLikersSyncJobCompleted(input: {
  tweetId: string;
  stats: TweetLikersSyncJob['stats'];
}): Promise<void> {
  const collection = await getTweetLikersSyncJobsCollection();
  const now = new Date();
  await collection.updateOne(
    { tweet_id: input.tweetId },
    {
      $set: {
        status: 'completed',
        claimed_by: null,
        claimed_at: null,
        retry_after: null,
        updated_at: now,
        stats: input.stats,
      },
    },
  );
}

export async function markTweetLikersSyncJobPending(input: {
  tweetId: string;
  stats?: TweetLikersSyncJob['stats'];
}): Promise<void> {
  const collection = await getTweetLikersSyncJobsCollection();
  const now = new Date();
  await collection.updateOne(
    { tweet_id: input.tweetId },
    {
      $set: {
        status: 'pending',
        claimed_by: null,
        claimed_at: null,
        retry_after: null,
        updated_at: now,
        ...(input.stats ? { stats: input.stats } : {}),
      },
    },
  );
}

export async function markTweetLikersSyncJobFailed(input: {
  tweetId: string;
  error: string;
  stats?: TweetLikersSyncJob['stats'];
}): Promise<void> {
  const collection = await getTweetLikersSyncJobsCollection();
  const now = new Date();
  await collection.updateOne(
    { tweet_id: input.tweetId },
    {
      $set: {
        status: 'failed',
        claimed_by: null,
        claimed_at: null,
        updated_at: now,
        last_error: input.error,
        ...(input.stats ? { stats: input.stats } : {}),
      },
      $inc: { retry_count: 1 },
    },
  );
}

