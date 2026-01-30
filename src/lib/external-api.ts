/**
 * External API integration for fetching tweet metrics
 * API: https://api.twitterapi.io/twitter/tweets
 * 
 * Supports hybrid API key strategy:
 * - 'monitor' key: Dedicated for monitoring (protected)
 * - 'shared' key: For batch operations (jobs, narratives, aggregates)
 */

import { getTwitterApiKey, type TwitterApiKeyType } from './config/twitter-api-config';

export interface TweetMetrics {
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  viewCount: number;
  bookmarkCount: number;
  last_updated?: Date;
}

export interface TweetQuote {
  id: string;
  viewCount?: number;
  quoteCount?: number;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  bookmarkCount?: number;
}

export interface TwitterApiResponse {
  tweets: Array<{
    id: string;
    url?: string;
    text?: string;
    /** Tweet published timestamp (field name varies by API version) */
    createdAt?: string;
    created_at?: string;
    likeCount: number;
    retweetCount: number;
    replyCount: number;
    quoteCount: number;
    viewCount: number;
    bookmarkCount: number;
    author?: {
      id: string;
      name: string;
      userName?: string;
      screen_name?: string;
    };
  }>;
  status: 'success' | 'error';
  message?: string;
}

export interface TwitterQuotesResponse extends TwitterApiResponse {
  has_next_page?: boolean;
  next_cursor?: string;
}

export interface TweetDetails {
  id: string;
  authorName: string;
  authorUsername?: string;
  text?: string;
  tweetCreatedAt?: Date;
  metrics: TweetMetrics;
}

/**
 * Custom error classes for better error handling
 */
export class TwitterApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public isRetryable: boolean = false,
    public errorCode?: string,
    public context?: {
      tweetId?: string;
      operation?: string;
      retryAfter?: number;
    }
  ) {
    super(message);
    this.name = 'TwitterApiError';
  }
}

/**
 * Fetch tweet metrics from external API with retry logic
 * 
 * @param tweetId - The tweet ID to fetch metrics for
 * @param retries - Number of retries (default: 1)
 * @param keyType - Which API key to use: 'monitor' (dedicated) or 'shared' (batch operations)
 */
export async function fetchTweetMetrics(
  tweetId: string,
  retries: number = 1,
  keyType: TwitterApiKeyType = 'shared'
): Promise<TweetMetrics> {
  const apiKey = getTwitterApiKey(keyType);
  
  if (!apiKey) {
    throw new TwitterApiError('Twitter API key is not configured. Set TWITTER_API_KEY_MONITOR, TWITTER_API_KEY_SHARED, or TWITTER_API_KEY.', 500, false);
  }
  
  const apiUrl = process.env.TWITTER_API_URL || 'https://api.twitterapi.io';
  const url = `${apiUrl}/twitter/tweets?tweet_ids=${tweetId}`;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // Handle different HTTP status codes
      if (response.status === 429) {
        // Rate limit - retryable but wait a bit
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
          continue;
        }
        throw new TwitterApiError(
          'Twitter API rate limit exceeded. Please try again later.',
          429,
          true
        );
      }
      
      if (response.status === 404) {
        // Tweet not found - not retryable
        throw new TwitterApiError(
          `Tweet with ID ${tweetId} not found. It may have been deleted.`,
          404,
          false
        );
      }
      
      if (response.status === 401 || response.status === 403) {
        // Authentication error - not retryable
        throw new TwitterApiError(
          'Twitter API authentication failed. Please check your API key.',
          response.status,
          false
        );
      }
      
      if (response.status === 402) {
        // Payment required - credits exhausted
        const errorData = await response.json().catch(() => ({}));
        const message = errorData.message || 'Twitter API credits exhausted';
        throw new TwitterApiError(
          `Twitter API credits insufficient: ${message}. Please recharge your account.`,
          402,
          false
        );
      }
      
      if (!response.ok) {
        // Other HTTP errors
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new TwitterApiError(
          `Twitter API responded with status ${response.status}: ${errorText}`,
          response.status,
          response.status >= 500 // Server errors are retryable
        );
      }
      
      const data: TwitterApiResponse = await response.json();
      
      if (data.status === 'error') {
        // API returned error status
        const errorMessage = data.message || 'Twitter API returned an error';
        throw new TwitterApiError(errorMessage, 400, false);
      }
      
      if (!data.tweets || data.tweets.length === 0) {
        throw new TwitterApiError(
          `No tweet found with ID: ${tweetId}`,
          404,
          false
        );
      }
      
      const tweet = data.tweets[0];
      
      return {
        likeCount: tweet.likeCount || 0,
        retweetCount: tweet.retweetCount || 0,
        replyCount: tweet.replyCount || 0,
        quoteCount: tweet.quoteCount || 0,
        viewCount: tweet.viewCount || 0,
        bookmarkCount: tweet.bookmarkCount || 0,
      };
    } catch (error) {
      // If it's a TwitterApiError and not retryable, throw immediately
      if (error instanceof TwitterApiError && !error.isRetryable) {
        throw error;
      }
      
      // If it's a timeout or network error, retry if attempts remain
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        (error instanceof TypeError && error.message.includes('fetch'))
      ) {
        if (attempt < retries) {
          console.warn(`Network error on attempt ${attempt + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
          continue;
        }
        throw new TwitterApiError(
          'Network error: Failed to connect to Twitter API',
          0,
          true
        );
      }
      
      // If it's a retryable error and we have attempts left, retry
      if (error instanceof TwitterApiError && error.isRetryable && attempt < retries) {
        console.warn(`Retryable error on attempt ${attempt + 1}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      // Re-throw if we've exhausted retries or it's not retryable
      throw error instanceof TwitterApiError
        ? error
        : new TwitterApiError(
            error instanceof Error ? error.message : 'Failed to fetch tweet metrics from external API',
            500,
            true
          );
    }
  }
  
  // Should never reach here, but TypeScript needs it
  throw new TwitterApiError('Failed to fetch tweet metrics after retries', 500, false);
}

