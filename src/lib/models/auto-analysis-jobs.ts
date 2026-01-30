import { Collection, ObjectId } from 'mongodb';
import { getDb } from '../mongodb-ranker';

// ===== TypeScript Interfaces =====

export type AutoAnalysisStatus =
  | 'monitoring'
  | 'awaiting_first_analysis'
  | 'first_done'
  | 'awaiting_second_analysis'
  | 'complete'
  | 'failed';

export interface AutoAnalysisJob {
  _id?: ObjectId;
  tweet_id: string;           // unique
  tweet_url: string;
  x_username: string;
  tweet_created_at: Date;
  detected_at: Date;
  status: AutoAnalysisStatus;
  monitoring_started_at?: Date;
  first_analysis_at?: Date;
  second_analysis_at?: Date;
  error?: string;
  retry_count: number;        // default 0

  // Distributed processing fields
  claimed_by: string | null;
  claimed_at: Date | null;
  scheduled_for: Date;
  priority: number;           // Higher = process first (default 10)
}

// ===== Collection Helpers =====

export async function getAutoAnalysisJobsCollection(): Promise<Collection<AutoAnalysisJob>> {
  const db = await getDb();
  return db.collection<AutoAnalysisJob>('auto_analysis_jobs');
}

// ===== Database Operations =====

export async function createAutoAnalysisJob(
  tweetId: string,
  tweetUrl: string,
  xUsername: string,
  tweetCreatedAt: Date,
  options?: { scheduled_for?: Date; priority?: number }
): Promise<AutoAnalysisJob> {
  const collection = await getAutoAnalysisJobsCollection();
  const now = new Date();

  // Default: schedule first analysis for 48h after tweet creation
  const scheduledFor = options?.scheduled_for ?? new Date(tweetCreatedAt.getTime() + 48 * 60 * 60 * 1000);
  const priority = options?.priority ?? 10;

  const job: AutoAnalysisJob = {
    tweet_id: tweetId,
    tweet_url: tweetUrl,
    x_username: xUsername.replace(/^@/, '').toLowerCase(),
    tweet_created_at: tweetCreatedAt,
    detected_at: now,
    status: 'monitoring',
    monitoring_started_at: now,
    retry_count: 0,
    claimed_by: null,
    claimed_at: null,
    scheduled_for: scheduledFor,
    priority,
  };

  await collection.insertOne(job);
  return job;
}

export async function getAutoAnalysisJob(tweetId: string): Promise<AutoAnalysisJob | null> {
  const collection = await getAutoAnalysisJobsCollection();
  return await collection.findOne({ tweet_id: tweetId });
}

export async function getJobsReadyForFirstAnalysis(): Promise<AutoAnalysisJob[]> {
  const collection = await getAutoAnalysisJobsCollection();
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h ago

  return await collection.find({
    status: 'monitoring',
    tweet_created_at: { $lte: cutoff },
  }).toArray();
}

export async function getJobsReadyForSecondAnalysis(): Promise<AutoAnalysisJob[]> {
  const collection = await getAutoAnalysisJobsCollection();
  const cutoff = new Date(Date.now() - 96 * 60 * 60 * 1000); // 96h ago

  return await collection.find({
    status: 'first_done',
    tweet_created_at: { $lte: cutoff },
  }).toArray();
}

export async function updateJobStatus(
  tweetId: string,
  status: AutoAnalysisStatus,
  extras?: Partial<Pick<AutoAnalysisJob, 'first_analysis_at' | 'second_analysis_at' | 'error'>>
): Promise<void> {
  const collection = await getAutoAnalysisJobsCollection();
  await collection.updateOne(
    { tweet_id: tweetId },
    { $set: { status, ...extras } }
  );
}

export async function incrementRetryCount(tweetId: string): Promise<void> {
  const collection = await getAutoAnalysisJobsCollection();
  await collection.updateOne(
    { tweet_id: tweetId },
    { $inc: { retry_count: 1 } }
  );
}

export async function getJobsByUsername(xUsername: string): Promise<AutoAnalysisJob[]> {
  const collection = await getAutoAnalysisJobsCollection();
  return await collection
    .find({ x_username: xUsername.replace(/^@/, '').toLowerCase() })
    .sort({ detected_at: -1 })
    .toArray();
}

// ===== Distributed Job Queue Functions =====

const MAX_RETRIES = 3;
const STALE_CLAIM_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Atomically claim the next job ready for analysis.
 * Uses findOneAndUpdate to ensure only one worker can claim each job.
 */
