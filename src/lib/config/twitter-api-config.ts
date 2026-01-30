/**
 * Centralized configuration for Twitter API client
 * 
 * Supports multiple API keys for rate limit distribution (Hybrid approach):
 * - TWITTER_API_KEY_MONITOR: Dedicated key for monitoring (protected, always available)
 * - TWITTER_API_KEY_SHARED: Shared key for batch operations (jobs, narratives, aggregates)
 * - TWITTER_API_KEY: Fallback for backward compatibility
 */

export type TwitterApiKeyType = 'monitor' | 'shared';

export interface TwitterApiConfig {
  apiUrl: string;
  apiKey: string;
  rateLimitDelay: number; // ms between requests
  requestTimeout: number; // ms
  maxRetries: number;
  retryDelay: number; // ms
  qpsLimit: number;
  maxPages: {
    replies: number;
    retweets: number;
    quotes: number;
  };
}

/**
 * Get the appropriate API key based on the key type.
 * 
 * Key Priority:
 * - 'monitor': TWITTER_API_KEY_MONITOR → TWITTER_API_KEY (fallback)
 * - 'shared': TWITTER_API_KEY_SHARED → TWITTER_API_KEY (fallback)
 * 
 * This allows gradual migration: if specific keys aren't set, falls back to original.
 */
export function getTwitterApiKey(keyType: TwitterApiKeyType = 'shared'): string {
  if (keyType === 'monitor') {
    // Dedicated key for monitoring - protected from batch operations
    return process.env.TWITTER_API_KEY_MONITOR || process.env.TWITTER_API_KEY || '';
  }
  
  // Shared key for batch operations (jobs, narratives, aggregates)
  return process.env.TWITTER_API_KEY_SHARED || process.env.TWITTER_API_KEY || '';
}

/**
 * Get Twitter API configuration with the appropriate key type
 */
export function getTwitterApiConfig(keyType: TwitterApiKeyType = 'shared'): TwitterApiConfig {
  return {
    apiUrl: process.env.TWITTER_API_URL || 'https://api.twitterapi.io',
    apiKey: getTwitterApiKey(keyType),
    rateLimitDelay: 500, // 500ms between paginated requests
    requestTimeout: 30000, // 30 seconds
    maxRetries: 3,
    retryDelay: 2000, // 2 seconds
    qpsLimit: parseInt(process.env.TWITTER_QPS_LIMIT || '5', 10),
    maxPages: {
      replies: 50,
      retweets: 75,
      quotes: 60,
    },
  };
}

/**
 * Log which API key type is being used (for debugging)
 */
export function logApiKeyUsage(keyType: TwitterApiKeyType, operation: string): void {
  const hasMonitorKey = !!process.env.TWITTER_API_KEY_MONITOR;
  const hasSharedKey = !!process.env.TWITTER_API_KEY_SHARED;
  const hasFallbackKey = !!process.env.TWITTER_API_KEY;
  
  const keySource = keyType === 'monitor'
    ? (hasMonitorKey ? 'MONITOR_KEY' : 'FALLBACK')
    : (hasSharedKey ? 'SHARED_KEY' : 'FALLBACK');
  
  console.log(`[twitter-api] ${operation} using ${keyType.toUpperCase()} key (source: ${keySource})`);
}

