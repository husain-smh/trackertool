#!/usr/bin/env node

/**
 * Quote Tweeters Metrics Export
 *
 * Extracts all users who quote-tweeted a given tweet and computes
 * their average engagement metrics from their last 25 tweets.
 *
 * Usage:
 *   npx tsx scripts/quote-tweeters-metrics.ts --tweet <tweet_url_or_id> [options]
 *
 * Options:
 *   --tweet, -t     Tweet URL or ID to analyze (required)
 *   --output, -o    Output xlsx file (default: quote-tweeters.xlsx)
 *   --tweets        Number of tweets to analyze per user (default: 25)
 *   --concurrency   Parallel workers for user processing (default: 3)
 *   --qps           Queries per second limit (default: 10)
 *   --max-pages     Max pages to fetch for quote tweets (default: 100)
 *
 * Required env:
 *   - TWITTER_API_KEY_SHARED (or TWITTER_API_KEY)
 */

import 'dotenv/config';

import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { URL } from 'node:url';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

type TweetApiTweet = {
  id?: string;
  url?: string;
  text?: string;
  createdAt?: string;
  viewCount?: number | string;
  likeCount?: number | string;
  replyCount?: number | string;
  retweetCount?: number | string;
  quoteCount?: number | string;
  bookmarkCount?: number | string;
  isReply?: boolean;
  quoted_tweet?: unknown;
  retweeted_tweet?: unknown;
  author?: {
    id?: string;
    userName?: string;
    username?: string;
    name?: string;
    followers?: number | string;
    isBlueVerified?: boolean;
    verified?: boolean;
    description?: string;
    location?: string;
    createdAt?: string;
    profile_bio?: { description?: string };
  };
};

type UserInfoResponse = {
  data?: {
    userName?: string;
    url?: string;
    id?: string;
    userId?: string;
    followers?: number | string;
    description?: string;
    location?: string;
    isBlueVerified?: boolean;
    verified?: boolean;
    createdAt?: string;
  };
  status?: 'success' | 'error';
  msg?: string;
  message?: string;
};

type LastTweetsResponse = {
  tweets?: TweetApiTweet[];
  data?: {
    tweets?: TweetApiTweet[];
    has_next_page?: boolean;
    next_cursor?: string;
  };
  has_next_page?: boolean;
  next_cursor?: string;
  status?: 'success' | 'error';
  message?: string;
  msg?: string;
};

type QuotesResponse = {
  tweets?: TweetApiTweet[];
  has_next_page?: boolean;
  next_cursor?: string;
  status?: 'success' | 'error';
  message?: string;
  msg?: string;
};

type TweetType = 'original' | 'retweet' | 'quote' | 'reply';

type QuoteTweeterRow = {
  username: string;
  profile_url: string;
  user_id: string;
  followers: number;
  verified: boolean;
  bio: string;
  location: string;
  quote_tweet_id: string;
  quote_tweet_text: string;
  quote_tweet_views: number;
  quote_tweet_likes: number;
  quote_tweet_retweets: number;
  quote_tweet_at: string;
  tweets_used: number;
  newest_tweet_at: string;
  oldest_tweet_at: string;
  avg_views_25: number;
  median_views_25: number;
  avg_likes_25: number;
  median_likes_25: number;
  avg_retweets_25: number;
  median_retweets_25: number;
  avg_replies_25: number;
  median_replies_25: number;
  avg_quotes_25: number;
  median_quotes_25: number;
  pct_original: number;
  pct_retweet: number;
  pct_quote: number;
  error: string;
};

// -------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------

interface ScriptConfig {
  apiUrl: string;
  apiKey: string;
  rateLimitDelay: number;
  requestTimeout: number;
  maxRetries: number;
  retryDelay: number;
  qpsLimit: number;
}

function getConfig(qpsOverride?: number): ScriptConfig {
  const qps = qpsOverride ?? parseInt(process.env.TWITTER_QPS_LIMIT || '10', 10);
  return {
    apiUrl: process.env.TWITTER_API_URL || 'https://api.twitterapi.io',
    apiKey: process.env.TWITTER_API_KEY_SHARED || process.env.TWITTER_API_KEY || '',
    rateLimitDelay: Math.ceil(1000 / qps),
    requestTimeout: 30000,
    maxRetries: 3,
    retryDelay: 2000,
    qpsLimit: qps,
  };
}

