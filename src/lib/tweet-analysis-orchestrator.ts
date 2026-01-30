/**
 * Tweet Analysis Orchestrator - Main orchestration logic
 */

import { fetchTweetDetails, fetchTweetMetrics } from './external-api';
import { fetchTweetReplies, fetchTweetRetweets, fetchTweetQuotes } from './twitter-api-client';
import { processAllEngagements } from './user-processor';
import { upsertTweetEngagements } from './models/tweet-engagements';
import {
  getTweet,
  updateTweetMetrics,
  compareMetrics,
  createTweet,
  storeEngagers,
  updateTweetStatus,
  updateTweetAuthorInfo,
  updateTweetText,
  updateTweetCreatedAt,
  type TweetMetrics,
  type MetricsComparison,
} from './models/tweets';
import { rankEngagers } from './models/ranker';
import { updateEngagersWithRanking } from './models/tweets';
import { logger } from './logger';
import { metricsTracker } from './metrics-tracker';
import { ProcessingError } from './errors/analysis-errors';
import { generateAndStoreContextualNotifications } from './contextual-notifications';
import { enqueueTweetLikersSyncJob } from './models/tweet-likers-sync-jobs';
import { getXOAuthByClientId } from './models/x-oauth';

export interface FetchStrategy {
  fetchReplies: boolean;
  fetchRetweets: boolean;
  fetchQuotes: boolean;
}

export interface AnalysisResult {
  success: boolean;
  tweetId: string;
  totalEngagers: number;
  metrics: TweetMetrics;
  comparison: MetricsComparison;
  error?: string;
}

/**
 * Determine which endpoints to fetch based on metric changes
 */
export function determineFetchStrategy(comparison: MetricsComparison): FetchStrategy {
  return {
    fetchReplies: comparison.changedFields.replies,
    fetchRetweets: comparison.changedFields.retweets,
    fetchQuotes: comparison.changedFields.quotes,
  };
}

/**
 * Check if metrics changed significantly enough to warrant re-analysis
 */
export function shouldReanalyze(comparison: MetricsComparison): boolean {
  // Re-analyze if any metric changed
  return comparison.hasChanges;
}

/**
 * Main analysis function
 */
