import { NextResponse } from 'next/server';
import {
  getActiveMonitoringJobs,
  completeMonitoringJob,
  storeMetricSnapshot,
  getLastValidQuoteViewSum,
  updateMonitoringJobRealtimeState,
  MonitoringJob,
} from '@/lib/models/monitoring';
import {
  fetchTweetMetrics,
  fetchQuoteMetricsAggregate,
  QuoteAggregateResult,
  TweetMetrics,
} from '@/lib/external-api';
import {
  fetchTweetReplies,
  fetchTweetRetweets,
  fetchTweetQuotes,
  FilteredUser,
} from '@/lib/twitter-api-client';
import { calculateAllDeltas, shouldFetchLikers, summarizeDeltas, PAGINATION_CONFIG } from '@/lib/monitoring/delta-calculator';
import { detectAllDeletions, summarizeDeletions } from '@/lib/monitoring/deletion-tracker';
import { bulkUpsertEngagements, MonitoringEngagement } from '@/lib/models/monitoring-engagements';
import { rankEngagers, EngagerInput } from '@/lib/models/ranker';

interface RealtimeProcessingResult {
  newEngagers: number;
  deletionsMarked: number;
}

/**
 * Convert FilteredUser to EngagerInput for ranking
 */
function toEngagerInput(user: FilteredUser, actionType: string): EngagerInput {
  return {
    username: user.username || '',
    userId: user.userId,
    name: user.name || '',
    bio: user.bio || undefined,
    location: user.location || undefined,
    followers: user.followers,
    verified: user.verified,
    replied: actionType === 'reply',
    retweeted: actionType === 'retweet',
    quoted: actionType === 'quote',
  };
}

/**
 * Convert FilteredUser to MonitoringEngagement
 */
function toMonitoringEngagement(
  user: FilteredUser,
  tweetId: string,
  actionType: 'reply' | 'retweet' | 'quote' | 'like',
  importanceScore: number,
  followedBy?: Array<{ username: string; weight?: number }>
): Omit<MonitoringEngagement, '_id' | 'created_at' | 'updated_at' | 'first_seen_at' | 'last_seen_at'> {
  return {
    tweet_id: tweetId,
    user_id: user.userId,
    action_type: actionType,
    username: user.username || '',
    name: user.name || '',
    followers: user.followers,
    verified: user.verified,
    bio: user.bio || undefined,
    location: user.location || undefined,
    account_created_at: user.accountCreatedAt,
    engagement_id: user.engagementId,
    engagement_url: user.engagementId
      ? `https://x.com/${user.username}/status/${user.engagementId}`
      : undefined,
    engagement_text: user.engagementText,
    engagement_created_at: user.engagementCreatedAt,
    quote_metrics: user.quoteMetrics,
    importance_score: importanceScore,
    followed_by: followedBy?.map((f) => ({ username: f.username, weight: f.weight || 1 })),
    is_deleted: false,
  };
}

/**
 * Fetch and process new engagers for realtime tracking
 */
