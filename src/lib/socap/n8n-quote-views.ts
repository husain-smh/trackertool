/**
 * Quote Views Integration
 * 
 * Unified interface for getting total views from quote tweets.
 * Supports two backends:
 * 1. N8N webhook (proven to work correctly)
 * 2. Direct API extractor (standalone backend system)
 * 
 * Switch between them using QUOTE_VIEWS_BACKEND env var:
 * - 'n8n' (default) - Uses N8N webhook
 * - 'extractor' - Uses direct API extractor
 */

import { getTweetByTweetId } from '../models/socap/tweets';
import { extractTotalQuoteTweetViews } from './quote-views-extractor';

/**
 * Result from quote views extraction (unified interface)
 */
export interface QuoteViewsResult {
  totalViews: number;
  totalQuotes: number;
  success: boolean;
  statistics?: {
    totalViewsAcrossAllQuoteTweets?: number;
    uniqueUsersKept?: number;
    totalQuotes?: number;
    pagesFetched?: number;
    quotesProcessed?: number;
  };
  backend?: 'n8n' | 'extractor'; // Which backend was used
}

/**
 * Get total views from quote tweets using N8N webhook
 * 
 * Handles long-running N8N calls (up to 10+ seconds) with proper timeout and retry logic.
 * 
 * @param tweetId - Tweet ID (will be converted to tweet URL)
 * @param options - Optional configuration
 * @returns Total views from all quote tweets
 */
async function getQuoteViewsFromN8NWebhook(
  tweetId: string,
  options?: {
    timeout?: number; // Timeout in ms (default: 60000 = 60 seconds)
    maxRetries?: number; // Max retries for transient failures (default: 2)
    retryDelay?: number; // Delay between retries in ms (default: 2000)
  }
): Promise<QuoteViewsResult> {
  // Get tweet to retrieve tweet_url
  const tweet = await getTweetByTweetId(tweetId);
  
  if (!tweet) {
    throw new Error(`Tweet ${tweetId} not found in database`);
  }

  if (!tweet.tweet_url) {
    throw new Error(`Tweet ${tweetId} has no tweet_url stored`);
  }

  const webhookUrl = process.env.N8N_QUOTE_VIEWS_WEBHOOK_URL || 
                     'https://mdhusainil.app.n8n.cloud/webhook/totalQuoteTwtViews';

  const timeout = options?.timeout || 60000; // 60 seconds default (N8N can take 10+ seconds)
  const maxRetries = options?.maxRetries ?? 2; // Retry up to 2 times for transient failures
  const retryDelay = options?.retryDelay || 2000; // 2 seconds between retries

  console.log(`[N8NQuoteViews] Calling N8N webhook for tweet ${tweetId} (${tweet.tweet_url}) - timeout: ${timeout}ms`);

  let lastError: Error | null = null;

  // Retry loop for transient failures
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[N8NQuoteViews] Retry attempt ${attempt}/${maxRetries} for tweet ${tweetId}`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }

    // Create AbortController for timeout handling (outside try so it's accessible in catch)
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | null = null;

    try {
      timeoutId = setTimeout(() => {
        controller.abort();
      }, timeout);

      const startTime = Date.now();

      const webhookResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // N8N workflow expects tweetUrl nested under 'body' property
        body: JSON.stringify({ 
          body: { tweetUrl: tweet.tweet_url }
        }),
        signal: controller.signal, // Enable timeout cancellation
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      const duration = Date.now() - startTime;
      console.log(`[N8NQuoteViews] N8N webhook responded in ${duration}ms for tweet ${tweetId}`);

      if (!webhookResponse.ok) {
        const errorText = await webhookResponse.text().catch(() => 'Unknown error');
        const error = new Error(`N8N webhook responded with status ${webhookResponse.status}: ${errorText}`);
        
        // 5xx errors are retryable, 4xx errors are not
        if (webhookResponse.status >= 500 && attempt < maxRetries) {
          console.warn(`[N8NQuoteViews] Server error ${webhookResponse.status}, will retry...`);
          lastError = error;
          continue;
        }
        
        throw error;
      }

      const webhookData = await webhookResponse.json();

      // Extract total views from N8N response
      const totalViews = webhookData.statistics?.totalViewsAcrossAllQuoteTweets || 0;
      const totalQuotes = webhookData.statistics?.uniqueUsersKept || 0; // This is actually unique users, not quote count

      console.log(
        `[N8NQuoteViews] Success: ${totalViews.toLocaleString()} total views from ${totalQuotes} unique quote tweets (took ${duration}ms)`
      );

      return {
        totalViews: typeof totalViews === 'number' ? totalViews : parseInt(String(totalViews), 10) || 0,
        totalQuotes: typeof totalQuotes === 'number' ? totalQuotes : parseInt(String(totalQuotes), 10) || 0,
        success: webhookData.success !== false,
        statistics: webhookData.statistics,
        backend: 'n8n' as const,
      };
    } catch (error) {
      // Clean up timeout if still active
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      // Handle timeout/abort errors
      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError = new Error(
          `N8N webhook timeout after ${timeout}ms for tweet ${tweetId}. N8N may be processing a large number of quotes.`
        );
        
        // Timeout is retryable if we have attempts left
        if (attempt < maxRetries) {
          console.warn(`[N8NQuoteViews] Timeout on attempt ${attempt + 1}, will retry...`);
          lastError = timeoutError;
          continue;
        }
        
        throw timeoutError;
      }

      // Handle network errors (retryable)
      if (error instanceof TypeError && error.message.includes('fetch')) {
        if (attempt < maxRetries) {
          console.warn(`[N8NQuoteViews] Network error on attempt ${attempt + 1}, will retry...`);
          lastError = error as Error;
          continue;
        }
      }

      // If it's not a retryable error or we've exhausted retries, throw
      if (attempt >= maxRetries) {
        console.error(`[N8NQuoteViews] Error calling N8N webhook for tweet ${tweetId} after ${attempt + 1} attempts:`, error);
        throw new Error(
          `Failed to get quote views from N8N after ${attempt + 1} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }

      lastError = error instanceof Error ? error : new Error('Unknown error');
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError || new Error(`Failed to get quote views from N8N for tweet ${tweetId}`);
}

