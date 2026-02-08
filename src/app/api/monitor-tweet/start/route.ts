import { NextRequest, NextResponse } from 'next/server';
import { createMonitoringJob, getMonitoringJobByTweetId, storeMetricSnapshot } from '@/lib/models/monitoring';
import { fetchTweetMetrics, fetchQuoteMetricsAggregate, QuoteAggregateResult } from '@/lib/external-api';
import { extractTweetIdFromUrl } from '@/lib/utils/tweet-utils';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { tweetUrl } = body;

    // Validate tweet URL
    if (!tweetUrl || typeof tweetUrl !== 'string') {
      return NextResponse.json(
        { error: 'Tweet URL is required' },
        { status: 400 }
      );
    }

    // Extract tweet ID from URL
    const tweetId = extractTweetIdFromUrl(tweetUrl);
    if (!tweetId) {
      console.error('[monitor-start] Failed to extract tweet ID from URL:', tweetUrl);
      return NextResponse.json(
        { 
          error: 'Invalid Twitter/X URL. Please provide a valid tweet URL.',
          details: 'URL must be in format: https://x.com/username/status/1234567890 or https://twitter.com/username/status/1234567890',
          received_url: tweetUrl
        },
        { status: 400 }
      );
    }
    
    console.log('[monitor-start] Extracted tweet ID:', tweetId, 'from URL:', tweetUrl);

    // Check if tweet is already being monitored
    const existingJob = await getMonitoringJobByTweetId(tweetId);
    if (existingJob && existingJob.status === 'active') {
      return NextResponse.json(
        {
          success: false,
          error: 'This tweet is already being monitored',
          tweet_id: tweetId,
          job: existingJob,
        },
        { status: 409 }
      );
    }

    // Validate tweet exists by fetching it once
    // Use dedicated 'monitor' API key to protect from batch operation rate limits
    let initialMetrics: Awaited<ReturnType<typeof fetchTweetMetrics>>;
    let initialQuoteAgg: QuoteAggregateResult | null = null;
    try {
      initialMetrics = await fetchTweetMetrics(tweetId, 1, 'monitor');
      console.log(`[monitor-start] Fetched base metrics: quoteCount=${initialMetrics.quoteCount}, viewCount=${initialMetrics.viewCount}`);

      // Fetch quote aggregates (with pagination) so the first snapshot has quote views
      // Pass expected quote count for dynamic page cap
      // Use dedicated 'monitor' API key
      try {
        initialQuoteAgg = await fetchQuoteMetricsAggregate(tweetId, {
          expectedQuoteCount: initialMetrics.quoteCount,
          keyType: 'monitor',
        });
        
        console.log(
          `[monitor-start] Quote aggregation complete: ` +
          `quoteTweetCount=${initialQuoteAgg.quoteTweetCount}, quoteViewSum=${initialQuoteAgg.quoteViewSum.toLocaleString()}, ` +
          `coverage=${initialQuoteAgg.meta.coveragePercent ?? 'N/A'}%, wasComplete=${initialQuoteAgg.meta.wasComplete}`
        );
        
        if (initialQuoteAgg.meta.errors.length > 0) {
          console.warn(`[monitor-start] Quote aggregation had issues: ${initialQuoteAgg.meta.errors.join('; ')}`);
        }
      } catch (quoteError) {
        console.error('[monitor-start] Error fetching initial quote aggregates:', quoteError);
      }
    } catch (error) {
      console.error('Error validating tweet:', error);
      
      // Provide more specific error messages
      let errorMessage = 'Failed to fetch tweet. Please verify the tweet URL is correct.';
      let statusCode = 400;
      
      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('404')) {
          errorMessage = 'Tweet not found. The tweet may have been deleted or the URL is incorrect.';
        } else if (error.message.includes('rate limit') || error.message.includes('429')) {
          errorMessage = 'Twitter API rate limit exceeded. Please try again in a few minutes.';
          statusCode = 429;
        } else if (error.message.includes('authentication') || error.message.includes('API key')) {
          errorMessage = 'Twitter API authentication failed. Please check your API key configuration.';
          statusCode = 401;
        } else if (error.message.includes('credits') || error.message.includes('402') || error.message.includes('recharge')) {
          errorMessage = 'Twitter API credits exhausted. Please recharge your API account to continue monitoring tweets.';
          statusCode = 402;
        } else if (error.message.includes('Network') || error.message.includes('timeout')) {
          errorMessage = 'Network error connecting to Twitter API. Please try again.';
          statusCode = 503;
        } else {
          errorMessage = `Failed to fetch tweet: ${error.message}`;
        }
      }
      
      return NextResponse.json(
        {
          error: errorMessage,
          details: error instanceof Error ? error.message : 'Unknown error',
          tweet_id: tweetId,
        },
        { status: statusCode }
      );
    }

    // Create monitoring job
    const job = await createMonitoringJob(tweetId, tweetUrl);

    // Capture the first snapshot immediately so the user sees metrics right away
    try {
      const quoteTweetCount = initialQuoteAgg?.quoteTweetCount || initialMetrics.quoteCount;
      const quoteViewSum = initialQuoteAgg?.quoteViewSum || 0;
      
      await storeMetricSnapshot(tweetId, {
        ...initialMetrics,
        quoteTweetCount,
        quoteViewSum,
      });
      
      const elapsed = Date.now() - startTime;
      console.log(
        `[monitor-start] ✅ Monitoring started for ${tweetId}: ` +
        `quoteViewSum=${quoteViewSum.toLocaleString()}, quoteTweetCount=${quoteTweetCount}, elapsed=${elapsed}ms`
      );
    } catch (snapshotError) {
      console.error('[monitor-start] Error storing initial metric snapshot:', snapshotError);
      return NextResponse.json(
        {
          error: 'Failed to store initial metrics snapshot',
          details: snapshotError instanceof Error ? snapshotError.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Monitoring started successfully. Metrics will be collected every 10 minutes for 5 days.',
      tweet_id: tweetId,
      job: {
        tweet_id: job.tweet_id,
        tweet_url: job.tweet_url,
        status: job.status,
        started_at: job.started_at,
      },
      initial_quote_metrics: initialQuoteAgg ? {
        quoteTweetCount: initialQuoteAgg.quoteTweetCount,
        quoteViewSum: initialQuoteAgg.quoteViewSum,
        wasComplete: initialQuoteAgg.meta.wasComplete,
        coveragePercent: initialQuoteAgg.meta.coveragePercent,
      } : null,
    });
  } catch (error) {
    console.error('[monitor-start] Error starting tweet monitoring:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to start monitoring',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

