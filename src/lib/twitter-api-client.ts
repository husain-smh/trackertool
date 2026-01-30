/**
 * Twitter API Client - Handles fetching replies, retweets, and quotes
 * with pagination, rate limiting, and immediate data transformation
 * 
 * Supports hybrid API key strategy:
 * - 'monitor' key: Dedicated for monitoring (protected)
 * - 'shared' key: For batch operations (jobs, narratives, aggregates)
 */

import { TwitterApiError } from './external-api';
import { getTwitterApiConfig, type TwitterApiKeyType } from './config/twitter-api-config';
import { RateLimitError } from './errors/analysis-errors';

export interface FilteredUser {
  userId: string;
  username: string | null;
  name: string | null;
  followers: number;
  verified: boolean;
  bio: string | null;
  location: string | null;
  accountCreatedAt?: Date; // When the user account was created
  engagementCreatedAt?: Date; // When the engagement (reply/retweet/quote) was created
  engagementId?: string;
  engagementText?: string;
  /**
   * For quote tweet flows (SOCAP), this optionally carries the viewCount of the
   * specific quote tweet that produced this engagement. Other flows ignore it.
   */
  quoteViewCount?: number;
  /**
   * Optional full metrics for a quote tweet when available.
   */
  quoteMetrics?: {
    viewCount?: number;
    likeCount?: number;
    retweetCount?: number;
    replyCount?: number;
    quoteCount?: number;
    bookmarkCount?: number;
  };
  /**
   * For quote tweet flows, the ID of the tweet that this quote is quoting
   * (when provided by the upstream API). This allows callers to decide whether
   * to enforce strict matching to a specific parent tweet.
   */
  quotedTweetId?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  hasMore: boolean;
  nextCursor?: string;
  totalFetched: number;
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let nextAvailableTime = 0;
let limiterChain: Promise<void> = Promise.resolve();

async function scheduleGlobalRateLimit(config: ReturnType<typeof getTwitterApiConfig>): Promise<void> {
  const qps = Math.max(0, config.qpsLimit || 0);
  if (qps <= 0) {
    return;
  }

  const interval = Math.ceil(1000 / qps);

  let release: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });

  const previous = limiterChain;
  limiterChain = previous.then(() => current);

  await previous;

  const now = Date.now();
  const waitTime = Math.max(0, nextAvailableTime - now);
  nextAvailableTime = Math.max(now, nextAvailableTime) + interval;

  release!();

  if (waitTime > 0) {
    await sleep(waitTime);
  }
}

/**
 * Make API request with retry logic
 */
export async function makeApiRequest(
  url: string,
  config: ReturnType<typeof getTwitterApiConfig>,
  retries = 0
): Promise<any> {
  await scheduleGlobalRateLimit(config);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.requestTimeout);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
      if (retries < config.maxRetries) {
        await sleep(retryAfter * 1000);
        return makeApiRequest(url, config, retries + 1);
      }
      throw new RateLimitError(retryAfter, 'Twitter API rate limit exceeded');
    }

    if (response.status === 404) {
      throw new TwitterApiError(
        'Tweet not found',
        404,
        false,
        'TWEET_NOT_FOUND'
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new TwitterApiError(
        'Twitter API authentication failed',
        response.status,
        false,
        'AUTH_ERROR'
      );
    }

    if (response.status === 402) {
      const errorData = await response.json().catch(() => ({}));
      throw new TwitterApiError(
        errorData.message || 'Twitter API credits exhausted',
        402,
        false,
        'CREDITS_EXHAUSTED'
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new TwitterApiError(
        `Twitter API error: ${errorText}`,
        response.status,
        response.status >= 500,
        'API_ERROR'
      );
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof TwitterApiError || error instanceof RateLimitError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      if (retries < config.maxRetries) {
        await sleep(config.retryDelay);
        return makeApiRequest(url, config, retries + 1);
      }
      throw new TwitterApiError(
        'Request timeout',
        0,
        true,
        'TIMEOUT'
      );
    }

    if (retries < config.maxRetries) {
      await sleep(config.retryDelay);
      return makeApiRequest(url, config, retries + 1);
    }

    throw new TwitterApiError(
      error instanceof Error ? error.message : 'Unknown error',
      500,
      true,
      'UNKNOWN_ERROR'
    );
  }
}