/**
 * Get total views from quote tweets using direct API extractor
 * 
 * Uses the standalone extractor function that directly calls the Twitter API.
 * 
 * @param tweetId - Tweet ID
 * @returns Total views from all quote tweets
 */
async function getQuoteViewsFromExtractor(tweetId: string): Promise<QuoteViewsResult> {
  console.log(`[QuoteViews] Using extractor backend for tweet ${tweetId}`);
  
  const result = await extractTotalQuoteTweetViews(tweetId);
  
  return {
    totalViews: result.totalViews,
    totalQuotes: result.totalQuotes,
    success: true,
    statistics: {
      totalViewsAcrossAllQuoteTweets: result.totalViews,
      totalQuotes: result.totalQuotes,
      pagesFetched: result.pagesFetched,
      quotesProcessed: result.quotesProcessed,
    },
    backend: 'extractor' as const,
  };
}

/**
 * Get total views from quote tweets (unified interface)
 * 
 * Automatically selects backend based on QUOTE_VIEWS_BACKEND env var:
 * - 'n8n' (default) - Uses N8N webhook
 * - 'extractor' - Uses direct API extractor
 * 
 * @param tweetId - Tweet ID
 * @param options - Optional configuration (only used for N8N backend)
 * @returns Total views from all quote tweets
 */
export async function getQuoteViews(
  tweetId: string,
  options?: {
    timeout?: number;
    maxRetries?: number;
    retryDelay?: number;
  }
): Promise<QuoteViewsResult> {
  // Determine which backend to use
  const backend = (process.env.QUOTE_VIEWS_BACKEND || 'n8n').toLowerCase().trim();
  
  console.log(`[QuoteViews] Using backend: ${backend} for tweet ${tweetId}`);
  
  if (backend === 'extractor') {
    return await getQuoteViewsFromExtractor(tweetId);
  } else {
    // Default to N8N webhook
    return await getQuoteViewsFromN8NWebhook(tweetId, options);
  }
}

/**
 * @deprecated Use getQuoteViews() instead. This function is kept for backward compatibility.
 */
export async function getQuoteViewsFromN8N(
  tweetId: string,
  options?: {
    timeout?: number;
    maxRetries?: number;
    retryDelay?: number;
  }
): Promise<QuoteViewsResult> {
  return await getQuoteViews(tweetId, options);
}

