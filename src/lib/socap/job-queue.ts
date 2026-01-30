import { Collection, ObjectId } from 'mongodb';
import clientPromise from '../mongodb';
import { logger } from '../logger';

// ===== TypeScript Interfaces =====

export interface Job {
  _id?: string;
  campaign_id: string;
  tweet_id: string;
  job_type: 'retweets' | 'replies' | 'quotes' | 'metrics' | 'liking_users' | 'location_enrichment';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';
  priority: number; // 1=metrics (highest), 2=retweets, 3=replies/quotes, 4=liking_users (lowest)
  claimed_by: string | null; // worker instance ID
  claimed_at: Date | null;
  error_message?: string;
  retry_count: number;
  max_retries: number;
  retry_after: Date | null; // When to retry (for exponential backoff)
  created_at: Date;
  updated_at: Date;
}

export interface EnqueueJobInput {
  campaign_id: string;
  tweet_id: string;
  job_type: Job['job_type'];
  priority?: number;
}

// ===== Collection Getter =====

export async function getJobQueueCollection(): Promise<Collection<Job>> {
  const client = await clientPromise;
  const db = client.db();
  return db.collection<Job>('socap_job_queue');
}

// ===== Indexes =====

export async function createJobQueueIndexes(): Promise<void> {
  const collection = await getJobQueueCollection();
  
  // Index for efficient job claiming
  // NOTE: We primarily prioritize jobs by time (created_at), not by job type.
  await collection.createIndex({ status: 1, created_at: 1, priority: 1 });
  
  // Unique constraint: one job per tweet/job_type combination
  await collection.createIndex(
    { campaign_id: 1, tweet_id: 1, job_type: 1 },
    { unique: true }
  );
  
  await collection.createIndex({ campaign_id: 1 });
  await collection.createIndex({ claimed_by: 1 });
}

// ===== Job Priority Mapping =====

function getJobPriority(jobType: Job['job_type']): number {
  const priorities: Record<Job['job_type'], number> = {
    metrics: 1, // Highest priority
    retweets: 2,
    replies: 3,
    quotes: 3,
    liking_users: 4,
    location_enrichment: 5, // Lowest priority (background enrichment, non-blocking)
  };
  return priorities[jobType];
}

// ===== CRUD Operations =====

/**
 * Enqueue a single job
 */
