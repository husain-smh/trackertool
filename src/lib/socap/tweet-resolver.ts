import { fetchTweetDetails, TwitterApiError } from '../external-api';

/**
 * Extract tweet ID from Twitter URL
 * Supports both twitter.com and x.com URLs
 */
export function extractTweetIdFromUrl(url: string): string | null {
  try {
    // Remove any query parameters
    const cleanUrl = url.split('?')[0];
    
    // Match patterns like:
    // https://twitter.com/username/status/1234567890
    // https://x.com/username/status/1234567890
    // twitter.com/username/status/1234567890
    const patterns = [
      /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/,
      /status\/(\d+)/,
    ];
    
    for (const pattern of patterns) {
      const match = cleanUrl.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting tweet ID from URL:', error);
    return null;
  }
}

/**
 * Validate and resolve tweet URL to tweet ID and metadata
 */
export interface ResolvedTweet {
  tweet_id: string;
  tweet_url: string;
  text?: string;
  author_name: string;
  author_username: string;
}

export async function resolveTweetUrl(url: string): Promise<ResolvedTweet> {
  // Extract tweet ID
  const tweetId = extractTweetIdFromUrl(url);
  
  if (!tweetId) {
    throw new Error(`Invalid tweet URL: ${url}`);
  }
  
  // Fetch tweet details from API to validate it exists
  try {
    const tweetDetails = await fetchTweetDetails(tweetId);
    
    return {
      tweet_id: tweetId,
      tweet_url: url,
      text: tweetDetails.text,
      author_name: tweetDetails.authorName || 'Unknown',
      author_username: tweetDetails.authorUsername || 'unknown',
    };
  } catch (error) {
    if (error instanceof TwitterApiError) {
      if (error.statusCode === 404) {
        throw new Error(`Tweet not found: ${url}`);
      }
      throw new Error(`Failed to fetch tweet: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Resolve multiple tweet URLs in parallel (with rate limiting)
 */
export async function resolveTweetUrls(urls: string[]): Promise<ResolvedTweet[]> {
  const results: ResolvedTweet[] = [];
  const errors: Array<{ url: string; error: string }> = [];
  
  // Process in batches to avoid overwhelming the API
  const batchSize = 5;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (url) => {
      try {
        return await resolveTweetUrl(url);
      } catch (error) {
        errors.push({
          url,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return null;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter((r): r is ResolvedTweet => r !== null));
    
    // Small delay between batches to respect rate limits
    if (i + batchSize < urls.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  
  if (errors.length > 0) {
    console.warn('Some tweets failed to resolve:', errors);
  }
  
  return results;
}

