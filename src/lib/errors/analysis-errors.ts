/**
 * Custom error classes for tweet analysis
 */

export class TweetNotFoundError extends Error {
  constructor(
    public tweetId: string,
    message?: string
  ) {
    super(message || `Tweet with ID ${tweetId} not found`);
    this.name = 'TweetNotFoundError';
  }
}

export class RateLimitError extends Error {
  constructor(
    public retryAfter?: number,
    message?: string
  ) {
    super(message || 'Twitter API rate limit exceeded');
    this.name = 'RateLimitError';
  }
}

export class AnalysisTimeoutError extends Error {
  constructor(
    public tweetId: string,
    message?: string
  ) {
    super(message || `Analysis timeout for tweet ${tweetId}`);
    this.name = 'AnalysisTimeoutError';
  }
}

export class ProcessingError extends Error {
  constructor(
    public tweetId: string,
    public operation: string,
    message?: string
  ) {
    super(message || `Processing error for tweet ${tweetId} during ${operation}`);
    this.name = 'ProcessingError';
  }
}