async function processRealtimeEngagers(
  job: MonitoringJob,
  currentMetrics: TweetMetrics
): Promise<RealtimeProcessingResult> {
  const result: RealtimeProcessingResult = {
    newEngagers: 0,
    deletionsMarked: 0,
  };

  const tweetId = job.tweet_id;

  // Get previous metrics (default to 0 if first run)
  const prevMetrics = job.prev_metrics || {
    replyCount: 0,
    retweetCount: 0,
    quoteCount: 0,
    likeCount: 0,
  };

  // Calculate deltas
  const deltas = calculateAllDeltas(prevMetrics, {
    replyCount: currentMetrics.replyCount,
    retweetCount: currentMetrics.retweetCount,
    quoteCount: currentMetrics.quoteCount,
    likeCount: currentMetrics.likeCount,
  });

  console.log(`[cron-monitors] Deltas for ${tweetId}: ${summarizeDeltas(deltas)}`);

  // Collect all new engagers
  const allNewEngagers: FilteredUser[] = [];
  const actionTypes: Array<{ type: 'reply' | 'retweet' | 'quote'; users: FilteredUser[] }> = [];

  // Fetch replies if delta > 0
  if (deltas.reply.shouldFetch) {
    try {
      const repliesResult = await fetchTweetReplies(tweetId, {
        maxPages: deltas.reply.pagesNeeded,
        keyType: 'monitor',
      });
      actionTypes.push({ type: 'reply', users: repliesResult.data });
      allNewEngagers.push(...repliesResult.data);
      console.log(`[cron-monitors] Fetched ${repliesResult.data.length} replies for ${tweetId}`);
    } catch (e) {
      console.error(`[cron-monitors] Error fetching replies for ${tweetId}:`, e);
    }
  }

  // Fetch retweets if delta > 0
  if (deltas.retweet.shouldFetch) {
    try {
      const retweetsResult = await fetchTweetRetweets(tweetId, {
        maxPages: deltas.retweet.pagesNeeded,
        keyType: 'monitor',
      });
      actionTypes.push({ type: 'retweet', users: retweetsResult.data });
      allNewEngagers.push(...retweetsResult.data);
      console.log(`[cron-monitors] Fetched ${retweetsResult.data.length} retweets for ${tweetId}`);
    } catch (e) {
      console.error(`[cron-monitors] Error fetching retweets for ${tweetId}:`, e);
    }
  }

  // Fetch quotes if delta > 0
  if (deltas.quote.shouldFetch) {
    try {
      const quotesResult = await fetchTweetQuotes(tweetId, {
        maxPages: deltas.quote.pagesNeeded,
        keyType: 'monitor',
      });
      actionTypes.push({ type: 'quote', users: quotesResult.data });
      allNewEngagers.push(...quotesResult.data);
      console.log(`[cron-monitors] Fetched ${quotesResult.data.length} quotes for ${tweetId}`);
    } catch (e) {
      console.error(`[cron-monitors] Error fetching quotes for ${tweetId}:`, e);
    }
  }

  // Likers are fetched less frequently due to rate limits (every 30 min)
  // Skip for now - would need OAuth and separate handling
  // if (shouldFetchLikers(job.likers_last_fetched_at)) { ... }

  if (allNewEngagers.length === 0) {
    // Update prev_metrics even if no new engagers
    await updateMonitoringJobRealtimeState(tweetId, {
      prev_metrics: {
        replyCount: currentMetrics.replyCount,
        retweetCount: currentMetrics.retweetCount,
        quoteCount: currentMetrics.quoteCount,
        likeCount: currentMetrics.likeCount,
      },
    });
    return result;
  }

  // Rank all engagers to get importance scores
  const engagerInputs = allNewEngagers.map((u) =>
    toEngagerInput(u, actionTypes.find((at) => at.users.includes(u))?.type || 'reply')
  );
  const rankedEngagers = await rankEngagers(engagerInputs);
  const rankMap = new Map(rankedEngagers.map((r) => [r.userId, r]));

  // Convert to MonitoringEngagement and upsert
  const engagementsToUpsert: Array<
    Omit<MonitoringEngagement, '_id' | 'created_at' | 'updated_at' | 'first_seen_at' | 'last_seen_at'>
  > = [];

  for (const { type, users } of actionTypes) {
    for (const user of users) {
      const ranked = rankMap.get(user.userId);
      const score = ranked?.importance_score || 0;
      const followedBy = ranked?.followed_by;

      engagementsToUpsert.push(
        toMonitoringEngagement(user, tweetId, type, score, followedBy)
      );
    }
  }

  const upsertResult = await bulkUpsertEngagements(engagementsToUpsert);
  result.newEngagers = upsertResult.upserted;
  console.log(
    `[cron-monitors] Upserted engagements for ${tweetId}: ${upsertResult.upserted} new, ${upsertResult.modified} updated`
  );

  // Detect deletions by comparing current engager IDs with previous known IDs
  const previousKnownEngagers = job.known_engagers || {
    replies: [],
    retweets: [],
    quotes: [],
    likes: [],
  };

  const currentEngagers = {
    replies: actionTypes.find((at) => at.type === 'reply')?.users.map((u) => u.userId) || [],
    retweets: actionTypes.find((at) => at.type === 'retweet')?.users.map((u) => u.userId) || [],
    quotes: actionTypes.find((at) => at.type === 'quote')?.users.map((u) => u.userId) || [],
    likes: [] as string[], // Likers not implemented yet
  };

  // Only detect deletions if we have previous data
  if (
    previousKnownEngagers.replies.length > 0 ||
    previousKnownEngagers.retweets.length > 0 ||
    previousKnownEngagers.quotes.length > 0
  ) {
    const deletionResults = await detectAllDeletions(
      tweetId,
      currentEngagers,
      previousKnownEngagers
    );
    result.deletionsMarked = deletionResults.totalDeleted;

    if (deletionResults.totalDeleted > 0) {
      console.log(`[cron-monitors] ${summarizeDeletions(deletionResults)}`);
    }
  }

  // Update job with new state
  await updateMonitoringJobRealtimeState(tweetId, {
    prev_metrics: {
      replyCount: currentMetrics.replyCount,
      retweetCount: currentMetrics.retweetCount,
      quoteCount: currentMetrics.quoteCount,
      likeCount: currentMetrics.likeCount,
    },
    known_engagers: {
      replies: currentEngagers.replies,
      retweets: currentEngagers.retweets,
      quotes: currentEngagers.quotes,
      likes: currentEngagers.likes,
    },
  });

  return result;
}

