import { Collection, ObjectId } from 'mongodb';
import { getDb } from '../mongodb-tooltracker';

// ===== TypeScript Interfaces =====

export interface MonitoringJob {
  _id?: ObjectId;
  tweet_id: string;           // Extracted from URL
  tweet_url: string;          // Original URL user provided
  status: 'active' | 'completed';  // Simple status
  started_at: Date;           // When monitoring started
  created_at: Date;

  // Real-time tracking state
  realtime_enabled?: boolean;
  prev_metrics?: {
    replyCount: number;
    retweetCount: number;
    quoteCount: number;
    likeCount: number;
  };
  known_engagers?: {
    replies: string[];   // user_ids
    retweets: string[];
    quotes: string[];
    likes: string[];
  };
  likers_last_fetched_at?: Date;

  // Settings
  notification_threshold?: number;
  slack_webhook_url?: string;
}

export interface MetricSnapshot {
  _id?: ObjectId;
  tweet_id: string;            // Reference to monitoring_job
  timestamp: Date;             // When this snapshot was taken
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  viewCount: number;
  bookmarkCount: number;
  quoteViewSum: number;        // Sum of views across quote tweets at this time
  quoteTweetCount: number;     // Number of quote tweets counted at this time
}

// ===== Collection Helpers =====

export async function getMonitoringJobsCollection(): Promise<Collection<MonitoringJob>> {
  const db = await getDb();
  return db.collection<MonitoringJob>('monitoring_jobs');
}

export async function getMetricSnapshotsCollection(): Promise<Collection<MetricSnapshot>> {
  const db = await getDb();
  return db.collection<MetricSnapshot>('metric_snapshots');
}

// ===== Database Operations =====

/**
 * Create a new monitoring job
 */
export async function createMonitoringJob(
  tweetId: string,
  tweetUrl: string
): Promise<MonitoringJob> {
  const collection = await getMonitoringJobsCollection();
  
  const job: MonitoringJob = {
    tweet_id: tweetId,
    tweet_url: tweetUrl,
    status: 'active',
    started_at: new Date(),
    created_at: new Date(),
  };
  
  await collection.insertOne(job);
  return job;
}

/**
 * Get active monitoring jobs that are still within 5-day window
 */
export async function getActiveMonitoringJobs(): Promise<MonitoringJob[]> {
  const collection = await getMonitoringJobsCollection();
  const now = new Date();
  const monitorDurationMs = 120 * 60 * 60 * 1000; // 5 days
  const windowStart = new Date(now.getTime() - monitorDurationMs);

  // Find jobs that are active and started within the last 5 days
  return await collection
    .find({
      status: 'active',
      started_at: { $gte: windowStart }
    })
    .toArray();
}

/**
 * Get all monitoring jobs (active and completed), sorted by most recent first
 */
export async function getAllMonitoringJobs(
  limit: number = 100,
  skip: number = 0
): Promise<MonitoringJob[]> {
  const collection = await getMonitoringJobsCollection();
  return await collection
    .find({})
    .sort({ started_at: -1 }) // Most recent first
    .limit(limit)
    .skip(skip)
    .toArray();
}

/**
 * Get monitoring job by tweet ID
 */
export async function getMonitoringJobByTweetId(tweetId: string): Promise<MonitoringJob | null> {
  const collection = await getMonitoringJobsCollection();
  return await collection.findOne({ tweet_id: tweetId });
}

/**
 * Mark monitoring job as completed
 */
export async function completeMonitoringJob(tweetId: string): Promise<void> {
  const collection = await getMonitoringJobsCollection();
  await collection.updateOne(
    { tweet_id: tweetId },
    { $set: { status: 'completed' } }
  );
}

/**
 * Stop monitoring job manually
 */
export async function stopMonitoringJob(tweetId: string): Promise<void> {
  await completeMonitoringJob(tweetId);
}

/**
 * Store a metric snapshot
 */
