/**
 * Advanced Search (twitterapi.io)
 *
 * Endpoint (documented in `apiadvancesearch.md`):
 *   GET /twitter/tweet/advanced_search?query=<...>&queryType=Latest|Top&cursor=<...>
 *
 * This module is used by:
 * - Next API routes: `/api/twitter/advanced-search` and `/api/twitter/advanced-search/export`
 * - CLI script: `scripts/advanced-search-export.ts`
 */

import { getTwitterApiKey, type TwitterApiKeyType } from './config/twitter-api-config';
import { TwitterApiError } from './external-api';
import https from 'node:https';
import { URL } from 'node:url';

export type AdvancedSearchQueryType = 'Latest' | 'Top';

export type AdvancedSearchTweet = {
  type?: string;
  id: string;
  url?: string;
  text?: string;
  source?: string;
  createdAt?: string;
  lang?: string;

  likeCount?: number;
  replyCount?: number;
  retweetCount?: number;
  quoteCount?: number;
  viewCount?: number;
  bookmarkCount?: number;

  // Reply/thread metadata (present when tweet is a reply)
  isReply?: boolean;
  inReplyToId?: string;
  conversationId?: string;
  inReplyToUserId?: string;
  inReplyToUsername?: string;

  author?: {
    type?: string;
    id?: string;
    userName?: string;
    username?: string;
    screen_name?: string;
    name?: string;
    url?: string;
    profilePicture?: string;
    isBlueVerified?: boolean;
    verified?: boolean;
  };
};

export type AdvancedSearchPageResponse = {
  tweets: AdvancedSearchTweet[];
  has_next_page: boolean;
  next_cursor: string;
};

