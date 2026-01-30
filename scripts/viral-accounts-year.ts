/**
 * Viral Account Discovery (creator-first)
 *
 * Objective:
 * Collect top-performing tweets in weekly windows across ~1 year and extract authors + metrics,
 * then aggregate to a deduplicated account list.
 *
 * Data source:
 * - twitterapi.io Advanced Search endpoint via `fetchAdvancedSearchPage`
 * - Uses queryType=Top (ranked)
 *
 * Key properties:
 * - Cost-efficient: ~3 pages/week → ~60 tweets/week max (we cap to 50).
 * - Time-efficient: global QPS limiter + optional window concurrency.
 * - Rerun-safe: per-week cache files on disk; re-runs skip already-fetched windows unless --force.
 *
 * Usage (PowerShell):
 *   npx tsx scripts/viral-accounts-year.ts --weeks 60 --tweetsPerWeek 50 --out viral-accounts-year.xlsx
 *
 * Advanced:
 *   npx tsx scripts/viral-accounts-year.ts --startDate 2025-01-01 --endDate 2025-12-31 --tweetsPerWeek 50 --weekConcurrency 2 --qps 2
 *
 * Notes:
 * - `until:` is treated as exclusive by Twitter advanced search semantics.
 * - "No keywords" is supported: by default we query only `since:`/`until:` operators.
 * - If you want to exclude replies/retweets, pass `--queryBase "-filter:replies -filter:retweets"`.
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import ExcelJS from 'exceljs';

import { fetchAdvancedSearchPage, type AdvancedSearchQueryType, type AdvancedSearchTweet } from '@/lib/twitter-advanced-search';
import type { TwitterApiKeyType } from '@/lib/config/twitter-api-config';
import { TwitterApiError } from '@/lib/external-api';
import { getTwitterApiKey } from '@/lib/config/twitter-api-config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function nowIso() {
  return new Date().toISOString();
}

function log(level: LogLevel, event: string, data: Record<string, unknown> = {}, logFilePath?: string) {
  const payload = { ts: nowIso(), level, event, ...data };
  const line = JSON.stringify(payload);
  if (logFilePath) {
    try {
      // Append JSONL logs
      void fs.appendFile(logFilePath, line + '\n', { encoding: 'utf8' });
    } catch {
      // ignore
    }
  }
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatIsoDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysUTC(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function createRateLimiter(qps: number) {
  const safeQps = Math.max(0.1, Math.min(50, qps));
  const minIntervalMs = Math.ceil(1000 / safeQps);
  let nextAllowedAt = 0;
  let chain = Promise.resolve();

  const acquire = async () => {
    await (chain = chain.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, nextAllowedAt - now);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      nextAllowedAt = Date.now() + minIntervalMs;
    }));
  };

  return { acquire, qps: safeQps, minIntervalMs };
}

function excelSafeString(value: unknown): string {
  const s = String(value ?? '');
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
  const needsQuotes = /[",\n\r]/.test(guarded);
  const escaped = guarded.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function normalizeQueryType(value: unknown): AdvancedSearchQueryType {
  return value === 'Latest' ? 'Latest' : 'Top';
}

function normalizeKeyType(value: unknown): TwitterApiKeyType {
  return value === 'monitor' ? 'monitor' : 'shared';
}

function normalizeFormat(value: unknown): 'xlsx' | 'csv' {
  return value === 'csv' ? 'csv' : 'xlsx';
}

function stripTimeOperators(query: string): string {
  return query
    .replace(/\s+since:\d{4}-\d{2}-\d{2}\b/gi, '')
    .replace(/\s+until:\d{4}-\d{2}-\d{2}\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function coerceNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toCacheSafeToken(value: string): string {
  // Keep filenames readable but safe-ish on Windows.
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
}

function parseOptionalNonNegativeInt(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = typeof value === 'string' ? parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

async function readKeywordListFromFile(filePath: string): Promise<string[]> {
  const raw = await fs.readFile(filePath, { encoding: 'utf8' });
  return raw
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('#'));
}

function splitKeywordsCsv(value: string): string[] {
  // Comma-separated, but allow quoted segments with commas via a simple heuristic:
  // if user needs complex CSV, they should use --keywordsFile.
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeUsernameFromTweet(t: AdvancedSearchTweet): string {
  const a: any = t.author ?? {};
  const u = String(a.userName ?? a.username ?? a.screen_name ?? '').trim();
  return u;
}

function normalizeUserIdFromTweet(t: AdvancedSearchTweet): string {
  const a: any = t.author ?? {};
  return String(a.id ?? a.userId ?? '').trim();
}

function normalizeAuthorFollowersFromTweet(t: AdvancedSearchTweet): number {
  const a: any = t.author ?? {};
  return Math.max(0, Math.floor(coerceNumber(a.followers ?? a.followers_count ?? 0)));
}

function normalizeAuthorNameFromTweet(t: AdvancedSearchTweet): string {
  const a: any = t.author ?? {};
  return String(a.name ?? '').trim();
}

function normalizeAuthorUrlFromTweet(t: AdvancedSearchTweet, username: string): string {
  const a: any = t.author ?? {};
  const raw = String(a.url ?? '').trim();
  if (raw) return raw;
  return username ? `https://x.com/${username}` : '';
}

type WeekWindow = {
  index: number;
  total: number;
  since: Date; // inclusive
  untilExclusive: Date; // exclusive
};

function buildWeeklyWindows(opts: {
  startDateInclusive: Date;
  endDateInclusive: Date;
}): WeekWindow[] {
  const start = startOfDayUTC(opts.startDateInclusive);
  const endInclusive = startOfDayUTC(opts.endDateInclusive);
  const endExclusive = addDaysUTC(endInclusive, 1);
  if (start.getTime() > endExclusive.getTime()) return [];

  const windows: WeekWindow[] = [];
  let cur = start;
  while (cur.getTime() < endExclusive.getTime()) {
    const next = addDaysUTC(cur, 7);
    windows.push({ index: windows.length + 1, total: 0, since: cur, untilExclusive: next });
    cur = next;
  }
  const total = windows.length;
  for (const w of windows) w.total = total;
  return windows;
}

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true }).catch(() => {});
}

type CachedWeek = {
  version: 1;
  fetchedAt: string;
  queryType: AdvancedSearchQueryType;
  keyType: TwitterApiKeyType;
  query: string;
  weekSince: string; // YYYY-MM-DD
  weekUntilInclusive: string; // YYYY-MM-DD
  weekUntilExclusive: string; // YYYY-MM-DD
  tweets: AdvancedSearchTweet[];
  meta: {
    pagesFetched: number;
    stoppedBecause: 'completed' | 'maxPages' | 'maxTweets' | 'cursorMissing' | 'cursorLoop';
  };
};

async function fetchTopTweetsForWeek(opts: {
  query: string;
  queryType: AdvancedSearchQueryType;
  keyType: TwitterApiKeyType;
  tweetsPerWeek: number;
  maxPages: number;
  limiter: { acquire: () => Promise<void> };
  pageDelayMs: number;
  retries: number;
  tweetFilter?: (t: AdvancedSearchTweet) => boolean;
  logFilePath?: string;
  weekLabel: { since: string; untilExclusive: string; index: number; total: number };
}): Promise<{ tweets: AdvancedSearchTweet[]; pagesFetched: number; stoppedBecause: CachedWeek['meta']['stoppedBecause'] }> {
  const seen = new Set<string>();
  const tweets: AdvancedSearchTweet[] = [];
  let cursor = '';
  let pagesFetched = 0;
  let stoppedBecause: CachedWeek['meta']['stoppedBecause'] = 'completed';
  const tweetFilter = opts.tweetFilter ?? (() => true);

  while (true) {
    if (pagesFetched >= opts.maxPages) {
      stoppedBecause = 'maxPages';
      break;
    }
    if (tweets.length >= opts.tweetsPerWeek) {
      stoppedBecause = 'maxTweets';
      break;
    }

    await opts.limiter.acquire();
    const page = await fetchAdvancedSearchPage({
      query: opts.query,
      queryType: opts.queryType,
      cursor,
      retries: opts.retries,
      keyType: opts.keyType,
    });

    pagesFetched += 1;

    for (const t of page.tweets || []) {
      if (!t?.id) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      if (!tweetFilter(t)) continue;
      tweets.push(t);
      if (tweets.length >= opts.tweetsPerWeek) break;
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
    if (opts.pageDelayMs > 0) {
      await new Promise((r) => setTimeout(r, opts.pageDelayMs));
    }
  }

  log(
    'info',
    'week_fetched',
    {
      week: opts.weekLabel,
      pagesFetched,
      tweets: tweets.length,
      stoppedBecause,
    },
    opts.logFilePath,
  );

  return { tweets, pagesFetched, stoppedBecause };
}

type TweetRow = {
  keyword: string;
  week_since: string;
  week_until_inclusive: string;
  tweet_id: string;
  tweet_url: string;
  created_at: string;
  lang: string;
  like_count: number;
  retweet_count: number;
  reply_count: number;
  quote_count: number;
  view_count: number;
  bookmark_count: number;
  is_reply: boolean;
  in_reply_to_id: string;
  author_username: string;
  author_name: string;
  author_id: string;
  author_followers: number;
  author_profile_url: string;
  author_is_blue_verified: boolean;
  text: string;
};

function toTweetRow(t: AdvancedSearchTweet, keyword: string, weekSince: string, weekUntilInclusive: string): TweetRow {
  const username = normalizeUsernameFromTweet(t);
  const authorId = normalizeUserIdFromTweet(t);
  const authorFollowers = normalizeAuthorFollowersFromTweet(t);
  const authorName = normalizeAuthorNameFromTweet(t);
  const authorUrl = normalizeAuthorUrlFromTweet(t, username);
  const a: any = t.author ?? {};

  return {
    keyword,
    week_since: weekSince,
    week_until_inclusive: weekUntilInclusive,
    tweet_id: String(t.id ?? ''),
    tweet_url: String(t.url ?? (t.id ? `https://x.com/i/web/status/${t.id}` : '')),
    created_at: String(t.createdAt ?? ''),
    lang: String(t.lang ?? ''),
    like_count: Math.floor(coerceNumber((t as any).likeCount)),
    retweet_count: Math.floor(coerceNumber((t as any).retweetCount)),
    reply_count: Math.floor(coerceNumber((t as any).replyCount)),
    quote_count: Math.floor(coerceNumber((t as any).quoteCount)),
    view_count: Math.floor(coerceNumber((t as any).viewCount)),
    bookmark_count: Math.floor(coerceNumber((t as any).bookmarkCount)),
    is_reply: Boolean((t as any).isReply),
    in_reply_to_id: String((t as any).inReplyToId ?? ''),
    author_username: username,
    author_name: authorName,
    author_id: authorId,
    author_followers: authorFollowers,
    author_profile_url: authorUrl,
    author_is_blue_verified: Boolean(a.isBlueVerified ?? a.verified ?? false),
    text: String(t.text ?? ''),
  };
}

type AccountAgg = {
  key: string;
  username: string;
  user_id: string;
  profile_url: string;
  display_name: string;
  followers_max: number;
  tweets_captured: number;
  weeks_appeared: Set<string>;
  peak_view_count: number;
  peak_like_count: number;
  peak_retweet_count: number;
  peak_reply_count: number;
  peak_bookmark_count: number;
  peak_engagement_score: number;
  peak_tweet_url: string;
  peak_week_since: string;
  keywords: Set<string>;
};

function engagementScore(r: TweetRow): number {
  // Lightweight heuristic. Can be swapped later without changing the dataset shape.
  return (
    r.like_count +
    2 * r.retweet_count +
    r.reply_count +
    r.quote_count +
    r.bookmark_count
  );
}

function accountKeyForRow(r: TweetRow): string {
  if (r.author_id) return `id:${r.author_id}`;
  if (r.author_username) return `u:${r.author_username.toLowerCase()}`;
  return `unknown:${r.tweet_id}`;
}

async function writeCsv(outPath: string, rows: Array<Record<string, unknown>>, columns: string[]): Promise<void> {
  const bom = '\uFEFF';
  const lines: string[] = [];
  lines.push(bom + columns.map(csvEscape).join(','));
  for (const r of rows) {
    lines.push(columns.map((c) => csvEscape((r as any)[c] ?? '')).join(','));
  }
  await ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, lines.join('\n'), { encoding: 'utf8' });
}

async function writeXlsx(outPath: string, opts: {
  tweetRows: TweetRow[];
  accountRows: Array<Record<string, unknown>>;
  todoRows: Array<Record<string, unknown>>;
  seedRows: Array<Record<string, unknown>>;
}): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Identity Labs';
  wb.created = new Date();

  const tweetsSheet = wb.addWorksheet('Tweets', { views: [{ state: 'frozen', ySplit: 1 }] });
  tweetsSheet.columns = [
    { header: 'keyword', key: 'keyword', width: 18 },
    { header: 'week_since', key: 'week_since', width: 12 },
    { header: 'week_until_inclusive', key: 'week_until_inclusive', width: 18 },
    { header: 'tweet_id', key: 'tweet_id', width: 22 },
    { header: 'tweet_url', key: 'tweet_url', width: 42 },
    { header: 'created_at', key: 'created_at', width: 24 },
    { header: 'lang', key: 'lang', width: 8 },
    { header: 'like_count', key: 'like_count', width: 11 },
    { header: 'retweet_count', key: 'retweet_count', width: 13 },
    { header: 'reply_count', key: 'reply_count', width: 11 },
    { header: 'quote_count', key: 'quote_count', width: 11 },
    { header: 'view_count', key: 'view_count', width: 12 },
    { header: 'bookmark_count', key: 'bookmark_count', width: 14 },
    { header: 'is_reply', key: 'is_reply', width: 8 },
    { header: 'in_reply_to_id', key: 'in_reply_to_id', width: 22 },
    { header: 'author_username', key: 'author_username', width: 18 },
    { header: 'author_name', key: 'author_name', width: 22 },
    { header: 'author_id', key: 'author_id', width: 22 },
    { header: 'author_followers', key: 'author_followers', width: 14 },
    { header: 'author_profile_url', key: 'author_profile_url', width: 42 },
    { header: 'author_is_blue_verified', key: 'author_is_blue_verified', width: 18 },
    { header: 'text', key: 'text', width: 90 },
  ];
  tweetsSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: tweetsSheet.columns.length },
  };
  const tweetsHeader = tweetsSheet.getRow(1);
  tweetsHeader.font = { bold: true };
  tweetsHeader.alignment = { vertical: 'middle' };

  for (const r of opts.tweetRows) {
    tweetsSheet.addRow({
      ...r,
      keyword: excelSafeString(r.keyword),
      tweet_id: excelSafeString(r.tweet_id),
      tweet_url: excelSafeString(r.tweet_url),
      created_at: excelSafeString(r.created_at),
      in_reply_to_id: excelSafeString(r.in_reply_to_id),
      author_username: excelSafeString(r.author_username),
      author_name: excelSafeString(r.author_name),
      author_id: excelSafeString(r.author_id),
      author_profile_url: excelSafeString(r.author_profile_url),
      text: excelSafeString(r.text),
    });
  }

  const accountsSheet = wb.addWorksheet('Accounts', { views: [{ state: 'frozen', ySplit: 1 }] });
  accountsSheet.columns = [
    { header: 'username', key: 'username', width: 18 },
    { header: 'profile_url', key: 'profile_url', width: 42 },
    { header: 'user_id', key: 'user_id', width: 22 },
    { header: 'display_name', key: 'display_name', width: 24 },
    { header: 'followers_max', key: 'followers_max', width: 14 },
    { header: 'keywords', key: 'keywords', width: 40 },
    { header: 'weeks_appeared', key: 'weeks_appeared', width: 14 },
    { header: 'tweets_captured', key: 'tweets_captured', width: 14 },
    { header: 'peak_view_count', key: 'peak_view_count', width: 14 },
    { header: 'peak_like_count', key: 'peak_like_count', width: 14 },
    { header: 'peak_retweet_count', key: 'peak_retweet_count', width: 16 },
    { header: 'peak_reply_count', key: 'peak_reply_count', width: 14 },
    { header: 'peak_bookmark_count', key: 'peak_bookmark_count', width: 18 },
    { header: 'peak_engagement_score', key: 'peak_engagement_score', width: 20 },
    { header: 'peak_tweet_url', key: 'peak_tweet_url', width: 42 },
    { header: 'peak_week_since', key: 'peak_week_since', width: 12 },
    { header: 'weeks_list', key: 'weeks_list', width: 60 },
  ];
  accountsSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: accountsSheet.columns.length },
  };
  const accountsHeader = accountsSheet.getRow(1);
  accountsHeader.font = { bold: true };
  accountsHeader.alignment = { vertical: 'middle' };

  for (const r of opts.accountRows) {
    accountsSheet.addRow({
      ...r,
      username: excelSafeString((r as any).username),
      profile_url: excelSafeString((r as any).profile_url),
      user_id: excelSafeString((r as any).user_id),
      display_name: excelSafeString((r as any).display_name),
      keywords: excelSafeString((r as any).keywords),
      peak_tweet_url: excelSafeString((r as any).peak_tweet_url),
      weeks_list: excelSafeString((r as any).weeks_list),
    });
  }

  const seedsSheet = wb.addWorksheet('Seeds', { views: [{ state: 'frozen', ySplit: 1 }] });
  seedsSheet.columns = [
    { header: 'username', key: 'username', width: 18 },
    { header: 'profile_url', key: 'profile_url', width: 42 },
    { header: 'keywords', key: 'keywords', width: 50 },
    { header: 'followers_max', key: 'followers_max', width: 14 },
    { header: 'weeks_appeared', key: 'weeks_appeared', width: 14 },
    { header: 'tweets_captured', key: 'tweets_captured', width: 14 },
    { header: 'peak_tweet_url', key: 'peak_tweet_url', width: 42 },
    { header: 'peak_view_count', key: 'peak_view_count', width: 14 },
    { header: 'peak_engagement_score', key: 'peak_engagement_score', width: 20 },
  ];
  seedsSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: seedsSheet.columns.length },
  };
  const seedsHeader = seedsSheet.getRow(1);
  seedsHeader.font = { bold: true };
  seedsHeader.alignment = { vertical: 'middle' };
  for (const r of opts.seedRows) {
    seedsSheet.addRow({
      ...r,
      username: excelSafeString((r as any).username),
      profile_url: excelSafeString((r as any).profile_url),
      keywords: excelSafeString((r as any).keywords),
      peak_tweet_url: excelSafeString((r as any).peak_tweet_url),
    });
  }

  const todoSheet = wb.addWorksheet('Todo', { views: [{ state: 'frozen', ySplit: 1 }] });
  todoSheet.columns = [
    { header: 'status', key: 'status', width: 12 },
    { header: 'username', key: 'username', width: 18 },
    { header: 'profile_url', key: 'profile_url', width: 42 },
    { header: 'followers_max', key: 'followers_max', width: 14 },
    { header: 'keywords', key: 'keywords', width: 50 },
    { header: 'weeks_appeared', key: 'weeks_appeared', width: 14 },
    { header: 'tweets_captured', key: 'tweets_captured', width: 14 },
    { header: 'peak_tweet_url', key: 'peak_tweet_url', width: 42 },
    { header: 'peak_view_count', key: 'peak_view_count', width: 14 },
    { header: 'peak_like_count', key: 'peak_like_count', width: 14 },
    { header: 'peak_retweet_count', key: 'peak_retweet_count', width: 16 },
    { header: 'peak_reply_count', key: 'peak_reply_count', width: 14 },
    { header: 'peak_bookmark_count', key: 'peak_bookmark_count', width: 18 },
    { header: 'peak_engagement_score', key: 'peak_engagement_score', width: 20 },
    { header: 'notes', key: 'notes', width: 50 },
  ];
  todoSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: todoSheet.columns.length },
  };
  const todoHeader = todoSheet.getRow(1);
  todoHeader.font = { bold: true };
  todoHeader.alignment = { vertical: 'middle' };

  for (const r of opts.todoRows) {
    todoSheet.addRow({
      ...r,
      status: excelSafeString((r as any).status),
      username: excelSafeString((r as any).username),
      profile_url: excelSafeString((r as any).profile_url),
      keywords: excelSafeString((r as any).keywords),
      peak_tweet_url: excelSafeString((r as any).peak_tweet_url),
      notes: excelSafeString((r as any).notes),
    });
  }

  await ensureDir(path.dirname(outPath));
  await wb.xlsx.writeFile(outPath);
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      // Time scope
      startDate: { type: 'string' }, // YYYY-MM-DD (inclusive)
      endDate: { type: 'string' }, // YYYY-MM-DD (inclusive) - default today UTC
      weeks: { type: 'string' }, // default 60, used only if startDate not provided

      // Query
      queryBase: { type: 'string' }, // no time operators here (we'll add since/until)
      queryFile: { type: 'string' }, // optional file for queryBase
      keywords: { type: 'string' }, // comma-separated keywords (optional)
      keywordsFile: { type: 'string' }, // newline-separated keywords (optional)
      lang: { type: 'string' }, // e.g. "en" (optional)
      minFaves: { type: 'string' }, // twitter advanced search operator: min_faves:N (optional)
      minRetweets: { type: 'string' }, // optional (not requested, but handy)
      minReplies: { type: 'string' }, // optional (not requested, but handy)
      minViewCount: { type: 'string' }, // NOTE: applied post-fetch based on tweet.viewCount (optional)
      todoMinViewCount: { type: 'string' }, // default 50000. Filter for Todo sheet (not the raw Tweets/Accounts).
      queryType: { type: 'string' }, // Top|Latest (default Top)
      tweetsPerWeek: { type: 'string' }, // default 50

      // Perf / cost knobs
      maxPagesPerWeek: { type: 'string' }, // default 3 (20/page -> ~60 tweets; we cap to 50)
      pageDelayMs: { type: 'string' }, // default 0 (global QPS limiter handles pacing)
      retries: { type: 'string' }, // default 2
      weekConcurrency: { type: 'string' }, // default 1
      qps: { type: 'string' }, // default 2
      keyType: { type: 'string' }, // shared|monitor (default shared)

      // Output / cache
      out: { type: 'string' }, // default viral-accounts-year.xlsx/csv based on --format
      format: { type: 'string' }, // xlsx|csv
      cacheDir: { type: 'string' }, // default data/viral-weekly/cache
      seedOut: { type: 'string' }, // optional: write deduped seeds (profile URLs) to .txt
      force: { type: 'boolean' }, // refetch even if cached
      logFile: { type: 'string' }, // optional JSONL
    },
    allowPositionals: true,
  });

  // Query base (optional). PowerShell may split, so accept positionals too.
  let queryBase = '';
  if (values.queryFile) {
    queryBase = (await fs.readFile(String(values.queryFile), { encoding: 'utf8' })).trim();
  } else if (values.queryBase) {
    queryBase = String(values.queryBase).trim();
  }
  if (Array.isArray(positionals) && positionals.length > 0) {
    const pos = positionals.join(' ').trim();
    if (pos) queryBase = queryBase ? `${queryBase} ${pos}`.trim() : pos;
  }
  queryBase = stripTimeOperators(queryBase.replace(/\s+/g, ' ').trim());

  const lang = typeof values.lang === 'string' && values.lang.trim() ? values.lang.trim() : '';
  const minFaves = parseOptionalNonNegativeInt(values.minFaves);
  const minRetweets = parseOptionalNonNegativeInt(values.minRetweets);
  const minReplies = parseOptionalNonNegativeInt(values.minReplies);
  const minViewCount = parseOptionalNonNegativeInt(values.minViewCount);
  const todoMinViewCount = parseOptionalNonNegativeInt(values.todoMinViewCount) ?? 50_000;

  const queryType = normalizeQueryType(values.queryType);
  const tweetsPerWeek = clampInt(values.tweetsPerWeek, 50, 1, 200);
  const maxPagesPerWeek = clampInt(values.maxPagesPerWeek, 3, 1, 50);
  const pageDelayMs = clampInt(values.pageDelayMs, 0, 0, 5000);
  const retries = clampInt(values.retries, 2, 0, 6);
  const weekConcurrency = clampInt(values.weekConcurrency, 1, 1, 8);
  const qps = clampInt(values.qps, 2, 1, 50);
  const keyType = normalizeKeyType(values.keyType);
  const limiter = createRateLimiter(qps);
  const apiKeyPresent = Boolean(getTwitterApiKey(keyType));

  const endDateInclusive = parseIsoDate(values.endDate) ?? startOfDayUTC(new Date());
  const weeks = clampInt(values.weeks, 60, 1, 260);
  const startDateFromArg = parseIsoDate(values.startDate);
  const startDateInclusive = startDateFromArg ?? addDaysUTC(endDateInclusive, -7 * weeks);

  const format = normalizeFormat(values.format);
  const cacheDir = String(values.cacheDir || path.resolve(process.cwd(), 'data', 'viral-weekly', 'cache'));
  const force = Boolean(values.force);
  const logFilePath = values.logFile ? String(values.logFile) : undefined;
  const defaultOut = format === 'csv' ? 'viral-tweets-and-accounts.csv' : 'viral-accounts-year.xlsx';
  const outPath = String(values.out || path.resolve(process.cwd(), defaultOut));
  const seedOutPath = typeof values.seedOut === 'string' && values.seedOut.trim() ? String(values.seedOut).trim() : '';

  // Build a final query base by appending operators (no keywords unless user provides them).
  const operatorParts: string[] = [];
  if (lang) operatorParts.push(`lang:${lang}`);
  if (minFaves !== null) operatorParts.push(`min_faves:${minFaves}`);
  if (minRetweets !== null) operatorParts.push(`min_retweets:${minRetweets}`);
  if (minReplies !== null) operatorParts.push(`min_replies:${minReplies}`);
  const queryBaseFinal = stripTimeOperators(`${queryBase} ${operatorParts.join(' ')}`.replace(/\s+/g, ' ').trim());

  // Keyword list (optional). If not provided, we run a single "no keyword" pass.
  let keywordsList: string[] = ['']; // '' = no keyword
  if (typeof values.keywordsFile === 'string' && values.keywordsFile.trim()) {
    keywordsList = await readKeywordListFromFile(String(values.keywordsFile).trim());
  } else if (typeof values.keywords === 'string' && values.keywords.trim()) {
    keywordsList = splitKeywordsCsv(values.keywords);
  }
  keywordsList = keywordsList.map((k) => k.trim()).filter((k) => k.length > 0);
  if (keywordsList.length === 0) keywordsList = [''];

  log(
    'info',
    'start',
    {
      queryType,
      queryBaseLen: queryBaseFinal.length,
      keywordsCount: keywordsList[0] === '' ? 0 : keywordsList.length,
      lang: lang || null,
      minFaves,
      minRetweets,
      minReplies,
      minViewCount,
      todoMinViewCount,
      seedOutPath: seedOutPath || null,
      tweetsPerWeek,
      maxPagesPerWeek,
      pageDelayMs,
      retries,
      weekConcurrency,
      qps: limiter.qps,
      keyType,
      apiKeyPresent,
      startDate: formatIsoDateUTC(startDateInclusive),
      endDate: formatIsoDateUTC(endDateInclusive),
      cacheDir,
      force,
      format,
      outPath,
      apiUrl: process.env.TWITTER_API_URL || 'https://api.twitterapi.io',
      logFilePath: logFilePath || null,
    },
    logFilePath,
  );

  // ---- Questions / decisions (encoded as flags, not interactive prompts) ----
  // 1) Do you want to exclude replies and/or retweets for "creator-first" datasets?
  //    - Recommended for influencer discovery:
  //      --queryBase "-filter:replies -filter:retweets"
  // 2) Do you want language constraints (less noise, but more bias)?
  //    - Example:
  //      --queryBase "lang:en -filter:replies -filter:retweets"
  // 3) What does “viral” mean for you: views-led vs engagement-led?
  //    - We currently compute `peak_engagement_score = likes + 2*retweets + replies + quotes + bookmarks`
  //    - If you want to rank by views instead, sort by `peak_view_count` in the Accounts sheet.

  if (!apiKeyPresent) {
    throw new Error(
      [
        'Missing Twitter API key environment variable.',
        '',
        'Set one of:',
        '- TWITTER_API_KEY_SHARED (recommended for batch scripts)',
        '- TWITTER_API_KEY (fallback)',
        '',
        'Example (PowerShell):',
        '  $env:TWITTER_API_KEY_SHARED=\"...\"',
        '  npx tsx scripts/viral-accounts-year.ts --weeks 60 --tweetsPerWeek 50 --out viral-accounts-year.xlsx',
      ].join('\n'),
    );
  }

  const windows = buildWeeklyWindows({ startDateInclusive, endDateInclusive });
  if (windows.length === 0) {
    throw new Error('No weekly windows computed (check --startDate/--endDate).');
  }

  await ensureDir(cacheDir);

  const tweetRows: TweetRow[] = [];

  // Build tasks = keyword × week
  const tasks: Array<{ keyword: string; window: WeekWindow }> = [];
  for (const kw of keywordsList) {
    for (const w of windows) tasks.push({ keyword: kw, window: w });
  }

  let nextIndex = 0;
  const worker = async (workerId: number) => {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= tasks.length) return;
      const task = tasks[i]!;
      const w = task.window;
      const keyword = task.keyword;
      const sinceStr = formatIsoDateUTC(w.since);
      const untilExclusiveStr = formatIsoDateUTC(w.untilExclusive);
      const untilInclusiveStr = formatIsoDateUTC(addDaysUTC(w.untilExclusive, -1));

      const kwPrefix = keyword ? `(${keyword})` : '';
      const query = `${kwPrefix} ${queryBaseFinal} since:${sinceStr} until:${untilExclusiveStr}`.replace(/\s+/g, ' ').trim();
      // Must not be empty: at minimum it includes time operators.
      if (!query) {
        throw new Error('Computed query is empty. This should be unreachable.');
      }

      const cacheSig = [
        `qt=${queryType}`,
        `kw=${keyword || 'none'}`,
        `lang=${lang || 'any'}`,
        `f=${minFaves ?? 'na'}`,
        `rt=${minRetweets ?? 'na'}`,
        `rp=${minReplies ?? 'na'}`,
        `v=${minViewCount ?? 'na'}`,
      ].join('_');
      const cacheFile = path.join(
        cacheDir,
        `week_${sinceStr}_to_${untilInclusiveStr}__${toCacheSafeToken(cacheSig)}.json`,
      );

      let cached: CachedWeek | null = null;
      if (!force && existsSync(cacheFile)) {
        try {
          const text = await fs.readFile(cacheFile, { encoding: 'utf8' });
          cached = JSON.parse(text) as CachedWeek;
        } catch {
          cached = null;
        }
      }

      if (cached && Array.isArray(cached.tweets)) {
        log('info', 'week_cache_hit', { workerId, keyword, index: w.index, total: w.total, since: sinceStr, untilInclusive: untilInclusiveStr, cacheFile }, logFilePath);
        for (const t of cached.tweets) {
          tweetRows.push(toTweetRow(t, keyword, sinceStr, untilInclusiveStr));
        }
        continue;
      }

      log('info', 'week_fetch_start', { workerId, keyword, index: w.index, total: w.total, since: sinceStr, untilExclusive: untilExclusiveStr, tweetsPerWeek, maxPagesPerWeek }, logFilePath);

      try {
        const filterFn =
          minViewCount !== null
            ? (t: AdvancedSearchTweet) => Math.floor(coerceNumber((t as any).viewCount)) >= minViewCount
            : undefined;

        const fetched = await fetchTopTweetsForWeek({
          query,
          queryType,
          keyType,
          tweetsPerWeek,
          maxPages: maxPagesPerWeek,
          limiter,
          pageDelayMs,
          retries,
          tweetFilter: filterFn,
          logFilePath,
          weekLabel: { since: sinceStr, untilExclusive: untilExclusiveStr, index: w.index, total: w.total },
        });

        const payload: CachedWeek = {
          version: 1,
          fetchedAt: nowIso(),
          queryType,
          keyType,
          query,
          weekSince: sinceStr,
          weekUntilInclusive: untilInclusiveStr,
          weekUntilExclusive: untilExclusiveStr,
          tweets: fetched.tweets,
          meta: { pagesFetched: fetched.pagesFetched, stoppedBecause: fetched.stoppedBecause },
        };
        await fs.writeFile(cacheFile, JSON.stringify(payload, null, 2), { encoding: 'utf8' });

        for (const t of fetched.tweets) {
          tweetRows.push(toTweetRow(t, keyword, sinceStr, untilInclusiveStr));
        }

        log('info', 'week_fetch_done', { workerId, keyword, index: w.index, total: w.total, since: sinceStr, tweets: fetched.tweets.length, cacheFile }, logFilePath);
      } catch (e) {
        // Persist a "failed" cache entry? We intentionally do NOT, so reruns can recover.
        throw e;
      }
    }
  };

  const workers = Array.from({ length: Math.min(weekConcurrency, tasks.length) }, (_, idx) => worker(idx + 1));
  await Promise.all(workers);

  // Aggregate accounts
  const accounts = new Map<string, AccountAgg>();
  for (const r of tweetRows) {
    const key = accountKeyForRow(r);
    const existing = accounts.get(key);
    const week = r.week_since;
    const score = engagementScore(r);

    const base: AccountAgg =
      existing ??
      ({
        key,
        username: r.author_username,
        user_id: r.author_id,
        profile_url: r.author_profile_url,
        display_name: r.author_name,
        followers_max: r.author_followers,
        tweets_captured: 0,
        weeks_appeared: new Set<string>(),
        peak_view_count: 0,
        peak_like_count: 0,
        peak_retweet_count: 0,
        peak_reply_count: 0,
        peak_bookmark_count: 0,
        peak_engagement_score: 0,
        peak_tweet_url: '',
        peak_week_since: '',
        keywords: new Set<string>(),
      } satisfies AccountAgg);

    base.tweets_captured += 1;
    base.weeks_appeared.add(week);
    if (r.keyword) base.keywords.add(r.keyword);

    // Some weeks may produce missing author fields; only overwrite if current has a value.
    if (!base.username && r.author_username) base.username = r.author_username;
    if (!base.user_id && r.author_id) base.user_id = r.author_id;
    if (!base.profile_url && r.author_profile_url) base.profile_url = r.author_profile_url;
    if (!base.display_name && r.author_name) base.display_name = r.author_name;

    base.followers_max = Math.max(base.followers_max, r.author_followers);
    base.peak_view_count = Math.max(base.peak_view_count, r.view_count);
    base.peak_like_count = Math.max(base.peak_like_count, r.like_count);
    base.peak_retweet_count = Math.max(base.peak_retweet_count, r.retweet_count);
    base.peak_reply_count = Math.max(base.peak_reply_count, r.reply_count);
    base.peak_bookmark_count = Math.max(base.peak_bookmark_count, r.bookmark_count);

    if (score > base.peak_engagement_score) {
      base.peak_engagement_score = score;
      base.peak_tweet_url = r.tweet_url;
      base.peak_week_since = r.week_since;
    }

    accounts.set(key, base);
  }

  const accountRows = Array.from(accounts.values())
    .map((a) => ({
      username: a.username,
      profile_url: a.profile_url || (a.username ? `https://x.com/${a.username}` : ''),
      user_id: a.user_id,
      display_name: a.display_name,
      followers_max: a.followers_max,
      keywords: Array.from(a.keywords).sort().join(', '),
      weeks_appeared: a.weeks_appeared.size,
      tweets_captured: a.tweets_captured,
      peak_view_count: a.peak_view_count,
      peak_like_count: a.peak_like_count,
      peak_retweet_count: a.peak_retweet_count,
      peak_reply_count: a.peak_reply_count,
      peak_bookmark_count: a.peak_bookmark_count,
      peak_engagement_score: a.peak_engagement_score,
      peak_tweet_url: a.peak_tweet_url,
      peak_week_since: a.peak_week_since,
      weeks_list: Array.from(a.weeks_appeared).sort().join(', '),
    }))
    .sort((a, b) => {
      // Primary: more weeks appeared. Secondary: higher peak engagement score. Tertiary: followers.
      const dw = (b.weeks_appeared as number) - (a.weeks_appeared as number);
      if (dw !== 0) return dw;
      const ds = (b.peak_engagement_score as number) - (a.peak_engagement_score as number);
      if (ds !== 0) return ds;
      return (b.followers_max as number) - (a.followers_max as number);
    });

  log('info', 'aggregate_done', { tweets: tweetRows.length, uniqueAccounts: accountRows.length }, logFilePath);

  // Todo list: deduped influencers that crossed a "viral" view threshold at least once.
  // This is the sheet you’ll actually work from for outreach.
  const todoRows = accountRows
    .filter((r) => {
      const username = String((r as any).username ?? '').trim();
      if (!username) return false;
      const peakViews = Number((r as any).peak_view_count ?? 0) || 0;
      return peakViews >= todoMinViewCount;
    })
    .map((r) => ({
      status: 'todo',
      username: (r as any).username,
      profile_url: (r as any).profile_url,
      followers_max: (r as any).followers_max,
      keywords: (r as any).keywords,
      weeks_appeared: (r as any).weeks_appeared,
      tweets_captured: (r as any).tweets_captured,
      peak_tweet_url: (r as any).peak_tweet_url,
      peak_view_count: (r as any).peak_view_count,
      peak_like_count: (r as any).peak_like_count,
      peak_retweet_count: (r as any).peak_retweet_count,
      peak_reply_count: (r as any).peak_reply_count,
      peak_bookmark_count: (r as any).peak_bookmark_count,
      peak_engagement_score: (r as any).peak_engagement_score,
      notes: '',
    }))
    .sort((a, b) => {
      // Primary: peak views. Secondary: weeks appeared. Tertiary: peak engagement score.
      const dv = (Number(b.peak_view_count) || 0) - (Number(a.peak_view_count) || 0);
      if (dv !== 0) return dv;
      const dw = (Number(b.weeks_appeared) || 0) - (Number(a.weeks_appeared) || 0);
      if (dw !== 0) return dw;
      return (Number(b.peak_engagement_score) || 0) - (Number(a.peak_engagement_score) || 0);
    });

  // Seed list: ALL deduped accounts (for feeding into influencer sorting / metrics scripts).
  const seedRows = accountRows.map((r) => ({
    username: (r as any).username,
    profile_url: (r as any).profile_url,
    keywords: (r as any).keywords,
    followers_max: (r as any).followers_max,
    weeks_appeared: (r as any).weeks_appeared,
    tweets_captured: (r as any).tweets_captured,
    peak_tweet_url: (r as any).peak_tweet_url,
    peak_view_count: (r as any).peak_view_count,
    peak_engagement_score: (r as any).peak_engagement_score,
  }));

  if (seedOutPath) {
    // Write one profile URL per line (safe for influencer-metrics-export input).
    const lines = seedRows
      .map((r) => String((r as any).profile_url ?? '').trim())
      .filter(Boolean);
    await ensureDir(path.dirname(seedOutPath));
    await fs.writeFile(seedOutPath, lines.join('\n') + '\n', { encoding: 'utf8' });
    log('info', 'seed_written', { seedOutPath, seeds: lines.length }, logFilePath);
  }

  if (format === 'csv') {
    // CSV mode: write multiple CSVs (tweets + accounts + todo).
    const base = outPath.endsWith('.csv') ? outPath.slice(0, -4) : outPath;
    const tweetsCsv = `${base}.tweets.csv`;
    const accountsCsv = `${base}.accounts.csv`;
    const todoCsv = `${base}.todo.csv`;
    const seedCsv = `${base}.seeds.csv`;

    await writeCsv(
      tweetsCsv,
      tweetRows,
      [
        'keyword',
        'week_since',
        'week_until_inclusive',
        'tweet_id',
        'tweet_url',
        'created_at',
        'lang',
        'like_count',
        'retweet_count',
        'reply_count',
        'quote_count',
        'view_count',
        'bookmark_count',
        'is_reply',
        'in_reply_to_id',
        'author_username',
        'author_name',
        'author_id',
        'author_followers',
        'author_profile_url',
        'author_is_blue_verified',
        'text',
      ],
    );
    await writeCsv(
      accountsCsv,
      accountRows,
      [
        'username',
        'profile_url',
        'user_id',
        'display_name',
        'followers_max',
        'keywords',
        'weeks_appeared',
        'tweets_captured',
        'peak_view_count',
        'peak_like_count',
        'peak_retweet_count',
        'peak_reply_count',
        'peak_bookmark_count',
        'peak_engagement_score',
        'peak_tweet_url',
        'peak_week_since',
        'weeks_list',
      ],
    );

    await writeCsv(
      todoCsv,
      todoRows,
      [
        'status',
        'username',
        'profile_url',
        'followers_max',
        'keywords',
        'weeks_appeared',
        'tweets_captured',
        'peak_tweet_url',
        'peak_view_count',
        'peak_like_count',
        'peak_retweet_count',
        'peak_reply_count',
        'peak_bookmark_count',
        'peak_engagement_score',
        'notes',
      ],
    );

    await writeCsv(
      seedCsv,
      seedRows,
      [
        'username',
        'profile_url',
        'keywords',
        'followers_max',
        'weeks_appeared',
        'tweets_captured',
        'peak_tweet_url',
        'peak_view_count',
        'peak_engagement_score',
      ],
    );

    log('info', 'written', { tweetsCsv, accountsCsv, todoCsv, seedCsv }, logFilePath);
    return;
  }

  await writeXlsx(outPath, { tweetRows, accountRows, todoRows, seedRows });
  log('info', 'written', { outPath }, logFilePath);
}

main().catch((error) => {
  // Keep error surface consistent with other scripts.
  const msg = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ts: nowIso(), level: 'error', event: 'fatal', message: msg }));
  if (error instanceof TwitterApiError) {
    console.error(JSON.stringify({ ts: nowIso(), level: 'error', event: 'twitter_api_error', statusCode: error.statusCode, retryable: error.isRetryable, context: error.context }));
  }
  process.exitCode = 1;
});