export async function storeMetricSnapshot(
  tweetId: string,
  metrics: {
    likeCount: number;
    retweetCount: number;
    replyCount: number;
    quoteCount: number;
    viewCount: number;
    bookmarkCount: number;
    quoteViewSum?: number;
    quoteTweetCount?: number;
  }
): Promise<MetricSnapshot> {
  const collection = await getMetricSnapshotsCollection();
  
  const snapshot: MetricSnapshot = {
    tweet_id: tweetId,
    timestamp: new Date(),
    ...metrics,
    quoteViewSum: metrics.quoteViewSum ?? 0,
    quoteTweetCount: metrics.quoteTweetCount ?? 0,
  };
  
  await collection.insertOne(snapshot);
  return snapshot;
}

/**
 * Get all snapshots for a tweet, sorted by timestamp
 */
export async function getMetricSnapshots(tweetId: string): Promise<MetricSnapshot[]> {
  const collection = await getMetricSnapshotsCollection();
  return await collection
    .find({ tweet_id: tweetId })
    .sort({ timestamp: 1 }) // Ascending order (oldest first)
    .toArray();
}

/**
 * Get the last valid (non-zero) quoteViewSum for a tweet.
 * Used as fallback when current fetch fails or returns 0.
 */
export async function getLastValidQuoteViewSum(tweetId: string): Promise<{
  quoteViewSum: number;
  quoteTweetCount: number;
  timestamp: Date;
} | null> {
  const collection = await getMetricSnapshotsCollection();
  
  // Find the most recent snapshot with quoteViewSum > 0
  const result = await collection.findOne(
    { 
      tweet_id: tweetId,
      quoteViewSum: { $gt: 0 }
    },
    { 
      sort: { timestamp: -1 }, // Most recent first
      projection: { quoteViewSum: 1, quoteTweetCount: 1, timestamp: 1 }
    }
  );

  if (!result) {
    return null;
  }

  return {
    quoteViewSum: result.quoteViewSum,
    quoteTweetCount: result.quoteTweetCount,
    timestamp: result.timestamp,
  };
}

/**
 * Get monitoring job with snapshots
 */
export async function getMonitoringData(tweetId: string): Promise<{
  job: MonitoringJob | null;
  snapshots: MetricSnapshot[];
}> {
  const job = await getMonitoringJobByTweetId(tweetId);
  const snapshots = await getMetricSnapshots(tweetId);
  
  return { job, snapshots };
}

/**
 * Update monitoring job realtime tracking state
 */
export async function updateMonitoringJobRealtimeState(
  tweetId: string,
  update: {
    prev_metrics?: {
      replyCount: number;
      retweetCount: number;
      quoteCount: number;
      likeCount: number;
    };
    known_engagers?: {
      replies: string[];
      retweets: string[];
      quotes: string[];
      likes: string[];
    };
    likers_last_fetched_at?: Date;
  }
): Promise<void> {
  const collection = await getMonitoringJobsCollection();
  await collection.updateOne(
    { tweet_id: tweetId },
    { $set: update }
  );
}

/**
 * Update monitoring job settings
 */
export async function updateMonitoringJobSettings(
  tweetId: string,
  update: {
    realtime_enabled?: boolean;
    notification_threshold?: number;
    slack_webhook_url?: string;
  }
): Promise<MonitoringJob | null> {
  const collection = await getMonitoringJobsCollection();
  const result = await collection.findOneAndUpdate(
    { tweet_id: tweetId },
    { $set: update },
    { returnDocument: 'after' }
  );
  return result;
}

// ===== Index Creation =====
export async function createMonitoringIndexes(): Promise<void> {
  const jobsCollection = await getMonitoringJobsCollection();
  const snapshotsCollection = await getMetricSnapshotsCollection();
  
  // Monitoring jobs indexes
  await jobsCollection.createIndex({ tweet_id: 1 }, { unique: true });
  await jobsCollection.createIndex({ status: 1 });
  await jobsCollection.createIndex({ started_at: -1 });
  
  // Metric snapshots indexes
  await snapshotsCollection.createIndex({ tweet_id: 1 });
  await snapshotsCollection.createIndex({ tweet_id: 1, timestamp: 1 });
  await snapshotsCollection.createIndex({ timestamp: -1 });
  
  console.log('✅ Monitoring indexes created');
}