// -------------------------------------------------------------------
// Utilities
// -------------------------------------------------------------------

function ts(): string {
  return new Date().toISOString();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  const a = sorted[mid - 1] ?? 0;
  const b = sorted[mid] ?? 0;
  return (a + b) / 2;
}

function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

// -------------------------------------------------------------------
// Rate Limiter
// -------------------------------------------------------------------

let limiterChain: Promise<void> = Promise.resolve();
let nextAvailableTime = 0;

async function scheduleRateLimit(config: ScriptConfig): Promise<void> {
  const qps = Math.max(1, config.qpsLimit);
  const interval = Math.ceil(1000 / qps);

  let release: () => void;
  const current = new Promise<void>((resolve) => {
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

// -------------------------------------------------------------------
// HTTP Client with TLS fallback
// -------------------------------------------------------------------

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

async function httpsGetText(
  inputUrl: string,
  opts: { headers: Record<string, string>; timeoutMs: number; lookupIp?: string | null }
) {
  const u = new URL(inputUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const result = await new Promise<{
      statusCode: number;
      body: string;
      headers: Record<string, string | string[] | undefined>;
    }>((resolve, reject) => {
      const lookup =
        opts.lookupIp && isLikelyIpv4(opts.lookupIp)
          ? ((_: string, optionsOrCb: any, maybeCb?: any) => {
              const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
              const options = typeof optionsOrCb === 'function' ? undefined : optionsOrCb;
              if (typeof cb !== 'function') {
                throw new Error('lookup callback missing');
              }

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
    });

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchJsonWithTlsFallback(
  inputUrl: string,
  config: ScriptConfig
): Promise<any> {
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    await scheduleRateLimit(config);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.requestTimeout);

    try {
      const u = new URL(inputUrl);

      const res = await fetch(inputUrl, {
        method: 'GET',
        headers: {
          'X-API-Key': config.apiKey,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status === 429 || res.status >= 500) {
        if (attempt < config.maxRetries) {
          const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
          const backoff = Math.pow(2, attempt + 1) * 1000;
          const waitMs = Math.max(config.retryDelay, retryAfter > 0 ? retryAfter * 1000 : 0, backoff);
          await sleep(waitMs);
          continue;
        }
      }

      const text = await res.text().catch(() => '');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} ${text || ''}`.trim());
      }

      return safeJsonParse<any>(text, {});
    } catch (error) {
      clearTimeout(timeoutId);

      if (isTlsCertVerifyError(error)) {
        try {
          const u = new URL(inputUrl);
          if (u.hostname === 'api.twitterapi.io') {
            const ip = await resolveAWithCloudflareDoh(u.hostname);
            if (ip) {
              const resp = await httpsGetText(inputUrl, {
                headers: {
                  'X-API-Key': config.apiKey,
                  'Content-Type': 'application/json',
                },
                timeoutMs: config.requestTimeout,
                lookupIp: ip,
              });
              if (resp.statusCode >= 200 && resp.statusCode < 300) {
                return safeJsonParse<any>(resp.body || '{}', {});
              }
            }
          }
        } catch {
          // fallthrough to retry
        }
      }

      const err = error as any;
      const netCode = err?.cause?.code ?? err?.code;
      const isNetworkish =
        (error instanceof Error && error.name === 'AbortError') ||
        isTlsCertVerifyError(error) ||
        ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(
          String(netCode || '')
        );

      if (attempt < config.maxRetries && isNetworkish) {
        const backoff = Math.pow(2, attempt + 1) * 1000;
        await sleep(Math.max(config.retryDelay, backoff));
        continue;
      }

      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error('Retries exhausted');
}

// -------------------------------------------------------------------
// Tweet URL/ID parsing
// -------------------------------------------------------------------

function extractTweetId(input: string): string | null {
  const trimmed = input.trim();

  // Check if it's just a numeric ID
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  // Try to extract from URL patterns:
  // https://x.com/user/status/1234567890
  // https://twitter.com/user/status/1234567890
  const urlMatch = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/[^\/]+\/status\/(\d+)/i
  );
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  return null;
}

// -------------------------------------------------------------------
// API Functions
// -------------------------------------------------------------------

async function fetchQuoteTweets(
  tweetId: string,
  config: ScriptConfig,
  maxPages: number
): Promise<TweetApiTweet[]> {
  const allQuotes: TweetApiTweet[] = [];
  let cursor = '';
  let page = 0;

  console.log(`[${ts()}] Fetching quote tweets for tweet ${tweetId}...`);

  while (page < maxPages) {
    page += 1;
    const url = new URL(`${config.apiUrl}/twitter/tweet/quotes`);
    url.searchParams.set('tweetId', tweetId);
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const data = (await fetchJsonWithTlsFallback(url.toString(), config)) as QuotesResponse;

    if (data?.status === 'error') {
      const msg = String(data?.msg ?? data?.message ?? 'Unknown error').trim();
      throw new Error(`twitter/tweet/quotes error: ${msg}`);
    }

    const tweets = Array.isArray(data?.tweets) ? data.tweets : [];
    for (const t of tweets) {
      allQuotes.push(t);
    }

    console.log(`[${ts()}]   Page ${page}: ${tweets.length} quotes (total: ${allQuotes.length})`);

    const nextCursor = data?.next_cursor ?? '';
    const hasNext = Boolean(data?.has_next_page) && Boolean(nextCursor) && tweets.length > 0;

    if (!hasNext) {
      console.log(`[${ts()}]   No more pages.`);
      break;
    }
    cursor = nextCursor;
  }

  return allQuotes;
}

async function fetchUserInfo(
  username: string,
  config: ScriptConfig
): Promise<{
  user_id: string;
  username: string;
  profile_url: string;
  followers: number;
  verified: boolean;
  bio: string;
  location: string;
}> {
  const url = new URL(`${config.apiUrl}/twitter/user/info`);
  url.searchParams.set('userName', username);

  const data = (await fetchJsonWithTlsFallback(url.toString(), config)) as UserInfoResponse;

  const payload = data?.data ?? {};
  const userId = String(payload.userId ?? payload.id ?? '').trim();
  const resolvedUsername = String(payload.userName ?? username).trim() || username;
  const profileUrl =
    typeof payload.url === 'string' && payload.url.trim()
      ? payload.url.trim()
      : `https://x.com/${resolvedUsername}`;

  return {
    user_id: userId,
    username: resolvedUsername,
    profile_url: profileUrl,
    followers: parseNumber(payload.followers),
    verified: Boolean(payload.isBlueVerified ?? payload.verified),
    bio: String(payload.description ?? '').trim(),
    location: String(payload.location ?? '').trim(),
  };
}

async function fetchLastTweets(
  params: { userId?: string; userName?: string },
  maxTweets: number,
  config: ScriptConfig
): Promise<TweetApiTweet[]> {
  const hasUserId = typeof params.userId === 'string' && params.userId.trim().length > 0;
  const hasUserName = typeof params.userName === 'string' && params.userName.trim().length > 0;
  if (!hasUserId && !hasUserName) {
    throw new Error('fetchLastTweets requires userId or userName');
  }

  const tweets: TweetApiTweet[] = [];
  let cursor = '';
  let page = 0;

  while (tweets.length < maxTweets) {
    page += 1;
    const url = new URL(`${config.apiUrl}/twitter/user/last_tweets`);
    if (hasUserId) {
      url.searchParams.set('userId', String(params.userId));
    } else {
      url.searchParams.set('userName', String(params.userName));
    }
    url.searchParams.set('includeReplies', 'false');
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const data = (await fetchJsonWithTlsFallback(url.toString(), config)) as LastTweetsResponse;

    if (data?.status === 'error') {
      const msg = String(data?.msg ?? data?.message ?? 'Unknown error').trim();
      const who = hasUserId
        ? `userId=${String(params.userId)}`
        : `userName=${String(params.userName)}`;
      throw new Error(`twitter/user/last_tweets error for ${who}: ${msg}`);
    }

    const pageTweets = Array.isArray(data?.tweets)
      ? data.tweets
      : Array.isArray(data?.data?.tweets)
        ? data.data.tweets
        : [];

    for (const t of pageTweets) {
      tweets.push(t);
      if (tweets.length >= maxTweets) break;
    }

    const nextCursor =
      typeof data?.next_cursor === 'string'
        ? data.next_cursor
        : typeof data?.data?.next_cursor === 'string'
          ? data.data.next_cursor
          : '';
    const hasNext =
      Boolean(data?.has_next_page ?? data?.data?.has_next_page) && Boolean(nextCursor);
    if (!hasNext) break;
    cursor = nextCursor;

    if (page >= 5) break; // Safety limit
  }

  return tweets.slice(0, maxTweets);
}

// -------------------------------------------------------------------
// Tweet Classification
// -------------------------------------------------------------------

function isMeaningfulTweetReference(value: unknown): boolean {
  if (value === null || value === undefined) return false;

  if (typeof value === 'string') {
    const v = value.trim();
    if (!v) return false;
    const lowered = v.toLowerCase();
    if (lowered === 'null' || lowered === '<unknown>' || lowered === 'unknown') return false;
    return true;
  }

  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.length > 0;
    const obj = value as Record<string, unknown>;
    const id =
      (typeof obj.id === 'string' && obj.id.trim().length > 0) ||
      (typeof obj.id === 'number' && Number.isFinite(obj.id)) ||
      (typeof (obj as any).id_str === 'string' && String((obj as any).id_str).trim().length > 0);
    if (id) return true;
    return Object.keys(obj).length > 0;
  }

  return false;
}

function classifyTweet(t: TweetApiTweet): TweetType {
  if (t.isReply) return 'reply';
  if (isMeaningfulTweetReference(t.retweeted_tweet)) return 'retweet';
  if (isMeaningfulTweetReference(t.quoted_tweet)) return 'quote';
  return 'original';
}

// -------------------------------------------------------------------
// Row Computation
// -------------------------------------------------------------------

function computeRow(params: {
  quoteTweet: TweetApiTweet;
  userInfo: Awaited<ReturnType<typeof fetchUserInfo>>;
  tweets: TweetApiTweet[];
  error?: string;
}): QuoteTweeterRow {
  const { quoteTweet, userInfo, tweets } = params;

  const types: TweetType[] = [];
  const views: number[] = [];
  const likes: number[] = [];
  const retweets: number[] = [];
  const replies: number[] = [];
  const quotes: number[] = [];
  const createdAts: string[] = [];

  for (const t of tweets) {
    const type = classifyTweet(t);
    types.push(type);
    views.push(parseNumber(t.viewCount));
    likes.push(parseNumber(t.likeCount));
    retweets.push(parseNumber(t.retweetCount));
    replies.push(parseNumber(t.replyCount));
    quotes.push(parseNumber(t.quoteCount));
    if (typeof t.createdAt === 'string' && t.createdAt.trim()) {
      createdAts.push(t.createdAt.trim());
    }
  }

  const tweetsUsed = tweets.length;
  const originalCount = types.filter((t) => t === 'original').length;
  const retweetCount = types.filter((t) => t === 'retweet').length;
  const quoteCount = types.filter((t) => t === 'quote').length;

  const newest = createdAts.length ? createdAts[0] : '';
  const oldest = createdAts.length ? createdAts[createdAts.length - 1] : '';

  const denom = tweetsUsed || 1;
  const pct = (n: number) => (n / denom) * 100;

  return {
    username: userInfo.username,
    profile_url: userInfo.profile_url,
    user_id: userInfo.user_id,
    followers: userInfo.followers,
    verified: userInfo.verified,
    bio: userInfo.bio,
    location: userInfo.location,
    quote_tweet_id: String(quoteTweet.id ?? ''),
    quote_tweet_text: String(quoteTweet.text ?? '').slice(0, 500),
    quote_tweet_views: parseNumber(quoteTweet.viewCount),
    quote_tweet_likes: parseNumber(quoteTweet.likeCount),
    quote_tweet_retweets: parseNumber(quoteTweet.retweetCount),
    quote_tweet_at: String(quoteTweet.createdAt ?? ''),
    tweets_used: tweetsUsed,
    newest_tweet_at: newest,
    oldest_tweet_at: oldest,
    avg_views_25: mean(views),
    median_views_25: median(views),
    avg_likes_25: mean(likes),
    median_likes_25: median(likes),
    avg_retweets_25: mean(retweets),
    median_retweets_25: median(retweets),
    avg_replies_25: mean(replies),
    median_replies_25: median(replies),
    avg_quotes_25: mean(quotes),
    median_quotes_25: median(quotes),
    pct_original: pct(originalCount),
    pct_retweet: pct(retweetCount),
    pct_quote: pct(quoteCount),
    error: params.error ?? '',
  };
}

// -------------------------------------------------------------------
// Excel Export
// -------------------------------------------------------------------

async function writeXlsx(outputPath: string, rows: QuoteTweeterRow[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IdentityLabs Pdts';
  wb.created = new Date();

  const ws = wb.addWorksheet('quote_tweeters', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const columns: Partial<ExcelJS.Column>[] = [
    { header: 'username', key: 'username', width: 18 },
    { header: 'profile_url', key: 'profile_url', width: 34 },
    { header: 'user_id', key: 'user_id', width: 22 },
    { header: 'followers', key: 'followers', width: 12 },
    { header: 'verified', key: 'verified', width: 10 },
    { header: 'bio', key: 'bio', width: 50 },
    { header: 'location', key: 'location', width: 20 },
    { header: 'quote_tweet_id', key: 'quote_tweet_id', width: 22 },
    { header: 'quote_tweet_text', key: 'quote_tweet_text', width: 60 },
    { header: 'quote_tweet_views', key: 'quote_tweet_views', width: 16 },
    { header: 'quote_tweet_likes', key: 'quote_tweet_likes', width: 16 },
    { header: 'quote_tweet_retweets', key: 'quote_tweet_retweets', width: 18 },
    { header: 'quote_tweet_at', key: 'quote_tweet_at', width: 22 },
    { header: 'tweets_used', key: 'tweets_used', width: 12 },
    { header: 'newest_tweet_at', key: 'newest_tweet_at', width: 22 },
    { header: 'oldest_tweet_at', key: 'oldest_tweet_at', width: 22 },
    { header: 'avg_views_25', key: 'avg_views_25', width: 14 },
    { header: 'median_views_25', key: 'median_views_25', width: 16 },
    { header: 'avg_likes_25', key: 'avg_likes_25', width: 14 },
    { header: 'median_likes_25', key: 'median_likes_25', width: 16 },
    { header: 'avg_retweets_25', key: 'avg_retweets_25', width: 16 },
    { header: 'median_retweets_25', key: 'median_retweets_25', width: 18 },
    { header: 'avg_replies_25', key: 'avg_replies_25', width: 14 },
    { header: 'median_replies_25', key: 'median_replies_25', width: 16 },
    { header: 'avg_quotes_25', key: 'avg_quotes_25', width: 14 },
    { header: 'median_quotes_25', key: 'median_quotes_25', width: 16 },
    { header: 'pct_original', key: 'pct_original', width: 12 },
    { header: 'pct_retweet', key: 'pct_retweet', width: 12 },
    { header: 'pct_quote', key: 'pct_quote', width: 12 },
    { header: 'error', key: 'error', width: 40 },
  ];

  ws.columns = columns;

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };

  for (const row of rows) {
    ws.addRow(row);
  }

  const percentKeys = new Set(['pct_original', 'pct_retweet', 'pct_quote']);
  const intKeys = new Set(['followers', 'tweets_used', 'quote_tweet_views', 'quote_tweet_likes', 'quote_tweet_retweets']);
  const floatKeys = new Set([
    'avg_views_25',
    'median_views_25',
    'avg_likes_25',
    'median_likes_25',
    'avg_retweets_25',
    'median_retweets_25',
    'avg_replies_25',
    'median_replies_25',
    'avg_quotes_25',
    'median_quotes_25',
  ]);

  ws.columns.forEach((col) => {
    const key = String(col.key ?? '');
    if (percentKeys.has(key)) {
      col.numFmt = '0.00';
    } else if (intKeys.has(key)) {
      col.numFmt = '0';
    } else if (floatKeys.has(key)) {
      col.numFmt = '0.00';
    }
  });

  await wb.xlsx.writeFile(outputPath);
}

// -------------------------------------------------------------------
// Pool Runner
// -------------------------------------------------------------------

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runner(): Promise<void> {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current] as T, current);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => runner());
  await Promise.all(workers);
  return results;
}

// -------------------------------------------------------------------
// Args Parser
// -------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (!a.startsWith('-')) continue;

    // Handle both --flag and -f
    const isLongFlag = a.startsWith('--');
    const rawKey = isLongFlag ? a.slice(2) : a.slice(1);
    const [k, v] = rawKey.split('=', 2);

    if (v !== undefined) {
      out[k] = v;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('-')) {
      out[k] = next;
      i += 1;
    } else {
      out[k] = true;
    }
  }
  return out;
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const tweetInput =
    typeof args.tweet === 'string'
      ? args.tweet
      : typeof args.t === 'string'
        ? args.t
        : '';

  const outputPath =
    typeof args.output === 'string'
      ? args.output
      : typeof args.o === 'string'
        ? args.o
        : path.resolve(process.cwd(), 'quote-tweeters.xlsx');

  const maxTweets = typeof args.tweets === 'string' ? Math.max(1, Number(args.tweets)) : 25;
  const concurrency =
    typeof args.concurrency === 'string' ? Math.max(1, Number(args.concurrency)) : 3;
  const qpsLimit = typeof args.qps === 'string' ? Math.max(1, Number(args.qps)) : 10;
  const maxQuotePages =
    typeof args['max-pages'] === 'string' ? Math.max(1, Number(args['max-pages'])) : 100;

  if (!tweetInput || args.help || args.h) {
    console.error(
      [
        'Quote Tweeters Metrics Export',
        '',
        'Usage:',
        '  npx tsx scripts/quote-tweeters-metrics.ts --tweet <tweet_url_or_id> [options]',
        '',
        'Options:',
        '  --tweet, -t     Tweet URL or ID to analyze (required)',
        '  --output, -o    Output xlsx file (default: quote-tweeters.xlsx)',
        '  --tweets        Number of tweets to analyze per user (default: 25)',
        '  --concurrency   Parallel workers for user processing (default: 3)',
        '  --qps           Queries per second limit (default: 10)',
        '  --max-pages     Max pages to fetch for quote tweets (default: 100)',
        '',
        'Required env:',
        '  - TWITTER_API_KEY_SHARED (or TWITTER_API_KEY)',
      ].join('\n')
    );
    process.exit(tweetInput ? 0 : 1);
  }

  const tweetId = extractTweetId(tweetInput);
  if (!tweetId) {
    console.error(`[${ts()}] Invalid tweet URL or ID: ${tweetInput}`);
    process.exit(1);
  }

  const config = getConfig(qpsLimit);

  if (!config.apiKey) {
    console.error(`[${ts()}] TWITTER_API_KEY_SHARED or TWITTER_API_KEY must be set`);
    process.exit(1);
  }

  console.log(`[${ts()}] Quote Tweeters Metrics Export`);
  console.log(`[${ts()}] Tweet ID: ${tweetId}`);
  console.log(`[${ts()}] Output: ${outputPath}`);
  console.log(`[${ts()}] Tweets per user: ${maxTweets}`);
  console.log(`[${ts()}] Concurrency: ${concurrency}`);
  console.log(`[${ts()}] QPS Limit: ${qpsLimit}`);
  console.log(`[${ts()}] Max Quote Pages: ${maxQuotePages}`);

  // Step 1: Fetch all quote tweets
  const quoteTweets = await fetchQuoteTweets(tweetId, config, maxQuotePages);

  if (quoteTweets.length === 0) {
    console.log(`[${ts()}] No quote tweets found for tweet ${tweetId}`);
    process.exit(0);
  }

  console.log(`[${ts()}] Found ${quoteTweets.length} quote tweets. Processing users...`);

  // Step 2: Process each quote tweeter
  const rows = await runPool(quoteTweets, concurrency, async (quoteTweet, idx) => {
    const prefix = `[${idx + 1}/${quoteTweets.length}]`;
    const authorUsername = quoteTweet.author?.userName ?? quoteTweet.author?.username ?? '';

    if (!authorUsername) {
      console.warn(`${prefix} [${ts()}] Quote tweet ${quoteTweet.id} has no author username`);
      return {
        username: '',
        profile_url: '',
        user_id: '',
        followers: 0,
        verified: false,
        bio: '',
        location: '',
        quote_tweet_id: String(quoteTweet.id ?? ''),
        quote_tweet_text: String(quoteTweet.text ?? '').slice(0, 500),
        quote_tweet_views: parseNumber(quoteTweet.viewCount),
        quote_tweet_likes: parseNumber(quoteTweet.likeCount),
        quote_tweet_retweets: parseNumber(quoteTweet.retweetCount),
        quote_tweet_at: String(quoteTweet.createdAt ?? ''),
        tweets_used: 0,
        newest_tweet_at: '',
        oldest_tweet_at: '',
        avg_views_25: 0,
        median_views_25: 0,
        avg_likes_25: 0,
        median_likes_25: 0,
        avg_retweets_25: 0,
        median_retweets_25: 0,
        avg_replies_25: 0,
        median_replies_25: 0,
        avg_quotes_25: 0,
        median_quotes_25: 0,
        pct_original: 0,
        pct_retweet: 0,
        pct_quote: 0,
        error: 'No author username in quote tweet',
      } satisfies QuoteTweeterRow;
    }

    try {
      console.log(`${prefix} [${ts()}] @${authorUsername}`);

      // Get user info
      const userInfo = await fetchUserInfo(authorUsername, config);

      // Get last N tweets
      const lookup = userInfo.user_id
        ? { userId: userInfo.user_id, userName: userInfo.username }
        : { userName: userInfo.username };

      const tweets = await fetchLastTweets(lookup, maxTweets, config);
      console.log(`${prefix} [${ts()}]   tweets_used=${tweets.length}`);

      return computeRow({ quoteTweet, userInfo, tweets });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`${prefix} [${ts()}] Failed for @${authorUsername}: ${message}`);

      return {
        username: authorUsername,
        profile_url: `https://x.com/${authorUsername}`,
        user_id: '',
        followers: parseNumber(quoteTweet.author?.followers),
        verified: Boolean(quoteTweet.author?.isBlueVerified ?? quoteTweet.author?.verified),
        bio: '',
        location: '',
        quote_tweet_id: String(quoteTweet.id ?? ''),
        quote_tweet_text: String(quoteTweet.text ?? '').slice(0, 500),
        quote_tweet_views: parseNumber(quoteTweet.viewCount),
        quote_tweet_likes: parseNumber(quoteTweet.likeCount),
        quote_tweet_retweets: parseNumber(quoteTweet.retweetCount),
        quote_tweet_at: String(quoteTweet.createdAt ?? ''),
        tweets_used: 0,
        newest_tweet_at: '',
        oldest_tweet_at: '',
        avg_views_25: 0,
        median_views_25: 0,
        avg_likes_25: 0,
        median_likes_25: 0,
        avg_retweets_25: 0,
        median_retweets_25: 0,
        avg_replies_25: 0,
        median_replies_25: 0,
        avg_quotes_25: 0,
        median_quotes_25: 0,
        pct_original: 0,
        pct_retweet: 0,
        pct_quote: 0,
        error: message,
      } satisfies QuoteTweeterRow;
    }
  });

  // Step 3: Write output
  await fs.mkdir(path.dirname(outputPath), { recursive: true }).catch(() => {});
  await writeXlsx(outputPath, rows);

  console.log(`[${ts()}] Wrote ${rows.length} rows to ${outputPath}`);
}

main().catch((err) => {
  console.error(`[${ts()}] Fatal error:`, err);
  process.exit(1);
});
