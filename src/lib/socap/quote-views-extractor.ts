/**
 * Quote Views Extractor
 * 
 * Standalone system for extracting total views from quote tweets.
 * Based on proven N8N logic - fetches all pages and sums all viewCounts.
 * 
 * This is separate from the worker logic for easier debugging and testing.
 */

import { getTwitterApiConfig } from '../config/twitter-api-config';
import { TwitterApiError } from '../external-api';
import { extractTweetIdFromUrl } from './tweet-resolver';
import { makeApiRequest } from '../twitter-api-client';

/**
 * Extract tweet ID from URL or return as-is if already an ID
 */
function normalizeTweetId(input: string): string {
  // If it's already a numeric ID, return it
  if (/^\d+$/.test(input.trim())) {
    return input.trim();
  }
  
  // Try to extract from URL
  const extracted = extractTweetIdFromUrl(input);
  if (extracted) {
    return extracted;
  }
  
  throw new Error(`Invalid tweet ID or URL: ${input}`);
}

/**
 * Sleep utility for rate limiting between pages
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Result of quote views extraction
 */
export interface QuoteViewsResult {
  totalViews: number;
  totalQuotes: number;
  pagesFetched: number;
  quotesProcessed: number;
}

/**
 * Extract total views from all quote tweets of a given tweet.
 * 
 * This function:
 * - Fetches ALL pages of quotes (like N8N does)
 * - Sums ALL viewCount values (no filtering, trusts the API)
 * - Returns the total
 * 
 * Based on N8N workflow logic which has been proven to work correctly.
 * 
 * @param tweetIdOrUrl - Tweet ID (string) or Twitter URL
 * @param options - Optional configuration
 * @returns Total views from all quote tweets
 */
export async function extractTotalQuoteTweetViews(
  tweetIdOrUrl: string,
  options?: {
    maxPages?: number; // Maximum pages to fetch (default: 60, like N8N)
    requestInterval?: number; // Delay between pages in ms (default: 500, like N8N)
  }
): Promise<QuoteViewsResult> {
  const tweetId = normalizeTweetId(tweetIdOrUrl);
  const config = getTwitterApiConfig();
  const maxPages = options?.maxPages || config.maxPages.quotes; // Use config default (60)
  const requestInterval = options?.requestInterval || config.rateLimitDelay; // Use config default (500ms = 0.5 seconds)
  
  if (!config.apiKey) {
    throw new TwitterApiError(
      'TWITTER_API_KEY not configured',
      500,
      false,
      'CONFIG_ERROR'
    );
  }

  let totalViews = 0;
  let totalQuotes = 0;
  let pagesFetched = 0;
  let currentCursor: string | undefined = undefined;
  let hasMore = true;
  const processedQuoteIds = new Set<string>(); // Deduplicate by quote tweet ID

  console.log(`[QuoteViewsExtractor] Starting extraction for tweet ${tweetId}`);

  while (hasMore && pagesFetched < maxPages) {
    // Build URL with cursor
    const url = new URL(`${config.apiUrl}/twitter/tweet/quotes`);
    url.searchParams.set('tweetId', tweetId);
    if (currentCursor) {
      url.searchParams.set('cursor', currentCursor);
    }

    try {
      // Make API request using existing rate limiting infrastructure
      const data = await makeApiRequest(url.toString(), config);

      // Process tweets array (like N8N does)
      if (data.tweets && Array.isArray(data.tweets)) {
        for (const quoteTweet of data.tweets) {
          // Use quote tweet ID as unique identifier to prevent double-counting
          const quoteId = quoteTweet.id;
          
          if (processedQuoteIds.has(quoteId)) {
            console.log(`[QuoteViewsExtractor] Skipping duplicate quote: ${quoteId}`);
            continue;
          }
          
          processedQuoteIds.add(quoteId);
          totalQuotes++;

          // Extract viewCount (like N8N does - no filtering, just sum everything)
          let viewCount = 0;
          const rawViewCount = quoteTweet.viewCount;
          
          if (typeof rawViewCount === 'number') {
            viewCount = rawViewCount;
          } else if (typeof rawViewCount === 'string') {
            const parsed = parseInt(rawViewCount, 10);
            viewCount = Number.isNaN(parsed) ? 0 : parsed;
          }

          totalViews += viewCount;
        }
      }

      // Update pagination state
      currentCursor = data.next_cursor;
      hasMore = data.tweets && 
                data.tweets.length > 0 && 
                (data.has_next_page !== false) && 
                !!currentCursor;
      
      pagesFetched++;

      console.log(
        `[QuoteViewsExtractor] Page ${pagesFetched}: ${data.tweets?.length || 0} quotes, ` +
        `Total so far: ${totalViews.toLocaleString()} views from ${totalQuotes} quotes`
      );

      // Rate limiting delay between pages (0.5 seconds like N8N)
      // This respects API rate limits and prevents overwhelming the API
      if (hasMore && pagesFetched < maxPages) {
        await sleep(requestInterval); // Default 500ms (0.5 seconds)
      }
    } catch (error) {
      if (error instanceof TwitterApiError) {
        throw error;
      }
      throw new TwitterApiError(
        `Error fetching quote tweets: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        false,
        'FETCH_ERROR'
      );
    }
  }

  console.log(
    `[QuoteViewsExtractor] Complete: ${totalViews.toLocaleString()} total views ` +
    `from ${totalQuotes} unique quotes across ${pagesFetched} pages`
  );

  return {
    totalViews,
    totalQuotes,
    pagesFetched,
    quotesProcessed: totalQuotes,
  };
}

