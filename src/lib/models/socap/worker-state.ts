import { Collection } from 'mongodb';
import { getDb } from '../../mongodb-tooltracker';

// ===== TypeScript Interfaces =====

export interface WorkerState {
  _id?: string;
  campaign_id: string;
  tweet_id: string;
  job_type: 'retweets' | 'replies' | 'quotes' | 'metrics' | 'liking_users' | 'location_enrichment';
  last_success: Date | null;
  cursor: string | null;
  blocked_until: Date | null;
  last_error: string | null;
  retry_count: number;
  updated_at: Date;
  /**
   * True when initial backfill has completed (fetched all pages).
   * Used to distinguish between interrupted backfills and completed ones.
   * If false/undefined with a cursor, backfill should resume.
   */
  backfill_complete?: boolean;
}

export interface CreateWorkerStateInput {
  campaign_id: string;
  tweet_id: string;
  job_type: WorkerState['job_type'];
}

// ===== Collection Getter =====

export async function getWorkerStateCollection(): Promise<Collection<WorkerState>> {
  const db = await getDb();
  return db.collection<WorkerState>('socap_worker_state');
}

// ===== Indexes =====

export async function createWorkerStateIndexes(): Promise<void> {
  const collection = await getWorkerStateCollection();
  
  // Unique index: one state per tweet/job combination
  await collection.createIndex(
    { campaign_id: 1, tweet_id: 1, job_type: 1 },
    { unique: true }
  );
  
  await collection.createIndex({ blocked_until: 1 });
  await collection.createIndex({ campaign_id: 1, job_type: 1 });
}

// ===== CRUD Operations =====

export async function createWorkerState(input: CreateWorkerStateInput): Promise<WorkerState> {
  const collection = await getWorkerStateCollection();
  
  const state: WorkerState = {
    campaign_id: input.campaign_id,
    tweet_id: input.tweet_id,
    job_type: input.job_type,
    last_success: null,
    cursor: null,
    blocked_until: null,
    last_error: null,
    retry_count: 0,
    updated_at: new Date(),
  };
  
  const result = await collection.insertOne(state);
  state._id = result.insertedId.toString();
  
  return state;
}

/**
 * Bulk insert multiple worker states at once.
 * Uses ordered: false to continue inserting even if some fail (e.g., duplicates).
 * Returns the count of successfully inserted documents.
 */
export async function createWorkerStatesBulk(
  inputs: CreateWorkerStateInput[]
): Promise<{ insertedCount: number; errors: string[] }> {
  if (inputs.length === 0) {
    return { insertedCount: 0, errors: [] };
  }

  const collection = await getWorkerStateCollection();
  const now = new Date();

  const states: WorkerState[] = inputs.map((input) => ({
    campaign_id: input.campaign_id,
    tweet_id: input.tweet_id,
    job_type: input.job_type,
    last_success: null,
    cursor: null,
    blocked_until: null,
    last_error: null,
    retry_count: 0,
    updated_at: now,
  }));

  const errors: string[] = [];

  try {
    // ordered: false means continue inserting even if some fail (e.g., duplicates)
    const result = await collection.insertMany(states, { ordered: false });
    return { insertedCount: result.insertedCount, errors };
  } catch (err: unknown) {
    // MongoDB bulk write errors contain partial success info
    if (
      err &&
      typeof err === 'object' &&
      'insertedCount' in err &&
      typeof (err as { insertedCount: number }).insertedCount === 'number'
    ) {
      const bulkErr = err as { insertedCount: number; message?: string };
      errors.push(bulkErr.message || 'Partial bulk insert failure');
      return { insertedCount: bulkErr.insertedCount, errors };
    }
    // Complete failure
    const message = err instanceof Error ? err.message : 'Bulk insert failed';
    errors.push(message);
    return { insertedCount: 0, errors };
  }
}

export async function getWorkerState(
  campaignId: string,
  tweetId: string,
  jobType: WorkerState['job_type']
): Promise<WorkerState | null> {
  const collection = await getWorkerStateCollection();
  
  return await collection.findOne({
    campaign_id: campaignId,
    tweet_id: tweetId,
    job_type: jobType,
  });
}

export async function getOrCreateWorkerState(
  input: CreateWorkerStateInput
): Promise<WorkerState> {
  const existing = await getWorkerState(input.campaign_id, input.tweet_id, input.job_type);
  
  if (existing) {
    return existing;
  }
  
  return await createWorkerState(input);
}

export async function updateWorkerState(
  campaignId: string,
  tweetId: string,
  jobType: WorkerState['job_type'],
  updates: Partial<Pick<WorkerState, 'last_success' | 'cursor' | 'blocked_until' | 'last_error' | 'retry_count' | 'backfill_complete'>>
): Promise<boolean> {
  const collection = await getWorkerStateCollection();
  
  const result = await collection.updateOne(
    {
      campaign_id: campaignId,
      tweet_id: tweetId,
      job_type: jobType,
    },
    {
      $set: {
        ...updates,
        updated_at: new Date(),
      },
    }
  );
  
  return result.modifiedCount > 0;
}

export async function resetWorkerStateCursor(
  campaignId: string,
  tweetId: string,
  jobType: WorkerState['job_type']
): Promise<boolean> {
  return await updateWorkerState(campaignId, tweetId, jobType, {
    cursor: null,
    retry_count: 0,
    last_error: null,
  });
}

export async function getBlockedWorkers(): Promise<WorkerState[]> {
  const collection = await getWorkerStateCollection();
  const now = new Date();
  
  return await collection
    .find({
      blocked_until: { $gt: now },
    })
    .toArray();
}