/**
 * Parse createdAt string to Date object
 */
function parseCreatedAt(createdAt: string | undefined): Date | undefined {
  if (!createdAt) return undefined;
  try {
    const date = new Date(createdAt);
    return isNaN(date.getTime()) ? undefined : date;
  } catch {
    return undefined;
  }
}

/**
 * Transform tweet author to FilteredUser
 */
function transformTweetAuthor(author: any, engagementCreatedAt?: string): FilteredUser | null {
  if (!author || !author.id) return null;

  const isVerified = author.isBlueVerified !== undefined
    ? Boolean(author.isBlueVerified)
    : Boolean(author.verified);

  return {
    userId: author.id,
    username: author.userName || author.username || author.screen_name || null,
    name: author.name || null,
    followers: parseInt(author.followers || author.followers_count || '0', 10) || 0,
    verified: isVerified,
    bio: author.profile_bio?.description || null,
    location: author.location || null,
    accountCreatedAt: parseCreatedAt(author.createdAt),
    engagementCreatedAt: engagementCreatedAt ? parseCreatedAt(engagementCreatedAt) : undefined,
  };
}

/**
 * Transform user object to FilteredUser
 */
function transformUser(user: any, engagementCreatedAt?: string): FilteredUser | null {
  if (!user || !user.id) return null;

  const isVerified = user.isBlueVerified !== undefined
    ? Boolean(user.isBlueVerified)
    : Boolean(user.verified);

  return {
    userId: user.id,
    username: user.userName || user.username || user.screen_name || null,
    name: user.name || null,
    followers: parseInt(user.followers || user.followers_count || '0', 10) || 0,
    verified: isVerified,
    bio: user.description || null,
    location: user.location || null,
    accountCreatedAt: parseCreatedAt(user.createdAt),
    engagementCreatedAt: engagementCreatedAt ? parseCreatedAt(engagementCreatedAt) : undefined,
  };
}

/**
 * Fetch tweet replies with pagination
 * 
 * @param tweetId - The tweet ID to fetch replies for
 * @param options - Configuration options
 * @param options.maxPages - Maximum pages to fetch
 * @param options.cursor - Pagination cursor
 * @param options.requestIntervalMs - Delay between requests
 * @param options.keyType - Which API key to use: 'monitor' (dedicated) or 'shared' (batch operations)
 */
export async function fetchTweetReplies(
  tweetId: string,
  options: {
    maxPages?: number;
    cursor?: string;
    requestIntervalMs?: number;
    keyType?: TwitterApiKeyType;
  } = {}
): Promise<PaginatedResponse<FilteredUser>> {
  const keyType = options.keyType ?? 'shared';
  const config = getTwitterApiConfig(keyType);
  const maxPages = options.maxPages || config.maxPages.replies;
  const requestIntervalMs = options.requestIntervalMs ?? config.rateLimitDelay;
  
  if (!config.apiKey) {
    throw new TwitterApiError(
      'TWITTER_API_KEY not configured',
      500,
      false,
      'CONFIG_ERROR'
    );
  }

  const allUsers: FilteredUser[] = [];
  let currentCursor = options.cursor;
  let pagesFetched = 0;
  let hasMore = true;

  while (hasMore && pagesFetched < maxPages) {
    const url = new URL(`${config.apiUrl}/twitter/tweet/replies`);
    url.searchParams.set('tweetId', tweetId);
    if (currentCursor) {
      url.searchParams.set('cursor', currentCursor);
    }

    const data = await makeApiRequest(url.toString(), config);

    // Transform and filter data immediately
    // Support both 'replies' and 'tweets' response formats
    const replies = data.replies || data.tweets || [];
    if (Array.isArray(replies)) {
      for (const reply of replies) {
        if (reply.author) {
          const user = transformTweetAuthor(reply.author, reply.createdAt);
          if (user) {
            // Store the reply tweet ID as engagementId
            allUsers.push({
              ...user,
              engagementId: reply.id,
              engagementText: reply.text || undefined,
            });
          }
        }
      }
    }

    // Check if there's more data
    currentCursor = data.next_cursor;
    hasMore = replies.length > 0 && !!currentCursor;

    pagesFetched++;

    // Rate limiting delay between pages
    if (hasMore && pagesFetched < maxPages) {
      await sleep(requestIntervalMs);
    }
  }

  return {
    data: allUsers,
    hasMore,
    nextCursor: currentCursor,
    totalFetched: allUsers.length,
  };
}

