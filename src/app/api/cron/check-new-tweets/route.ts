import { NextResponse } from 'next/server';
import { getMonitoringEnabledClients, updateLastKnownTweet, updateLastChecked } from '@/lib/models/clients';
import { createAutoAnalysisJob, getAutoAnalysisJob } from '@/lib/models/auto-analysis-jobs';
import { createMonitoringJob, getMonitoringJobByTweetId } from '@/lib/models/monitoring';
import { fetchTweetMetrics, fetchQuoteMetricsAggregate } from '@/lib/external-api';
import { storeMetricSnapshot } from '@/lib/models/monitoring';
import { makeApiRequest } from '@/lib/twitter-api-client';
import { getTwitterApiConfig } from '@/lib/config/twitter-api-config';

interface LastTweet {
  id: string;
  url?: string;
  text?: string;
  type?: string;
  createdAt?: string;
  isReply?: boolean;
  quoted_tweet?: unknown;
  retweeted_tweet?: unknown;
  author?: { id?: string; name?: string; userName?: string };
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
}

function isOriginalOrQuote(tweet: LastTweet): boolean {
  // Skip replies
  if (tweet.isReply) return false;
  // Skip retweets
  if (tweet.retweeted_tweet) return false;
  // Keep originals (type="tweet") and quote tweets (has quoted_tweet)
  return true;
}

export async function GET() {
  const cronStart = Date.now();

  try {
    const clients = await getMonitoringEnabledClients();
    console.log(`[cron-new-tweets] Starting check for ${clients.length} clients`);

    let totalNewTweets = 0;
    let clientsProcessed = 0;
    const errors: string[] = [];

    for (const client of clients) {
      const clientStart = Date.now();

      try {
        const config = getTwitterApiConfig('shared');
        const url = new URL(`${config.apiUrl}/twitter/user/last_tweets`);
        url.searchParams.set('userName', client.x_username);

        const data = await makeApiRequest(url.toString(), config);
        const tweets: LastTweet[] = data.tweets || [];

        // Filter to originals and quotes only
        const qualifying = tweets.filter(isOriginalOrQuote);

        // Find new tweets (newer than last_known_tweet_id)
        const newTweets: LastTweet[] = [];
        for (const tweet of qualifying) {
          if (client.last_known_tweet_id && tweet.id <= client.last_known_tweet_id) {
            break; // Tweets are sorted desc, stop when we hit the known one
          }
          newTweets.push(tweet);
        }

        if (newTweets.length > 0) {
          console.log(`[cron-new-tweets] @${client.x_username}: ${newTweets.length} new qualifying tweets`);

          for (const tweet of newTweets) {
            try {
              // Skip if already tracked
              const existingJob = await getAutoAnalysisJob(tweet.id);
              if (existingJob) {
                console.log(`[cron-new-tweets] Skipping ${tweet.id} - already tracked`);
                continue;
              }

              const tweetUrl = tweet.url || `https://x.com/${client.x_username}/status/${tweet.id}`;
              const tweetCreatedAt = tweet.createdAt ? new Date(tweet.createdAt) : new Date();

              // Create auto-analysis job with scheduling
              const scheduledFor = new Date(tweetCreatedAt.getTime() + 48 * 60 * 60 * 1000);
              await createAutoAnalysisJob(tweet.id, tweetUrl, client.x_username, tweetCreatedAt, {
                scheduled_for: scheduledFor,
                priority: 10,
              });

              // Start monitoring (reuse existing monitoring logic)
              const existingMonitor = await getMonitoringJobByTweetId(tweet.id);
              if (!existingMonitor) {
                try {
                  const metrics = await fetchTweetMetrics(tweet.id, 1, 'monitor');
                  await createMonitoringJob(tweet.id, tweetUrl);

                  let quoteViewSum = 0;
                  let quoteTweetCount = metrics.quoteCount;
                  try {
                    const quoteAgg = await fetchQuoteMetricsAggregate(tweet.id, {
                      expectedQuoteCount: metrics.quoteCount,
                      keyType: 'monitor',
                    });
                    quoteViewSum = quoteAgg.quoteViewSum;
                    quoteTweetCount = quoteAgg.quoteTweetCount || metrics.quoteCount;
                  } catch {
                    // Quote aggregation is optional
                  }

                  await storeMetricSnapshot(tweet.id, {
                    ...metrics,
                    quoteTweetCount,
                    quoteViewSum,
                  });

                  console.log(`[cron-new-tweets] Monitoring started for ${tweet.id}`);
                } catch (monitorError) {
                  console.error(`[cron-new-tweets] Failed to start monitoring for ${tweet.id}:`, monitorError);
                }
              }

              totalNewTweets++;
            } catch (tweetError) {
              const msg = tweetError instanceof Error ? tweetError.message : 'Unknown';
              console.error(`[cron-new-tweets] Error processing tweet ${tweet.id}:`, msg);
              errors.push(`Tweet ${tweet.id}: ${msg}`);
            }
          }

          // Update baseline to newest tweet
          await updateLastKnownTweet(client.x_username, qualifying[0]?.id || newTweets[0].id);
        } else {
          // No new tweets, just update last_checked_at
          await updateLastChecked(client.x_username);
        }

        clientsProcessed++;
        const clientElapsed = Date.now() - clientStart;
        console.log(`[cron-new-tweets] @${client.x_username}: done in ${clientElapsed}ms`);
      } catch (clientError) {
        const msg = clientError instanceof Error ? clientError.message : 'Unknown';
        console.error(`[cron-new-tweets] Error checking @${client.x_username}:`, msg);
        errors.push(`@${client.x_username}: ${msg}`);
      }
    }

    const totalElapsed = Date.now() - cronStart;
    console.log(
      `[cron-new-tweets] Complete: clients=${clientsProcessed}, newTweets=${totalNewTweets}, errors=${errors.length}, elapsed=${totalElapsed}ms`
    );

    return NextResponse.json({
      success: true,
      clients_checked: clientsProcessed,
      new_tweets_detected: totalNewTweets,
      errors: errors.length > 0 ? errors : undefined,
      error_count: errors.length,
      elapsed_ms: totalElapsed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[cron-new-tweets] Fatal error:', error);
    return NextResponse.json(
      { error: 'Failed to check new tweets', details: error instanceof Error ? error.message : 'Unknown error', elapsed_ms: Date.now() - cronStart },
      { status: 500 }
    );
  }
}
