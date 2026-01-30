import { NextRequest, NextResponse } from 'next/server';
import {
  createCampaign,
  getAllCampaigns,
  CreateCampaignInput,
} from '@/lib/models/socap/campaigns';
import {
  createCampaignTweet,
} from '@/lib/models/socap/tweets';
import {
  createWorkerStatesBulk,
  CreateWorkerStateInput,
} from '@/lib/models/socap/worker-state';
import {
  resolveTweetUrls,
} from '@/lib/socap/tweet-resolver';

// Retry helper for MongoDB operations
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if it's a MongoDB connection error
      const isConnectionError = errorMessage.includes('MongoServerSelectionError') || 
                                errorMessage.includes('timeout') ||
                                errorMessage.includes('ECONNRESET') ||
                                errorMessage.includes('connection') ||
                                errorMessage.includes('MongoError');
      
      if (isConnectionError && attempt < maxRetries) {
        const waitTime = delayMs * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`⚠️ Attempt ${attempt}/${maxRetries} failed with connection error. Retrying in ${waitTime}ms...`);
        console.log(`   Error: ${errorMessage}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // If not a connection error or last attempt, throw
      throw error;
    }
  }
  
  throw lastError || new Error('Operation failed after retries');
}

/**
 * GET /socap/campaigns
 * List all campaigns
 */
export async function GET(_request: NextRequest) {
  void _request;
  try {
    const campaigns = await withRetry(() => getAllCampaigns(), 3, 1000);
    
    return NextResponse.json({
      success: true,
      data: campaigns,
    });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    
    // Provide more helpful error messages
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isConnectionError = errorMessage.includes('MongoServerSelectionError') || 
                              errorMessage.includes('timeout');
    
    return NextResponse.json(
      {
        success: false,
        error: isConnectionError 
          ? 'Failed to connect to MongoDB. Please check your network connection and MongoDB Atlas IP whitelist settings.'
          : 'Failed to fetch campaigns',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /socap/campaigns
 * Create a new campaign
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.launch_name || !body.client_info || !body.monitor_window) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: launch_name, client_info, monitor_window',
        },
        { status: 400 }
      );
    }

    // Create campaign first – campaigns can exist with zero tweets,
    // and tweet attachment is a best-effort, append-only operation.
    const campaignInput: CreateCampaignInput = {
      launch_name: body.launch_name,
      client_info: body.client_info,
      maintweets: body.maintweets || [],
      influencer_twts: body.influencer_twts || [],
      investor_twts: body.investor_twts || [],
      monitor_window: body.monitor_window,
      alert_preferences: {
        importance_threshold: body.alert_preferences?.importance_threshold || 10,
        channels: body.alert_preferences?.channels || ['email'],
        frequency_window_minutes: body.alert_preferences?.frequency_window_minutes || 30,
        alert_spacing_minutes: body.alert_preferences?.alert_spacing_minutes || 20,
      },
    };
    
    const campaign = await createCampaign(campaignInput);

    // Resolve and attach tweets in a best-effort way.
    // - Campaign creation never rolls back because of tweet issues.
    // - Campaigns are allowed to have zero tweets.
    const allTweetUrls = [
      ...(body.maintweets || []).map((t: { url: string }) => t.url),
      ...(body.influencer_twts || []).map((t: { url: string }) => t.url),
      ...(body.investor_twts || []).map((t: { url: string }) => t.url),
    ];

    let tweetsCreated = 0;
    const tweetErrors: Array<{ url: string; reason: string }> = [];

    if (allTweetUrls.length > 0) {
      try {
        const resolvedTweets = await resolveTweetUrls(allTweetUrls);

        if (resolvedTweets.length === 0) {
          // No URLs could be resolved – keep the campaign but report the issue.
          for (const url of allTweetUrls) {
            tweetErrors.push({
              url,
              reason: 'Failed to resolve tweet URL',
            });
          }
        } else {
          // Build URL -> category map once from the original body
          const tweetMap = new Map<
            string,
            { url: string; category: 'main_twt' | 'influencer_twt' | 'investor_twt' }
          >();

          (body.maintweets || []).forEach((t: { url: string }) => {
            tweetMap.set(t.url, { url: t.url, category: 'main_twt' });
          });

          (body.influencer_twts || []).forEach((t: { url: string }) => {
            tweetMap.set(t.url, { url: t.url, category: 'influencer_twt' });
          });

          (body.investor_twts || []).forEach((t: { url: string }) => {
            tweetMap.set(t.url, { url: t.url, category: 'investor_twt' });
          });

          const jobTypes: Array<'retweets' | 'replies' | 'quotes' | 'metrics'> = [
            'retweets',
            'replies',
            'quotes',
            'metrics',
          ];

          // ============================================================
          // PARALLEL TWEET CREATION - Process all tweets concurrently
          // ============================================================
          const successfulTweets: Array<{ tweet_id: string; tweet_url: string }> = [];

          const tweetCreationPromises = resolvedTweets.map(async (resolvedTweet) => {
            const tweetInfo = tweetMap.get(resolvedTweet.tweet_url);
            if (!tweetInfo) return null;

            try {
              await createCampaignTweet(
                campaign._id!,
                resolvedTweet.tweet_id,
                resolvedTweet.tweet_url,
                tweetInfo.category,
                resolvedTweet.author_name,
                resolvedTweet.author_username,
                resolvedTweet.text
              );
              return { tweet_id: resolvedTweet.tweet_id, tweet_url: resolvedTweet.tweet_url };
            } catch (err) {
              const message =
                err instanceof Error ? err.message : 'Failed to create campaign tweet';
              tweetErrors.push({
                url: resolvedTweet.tweet_url,
                reason: message,
              });
              return null;
            }
          });

          // Wait for all tweet creations to complete in parallel
          const tweetResults = await Promise.all(tweetCreationPromises);
          for (const result of tweetResults) {
            if (result) {
              successfulTweets.push(result);
              tweetsCreated += 1;
            }
          }

          // ============================================================
          // BULK INSERT WORKER STATES - Single batch operation
          // ============================================================
          if (successfulTweets.length > 0) {
            const workerStateInputs: CreateWorkerStateInput[] = [];

            for (const tweet of successfulTweets) {
              for (const jobType of jobTypes) {
                workerStateInputs.push({
                  campaign_id: campaign._id!,
                  tweet_id: tweet.tweet_id,
                  job_type: jobType,
                });
              }
            }

            const bulkResult = await createWorkerStatesBulk(workerStateInputs);

            // Report any bulk insert errors
            if (bulkResult.errors.length > 0) {
              for (const errMsg of bulkResult.errors) {
                tweetErrors.push({
                  url: 'worker_states_bulk',
                  reason: errMsg,
                });
              }
            }
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to resolve tweet URLs';
        tweetErrors.push({
          url: 'ALL_URLS',
          reason: message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        campaign,
        tweets_created: tweetsCreated,
        tweet_errors: tweetErrors,
      },
    });
  } catch (error) {
    console.error('Error creating campaign:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create campaign',
      },
      { status: 500 }
    );
  }
}