/**
 * Fetch tweet retweets with pagination
 * 
 * @param tweetId - The tweet ID to fetch retweets for
 * @param options - Configuration options
 * @param options.maxPages - Maximum pages to fetch
 * @param options.cursor - Pagination cursor
 * @param options.keyType - Which API key to use: 'monitor' (dedicated) or 'shared' (batch operations)
 */
export async function fetchTweetRetweets(
  tweetId: string,
  options: {
    maxPages?: number;
    cursor?: string;
    keyType?: TwitterApiKeyType;
  } = {}
): Promise<PaginatedResponse<FilteredUser>> {
  const keyType = options.keyType ?? 'shared';
  const config = getTwitterApiConfig(keyType);
  const maxPages = options.maxPages || config.maxPages.retweets;
  
  if (!config.apiKey) {
    throw new TwitterApiError(
      'TWITTER_API_KEY not configured',
      500,
      false,
      'CONFIG_ERROR'
    );
  }

  const allUsers: FilteredUser[] = [];
  let currentCursor = options.cursor;
  let pagesFetched = 0;
  let hasMore = true;

  while (hasMore && pagesFetched < maxPages) {
    const url = new URL(`${config.apiUrl}/twitter/tweet/retweeters`);
    url.searchParams.set('tweetId', tweetId);
    if (currentCursor) {
      url.searchParams.set('cursor', currentCursor);
    }

    const data = await makeApiRequest(url.toString(), config);

    // Transform and filter data immediately
    // Retweeters API returns users[] array
    // NOTE: The user.createdAt is their account creation date, NOT when they retweeted
    // The API doesn't provide retweet timestamp, so we can't extract when the retweet happened
    if (data.users && Array.isArray(data.users)) {
      for (const user of data.users) {
        const filteredUser = transformUser(user);
        if (filteredUser) {
          allUsers.push(filteredUser);
        }
      }
    }

    // Check if there's more data
    currentCursor = data.next_cursor;
    hasMore = data.users && data.users.length > 0 && !!currentCursor;

    pagesFetched++;

    // Rate limiting delay between pages
    if (hasMore && pagesFetched < maxPages) {
      await sleep(config.rateLimitDelay);
    }
  }

  return {
    data: allUsers,
    hasMore,
    nextCursor: currentCursor,
    totalFetched: allUsers.length,
  };
}

/**
 * Fetch tweet quotes with pagination
 * 
 * @param tweetId - The tweet ID to fetch quotes for
 * @param options - Configuration options
 * @param options.maxPages - Maximum pages to fetch
 * @param options.cursor - Pagination cursor
 * @param options.requestIntervalMs - Delay between requests
 * @param options.keyType - Which API key to use: 'monitor' (dedicated) or 'shared' (batch operations)
 */