/**
 * Fetch full tweet details including author information
 * 
 * @param tweetId - The tweet ID to fetch details for
 * @param retries - Number of retries (default: 1)
 * @param keyType - Which API key to use: 'monitor' (dedicated) or 'shared' (batch operations)
 */
export async function fetchTweetDetails(
  tweetId: string,
  retries: number = 1,
  keyType: TwitterApiKeyType = 'shared'
): Promise<TweetDetails> {
  const apiKey = getTwitterApiKey(keyType);
  
  if (!apiKey) {
    throw new TwitterApiError('Twitter API key is not configured. Set TWITTER_API_KEY_MONITOR, TWITTER_API_KEY_SHARED, or TWITTER_API_KEY.', 500, false);
  }
  
  const apiUrl = process.env.TWITTER_API_URL || 'https://api.twitterapi.io';
  const url = `${apiUrl}/twitter/tweets?tweet_ids=${tweetId}`;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.status === 429) {
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        throw new TwitterApiError(
          'Twitter API rate limit exceeded. Please try again later.',
          429,
          true
        );
      }
      
      if (response.status === 404) {
        throw new TwitterApiError(
          `Tweet with ID ${tweetId} not found. It may have been deleted.`,
          404,
          false
        );
      }
      
      if (response.status === 401 || response.status === 403) {
        throw new TwitterApiError(
          'Twitter API authentication failed. Please check your API key.',
          response.status,
          false
        );
      }
      
      if (response.status === 402) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData.message || 'Twitter API credits exhausted';
        throw new TwitterApiError(
          `Twitter API credits insufficient: ${message}. Please recharge your account.`,
          402,
          false
        );
      }
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new TwitterApiError(
          `Twitter API responded with status ${response.status}: ${errorText}`,
          response.status,
          response.status >= 500
        );
      }
      
      const data: TwitterApiResponse = await response.json();
      
      if (data.status === 'error') {
        const errorMessage = data.message || 'Twitter API returned an error';
        throw new TwitterApiError(errorMessage, 400, false);
      }
      
      if (!data.tweets || data.tweets.length === 0) {
        throw new TwitterApiError(
          `No tweet found with ID: ${tweetId}`,
          404,
          false
        );
      }
      
      const tweet = data.tweets[0];
      const author = tweet.author;
      const createdAtRaw = (tweet as any).createdAt ?? (tweet as any).created_at;
      const tweetCreatedAt =
        typeof createdAtRaw === 'string' && createdAtRaw
          ? new Date(createdAtRaw)
          : undefined;
      const safeTweetCreatedAt =
        tweetCreatedAt instanceof Date && !Number.isNaN(tweetCreatedAt.getTime())
          ? tweetCreatedAt
          : undefined;
      
      return {
        id: tweet.id,
        authorName: author?.name || 'Unknown',
        authorUsername: author?.userName || author?.screen_name,
        text: tweet.text,
        tweetCreatedAt: safeTweetCreatedAt,
        metrics: {
          likeCount: tweet.likeCount || 0,
          retweetCount: tweet.retweetCount || 0,
          replyCount: tweet.replyCount || 0,
          quoteCount: tweet.quoteCount || 0,
          viewCount: tweet.viewCount || 0,
          bookmarkCount: 0, // Not always available in this endpoint
          last_updated: new Date(),
        },
      };
    } catch (error) {
      if (error instanceof TwitterApiError && !error.isRetryable) {
        throw error;
      }
      
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        (error instanceof TypeError && error.message.includes('fetch'))
      ) {
        if (attempt < retries) {
          console.warn(`Network error on attempt ${attempt + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        throw new TwitterApiError(
          'Network error: Failed to connect to Twitter API',
          0,
          true
        );
      }
      
      if (error instanceof TwitterApiError && error.isRetryable && attempt < retries) {
        console.warn(`Retryable error on attempt ${attempt + 1}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      throw error instanceof TwitterApiError
        ? error
        : new TwitterApiError(
            error instanceof Error ? error.message : 'Failed to fetch tweet details from external API',
            500,
            true
          );
    }
  }
  
  throw new TwitterApiError('Failed to fetch tweet details after retries', 500, false);
}

