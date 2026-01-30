#!/usr/bin/env node

import 'dotenv/config';

import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { URL } from 'node:url';

import { getTwitterApiConfig } from '../src/lib/config/twitter-api-config';

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
};

type UserInfoResponse = {
  data?: {
    userName?: string;
    url?: string;
    id?: string;
    userId?: string;
    followers?: number | string;
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

type TweetType = 'original' | 'retweet' | 'quote' | 'reply';

type ImportanceLookup = {
  found: boolean;
  importance_score: number;
  followed_by_usernames: string[];
};

type InfluencerRow = {
  input: string;
  username: string;
  profile_url: string;
  user_id: string;
  followers: number;
  tweets_used: number;
  newest_tweet_at: string;
  oldest_tweet_at: string;
  avg_views_50: number;
  median_views_50: number;
  avg_likes_50: number;
  median_likes_50: number;
  avg_retweets_50: number;
  median_retweets_50: number;
  avg_replies_50: number;
  median_replies_50: number;
  avg_quotes_50: number;
  median_quotes_50: number;
  pct_original: number;
  pct_retweet: number;
  pct_quote: number;
  importance_score: number;
  important_followed_by_usernames: string;
  error: string;
};

function ts(): string {
  return new Date().toISOString();
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

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
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
          },
        );

        req.on('error', reject);
        req.end();
      },
    );

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchJsonWithTlsFallback(
  inputUrl: string,
  opts: { headers: Record<string, string>; timeoutMs: number; maxRetries: number; retryDelayMs: number },
): Promise<any> {
  for (let attempt = 0; attempt <= opts.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const u = new URL(inputUrl);

      // Fast path: use fetch directly.
      const res = await fetch(inputUrl, { method: 'GET', headers: opts.headers, signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.status === 429 || res.status >= 500) {
        if (attempt < opts.maxRetries) {
          const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
          const backoff = Math.pow(2, attempt + 1) * 1000;
          const waitMs = Math.max(opts.retryDelayMs, retryAfter > 0 ? retryAfter * 1000 : 0, backoff);
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

      // If TLS verification fails, try DoH+forced IP for api.twitterapi.io (same pattern as user-about-api.ts)
      if (isTlsCertVerifyError(error)) {
        try {
          const u = new URL(inputUrl);
          if (u.hostname === 'api.twitterapi.io') {
            preferDohForTwitterApiIo = true;
            const ip = await resolveAWithCloudflareDoh(u.hostname);
            if (ip) {
              const resp = await httpsGetText(inputUrl, { headers: opts.headers, timeoutMs: opts.timeoutMs, lookupIp: ip });
              if (resp.statusCode >= 200 && resp.statusCode < 300) {
                return safeJsonParse<any>(resp.body || '{}', {});
              }
              // fallthrough to retry below on non-2xx
            }
          }
        } catch {
          // fallthrough to retry below
        }
      }

      const err = error as any;
      const netCode = err?.cause?.code ?? err?.code;
      const isNetworkish =
        (error instanceof Error && error.name === 'AbortError') ||
        isTlsCertVerifyError(error) ||
        ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(String(netCode || ''));

      if (attempt < opts.maxRetries && isNetworkish) {
        const backoff = Math.pow(2, attempt + 1) * 1000;
        await sleep(Math.max(opts.retryDelayMs, backoff));
        continue;
      }

      // Re-throw final error
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error('Retries exhausted');
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

function isMeaningfulTweetReference(value: unknown): boolean {
  // twitterapi.io sometimes returns:
  // - null for "no quoted/retweeted tweet"
  // - an object with id/url/... for actual quoted/retweeted tweet
  // - placeholders like {} or "<unknown>" depending on endpoint/version
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

    // If it's an object but without an id, treat it as meaningful only if it has other fields.
    // This avoids counting empty placeholders like {} as retweets/quotes.
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

function normalizeUsernameFromInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Accept "@handle"
  if (trimmed.startsWith('@')) {
    const handle = trimmed.slice(1).trim();
    return handle || null;
  }

  // Accept profile URLs: https://x.com/handle, https://twitter.com/handle
  const urlMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:[\/?#]|$)/i);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  // Plain handle
  // X usernames are max 15 chars and [A-Za-z0-9_]
  const handleMatch = trimmed.match(/^([A-Za-z0-9_]{1,15})$/);
  if (handleMatch?.[1]) {
    return handleMatch[1];
  }

  return null;
}

async function readInputsFromFile(inputPath: string): Promise<string[]> {
  const ext = path.extname(inputPath).toLowerCase();

  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(inputPath);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const values: string[] = [];

    // Take column A. Skip header-like first cell if it looks like "username".
    ws.eachRow((row, rowNumber) => {
      const cellValue = row.getCell(1).value;
      const text = typeof cellValue === 'string' ? cellValue : typeof cellValue === 'number' ? String(cellValue) : '';
      const raw = text.trim();
      if (!raw) return;
      if (rowNumber === 1 && /^username$/i.test(raw)) return;
      values.push(raw);
    });

    return values;
  }

  const raw = await fs.readFile(inputPath, 'utf8');
  const tokens = raw
    .split(/[\r\n,]+/g)
    .map((t) => t.trim())
    .filter(Boolean);

  // Drop a common CSV header if present
  return tokens.filter((t, idx) => !(idx === 0 && /^username$/i.test(t)));
}

async function fetchUserInfo(username: string): Promise<{
  user_id: string; // may be empty if user/info doesn't return it
  username: string;
  profile_url: string;
  followers: number;
}> {
  const config = getTwitterApiConfig('shared');
  if (!config.apiKey) {
    throw new Error('TWITTER_API_KEY_SHARED or TWITTER_API_KEY must be set');
  }

  const url = new URL(`${config.apiUrl}/twitter/user/info`);
  url.searchParams.set('userName', username);
  const data = (await fetchJsonWithTlsFallback(url.toString(), {
    headers: {
      'X-API-Key': config.apiKey,
      'Content-Type': 'application/json',
    },
    timeoutMs: config.requestTimeout,
    maxRetries: config.maxRetries,
    retryDelayMs: config.retryDelay,
  })) as UserInfoResponse;

  // Note: don't hard-fail on user/info errors; we can still attempt last_tweets by userName.
  // We'll surface issues downstream via the `error` column if needed.

  const payload = data?.data ?? {};
  const userId = String(payload.userId ?? payload.id ?? '').trim(); // may be empty

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
  };
}

async function fetchLastTweets(userId: string, maxTweets: number): Promise<TweetApiTweet[]> {
  return fetchLastTweetsInternal({ userId, maxTweets, includeReplies: false });
}

async function fetchLastTweetsInternal(params: {
  userId?: string;
  userName?: string;
  maxTweets: number;
  includeReplies: boolean;
}): Promise<TweetApiTweet[]> {
  const config = getTwitterApiConfig('shared');
  if (!config.apiKey) {
    throw new Error('TWITTER_API_KEY_SHARED or TWITTER_API_KEY must be set');
  }

  const hasUserId = typeof params.userId === 'string' && params.userId.trim().length > 0;
  const hasUserName = typeof params.userName === 'string' && params.userName.trim().length > 0;
  if (!hasUserId && !hasUserName) {
    throw new Error('fetchLastTweetsInternal requires userId or userName');
  }

  const tweets: TweetApiTweet[] = [];
  let cursor = '';
  let page = 0;

  while (tweets.length < params.maxTweets) {
    page += 1;
    const url = new URL(`${config.apiUrl}/twitter/user/last_tweets`);
    if (hasUserId) {
      url.searchParams.set('userId', String(params.userId));
    } else {
      url.searchParams.set('userName', String(params.userName));
    }
    url.searchParams.set('includeReplies', params.includeReplies ? 'true' : 'false');
    url.searchParams.set('cursor', cursor);

    const data = (await fetchJsonWithTlsFallback(url.toString(), {
      headers: {
        'X-API-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
      timeoutMs: config.requestTimeout,
      maxRetries: config.maxRetries,
      retryDelayMs: config.retryDelay,
    })) as LastTweetsResponse;

    if (data?.status === 'error') {
      const msg = String(data?.msg ?? data?.message ?? 'Unknown error').trim();
      const who = hasUserId ? `userId=${String(params.userId)}` : `userName=${String(params.userName)}`;
      throw new Error(`twitter/user/last_tweets error for ${who}: ${msg}`);
    }

    // twitterapi.io responses vary:
    // - docs show { tweets: [...] }
    // - real-world sometimes returns { data: { tweets: [...] } }
    const pageTweets = Array.isArray(data?.tweets)
      ? data.tweets
      : Array.isArray(data?.data?.tweets)
        ? data.data.tweets
        : [];
    for (const t of pageTweets) {
      tweets.push(t);
      if (tweets.length >= params.maxTweets) break;
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

    // Small delay between pages to avoid hammering.
    // Note: we are not using the global QPS limiter here (makeApiRequest), so keep this.
    await sleep(Math.max(0, config.rateLimitDelay));

    // Safety: don't paginate forever even if the API lies
    if (page >= 10) break;
  }

  return tweets.slice(0, params.maxTweets);
}

async function lookupAccountImportance(username: string): Promise<ImportanceLookup> {
  // Lazy import so running "--help"/missing args doesn't try to connect to MongoDB.
  const { getFollowingIndexCollection } = await import('../src/lib/models/ranker');
  const followingIndexCollection = await getFollowingIndexCollection();

  const entry = await followingIndexCollection.findOne({
    followed_username: { $regex: `^${username}$`, $options: 'i' },
  });

  if (!entry) {
    return { found: false, importance_score: 0, followed_by_usernames: [] };
  }

  const followedBy = Array.isArray(entry.followed_by) ? entry.followed_by : [];
  const usernames = followedBy
    .map((f) => String((f as any)?.username ?? '').trim())
    .filter(Boolean);

  return {
    found: true,
    importance_score: typeof (entry as any).importance_score === 'number' ? (entry as any).importance_score : 0,
    followed_by_usernames: usernames,
  };
}

function computeRow(params: {
  input: string;
  userInfo: Awaited<ReturnType<typeof fetchUserInfo>>;
  tweets: TweetApiTweet[];
  importance: ImportanceLookup;
  error?: string;
}): InfluencerRow {
  const { input, userInfo, tweets, importance } = params;

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

  // createdAt is already a sortable ISO-ish string in examples; still keep as strings for Excel.
  const newest = createdAts.length ? createdAts[0] : '';
  const oldest = createdAts.length ? createdAts[createdAts.length - 1] : '';

  const denom = tweetsUsed || 1;
  const pct = (n: number) => (n / denom) * 100;

  return {
    input,
    username: userInfo.username,
    profile_url: userInfo.profile_url,
    user_id: userInfo.user_id,
    followers: userInfo.followers,
    tweets_used: tweetsUsed,
    newest_tweet_at: newest,
    oldest_tweet_at: oldest,
    avg_views_50: mean(views),
    median_views_50: median(views),
    avg_likes_50: mean(likes),
    median_likes_50: median(likes),
    avg_retweets_50: mean(retweets),
    median_retweets_50: median(retweets),
    avg_replies_50: mean(replies),
    median_replies_50: median(replies),
    avg_quotes_50: mean(quotes),
    median_quotes_50: median(quotes),
    pct_original: pct(originalCount),
    pct_retweet: pct(retweetCount),
    pct_quote: pct(quoteCount),
    importance_score: importance.importance_score,
    important_followed_by_usernames: importance.followed_by_usernames.map((u) => `@${u}`).join(', '),
    error: params.error ?? '',
  };
}

async function writeXlsx(outputPath: string, rows: InfluencerRow[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IdentityLabs Pdts';
  wb.created = new Date();

  const ws = wb.addWorksheet('likes', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const columns: Partial<ExcelJS.Column>[] = [
    { header: 'input', key: 'input', width: 28 },
    { header: 'username', key: 'username', width: 18 },
    { header: 'profile_url', key: 'profile_url', width: 34 },
    { header: 'user_id', key: 'user_id', width: 22 },
    { header: 'followers', key: 'followers', width: 12 },
    { header: 'tweets_used', key: 'tweets_used', width: 12 },
    { header: 'newest_tweet_at', key: 'newest_tweet_at', width: 22 },
    { header: 'oldest_tweet_at', key: 'oldest_tweet_at', width: 22 },
    { header: 'avg_views_50', key: 'avg_views_50', width: 14 },
    { header: 'median_views_50', key: 'median_views_50', width: 16 },
    { header: 'avg_likes_50', key: 'avg_likes_50', width: 14 },
    { header: 'median_likes_50', key: 'median_likes_50', width: 16 },
    { header: 'avg_retweets_50', key: 'avg_retweets_50', width: 16 },
    { header: 'median_retweets_50', key: 'median_retweets_50', width: 18 },
    { header: 'avg_replies_50', key: 'avg_replies_50', width: 14 },
    { header: 'median_replies_50', key: 'median_replies_50', width: 16 },
    { header: 'avg_quotes_50', key: 'avg_quotes_50', width: 14 },
    { header: 'median_quotes_50', key: 'median_quotes_50', width: 16 },
    { header: 'pct_original', key: 'pct_original', width: 12 },
    { header: 'pct_retweet', key: 'pct_retweet', width: 12 },
    { header: 'pct_quote', key: 'pct_quote', width: 12 },
    { header: 'importance_score', key: 'importance_score', width: 16 },
    { header: 'important_followed_by_usernames', key: 'important_followed_by_usernames', width: 60 },
    { header: 'error', key: 'error', width: 40 },
  ];

  ws.columns = columns;

  // Header styling
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };

  // Data rows
  for (const row of rows) {
    ws.addRow(row);
  }

  // Number formatting
  const percentKeys = new Set(['pct_original', 'pct_retweet', 'pct_quote']);
  const intKeys = new Set(['followers', 'tweets_used']);
  const floatKeys = new Set([
    'avg_views_50',
    'median_views_50',
    'avg_likes_50',
    'median_likes_50',
    'avg_retweets_50',
    'median_retweets_50',
    'avg_replies_50',
    'median_replies_50',
    'avg_quotes_50',
    'median_quotes_50',
    'importance_score',
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

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=', 2);
    if (v !== undefined) {
      out[k] = v;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[k] = next;
      i += 1;
    } else {
      out[k] = true;
    }
  }
  return out;
}

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const inputPath =
    typeof args.input === 'string' ? args.input : typeof args.i === 'string' ? args.i : '';
  const outputPath =
    typeof args.output === 'string'
      ? args.output
      : typeof args.o === 'string'
        ? args.o
        : path.resolve(process.cwd(), 'likes.xlsx');

  const maxTweets = typeof args.tweets === 'string' ? Math.max(1, Number(args.tweets)) : 50;
  const concurrency = typeof args.concurrency === 'string' ? Math.max(1, Number(args.concurrency)) : 3;

  if (!inputPath) {
    console.error(
      [
        'Usage:',
        '  npx tsx scripts/influencer-metrics-export.ts --input <file.(txt|csv|xlsx)> [--output likes.xlsx] [--tweets 50] [--concurrency 3]',
        '',
        'Notes:',
        '  - input can contain @handles, handles, or profile URLs (x.com/twitter.com).',
        '  - output defaults to ./likes.xlsx',
        '',
        'Required env:',
        '  - TWITTER_API_KEY_SHARED (or TWITTER_API_KEY)',
        '  - MONGODB_URI (for importance_score + followed_by)',
      ].join('\n')
    );
    process.exit(1);
  }

  console.log(`[${ts()}] 🚀 Influencer metrics export`);
  console.log(`[${ts()}] Input: ${inputPath}`);
  console.log(`[${ts()}] Output: ${outputPath}`);
  console.log(`[${ts()}] Tweets per influencer: ${maxTweets} (excluding replies)`);
  console.log(`[${ts()}] Concurrency: ${concurrency} (QPS limited by TWITTER_QPS_LIMIT)`);

  const rawInputs = await readInputsFromFile(inputPath);
  const normalized = rawInputs
    .map((raw) => ({ raw, username: normalizeUsernameFromInput(raw) }))
    .filter((x): x is { raw: string; username: string } => Boolean(x.username));

  const dedupMap = new Map<string, { raw: string; username: string }>();
  for (const x of normalized) {
    const key = x.username.toLowerCase();
    if (!dedupMap.has(key)) dedupMap.set(key, x);
  }
  const inputs = Array.from(dedupMap.values());

  if (inputs.length === 0) {
    console.error(`[${ts()}] ❌ No valid usernames found in input file.`);
    process.exit(1);
  }

  console.log(`[${ts()}] Found ${inputs.length} unique influencers to process.`);

  const rows = await runPool(inputs, concurrency, async ({ raw, username }, idx) => {
    const prefix = `[${idx + 1}/${inputs.length}]`;
    try {
      console.log(`${prefix} [${ts()}] 👤 @${username}`);

      const userInfo = await fetchUserInfo(username);
      const lookup = userInfo.user_id
        ? { userId: userInfo.user_id, userName: userInfo.username }
        : { userName: userInfo.username };

      let tweets = await fetchLastTweetsInternal({
        ...lookup,
        maxTweets,
        includeReplies: false,
      });
      if (tweets.length === 0) {
        // Fallback: some accounts may only have replies; if so, retry including replies so we can compute metrics.
        tweets = await fetchLastTweetsInternal({
          ...lookup,
          maxTweets,
          includeReplies: true,
        });
      }
      console.log(`${prefix} [${ts()}]   tweets_used=${tweets.length}${tweets.length === 0 ? ' (no tweets returned)' : ''}`);
      const importance = await lookupAccountImportance(userInfo.username);

      return computeRow({ input: raw, userInfo, tweets, importance });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`${prefix} [${ts()}] ⚠️ Failed for @${username}: ${message}`);

      // Best-effort: still try to fill importance if we can.
      let importance: ImportanceLookup = { found: false, importance_score: 0, followed_by_usernames: [] };
      try {
        importance = await lookupAccountImportance(username);
      } catch {
        // ignore
      }

      return {
        input: raw,
        username,
        profile_url: `https://x.com/${username}`,
        user_id: '',
        followers: 0,
        tweets_used: 0,
        newest_tweet_at: '',
        oldest_tweet_at: '',
        avg_views_50: 0,
        median_views_50: 0,
        avg_likes_50: 0,
        median_likes_50: 0,
        avg_retweets_50: 0,
        median_retweets_50: 0,
        avg_replies_50: 0,
        median_replies_50: 0,
        avg_quotes_50: 0,
        median_quotes_50: 0,
        pct_original: 0,
        pct_retweet: 0,
        pct_quote: 0,
        importance_score: importance.importance_score,
        important_followed_by_usernames: importance.followed_by_usernames.map((u) => `@${u}`).join(', '),
        error: message,
      } satisfies InfluencerRow;
    }
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true }).catch(() => {});
  await writeXlsx(outputPath, rows);

  console.log(`[${ts()}] ✅ Wrote ${rows.length} rows to ${outputPath}`);
}

main().catch((err) => {
  console.error(`[${ts()}] ❌ Fatal error:`, err);
  process.exit(1);
});