export async function fetchTweetQuotes(
  tweetId: string,
  options: {
    maxPages?: number;
    cursor?: string;
    requestIntervalMs?: number;
    keyType?: TwitterApiKeyType;
  } = {}
): Promise<PaginatedResponse<FilteredUser>> {
  const keyType = options.keyType ?? 'shared';
  const config = getTwitterApiConfig(keyType);
  const maxPages = options.maxPages || config.maxPages.quotes;
  const requestIntervalMs = options.requestIntervalMs ?? config.rateLimitDelay;
  
  if (!config.apiKey) {
    throw new TwitterApiError(
      'TWITTER_API_KEY not configured',
      500,
      false,
      'CONFIG_ERROR'
    );
  }

  const allUsers: FilteredUser[] = [];
  let currentCursor = options.cursor;
  let pagesFetched = 0;
  let hasMore = true;

  while (hasMore && pagesFetched < maxPages) {
    const pageNumber = pagesFetched + 1;
    const url = new URL(`${config.apiUrl}/twitter/tweet/quotes`);
    url.searchParams.set('tweetId', tweetId);
    if (currentCursor) {
      url.searchParams.set('cursor', currentCursor);
    }

    const data = await makeApiRequest(url.toString(), config);

    // Transform and filter data immediately
    // Quotes API returns tweets[] array, each tweet has createdAt (when quote was created)
    if (data.tweets && Array.isArray(data.tweets)) {
      for (const quoteTweet of data.tweets) {
        if (!quoteTweet.author) continue;

        // Capture which tweet this quote is quoting (if provided by the API).
        // Callers can choose whether to enforce strict matching to tweetId or not.
        const quotedTweetId = (quoteTweet as any).quoted_tweet?.id || 
                              (quoteTweet as any).quotedTweet?.id ||
                              (quoteTweet as any).quoted_tweet?.id_str ||
                              (quoteTweet as any).quotedTweet?.id_str;

        // quoteTweet.createdAt is when the quote tweet was created
        const user = transformTweetAuthor(quoteTweet.author, quoteTweet.createdAt);
        if (!user) continue;

        // Extract viewCount (number or string per twitterapi.io examples)
        let quoteViewCount = 0;
        const rawViewCount = (quoteTweet as any).viewCount;
        if (typeof rawViewCount === 'number') {
          quoteViewCount = rawViewCount;
        } else if (typeof rawViewCount === 'string') {
          const parsed = parseInt(rawViewCount, 10);
          quoteViewCount = Number.isNaN(parsed) ? 0 : parsed;
        }

        // Collect other metrics when present
        const quoteMetrics = {
          viewCount: quoteViewCount,
          likeCount: typeof (quoteTweet as any).likeCount === 'number' ? (quoteTweet as any).likeCount : undefined,
          retweetCount: typeof (quoteTweet as any).retweetCount === 'number' ? (quoteTweet as any).retweetCount : undefined,
          replyCount: typeof (quoteTweet as any).replyCount === 'number' ? (quoteTweet as any).replyCount : undefined,
          quoteCount: typeof (quoteTweet as any).quoteCount === 'number' ? (quoteTweet as any).quoteCount : undefined,
          bookmarkCount: typeof (quoteTweet as any).bookmarkCount === 'number' ? (quoteTweet as any).bookmarkCount : undefined,
        };

        allUsers.push({
          ...user,
          engagementId: quoteTweet.id,
          engagementText: quoteTweet.text || undefined,
          quoteViewCount,
          quoteMetrics,
          quotedTweetId,
        });
      }
    }

    // Check if there's more data (align with follower pagination behavior)
    const tweetsLen = Array.isArray(data.tweets) ? data.tweets.length : 0;
    const nextCursor =
      data.next_cursor ??
      data.nextCursor ??
      (data.meta && data.meta.next_token) ??
      null;
    const hasNextPageFlag =
      data.has_next_page !== undefined ? Boolean(data.has_next_page) : data.hasNextPage ?? true;

    // Debug pagination visibility to understand early stops
    console.log(
      `[fetchTweetQuotes] tweet=${tweetId} page=${pageNumber} tweets=${tweetsLen} next_cursor=${nextCursor ?? 'none'} has_next_page=${hasNextPageFlag}`
    );

    currentCursor = nextCursor || undefined;
    const cursorPresent = !!nextCursor;
    const shouldContinue = hasNextPageFlag && cursorPresent && tweetsLen > 0;
    hasMore = shouldContinue;
    if (!shouldContinue) {
      console.log(
        `[fetchTweetQuotes] stopping pagination for tweet=${tweetId} page=${pageNumber} (has_next_page=${hasNextPageFlag}, cursorPresent=${cursorPresent}, tweets=${tweetsLen})`
      );
    }

    pagesFetched++;

    // Rate limiting delay between pages
    if (hasMore && pagesFetched < maxPages) {
      await sleep(requestIntervalMs);
    }
  }

  return {
    data: allUsers,
    hasMore,
    nextCursor: currentCursor,
    totalFetched: allUsers.length,
  };
}