export async function claimNextAnalysisJob(
  workerId: string,
  jobType: 'first' | 'second'
): Promise<AutoAnalysisJob | null> {
  const collection = await getAutoAnalysisJobsCollection();
  const now = new Date();

  // Determine status and cutoff based on job type
  const status = jobType === 'first' ? 'monitoring' : 'first_done';
  const hoursAgo = jobType === 'first' ? 48 : 96;
  const cutoff = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);

  const result = await collection.findOneAndUpdate(
    {
      status,
      tweet_created_at: { $lte: cutoff },
      retry_count: { $lt: MAX_RETRIES },
      $or: [
        { claimed_by: null },
        { claimed_at: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } }
      ]
    },
    {
      $set: {
        claimed_by: workerId,
        claimed_at: now,
      }
    },
    {
      sort: { priority: -1, scheduled_for: 1 },  // High priority first, then oldest
      returnDocument: 'after',
    }
  );

  return result ?? null;
}

/**
 * Release a job claim (on failure, so another worker can retry).
 */
export async function releaseAnalysisJobClaim(tweetId: string): Promise<void> {
  const collection = await getAutoAnalysisJobsCollection();
  await collection.updateOne(
    { tweet_id: tweetId },
    { $set: { claimed_by: null, claimed_at: null } }
  );
}

/**
 * Mark a job as complete after analysis and clear the claim.
 */
export async function markAnalysisJobComplete(
  tweetId: string,
  newStatus: 'first_done' | 'complete',
  extras?: Partial<Pick<AutoAnalysisJob, 'first_analysis_at' | 'second_analysis_at'>>
): Promise<void> {
  const collection = await getAutoAnalysisJobsCollection();
  await collection.updateOne(
    { tweet_id: tweetId },
    {
      $set: {
        status: newStatus,
        claimed_by: null,
        claimed_at: null,
        ...extras,
      }
    }
  );
}

/**
 * Mark a job as failed (exceeded max retries).
 */
export async function markAnalysisJobFailed(
  tweetId: string,
  error: string
): Promise<void> {
  const collection = await getAutoAnalysisJobsCollection();
  await collection.updateOne(
    { tweet_id: tweetId },
    {
      $set: {
        status: 'failed',
        claimed_by: null,
        claimed_at: null,
        error,
      }
    }
  );
}

/**
 * Find jobs with stale claims (claimed but not processed within threshold).
 */
export async function getStaleClaimedJobs(
  staleThresholdMs: number = STALE_CLAIM_MS
): Promise<AutoAnalysisJob[]> {
  const collection = await getAutoAnalysisJobsCollection();
  const cutoff = new Date(Date.now() - staleThresholdMs);

  return await collection.find({
    claimed_by: { $ne: null },
    claimed_at: { $lt: cutoff },
    status: { $in: ['monitoring', 'first_done'] }
  }).toArray();
}

// ===== Index Creation =====

export async function createAutoAnalysisIndexes(): Promise<void> {
  const collection = await getAutoAnalysisJobsCollection();

  // Core indexes
  await collection.createIndex({ tweet_id: 1 }, { unique: true });
  await collection.createIndex({ status: 1 });
  await collection.createIndex({ x_username: 1 });
  await collection.createIndex({ status: 1, tweet_created_at: 1 });

  // Distributed processing indexes
  await collection.createIndex({ scheduled_for: 1, priority: -1, status: 1 });
  await collection.createIndex({ claimed_by: 1, claimed_at: 1 });

  // Migration: Add new fields to existing jobs that don't have them
  const migrateResult = await collection.updateMany(
    { claimed_by: { $exists: false } },
    {
      $set: {
        claimed_by: null,
        claimed_at: null,
        priority: 10,
      }
    }
  );

  // Set scheduled_for based on tweet_created_at for jobs that don't have it
  const scheduleResult = await collection.updateMany(
    { scheduled_for: { $exists: false } },
    [
      {
        $set: {
          scheduled_for: {
            $add: ['$tweet_created_at', 48 * 60 * 60 * 1000]
          }
        }
      }
    ]
  );

  if (migrateResult.modifiedCount > 0 || scheduleResult.modifiedCount > 0) {
    console.log(`✅ Auto-analysis jobs migrated: ${migrateResult.modifiedCount} claims, ${scheduleResult.modifiedCount} schedules`);
  }

  console.log('✅ Auto-analysis job indexes created');
}