export async function GET() {
  const cronStart = Date.now();

  try {
    const now = new Date();
    const activeJobs = await getActiveMonitoringJobs();

    console.log(
      `[cron-monitors] Starting cron run at ${now.toISOString()}, ${activeJobs.length} active jobs`
    );

    let processed = 0;
    let completed = 0;
    let usedFallback = 0;
    let totalNewEngagers = 0;
    const errors: string[] = [];
    const jobDetails: Array<{
      tweetId: string;
      status: string;
      quoteViewSum: number;
      source: string;
      newEngagers?: number;
    }> = [];

    // Process each active job
    for (const job of activeJobs) {
      const jobStart = Date.now();
      console.log(`[cron-monitors] Processing job: tweetId=${job.tweet_id}`);

      try {
        // Check if monitoring period (24 hours) has passed
        const startedAt = new Date(job.started_at);
        const monitorDurationMs = 48 * 60 * 60 * 1000; // 48 hours
        const endTime = new Date(startedAt.getTime() + monitorDurationMs);
        const shouldComplete = now >= endTime;

        if (shouldComplete) {
          await completeMonitoringJob(job.tweet_id);
          completed++;
          console.log(`[cron-monitors] Job completed (expired): tweetId=${job.tweet_id}`);
          jobDetails.push({
            tweetId: job.tweet_id,
            status: 'completed',
            quoteViewSum: 0,
            source: 'expired',
          });
          continue;
        }

        // Fetch current metrics from external API
        const metrics = await fetchTweetMetrics(job.tweet_id, 1, 'monitor');
        console.log(
          `[cron-monitors] Fetched base metrics for ${job.tweet_id}: ` +
            `replies=${metrics.replyCount}, retweets=${metrics.retweetCount}, ` +
            `quotes=${metrics.quoteCount}, likes=${metrics.likeCount}`
        );

        // Fetch quote aggregates (with pagination)
        let quoteAgg: QuoteAggregateResult | null = null;
        let finalQuoteViewSum = 0;
        let finalQuoteTweetCount = 0;
        let dataSource = 'fresh';

        try {
          quoteAgg = await fetchQuoteMetricsAggregate(job.tweet_id, {
            expectedQuoteCount: metrics.quoteCount,
            keyType: 'monitor',
          });

          const isDataTrustworthy =
            quoteAgg.quoteViewSum > 0 ||
            metrics.quoteCount === 0 ||
            (quoteAgg.meta.coveragePercent !== undefined && quoteAgg.meta.coveragePercent >= 50);

          if (isDataTrustworthy) {
            finalQuoteViewSum = quoteAgg.quoteViewSum;
            finalQuoteTweetCount = quoteAgg.quoteTweetCount || metrics.quoteCount;
            dataSource = 'fresh';

            if (quoteAgg.meta.errors.length > 0) {
              console.warn(
                `[cron-monitors] Quote fetch had issues for ${job.tweet_id}: ${quoteAgg.meta.errors.join('; ')}`
              );
            }
          } else {
            console.warn(
              `[cron-monitors] Suspicious data for ${job.tweet_id}: ` +
                `quoteViewSum=${quoteAgg.quoteViewSum}, expected ~${metrics.quoteCount} quotes`
            );

            const lastValid = await getLastValidQuoteViewSum(job.tweet_id);
            if (lastValid) {
              finalQuoteViewSum = lastValid.quoteViewSum;
              finalQuoteTweetCount = lastValid.quoteTweetCount;
              dataSource = 'fallback';
              usedFallback++;
            } else {
              finalQuoteViewSum = quoteAgg.quoteViewSum;
              finalQuoteTweetCount = quoteAgg.quoteTweetCount || metrics.quoteCount;
              dataSource = 'fresh_no_fallback';
            }
          }
        } catch (quoteError) {
          const msg = quoteError instanceof Error ? quoteError.message : 'Unknown quote fetch error';
          console.error(`[cron-monitors] Quote fetch failed for ${job.tweet_id}: ${msg}`);
          errors.push(`Quote fetch error for ${job.tweet_id}: ${msg}`);

          const lastValid = await getLastValidQuoteViewSum(job.tweet_id);
          if (lastValid) {
            finalQuoteViewSum = lastValid.quoteViewSum;
            finalQuoteTweetCount = lastValid.quoteTweetCount;
            dataSource = 'fallback_on_error';
            usedFallback++;
          } else {
            console.warn(`[cron-monitors] No fallback for ${job.tweet_id}, SKIPPING snapshot`);
            dataSource = 'skipped';
            jobDetails.push({
              tweetId: job.tweet_id,
              status: 'skipped',
              quoteViewSum: 0,
              source: 'no_data',
            });
            continue;
          }
        }

        // Store snapshot with quote aggregates
        await storeMetricSnapshot(job.tweet_id, {
          ...metrics,
          quoteTweetCount: finalQuoteTweetCount,
          quoteViewSum: finalQuoteViewSum,
        });

        // Process realtime engagers if enabled
        let realtimeResult: RealtimeProcessingResult | null = null;
        if (job.realtime_enabled) {
          try {
            realtimeResult = await processRealtimeEngagers(job, metrics);
            totalNewEngagers += realtimeResult.newEngagers;

            console.log(
              `[cron-monitors] Realtime processing for ${job.tweet_id}: ` +
                `${realtimeResult.newEngagers} new engagers, ` +
                `${realtimeResult.deletionsMarked} deletions`
            );
          } catch (realtimeError) {
            const msg =
              realtimeError instanceof Error ? realtimeError.message : 'Unknown realtime error';
            console.error(`[cron-monitors] Realtime processing failed for ${job.tweet_id}: ${msg}`);
            errors.push(`Realtime error for ${job.tweet_id}: ${msg}`);
          }
        }

        const jobElapsed = Date.now() - jobStart;
        processed++;

        console.log(
          `[cron-monitors] Stored snapshot for ${job.tweet_id}: ` +
            `quoteViewSum=${finalQuoteViewSum.toLocaleString()}, ` +
            `source=${dataSource}, elapsed=${jobElapsed}ms`
        );

        jobDetails.push({
          tweetId: job.tweet_id,
          status: 'processed',
          quoteViewSum: finalQuoteViewSum,
          source: dataSource,
          newEngagers: realtimeResult?.newEngagers,
        });

        // Check again after storing
        const checkAgain = new Date();
        const endTimeAfter = new Date(startedAt.getTime() + monitorDurationMs);
        if (checkAgain >= endTimeAfter) {
          await completeMonitoringJob(job.tweet_id);
          completed++;
        }
      } catch (error) {
        let errorMessage: string;
        let errorType = 'unknown';

        if (error instanceof Error) {
          if (error.name === 'TwitterApiError') {
            errorType = 'api_error';
            errorMessage = `Twitter API error for tweet ${job.tweet_id}: ${error.message}`;
          } else if (error.message.includes('rate limit')) {
            errorType = 'rate_limit';
            errorMessage = `Rate limit hit for tweet ${job.tweet_id}. Will retry on next run.`;
          } else if (error.message.includes('not found') || error.message.includes('deleted')) {
            errorType = 'tweet_not_found';
            errorMessage = `Tweet ${job.tweet_id} not found. It may have been deleted.`;
          } else {
            errorType = 'network_error';
            errorMessage = `Network/connection error for tweet ${job.tweet_id}: ${error.message}`;
          }
        } else {
          errorMessage = `Unknown error processing tweet ${job.tweet_id}`;
        }

        console.error(`[cron-monitors] [${errorType.toUpperCase()}] ${errorMessage}`, error);
        errors.push(errorMessage);
        jobDetails.push({
          tweetId: job.tweet_id,
          status: 'error',
          quoteViewSum: 0,
          source: errorType,
        });
      }
    }

    const totalElapsed = Date.now() - cronStart;

    console.log(
      `[cron-monitors] Cron run complete: ` +
        `processed=${processed}, completed=${completed}, usedFallback=${usedFallback}, ` +
        `newEngagers=${totalNewEngagers}, ` +
        `errors=${errors.length}, elapsed=${totalElapsed}ms`
    );

    return NextResponse.json({
      success: true,
      processed,
      completed,
      usedFallback,
      total_active: activeJobs.length,
      realtime: {
        new_engagers: totalNewEngagers,
      },
      errors: errors.length > 0 ? errors : undefined,
      error_count: errors.length,
      elapsed_ms: totalElapsed,
      timestamp: now.toISOString(),
      job_details: jobDetails,
      message:
        errors.length > 0
          ? `Processed ${processed} tweets, ${errors.length} errors occurred`
          : `Successfully processed ${processed} tweets`,
    });
  } catch (error) {
    console.error('[cron-monitors] Fatal error in cron job:', error);

    return NextResponse.json(
      {
        error: 'Failed to check monitors',
        details: error instanceof Error ? error.message : 'Unknown error',
        elapsed_ms: Date.now() - cronStart,
      },
      { status: 500 }
    );
  }
}