export async function analyzeTweet(
  tweetId: string,
  tweetUrl: string,
  options: {
    reanalyze?: boolean;
    authorName?: string;
    authorUsername?: string;
  } = {}
): Promise<AnalysisResult> {
  const metricId = metricsTracker.start('analyze_tweet', { tweetId });
  logger.info('Starting tweet analysis', { tweetId, operation: 'analyzeTweet' });

  try {
    // Step 1: Fetch current metrics
    logger.info('Fetching current tweet metrics', { tweetId });
    const currentMetrics = await fetchTweetMetrics(tweetId);
    
    const metricsWithTimestamp: TweetMetrics = {
      ...currentMetrics,
      last_updated: new Date(),
    };

    // Step 2: Get existing tweet or create new
    let existingTweet = await getTweet(tweetId);
    const oldMetrics = existingTweet?.metrics || null;

    if (!existingTweet) {
      // Create new tweet entry
      const authorName = options.authorName || 'Unknown';
      existingTweet = await createTweet(tweetId, tweetUrl, authorName, options.authorUsername);
      logger.info('Created new tweet entry', { tweetId });
    } else if (options.authorName) {
      await updateTweetAuthorInfo(tweetId, options.authorName, options.authorUsername);
    }

    // Step 2b: Ensure we store the main tweet text (and best author fields) for contextual LLM.
    // Only fetch details if we don't already have text (or tweet published timestamp) stored.
    if (!existingTweet.text || !existingTweet.tweet_created_at) {
      try {
        const details = await fetchTweetDetails(tweetId, 1, 'shared');
        if (details.authorName) {
          await updateTweetAuthorInfo(tweetId, details.authorName, details.authorUsername);
        }
        await updateTweetText(tweetId, details.text);
        await updateTweetCreatedAt(tweetId, details.tweetCreatedAt);
        // Keep in-memory copy fresh for any downstream logic that reads it.
        existingTweet = {
          ...existingTweet,
          text: details.text,
          tweet_created_at: details.tweetCreatedAt,
          author_name: details.authorName,
          author_username: details.authorUsername,
        };
      } catch (e) {
        // Non-fatal: we can still analyze engagers without tweet text.
        logger.warn('Failed to fetch/store tweet text (continuing)', { tweetId, error: e instanceof Error ? e.message : 'Unknown error' });
      }
    }

    // Step 2c: If the tweet author has connected OAuth, enqueue likes syncing in background.
    // This is safe + idempotent; the cron worker will drain it slowly with throttling.
    try {
      const clientId = existingTweet.author_username;
      if (clientId) {
        const oauth = await getXOAuthByClientId(clientId);
        if (oauth && oauth.status === 'active') {
          await enqueueTweetLikersSyncJob(tweetId);
        }
      }
    } catch (e) {
      // Non-fatal: analysis should not fail because likes can't be enqueued.
      logger.warn('Failed to enqueue liker sync job (non-fatal)', {
        tweetId,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    }

    // Step 3: Compare metrics
    const comparison = compareMetrics(oldMetrics, metricsWithTimestamp);
    logger.info('Metrics comparison', { tweetId, comparison });

    // Step 4: Check if re-analysis is needed
    if (!options.reanalyze && !shouldReanalyze(comparison)) {
      logger.info('No metric changes detected, skipping re-analysis', { tweetId });
      metricsTracker.end(metricId, true);
      return {
        success: true,
        tweetId,
        totalEngagers: existingTweet.total_engagers,
        metrics: metricsWithTimestamp,
        comparison,
      };
    }

    // Step 5: Update metrics in database
    await updateTweetMetrics(tweetId, currentMetrics);
    logger.info('Updated tweet metrics', { tweetId });

    // Step 6: Determine fetch strategy
    const strategy = options.reanalyze
      ? { fetchReplies: true, fetchRetweets: true, fetchQuotes: true }
      : determineFetchStrategy(comparison);
    logger.info('Fetch strategy determined', { tweetId, strategy });

    // Step 7: Fetch engagement data in parallel (only what changed)
    logger.info('Fetching engagement data', { tweetId, strategy });
    const repliesPromise = strategy.fetchReplies
      ? fetchTweetReplies(tweetId)
      : Promise.resolve({ data: [] });
    const retweetsPromise = strategy.fetchRetweets
      ? fetchTweetRetweets(tweetId)
      : Promise.resolve({ data: [] });
    const quotesPromise = strategy.fetchQuotes
      ? fetchTweetQuotes(tweetId)
      : Promise.resolve({ data: [] });

    const [repliesResult, retweetsResult, quotesResult] = await Promise.all([
      repliesPromise,
      retweetsPromise,
      quotesPromise,
    ]);

    logger.info('Fetched engagement data', {
      tweetId,
      replies: repliesResult.data?.length || 0,
      retweets: retweetsResult.data?.length || 0,
      quotes: quotesResult.data?.length || 0,
    });

    // Step 8a: Persist per-engagement context (SOCAP-style)
    // This stores quote/reply tweet IDs + text so we can later generate contextual LLM notifications
    // like “X quote-tweeted saying …”.
    await upsertTweetEngagements([
      ...(repliesResult.data || []).map((u) => ({
        tweet_id: tweetId,
        user_id: u.userId,
        action_type: 'reply' as const,
        engagement_tweet_id: u.engagementId,
        engagement_tweet_url: u.engagementId ? `https://twitter.com/i/web/status/${u.engagementId}` : undefined,
        text: u.engagementText,
        timestamp: u.engagementCreatedAt,
        account_profile: {
          username: u.username || '',
          name: u.name || u.username || '',
          bio: u.bio ?? undefined,
          location: u.location ?? undefined,
          followers: u.followers,
          verified: u.verified,
        },
      })),
      ...(quotesResult.data || []).map((u) => ({
        tweet_id: tweetId,
        user_id: u.userId,
        action_type: 'quote' as const,
        engagement_tweet_id: u.engagementId,
        engagement_tweet_url: u.engagementId ? `https://twitter.com/i/web/status/${u.engagementId}` : undefined,
        text: u.engagementText,
        timestamp: u.engagementCreatedAt,
        account_profile: {
          username: u.username || '',
          name: u.name || u.username || '',
          bio: u.bio ?? undefined,
          location: u.location ?? undefined,
          followers: u.followers,
          verified: u.verified,
        },
        quoted_tweet_id: u.quotedTweetId,
        quote_view_count: typeof u.quoteViewCount === 'number' ? u.quoteViewCount : undefined,
        quote_metrics: u.quoteMetrics,
      })),
      ...(retweetsResult.data || []).map((u) => ({
        tweet_id: tweetId,
        user_id: u.userId,
        action_type: 'retweet' as const,
        // twitterapi.io retweeters endpoint doesn't give us a retweet tweet id or timestamp
        timestamp: u.engagementCreatedAt,
        account_profile: {
          username: u.username || '',
          name: u.name || u.username || '',
          bio: u.bio ?? undefined,
          location: u.location ?? undefined,
          followers: u.followers,
          verified: u.verified,
        },
      })),
    ]);

    // Step 8: Process and merge all engagements
    const engagers = processAllEngagements(
      repliesResult.data || [],
      retweetsResult.data || [],
      quotesResult.data || []
    );

    logger.info('Processed engagers', { tweetId, totalEngagers: engagers.length });

    // Step 9: Store engagers in database
    if (existingTweet.total_engagers > 0) {
      // Re-analysis: delete old engagers first
      const { deleteEngagersByTweetId } = await import('./models/tweets');
      await deleteEngagersByTweetId(tweetId);
      logger.info('Deleted old engagers for re-analysis', { tweetId });
    }

    await storeEngagers(tweetId, engagers);
    logger.info('Stored engagers in database', { tweetId, count: engagers.length });

    // Step 10: Trigger background ranking (fire and forget)
    rankEngagersInBackground(tweetId, engagers).catch(error => {
      logger.error('Background ranking failed', error, { tweetId });
    });

    metricsTracker.end(metricId, true);

    return {
      success: true,
      tweetId,
      totalEngagers: engagers.length,
      metrics: metricsWithTimestamp,
      comparison,
    };
  } catch (error) {
    logger.error('Tweet analysis failed', error, { tweetId });
    metricsTracker.end(metricId, false, error instanceof Error ? error.message : 'Unknown error');

    // Update tweet status to failed
    await updateTweetStatus(
      tweetId,
      'failed',
      error instanceof Error ? error.message : 'Unknown error'
    ).catch(() => {
      // Ignore errors updating status
    });

    throw new ProcessingError(
      tweetId,
      'analyzeTweet',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

/**
 * Background job to rank engagers
 */
async function rankEngagersInBackground(
  tweetId: string,
  engagers: any[]
): Promise<void> {
  const rankId = metricsTracker.start('rank_engagers', { tweetId });
  logger.info('Starting background ranking', { tweetId });

  try {
    const rankedEngagers = await rankEngagers(engagers);

    const rankingData = rankedEngagers.map(re => ({
      userId: re.userId,
      importance_score: re.importance_score,
      followed_by: re.followed_by.map((p: any) => p.username),
    }));

    await updateEngagersWithRanking(tweetId, rankingData);
    await updateTweetStatus(tweetId, 'completed');

    // Auto-generate contextual notifications for important engagers (importance_score > 5).
    // Keep this best-effort so analysis completion isn't blocked by LLM/API issues.
    try {
      await generateAndStoreContextualNotifications(tweetId, {
        minImportanceScore: 5,
      });
      logger.info('Auto-generated contextual notifications', { tweetId });
    } catch (e) {
      logger.warn('Auto-generate contextual notifications failed (non-fatal)', {
        tweetId,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    }

    logger.info('Background ranking completed', { tweetId });
    metricsTracker.end(rankId, true);
  } catch (error) {
    logger.error('Background ranking failed', error, { tweetId });
    await updateTweetStatus(
      tweetId,
      'failed',
      error instanceof Error ? error.message : 'Unknown error'
    );
    metricsTracker.end(rankId, false, error instanceof Error ? error.message : 'Unknown error');
  }
}