export async function enqueueJob(input: EnqueueJobInput): Promise<Job> {
  const collection = await getJobQueueCollection();
  
  const job: Job = {
    campaign_id: input.campaign_id,
    tweet_id: input.tweet_id,
    job_type: input.job_type,
    status: 'pending',
    priority: input.priority ?? getJobPriority(input.job_type),
    claimed_by: null,
    claimed_at: null,
    retry_count: 0,
    max_retries: 3, // Default max retries
    retry_after: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  
  // Use upsert to avoid duplicates
  // If job exists, reset it to pending (allows re-queuing for periodic runs)
  // If job doesn't exist, create new one
  // 
  // IMPORTANT: $setOnInsert only sets fields on INSERT, not on UPDATE
  // Fields that should be set on both insert AND update go in $set
  // Fields that should ONLY be set on insert (like created_at) go in $setOnInsert
  const result = await collection.findOneAndUpdate(
    {
      campaign_id: input.campaign_id,
      tweet_id: input.tweet_id,
      job_type: input.job_type,
    },
    {
      $setOnInsert: {
        // Only set these fields when creating a new document
        campaign_id: job.campaign_id,
        tweet_id: job.tweet_id,
        job_type: job.job_type,
        created_at: job.created_at,
      },
      $set: {
        // These fields are updated on both insert and update
        status: 'pending', // Always reset to pending when enqueuing
        priority: job.priority,
        claimed_by: null, // Release any previous claim
        claimed_at: null,
        retry_count: 0, // Reset retry count
        retry_after: null,
        max_retries: job.max_retries,
        updated_at: new Date(),
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
    }
  );
  
  if (!result) {
    throw new Error('Failed to enqueue job');
  }
  
  return result as Job;
}

/**
 * Enqueue jobs for all tweets in a campaign
 * OPTIMIZED: Uses MongoDB bulkWrite instead of individual operations
 * INDEPENDENT: Conditionally includes liking_users jobs based on campaign features
 */
export async function enqueueCampaignJobs(campaignId: string): Promise<number> {
  const { getTweetsByCampaign, getCampaignTweetsCollection } = await import('../models/socap/tweets');
  const { getCampaignById } = await import('../models/socap/campaigns');
  
  // Enhanced logging for debugging
  console.log(`[enqueueCampaignJobs] Starting for campaign ID: ${campaignId} (type: ${typeof campaignId})`);
  
  // Get campaign to check features
  const campaign = await getCampaignById(campaignId);
  const tweets = await getTweetsByCampaign(campaignId);
  
  console.log(`[enqueueCampaignJobs] Found ${tweets.length} tweets for campaign ${campaignId}`);
  
  if (tweets.length === 0) {
    // Additional diagnostic: Check if tweets exist in database
    try {
      const collection = await getCampaignTweetsCollection();
      
      // Check total tweets and sample data
      const allTweets = await collection.find({}).limit(5).toArray();
      const campaignTweetsExact = await collection.find({ campaign_id: campaignId }).toArray();
      
      console.log(`[enqueueCampaignJobs] Diagnostic: Total tweets in DB (sample): ${allTweets.length}`);
      console.log(`[enqueueCampaignJobs] Diagnostic: Tweets with exact campaign_id match: ${campaignTweetsExact.length}`);
      
      if (allTweets.length > 0) {
        const sample = allTweets[0];
        console.log(`[enqueueCampaignJobs] Sample tweet - campaign_id: "${sample.campaign_id}" (type: ${typeof sample.campaign_id})`);
        console.log(`[enqueueCampaignJobs] Sample tweet - tweet_id: "${sample.tweet_id}", category: "${sample.category}"`);
      }
      
      // Check for partial matches (in case of ID format issues)
      if (campaignTweetsExact.length === 0 && allTweets.length > 0) {
        const partialMatches = allTweets.filter(t => 
          String(t.campaign_id).includes(campaignId) || String(campaignId).includes(String(t.campaign_id))
        );
        if (partialMatches.length > 0) {
          console.log(`[enqueueCampaignJobs] Warning: Found ${partialMatches.length} tweets with similar campaign_id (possible format mismatch)`);
        }
      }
    } catch (diagError) {
      console.error(`[enqueueCampaignJobs] Error during diagnostic check:`, diagError);
    }
    
    console.log(`[enqueueCampaignJobs] No tweets found for campaign ${campaignId} - returning 0`);
    return 0;
  }
  
  // Base job types for all tweets
  const baseJobTypes: Array<'retweets' | 'replies' | 'quotes' | 'metrics'> = [
    'retweets',
    'replies',
    'quotes',
    'metrics',
  ];
  
  // Check if liking users tracking is enabled
  const trackLikingUsers = campaign?.features?.track_liking_users || false;
  
  if (trackLikingUsers) {
    console.log(`[enqueueCampaignJobs] ✅ Liking users tracking enabled for campaign ${campaignId}`);
  }
  
  // Build bulk operations array - ONE DB call instead of N*4 calls
  const collection = await getJobQueueCollection();
  const now = new Date();
  
  type BulkJobOp = {
    updateOne: {
      filter: { campaign_id: string; tweet_id: string; job_type: Job['job_type'] };
      update: {
        $setOnInsert: { campaign_id: string; tweet_id: string; job_type: Job['job_type']; created_at: Date };
        $set: {
          status: 'pending';
          priority: number;
          claimed_by: null;
          claimed_at: null;
          retry_count: number;
          retry_after: null;
          max_retries: number;
          updated_at: Date;
        };
      };
      upsert: true;
    };
  };

  const bulkOps = tweets.flatMap(tweet => {
    // Base jobs for all tweets
    const tweetJobs: BulkJobOp[] = baseJobTypes.map(jobType => ({
      updateOne: {
        filter: {
          campaign_id: campaignId,
          tweet_id: tweet.tweet_id,
          job_type: jobType,
        },
        update: {
          $setOnInsert: {
            campaign_id: campaignId,
            tweet_id: tweet.tweet_id,
            job_type: jobType,
            created_at: now,
          },
          $set: {
            status: 'pending' as const,
            priority: getJobPriority(jobType),
            claimed_by: null,
            claimed_at: null,
            retry_count: 0,
            retry_after: null,
            max_retries: 3,
            updated_at: now,
          },
        },
        upsert: true,
      },
    }));
    
    // Add liking_users job ONLY for main tweets if feature is enabled
    if (trackLikingUsers && tweet.category === 'main_twt') {
      tweetJobs.push({
        updateOne: {
          filter: {
            campaign_id: campaignId,
            tweet_id: tweet.tweet_id,
            job_type: 'liking_users',
          },
          update: {
            $setOnInsert: {
              campaign_id: campaignId,
              tweet_id: tweet.tweet_id,
              job_type: 'liking_users',
              created_at: now,
            },
            $set: {
              status: 'pending' as const,
              priority: getJobPriority('liking_users'),
              claimed_by: null,
              claimed_at: null,
              retry_count: 0,
              retry_after: null,
              max_retries: 3,
              updated_at: now,
            },
          },
          upsert: true,
        },
      });
    }
    
    return tweetJobs;
  });
  
  if (bulkOps.length === 0) {
    console.log(`Campaign ${campaignId}: No jobs to enqueue`);
    return 0;
  }
  
  const mainTweetsCount = tweets.filter(t => t.category === 'main_twt').length;
  const expectedJobsPerTweet = trackLikingUsers ? 5 : 4; // 5 if liking_users enabled for main tweets
  const expectedTotal = (tweets.length * 4) + (trackLikingUsers ? mainTweetsCount : 0);
  
  console.log(`Enqueuing jobs for campaign ${campaignId}: ${tweets.length} tweets (${mainTweetsCount} main tweets) × ~${expectedJobsPerTweet} job types ≈ ${expectedTotal} total jobs`);
  
  try {
    const result = await collection.bulkWrite(bulkOps, { ordered: false });
    const enqueued = result.upsertedCount + result.modifiedCount;
    
    console.log(`Campaign ${campaignId}: ${enqueued} jobs enqueued via bulkWrite (${result.upsertedCount} new, ${result.modifiedCount} updated)`);
    
    if (trackLikingUsers && mainTweetsCount > 0) {
      console.log(`Campaign ${campaignId}: Including liking_users jobs for ${mainTweetsCount} main tweets`);
    }
    
    return enqueued;
  } catch (error) {
    logger.error(
      'Failed to bulk enqueue jobs',
      error,
      {
        campaign_id: campaignId,
        total_operations: bulkOps.length,
        operation: 'enqueueCampaignJobs',
      }
    );
    throw error;
  }
}

/**
 * Claim a pending job (atomic operation)
 * Also claims jobs ready for retry
 * 
 * @param workerId - Unique identifier for the worker claiming the job
 * @param campaignId - Optional: If provided, only claims jobs for this specific campaign
 */
export async function claimJob(workerId: string, campaignId?: string): Promise<Job | null> {
  const collection = await getJobQueueCollection();
  
  // Build the filter based on whether we're filtering by campaign
  const baseFilter: any = campaignId 
    ? { status: 'pending', campaign_id: campaignId }
    : { status: 'pending' };
  
  const retryFilter: any = campaignId
    ? { status: 'retrying', retry_after: { $lte: new Date() }, campaign_id: campaignId }
    : { status: 'retrying', retry_after: { $lte: new Date() } };
  
  // First, reset jobs ready for retry (respecting campaign filter if provided)
  await collection.updateMany(
    retryFilter,
    {
      $set: {
        status: 'pending',
        retry_after: null,
        updated_at: new Date(),
      },
    }
  );
  
  // Claim a pending job (including newly reset retry jobs)
  const result = await collection.findOneAndUpdate(
    baseFilter,
    {
      $set: {
        status: 'processing',
        claimed_by: workerId,
        claimed_at: new Date(),
        updated_at: new Date(),
      },
    },
    {
      // Process strictly oldest jobs first across all job types.
      // Job "priority" is now only a secondary tie-breaker when created_at is identical.
      sort: { created_at: 1, priority: 1 },
      returnDocument: 'after',
    }
  );
  
  return result as Job | null;
}

/**
 * Mark job as completed
 */
export async function completeJob(jobId: string): Promise<boolean> {
  const collection = await getJobQueueCollection();
  
  if (!ObjectId.isValid(jobId)) {
    return false;
  }
  
  const result = await collection.updateOne(
    { _id: new ObjectId(jobId) } as any,
    {
      $set: {
        status: 'completed',
        updated_at: new Date(),
      },
    }
  );
  
  return result.modifiedCount > 0;
}

/**
 * Mark job as failed (with retry logic)
 */
export async function failJob(jobId: string, errorMessage: string): Promise<boolean> {
  const collection = await getJobQueueCollection();
  
  if (!ObjectId.isValid(jobId)) {
    return false;
  }
  
  // Get current job to check retry count
  const job = await collection.findOne({ _id: new ObjectId(jobId) } as any);
  
  if (!job) {
    return false;
  }
  
  const retryCount = (job.retry_count || 0) + 1;
  const maxRetries = job.max_retries || 3;
  
  // Check if we should retry
  if (retryCount < maxRetries) {
    // Calculate exponential backoff: 2^retryCount minutes
    const backoffMinutes = Math.pow(2, retryCount);
    const retryAfter = new Date(Date.now() + backoffMinutes * 60 * 1000);
    
    // Mark as retrying
    const result = await collection.updateOne(
      { _id: new ObjectId(jobId) } as any,
      {
        $set: {
          status: 'retrying',
          error_message: errorMessage,
          retry_count: retryCount,
          retry_after: retryAfter,
          claimed_by: null, // Release claim
          claimed_at: null,
          updated_at: new Date(),
        },
      }
    );
    
    console.log(`Job ${jobId} will retry (${retryCount}/${maxRetries}) after ${retryAfter.toISOString()}`);
    return result.modifiedCount > 0;
  } else {
    // Max retries exceeded, mark as permanently failed
    const result = await collection.updateOne(
      { _id: new ObjectId(jobId) } as any,
      {
        $set: {
          status: 'failed',
          error_message: errorMessage,
          retry_count: retryCount,
          updated_at: new Date(),
        },
      }
    );
    
    console.log(`Job ${jobId} permanently failed after ${retryCount} retries`);
    return result.modifiedCount > 0;
  }
}

/**
 * Reset job for retry (called when retry_after time has passed)
 */
export async function resetJobForRetry(jobId: string): Promise<boolean> {
  const collection = await getJobQueueCollection();
  
  if (!ObjectId.isValid(jobId)) {
    return false;
  }
  
  const result = await collection.updateOne(
    { _id: new ObjectId(jobId) } as any,
    {
      $set: {
        status: 'pending',
        retry_after: null,
        updated_at: new Date(),
      },
    }
  );
  
  return result.modifiedCount > 0;
}

/**
 * Get jobs ready for retry
 */
export async function getJobsReadyForRetry(limit: number = 50): Promise<Job[]> {
  const collection = await getJobQueueCollection();
  const now = new Date();
  
  return await collection
    .find({
      status: 'retrying',
      retry_after: { $lte: now },
    })
    .limit(limit)
    .toArray();
}

/**
 * Get job queue statistics
 */
export async function getJobQueueStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  const collection = await getJobQueueCollection();
  
  const [pending, processing, completed, failed] = await Promise.all([
    collection.countDocuments({ status: 'pending' }),
    collection.countDocuments({ status: 'processing' }),
    collection.countDocuments({ status: 'completed' }),
    collection.countDocuments({ status: 'failed' }),
  ]);
  
  return { pending, processing, completed, failed };
}

/**
 * Enqueue location enrichment job for a campaign
 * Location enrichment is per-campaign (not per-tweet), so we use a special tweet_id
 * 
 * @param campaignId - Campaign ID to enqueue location enrichment for
 */
export async function enqueueLocationEnrichmentJob(campaignId: string): Promise<Job | null> {
  // For location enrichment, we use a special tweet_id format: "LOCATION_ENRICHMENT"
  // This distinguishes it from regular tweet-based jobs
  const specialTweetId = 'LOCATION_ENRICHMENT';
  
  try {
    const job = await enqueueJob({
      campaign_id: campaignId,
      tweet_id: specialTweetId,
      job_type: 'location_enrichment',
    });
    
    return job;
  } catch (error) {
    console.error(`Error enqueuing location enrichment job for campaign ${campaignId}:`, error);
    return null;
  }
}

/**
 * Clean up old completed jobs (optional maintenance)
 */
export async function cleanupOldJobs(olderThanDays: number = 7): Promise<number> {
  const collection = await getJobQueueCollection();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  
  const result = await collection.deleteMany({
    status: 'completed',
    updated_at: { $lt: cutoffDate },
  });
  
  return result.deletedCount;
}

