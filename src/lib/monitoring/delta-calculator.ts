/**
 * Delta Calculator - Calculates the difference between previous and current metrics
 * to determine how many new engagers need to be fetched
 */

export interface DeltaResult {
  actionType: 'reply' | 'retweet' | 'quote' | 'like';
  previousCount: number;
  currentCount: number;
  delta: number;
  pagesNeeded: number;
  shouldFetch: boolean;
}

export interface PaginationConfig {
  pageSize: number;
  maxPages: number;
  bufferMultiplier?: number; // Extra pages to fetch for safety (default: 1.2)
}

// Default pagination configurations per action type
export const PAGINATION_CONFIG: Record<'reply' | 'retweet' | 'quote' | 'like', PaginationConfig> = {
  reply: { pageSize: 20, maxPages: 10 },
  retweet: { pageSize: 20, maxPages: 15 },
  quote: { pageSize: 20, maxPages: 12 },
  like: { pageSize: 100, maxPages: 5 },
};

/**
 * Calculate delta and determine if fetching is needed
 */
export function calculateDelta(
  actionType: 'reply' | 'retweet' | 'quote' | 'like',
  prevCount: number,
  currentCount: number,
  config?: Partial<PaginationConfig>
): DeltaResult {
  const defaultConfig = PAGINATION_CONFIG[actionType];
  const pageSize = config?.pageSize ?? defaultConfig.pageSize;
  const maxPages = config?.maxPages ?? defaultConfig.maxPages;
  const bufferMultiplier = config?.bufferMultiplier ?? 1.2;

  const delta = Math.max(0, currentCount - prevCount);

  // Calculate pages needed with buffer
  // We fetch a bit more than strictly needed to catch any missed engagers
  let pagesNeeded = 0;
  if (delta > 0) {
    const rawPagesNeeded = Math.ceil(delta / pageSize);
    pagesNeeded = Math.min(
      Math.ceil(rawPagesNeeded * bufferMultiplier),
      maxPages
    );
  }

  return {
    actionType,
    previousCount: prevCount,
    currentCount,
    delta,
    pagesNeeded,
    shouldFetch: delta > 0,
  };
}

/**
 * Calculate deltas for all action types at once
 */
export function calculateAllDeltas(
  prevMetrics: {
    replyCount: number;
    retweetCount: number;
    quoteCount: number;
    likeCount: number;
  },
  currentMetrics: {
    replyCount: number;
    retweetCount: number;
    quoteCount: number;
    likeCount: number;
  }
): Record<'reply' | 'retweet' | 'quote' | 'like', DeltaResult> {
  return {
    reply: calculateDelta('reply', prevMetrics.replyCount, currentMetrics.replyCount),
    retweet: calculateDelta('retweet', prevMetrics.retweetCount, currentMetrics.retweetCount),
    quote: calculateDelta('quote', prevMetrics.quoteCount, currentMetrics.quoteCount),
    like: calculateDelta('like', prevMetrics.likeCount, currentMetrics.likeCount),
  };
}

/**
 * Check if likers should be fetched based on last fetch time
 * Likers have a 30-minute interval due to OAuth rate limits
 */
export function shouldFetchLikers(
  lastFetchedAt: Date | undefined,
  intervalMinutes: number = 30
): boolean {
  if (!lastFetchedAt) return true;

  const now = new Date();
  const elapsed = now.getTime() - new Date(lastFetchedAt).getTime();
  const intervalMs = intervalMinutes * 60 * 1000;

  return elapsed >= intervalMs;
}

/**
 * Summarize deltas for logging
 */
export function summarizeDeltas(
  deltas: Record<'reply' | 'retweet' | 'quote' | 'like', DeltaResult>
): string {
  const parts: string[] = [];

  for (const [type, result] of Object.entries(deltas)) {
    if (result.shouldFetch) {
      parts.push(`${type}: +${result.delta} (${result.pagesNeeded} pages)`);
    }
  }

  if (parts.length === 0) {
    return 'No new engagements detected';
  }

  return parts.join(', ');
}