/**
 * Fetch user followers with pagination
 * 
 * @param username - The username to fetch followers for
 * @param options - Configuration options
 * @param options.maxPages - Maximum pages to fetch (default: unlimited/very high)
 * @param options.cursor - Pagination cursor
 * @param options.pageSize - Items per page (default: 200, max: 200)
 * @param options.requestIntervalMs - Delay between requests
 * @param options.keyType - Which API key to use
 */
export async function fetchUserFollowers(
  username: string,
  options: {
    maxPages?: number;
    cursor?: string;
    pageSize?: number;
    requestIntervalMs?: number;
    keyType?: TwitterApiKeyType;
  } = {}
): Promise<PaginatedResponse<FilteredUser>> {
  const keyType = options.keyType ?? 'shared';
  const config = getTwitterApiConfig(keyType);
  const maxPages = options.maxPages || 10000; // Default to high number for "all followers"
  const requestIntervalMs = options.requestIntervalMs ?? config.rateLimitDelay;
  const pageSize = options.pageSize || 200;
  
  if (!config.apiKey) {
    throw new TwitterApiError(
      'TWITTER_API_KEY not configured',
      500,
      false,
      'CONFIG_ERROR'
    );
  }

  const allUsers: FilteredUser[] = [];
  let currentCursor = options.cursor;
  let pagesFetched = 0;
  let hasMore = true;

  while (hasMore && pagesFetched < maxPages) {
    const pageNumber = pagesFetched + 1;
    const url = new URL(`${config.apiUrl}/twitter/user/followers`);
    url.searchParams.set('userName', username);
    if (currentCursor) {
      url.searchParams.set('cursor', currentCursor);
    }
    // API supports pageSize defaults to 200
    if (pageSize) {
      url.searchParams.set('pageSize', pageSize.toString());
    }

    const data = await makeApiRequest(url.toString(), config);

    const followers = data.followers || [];
    if (Array.isArray(followers)) {
      if (followers.length > 0 && pageNumber === 1) {
        console.log('DEBUG: First follower raw object keys:', Object.keys(followers[0]));
        console.log('DEBUG: First follower raw object:', JSON.stringify(followers[0], null, 2));
      }
      for (const follower of followers) {
        const user = transformUser(follower);
        if (user) {
          allUsers.push(user);
        }
      }
    }

    // Check for next cursor
    const nextCursor = data.next_cursor || data.nextCursor;
    currentCursor = nextCursor;
    
    // If no followers returned, we are done
    if (followers.length === 0 || !currentCursor) {
      hasMore = false;
    }

    console.log(
      `[fetchUserFollowers] user=${username} page=${pageNumber} followers=${followers.length} next_cursor=${nextCursor ?? 'none'}`
    );

    pagesFetched++;

    if (hasMore && pagesFetched < maxPages) {
      await sleep(requestIntervalMs);
    }
  }

  return {
    data: allUsers,
    hasMore,
    nextCursor: currentCursor,
    totalFetched: allUsers.length,
  };
}