export type AdvancedSearchBulkResponse = {
  tweets: AdvancedSearchTweet[];
  meta: {
    pagesFetched: number;
    stoppedBecause: 'completed' | 'maxPages' | 'maxTweets' | 'cursorMissing' | 'cursorLoop';
  };
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function coerceString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function parseNextCursor(payload: any): string {
  return coerceString(payload?.next_cursor ?? payload?.nextCursor ?? '');
}

function parseHasNextPage(payload: any): boolean {
  // twitterapi.io uses `has_next_page` (snake). Some endpoints may use camel.
  if (typeof payload?.has_next_page === 'boolean') return payload.has_next_page;
  if (typeof payload?.hasNextPage === 'boolean') return payload.hasNextPage;
  return false;
}

function parseTweets(payload: any): AdvancedSearchTweet[] {
  const raw = payload?.tweets;
  if (!Array.isArray(raw)) return [];
  // We keep a light runtime guard here; callers can still access extra fields via `as any`.
  return raw.filter((t) => t && typeof t.id === 'string');
}

type CloudflareDnsJsonResponse = {
  Status?: number;
  Answer?: Array<{ name?: string; type?: number; TTL?: number; data?: string }>;
};

function isLikelyIpv4(value: string): boolean {
  if (!value) return false;
  const parts = value.trim().split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  return true;
}

let cachedDohA: { hostname: string; ip: string; expiresAtMs: number } | null = null;
let preferDohForTwitterApiIo = false;

async function resolveAWithCloudflareDoh(hostname: string): Promise<string | null> {
  const now = Date.now();
  if (cachedDohA && cachedDohA.hostname === hostname && cachedDohA.expiresAtMs > now) {
    return cachedDohA.ip;
  }
  const dohUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
  const res = await fetch(dohUrl, { headers: { accept: 'application/dns-json' } });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as CloudflareDnsJsonResponse | null;
  const answers = Array.isArray(json?.Answer) ? json!.Answer! : [];
  const ips = answers
    .filter((a) => a?.type === 1 && typeof a?.data === 'string')
    .map((a) => String(a.data).trim())
    .filter(isLikelyIpv4);
  const ip = ips[0] ?? null;
  if (ip) {
    cachedDohA = { hostname, ip, expiresAtMs: now + 10 * 60 * 1000 };
  }
  return ip;
}

function isTlsCertVerifyError(err: any): boolean {
  const code = err?.cause?.code ?? err?.code;
  const msg = String(err?.cause?.message ?? err?.message ?? '');
  return (
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    msg.includes('unable to verify the first certificate') ||
    msg.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE') ||
    msg.includes('Could not establish trust relationship') ||
    msg.includes('self signed certificate')
  );
}

function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function httpsGetText(inputUrl: string, opts: { headers: Record<string, string>; timeoutMs: number; lookupIp?: string | null }) {
  const u = new URL(inputUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const result = await new Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }>(
      (resolve, reject) => {
        const lookup =
          opts.lookupIp && isLikelyIpv4(opts.lookupIp)
            ? ((_: string, optionsOrCb: any, maybeCb?: any) => {
                const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
                const options = typeof optionsOrCb === 'function' ? undefined : optionsOrCb;
                if (typeof cb !== 'function') throw new Error('lookup callback missing');
                if (options?.all) {
                  cb(null, [{ address: opts.lookupIp, family: 4 }]);
                  return;
                }
                cb(null, opts.lookupIp, 4);
              })
            : undefined;

        const req = https.request(
          {
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port ? Number(u.port) : undefined,
            path: `${u.pathname}${u.search}`,
            method: 'GET',
            headers: opts.headers,
            signal: controller.signal,
            lookup,
            servername: u.hostname,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
            res.on('end', () => {
              const body = Buffer.concat(chunks).toString('utf8');
              resolve({ statusCode: res.statusCode ?? 0, body, headers: res.headers as any });
            });
          }
        );

        req.on('error', reject);
        req.end();
      }
    );

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchTextWithTimeoutOrDoh(url: string, apiKey: string, timeoutMs: number): Promise<{
  statusCode: number;
  body: string;
  header: (name: string) => string | null;
}> {
  const headers = {
    'X-API-Key': apiKey,
    'Content-Type': 'application/json',
  };

  // Fast path: normal fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    const body = await res.text().catch(() => '');
    const header = (name: string) => res.headers.get(name);
    return { statusCode: res.status, body, header };
  } catch (error) {
    clearTimeout(timeoutId);

    // If local env has TLS/DNS issues, fall back for api.twitterapi.io using DoH + forced IP.
    try {
      const u = new URL(url);
      if (u.hostname === 'api.twitterapi.io' && (isTlsCertVerifyError(error) || true)) {
        // (the `|| true` is intentional: "fetch failed" often hides the real cause; DoH fallback is safe here)
        preferDohForTwitterApiIo = true;
        const ip =
          preferDohForTwitterApiIo && u.hostname === 'api.twitterapi.io'
            ? await resolveAWithCloudflareDoh(u.hostname)
            : null;
        const resp = await httpsGetText(url, { headers, timeoutMs, lookupIp: ip || undefined });
        const header = (name: string) => {
          const key = name.toLowerCase();
          const v = (resp.headers as any)?.[key];
          if (Array.isArray(v)) return String(v[0] ?? '');
          return typeof v === 'string' ? v : null;
        };
        return { statusCode: resp.statusCode, body: resp.body, header };
      }
    } catch {
      // ignore and rethrow below
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch a single advanced search page (up to ~20 tweets), using cursor pagination.
 */
export async function fetchAdvancedSearchPage(opts: {
  query: string;
  queryType: AdvancedSearchQueryType;
  cursor?: string;
  retries?: number;
  keyType?: TwitterApiKeyType;
}): Promise<AdvancedSearchPageResponse> {
  const query = opts.query.trim();
  const queryType: AdvancedSearchQueryType = opts.queryType === 'Top' ? 'Top' : 'Latest';
  const cursor = opts.cursor ?? '';
  const retries = typeof opts.retries === 'number' ? Math.max(0, Math.floor(opts.retries)) : 1;
  const keyType = opts.keyType ?? 'shared';

  if (!query) {
    throw new TwitterApiError('Missing query for advanced search', 400, false, 'VALIDATION_ERROR', {
      operation: 'advanced_search',
    });
  }

  const apiKey = getTwitterApiKey(keyType);
  if (!apiKey) {
    throw new TwitterApiError(
      'Twitter API key is not configured. Set TWITTER_API_KEY_MONITOR, TWITTER_API_KEY_SHARED, or TWITTER_API_KEY.',
      500,
      false,
      'CONFIG_ERROR',
      { operation: 'advanced_search' }
    );
  }

  const apiUrl = process.env.TWITTER_API_URL || 'https://api.twitterapi.io';
  const params = new URLSearchParams({
    query,
    queryType,
    cursor,
  });
  const url = `${apiUrl}/twitter/tweet/advanced_search?${params.toString()}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchTextWithTimeoutOrDoh(url, apiKey, 45000);

      if (res.statusCode === 429) {
        const retryAfter = parseInt(res.header('Retry-After') || '5', 10);
        if (attempt < retries) {
          await sleep(Math.max(1, retryAfter) * 1000);
          continue;
        }
        throw new TwitterApiError('Twitter API rate limit exceeded. Please try again later.', 429, true, 'RATE_LIMIT', {
          operation: 'advanced_search',
          retryAfter,
        });
      }

      if (res.statusCode === 401 || res.statusCode === 403) {
        throw new TwitterApiError('Twitter API authentication failed. Please check your API key.', res.statusCode, false, 'AUTH_ERROR', {
          operation: 'advanced_search',
        });
      }

      if (res.statusCode === 402) {
        const errorData = safeJsonParse<any>(res.body || '{}', {});
        const message = (errorData as any)?.message || 'Twitter API credits exhausted';
        throw new TwitterApiError(`Twitter API credits insufficient: ${message}. Please recharge your account.`, 402, false, 'CREDITS_EXHAUSTED', {
          operation: 'advanced_search',
        });
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new TwitterApiError(`Twitter API responded with status ${res.statusCode}: ${res.body || 'Unknown error'}`, res.statusCode, res.statusCode >= 500, 'API_ERROR', {
          operation: 'advanced_search',
        });
      }

      const payload = safeJsonParse<any>(res.body || '{}', {});
      const tweets = parseTweets(payload);
      const has_next_page = parseHasNextPage(payload);
      const next_cursor = parseNextCursor(payload);

      return { tweets, has_next_page, next_cursor };
    } catch (error) {
      // Non-retryable TwitterApiError: fail fast.
      if (error instanceof TwitterApiError && !error.isRetryable) {
        throw error;
      }

      // Retry on network/timeout or retryable TwitterApiError
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const isFetchNetwork = error instanceof TypeError && error.message.includes('fetch');
      const isRetryableApi = error instanceof TwitterApiError && error.isRetryable;

      if ((isAbort || isFetchNetwork || isRetryableApi) && attempt < retries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }

      throw error instanceof TwitterApiError
        ? error
        : new TwitterApiError(
            error instanceof Error ? error.message : 'Failed to fetch advanced search results',
            500,
            true,
            'UNKNOWN_ERROR',
            { operation: 'advanced_search' }
          );
    }
  }

  // Should be unreachable
  throw new TwitterApiError('Failed to fetch advanced search results after retries', 500, true, 'UNKNOWN_ERROR', {
    operation: 'advanced_search',
  });
}

/**
 * Bulk advanced search: paginate with cursors until caps are hit.
 * Returns a single list of unique tweets by id.
 */
export async function fetchAdvancedSearchBulk(opts: {
  query: string;
  queryType: AdvancedSearchQueryType;
  maxPages: number;
  maxTweets: number;
  pageDelayMs?: number;
  keyType?: TwitterApiKeyType;
}): Promise<AdvancedSearchBulkResponse> {
  const query = opts.query.trim();
  const queryType: AdvancedSearchQueryType = opts.queryType === 'Top' ? 'Top' : 'Latest';
  const maxPages = Math.max(1, Math.floor(opts.maxPages));
  const maxTweets = Math.max(1, Math.floor(opts.maxTweets));
  const pageDelayMs = Math.max(0, Math.floor(opts.pageDelayMs ?? 350));
  const keyType = opts.keyType ?? 'shared';

  const tweets: AdvancedSearchTweet[] = [];
  const seen = new Set<string>();

  let cursor = '';
  let pagesFetched = 0;
  let stoppedBecause: AdvancedSearchBulkResponse['meta']['stoppedBecause'] = 'completed';

  // A safety limiter to avoid infinite loops.
  while (true) {
    if (pagesFetched >= maxPages) {
      stoppedBecause = 'maxPages';
      break;
    }
    if (seen.size >= maxTweets) {
      stoppedBecause = 'maxTweets';
      break;
    }

    const page = await fetchAdvancedSearchPage({
      query,
      queryType,
      cursor,
      retries: 2,
      keyType,
    });

    pagesFetched += 1;

    for (const t of page.tweets) {
      if (!t?.id) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      tweets.push(t);
      if (seen.size >= maxTweets) break;
    }

    const hasNext = Boolean(page.has_next_page);
    const nextCursor = page.next_cursor || '';

    if (!hasNext) {
      stoppedBecause = 'completed';
      break;
    }
    if (!nextCursor) {
      stoppedBecause = 'cursorMissing';
      break;
    }
    if (nextCursor === cursor) {
      stoppedBecause = 'cursorLoop';
      break;
    }

    cursor = nextCursor;
    if (pageDelayMs > 0) {
      await sleep(pageDelayMs);
    }
  }

  return {
    tweets,
    meta: {
      pagesFetched,
      stoppedBecause,
    },
  };
}