/**
 * Extract tweet ID from Twitter/X URL
 */
export function extractTweetIdFromUrl(tweetUrl: string): string | null {
  // Match patterns like:
  // https://twitter.com/username/status/1234567890
  // https://x.com/username/status/1234567890
  // https://www.twitter.com/username/status/1234567890
  const match = tweetUrl.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i);
  
  if (!match || !match[1]) {
    return null;
  }
  
  return match[1];
}

/**
 * Fetch one page of quote tweets for a given tweet.
 * Supports pagination via next_cursor.
 * 
 * IMPROVED: 3 retries with exponential backoff, better logging
 * 
 * @param tweetId - The tweet ID to fetch quotes for
 * @param cursor - Pagination cursor
 * @param retries - Number of retries (default: 3)
 * @param keyType - Which API key to use: 'monitor' (dedicated) or 'shared' (batch operations)
 */
export async function fetchTweetQuotesPage(
  tweetId: string,
  cursor?: string,
  retries: number = 3, // Increased from 1 to 3
  keyType: TwitterApiKeyType = 'shared'
): Promise<TwitterQuotesResponse> {
  const apiKey = getTwitterApiKey(keyType);

  if (!apiKey) {
    throw new TwitterApiError('Twitter API key is not configured. Set TWITTER_API_KEY_MONITOR, TWITTER_API_KEY_SHARED, or TWITTER_API_KEY.', 500, false);
  }

  const apiUrl = process.env.TWITTER_API_URL || 'https://api.twitterapi.io';
  // API expects tweetId (camel) and optional cursor; includeReplies defaults true
  const params = new URLSearchParams({
    tweetId,
    includeReplies: 'true',
    cursor: cursor ?? '',
  });
  const url = `${apiUrl}/twitter/tweet/quotes?${params.toString()}`;

  // Exponential backoff delays: 2s, 4s, 8s
  const getBackoffDelay = (attempt: number): number => Math.pow(2, attempt + 1) * 1000;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const attemptStart = Date.now();
    try {
      if (attempt > 0) {
        console.log(`[quotes-page] Retry attempt ${attempt}/${retries} for tweetId=${tweetId}, cursor=${cursor ?? 'none'}`);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000); // Increased from 30s to 45s

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const elapsed = Date.now() - attemptStart;
      
      console.log(`[quotes-page] Response: status=${response.status}, elapsed=${elapsed}ms, tweetId=${tweetId}, cursor=${cursor ?? 'none'}`);

      if (response.status === 429) {
        const backoffDelay = getBackoffDelay(attempt) * 2; // Double backoff for rate limits
        if (attempt < retries) {
          console.warn(`[quotes-page] Rate limited (429), backing off ${backoffDelay}ms before retry ${attempt + 1}/${retries}`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue;
        }
        throw new TwitterApiError(
          'Twitter API rate limit exceeded. Please try again later.',
          429,
          true
        );
      }

      if (response.status === 404) {
        throw new TwitterApiError(
          `Quote tweets for ${tweetId} not found.`,
          404,
          false
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new TwitterApiError(
          'Twitter API authentication failed. Please check your API key.',
          response.status,
          false
        );
      }

      if (response.status === 402) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData.message || 'Twitter API credits exhausted';
        throw new TwitterApiError(
          `Twitter API credits insufficient: ${message}. Please recharge your account.`,
          402,
          false
        );
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`[quotes-page] Non-OK response: status=${response.status}, body=${errorText.slice(0, 500)}`);
        throw new TwitterApiError(
          `Twitter API responded with status ${response.status}: ${errorText}`,
          response.status,
          response.status >= 500
        );
      }

      const data: TwitterQuotesResponse = await response.json();

      if (data.status === 'error') {
        const errorMessage = data.message || 'Twitter API returned an error';
        console.error(`[quotes-page] API error response: ${errorMessage}`);
        throw new TwitterApiError(errorMessage, 400, false);
      }

      return data;
    } catch (error) {
      const elapsed = Date.now() - attemptStart;
      
      if (error instanceof TwitterApiError && !error.isRetryable) {
        console.error(`[quotes-page] Non-retryable error after ${elapsed}ms: ${error.message}`);
        throw error;
      }

      if (
        (error instanceof Error && error.name === 'AbortError') ||
        (error instanceof TypeError && error.message.includes('fetch'))
      ) {
        const backoffDelay = getBackoffDelay(attempt);
        if (attempt < retries) {
          console.warn(`[quotes-page] Network/timeout error after ${elapsed}ms, backing off ${backoffDelay}ms before retry ${attempt + 1}/${retries}`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue;
        }
        throw new TwitterApiError(
          'Network error: Failed to connect to Twitter API (quotes)',
          0,
          true
        );
      }

      if (error instanceof TwitterApiError && error.isRetryable && attempt < retries) {
        const backoffDelay = getBackoffDelay(attempt);
        console.warn(`[quotes-page] Retryable error after ${elapsed}ms: ${error.message}, backing off ${backoffDelay}ms before retry ${attempt + 1}/${retries}`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        continue;
      }

      throw error instanceof TwitterApiError
        ? error
        : new TwitterApiError(
            error instanceof Error ? error.message : 'Failed to fetch quote tweets from external API',
            500,
            true
          );
    }
  }

  throw new TwitterApiError('Failed to fetch quote tweets after retries', 500, false);
}

/**
 * Result of quote metrics aggregation with quality metadata
 */
export interface QuoteAggregateResult {
  quoteTweetCount: number;
  quoteViewSum: number;
  /** Metadata about the fetch quality */
  meta: {
    pagesProcessed: number;
    maxPagesUsed: number;
    wasComplete: boolean;        // True if we got all pages (no maxPages cap hit)
    expectedQuoteCount?: number; // The quoteCount from the original tweet
    coveragePercent?: number;    // What % of expected quotes we found
    emptyPagesEncountered: number;
    duplicatesSkipped: number;
    tweetsWithZeroViews: number;
    totalElapsedMs: number;
    errors: string[];            // Any non-fatal errors encountered
  };
}

/**
 * Aggregate quote tweets across all pages with a small delay between pages.
 * Returns total quote tweets, summed view counts, and quality metadata.
 * 
 * IMPROVED:
 * - Dynamic page cap based on expected quoteCount
 * - Comprehensive logging for debugging
 * - Health check validation
 * - Returns metadata about fetch quality
 * 
 * @param tweetId - The tweet ID to aggregate quotes for
 * @param options - Configuration options
 * @param options.pageDelayMs - Delay between pages (default: 500ms)
 * @param options.maxPages - Maximum pages to fetch (default: 50, dynamic based on expectedQuoteCount)
 * @param options.expectedQuoteCount - Expected quote count for dynamic page calculation
 * @param options.keyType - Which API key to use: 'monitor' (dedicated) or 'shared' (batch operations)
 */
export async function fetchQuoteMetricsAggregate(
  tweetId: string,
  options: {
    pageDelayMs?: number;
    maxPages?: number;
    expectedQuoteCount?: number; // From the original tweet's quoteCount metric
    keyType?: TwitterApiKeyType; // Which API key to use
  } = {}
): Promise<QuoteAggregateResult> {
  const startTime = Date.now();
  const pageDelayMs = options.pageDelayMs ?? 500; // Increased from 300ms to 500ms for rate limit safety
  const expectedQuoteCount = options.expectedQuoteCount;
  const keyType = options.keyType ?? 'shared';
  
  // Dynamic page cap: if we know expected quotes, calculate pages needed (~20 tweets/page)
  // Add 20% buffer for safety, minimum 10 pages, cap at 100
  let maxPages = options.maxPages ?? 50;
  if (expectedQuoteCount && expectedQuoteCount > 0) {
    const estimatedPagesNeeded = Math.ceil(expectedQuoteCount / 20) * 1.2; // 20% buffer
    maxPages = Math.max(10, Math.min(100, Math.ceil(estimatedPagesNeeded)));
    console.log(`[quotes-agg] Dynamic maxPages=${maxPages} based on expectedQuoteCount=${expectedQuoteCount}`);
  }

  let cursor: string | undefined = undefined;
  let hasNext = true;
  let page = 0;
  let quoteTweetCount = 0;
  let quoteViewSum = 0;
  let emptyPagesEncountered = 0;
  let duplicatesSkipped = 0;
  let tweetsWithZeroViews = 0;
  let consecutiveEmptyPages = 0;
  const errors: string[] = [];
  const seen = new Set<string>();

  console.log(`[quotes-agg] Starting aggregation for tweetId=${tweetId}, maxPages=${maxPages}, expectedQuotes=${expectedQuoteCount ?? 'unknown'}`);

  while (hasNext && page < maxPages) {
    const pageStart = Date.now();
    
    try {
      const data = await fetchTweetQuotesPage(tweetId, cursor, 3, keyType);
      page += 1;
      const pageElapsed = Date.now() - pageStart;

      const tweets = data.tweets || [];
      
      // Log first page response structure for debugging
      if (page === 1 && tweets.length > 0) {
        const sampleTweet = tweets[0];
        const fields = Object.keys(sampleTweet || {});
        console.log(`[quotes-agg] First tweet sample fields: [${fields.join(', ')}]`);
        
        // Check for different viewCount field names
        const viewFieldCandidates = ['viewCount', 'view_count', 'views', 'impressionCount', 'impressions'];
        const foundViewField = viewFieldCandidates.find(f => (sampleTweet as any)[f] !== undefined);
        if (foundViewField && foundViewField !== 'viewCount') {
          console.warn(`[quotes-agg] ⚠️ Found view count in field "${foundViewField}" instead of "viewCount"`);
        }
        if (!foundViewField) {
          console.warn(`[quotes-agg] ⚠️ No view count field found in tweet! Available: ${fields.join(', ')}`);
        }
      }

      console.log(
        `[quotes-agg] page=${page}/${maxPages} tweets=${tweets.length} elapsed=${pageElapsed}ms ` +
        `cursor=${cursor ? cursor.slice(0, 20) + '...' : 'none'} ` +
        `has_next=${(data as any).has_next_page} next_cursor=${(data as any).next_cursor ? 'yes' : 'no'}`
      );

      if (tweets.length === 0) {
        emptyPagesEncountered++;
        consecutiveEmptyPages++;
        console.warn(`[quotes-agg] ⚠️ Empty page ${page} for tweetId=${tweetId} (consecutive: ${consecutiveEmptyPages})`);
        
        // Stop if we get 3 consecutive empty pages (likely API issue)
        if (consecutiveEmptyPages >= 3) {
          errors.push(`Stopped after ${consecutiveEmptyPages} consecutive empty pages`);
          console.error(`[quotes-agg] ❌ Stopping: ${consecutiveEmptyPages} consecutive empty pages`);
          break;
        }
      } else {
        consecutiveEmptyPages = 0; // Reset on successful page
      }

      for (const t of tweets) {
        if (!t?.id) {
          errors.push('Tweet without id encountered');
          continue;
        }
        if (seen.has(t.id)) {
          duplicatesSkipped++;
          continue;
        }
        seen.add(t.id);
        quoteTweetCount += 1;
        
        // Try multiple possible view count field names
        let viewCount = 0;
        const viewValue = (t as any).viewCount ?? (t as any).view_count ?? (t as any).views ?? (t as any).impressionCount ?? 0;
        if (typeof viewValue === 'number') {
          viewCount = viewValue;
        } else if (typeof viewValue === 'string') {
          viewCount = parseInt(viewValue, 10) || 0;
        }
        
        if (viewCount === 0) {
          tweetsWithZeroViews++;
        }
        quoteViewSum += viewCount;
      }

      // Check pagination signals
      const hasNextPage = (data as any).has_next_page === true || (data as any).hasNextPage === true;
      const nextCursor = data.next_cursor || (data as any).nextCursor;
      hasNext = hasNextPage && !!nextCursor && nextCursor !== cursor; // Also check cursor changed
      cursor = nextCursor;

      if (!hasNext) {
        console.log(`[quotes-agg] Pagination complete: has_next_page=${hasNextPage}, has_cursor=${!!nextCursor}`);
      }

      if (hasNext) {
        await new Promise(resolve => setTimeout(resolve, pageDelayMs));
      }
    } catch (pageError) {
      const errorMsg = pageError instanceof Error ? pageError.message : 'Unknown error';
      errors.push(`Page ${page + 1} error: ${errorMsg}`);
      console.error(`[quotes-agg] ❌ Error on page ${page + 1}: ${errorMsg}`);
      
      // If we have some data, don't throw - return what we have with error noted
      if (quoteTweetCount > 0) {
        console.warn(`[quotes-agg] ⚠️ Returning partial data (${quoteTweetCount} quotes) after error`);
        break;
      }
      
      // If no data at all, re-throw
      throw pageError;
    }
  }

  const totalElapsed = Date.now() - startTime;
  const wasComplete = page < maxPages && !hasNext;
  const coveragePercent = expectedQuoteCount && expectedQuoteCount > 0 
    ? Math.round((quoteTweetCount / expectedQuoteCount) * 100) 
    : undefined;

  // Health check warnings
  if (coveragePercent !== undefined && coveragePercent < 80) {
    console.warn(
      `[quotes-agg] ⚠️ LOW COVERAGE: Only found ${quoteTweetCount}/${expectedQuoteCount} quotes (${coveragePercent}%). ` +
      `This may indicate pagination issues.`
    );
    errors.push(`Low coverage: ${coveragePercent}% of expected quotes`);
  }

  if (tweetsWithZeroViews > quoteTweetCount * 0.5) {
    console.warn(
      `[quotes-agg] ⚠️ HIGH ZERO-VIEW RATE: ${tweetsWithZeroViews}/${quoteTweetCount} tweets have 0 views. ` +
      `This may indicate view field parsing issues.`
    );
    errors.push(`${Math.round(tweetsWithZeroViews / quoteTweetCount * 100)}% of tweets have 0 views`);
  }

  if (page >= maxPages && hasNext) {
    console.warn(`[quotes-agg] ⚠️ HIT MAX PAGES CAP: Stopped at ${maxPages} pages but more data exists`);
    errors.push(`Hit max pages cap (${maxPages}), data may be incomplete`);
  }

  console.log(
    `[quotes-agg] ✅ Complete for tweetId=${tweetId}: ` +
    `quoteTweetCount=${quoteTweetCount}, quoteViewSum=${quoteViewSum.toLocaleString()}, ` +
    `pages=${page}/${maxPages}, wasComplete=${wasComplete}, ` +
    `coverage=${coveragePercent ?? 'N/A'}%, elapsed=${totalElapsed}ms, ` +
    `emptyPages=${emptyPagesEncountered}, duplicates=${duplicatesSkipped}, zeroViews=${tweetsWithZeroViews}`
  );

  return {
    quoteTweetCount,
    quoteViewSum,
    meta: {
      pagesProcessed: page,
      maxPagesUsed: maxPages,
      wasComplete,
      expectedQuoteCount,
      coveragePercent,
      emptyPagesEncountered,
      duplicatesSkipped,
      tweetsWithZeroViews,
      totalElapsedMs: totalElapsed,
      errors,
    },
  };
}

