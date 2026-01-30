/**
 * CLI: Advanced Search bulk export with pagination + logs.
 *
 * Runs server-side (Node) and writes an Excel (.xlsx) or CSV to disk.
 *
 * Usage (PowerShell):
 *   npx tsx scripts/advanced-search-export.ts --format xlsx --query "(foo OR bar) since:2024-01-01 -from:baz" --queryType Latest --maxPages 500 --maxTweets 10000 --out out.xlsx
 *
 * Split mode (3-month windows, sequential) + combined workbook:
 *   npx tsx scripts/advanced-search-export.ts --format xlsx --queryFile query.txt --queryType Latest --splitMonths 3 --startDate 2024-01-01 --endDate 2025-12-31 --outPrefix elevenlabs --combineOut all.xlsx
 *
 * Split mode (3-month windows) in batches (concurrent windows) with global QPS limiter:
 *   npx tsx scripts/advanced-search-export.ts --format xlsx --queryFile query.txt --queryType Latest --splitMonths 3 --startDate 2024-01-01 --endDate 2025-12-31 --outPrefix elevenlabs --combineOut all.xlsx --windowConcurrency 2 --qps 2
 *
 * Notes:
 * - This script reads TWITTER_API_URL and TWITTER_API_KEY_* from env (same as the app).
 * - It will stop early if the API stops returning cursors or if caps are hit.
 */

import 'dotenv/config';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { appendFileSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { fetchAdvancedSearchPage, type AdvancedSearchQueryType } from '@/lib/twitter-advanced-search';
import { TwitterApiError } from '@/lib/external-api';
import type { TwitterApiKeyType } from '@/lib/config/twitter-api-config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function nowIso() {
  return new Date().toISOString();
}

function log(level: LogLevel, event: string, data: Record<string, unknown> = {}, logFilePath?: string) {
  // One-line JSON logs (easy to copy/paste into log tools)
  const payload = { ts: nowIso(), level, event, ...data };
  const line = JSON.stringify(payload);
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, line + '\n', { encoding: 'utf8' });
    } catch (e) {
      // If we can't write logs, still proceed with console logging.
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(JSON.stringify({ ts: nowIso(), level: 'warn', event: 'log_file_write_failed', message: msg, logFilePath }));
    }
  }
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function cursorPreview(cursor: string) {
  if (!cursor) return { present: false, len: 0, head: '' };
  const head = cursor.slice(0, 16);
  const tail = cursor.length > 16 ? cursor.slice(-8) : '';
  return { present: true, len: cursor.length, head, tail };
}

function excelSafeString(value: unknown): string {
  const s = String(value ?? '');
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  // Excel formula injection guard: prefix dangerous leading chars.
  const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
  const needsQuotes = /[",\n\r]/.test(guarded);
  const escaped = guarded.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeQueryType(value: unknown): AdvancedSearchQueryType {
  return value === 'Top' ? 'Top' : 'Latest';
}

function normalizeKeyType(value: unknown): TwitterApiKeyType {
  return value === 'monitor' ? 'monitor' : 'shared';
}

function normalizeFormat(value: unknown): 'xlsx' | 'csv' {
  if (value === 'csv') return 'csv';
  return 'xlsx';
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

function addMonthsUTC(d: Date, months: number): Date {
  // Use first of month to avoid month-length rollover surprises.
  const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  base.setUTCMonth(base.getUTCMonth() + months);
  return base;
}

function stripTimeOperators(query: string): string {
  return query
    .replace(/\s+since:\d{4}-\d{2}-\d{2}\b/gi, '')
    .replace(/\s+until:\d{4}-\d{2}-\d{2}\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function createRateLimiter(qps: number) {
  const safeQps = Math.max(0.1, Math.min(50, qps));
  const minIntervalMs = Math.ceil(1000 / safeQps);
  let nextAllowedAt = 0;
  let chain = Promise.resolve();

  const acquire = async () => {
    // Serialize acquire calls to preserve ordering.
    await (chain = chain.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, nextAllowedAt - now);
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }
      nextAllowedAt = Date.now() + minIntervalMs;
    }));
  };

  return { acquire, minIntervalMs, qps: safeQps };
}

async function runExport(opts: {
  query: string;
  queryType: AdvancedSearchQueryType;
  format: 'xlsx' | 'csv';
  maxPages: number;
  maxTweets: number;
  delayMs: number;
  keyType: TwitterApiKeyType;
  logEvery: number;
  outPath: string;
  logFilePath?: string;
  limiter?: { acquire: () => Promise<void>; minIntervalMs: number; qps: number };
  window?: { index: number; total: number; since: string; untilExclusive: string };
  combine?: {
    // Combined workbook sink (for split mode)
    sheet: ExcelJS.Worksheet;
    // Global dedupe across all windows (tweet id)
    seen: Set<string>;
    // Window metadata to attach to each row
    windowSince: string;
    windowUntilInclusive: string;
  };
}) {
  const {
    query,
    queryType,
    format,
    maxPages,
    maxTweets,
    delayMs,
    keyType,
    logEvery,
    outPath,
    logFilePath,
    window,
  } = opts;

  const startedAt = Date.now();
  const expectedPagesForMaxTweets = Math.ceil(maxTweets / 20);
  let cursor = '';
  let pagesFetched = 0;
  let hasNext = true;
  let nextCursor = '';
  let duplicatesSkipped = 0;
  const seen = new Set<string>();

  // CSV lines (only used when format=csv)
  const lines: string[] = [];
  if (format === 'csv') {
    const header = [
      'id',
      'url',
      'isReply',
      'inReplyToId',
      'conversationId',
      'inReplyToUserId',
      'inReplyToUsername',
      'createdAt',
      'lang',
      'authorUserName',
      'authorName',
      'likeCount',
      'replyCount',
      'retweetCount',
      'quoteCount',
      'viewCount',
      'text',
    ];
    lines.push('\uFEFF' + header.map(csvEscape).join(','));
  }

  // Excel workbook (only used when format=xlsx)
  const workbook = format === 'xlsx' ? new ExcelJS.Workbook() : null;
  const sheet =
    format === 'xlsx'
      ? workbook!.addWorksheet('Tweets', { views: [{ state: 'frozen', ySplit: 1 }] })
      : null;
  if (sheet) {
    workbook!.creator = 'Identity Labs';
    workbook!.created = new Date();
    sheet.columns = [
      { header: 'id', key: 'id', width: 22 },
      { header: 'url', key: 'url', width: 42 },
      { header: 'isReply', key: 'isReply', width: 8 },
      { header: 'inReplyToId', key: 'inReplyToId', width: 22 },
      { header: 'conversationId', key: 'conversationId', width: 22 },
      { header: 'inReplyToUserId', key: 'inReplyToUserId', width: 22 },
      { header: 'inReplyToUsername', key: 'inReplyToUsername', width: 18 },
      { header: 'createdAt', key: 'createdAt', width: 24 },
      { header: 'lang', key: 'lang', width: 8 },
      { header: 'authorUserName', key: 'authorUserName', width: 18 },
      { header: 'authorName', key: 'authorName', width: 22 },
      { header: 'likeCount', key: 'likeCount', width: 10 },
      { header: 'replyCount', key: 'replyCount', width: 10 },
      { header: 'retweetCount', key: 'retweetCount', width: 12 },
      { header: 'quoteCount', key: 'quoteCount', width: 10 },
      { header: 'viewCount', key: 'viewCount', width: 12 },
      { header: 'text', key: 'text', width: 90 },
    ];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle' };
  }

  let stoppedBecause: string = 'completed';

  while (hasNext) {
    if (pagesFetched >= maxPages) {
      stoppedBecause = 'maxPages';
      break;
    }
    if (seen.size >= maxTweets) {
      stoppedBecause = 'maxTweets';
      break;
    }

    const pageStart = Date.now();
    if (opts.limiter) {
      await opts.limiter.acquire();
    }
    const page = await fetchAdvancedSearchPage({
      query,
      queryType,
      cursor,
      retries: 2,
      keyType,
    });

    pagesFetched += 1;
    const elapsed = Date.now() - pageStart;
    const totalElapsed = Date.now() - startedAt;
    const avgMsPerPage = Math.round(totalElapsed / Math.max(1, pagesFetched));
    const etaMsForCaps = avgMsPerPage * Math.max(0, Math.min(maxPages, expectedPagesForMaxTweets) - pagesFetched);

    let addedThisPage = 0;
    for (const t of page.tweets || []) {
      if (!t?.id) continue;
      if (seen.has(t.id)) {
        duplicatesSkipped += 1;
        continue;
      }
      seen.add(t.id);
      addedThisPage += 1;

      if (format === 'csv') {
        const row = [
          t.id,
          t.url ?? '',
          Boolean((t as any).isReply),
          (t as any).inReplyToId ?? '',
          (t as any).conversationId ?? '',
          (t as any).inReplyToUserId ?? '',
          (t as any).inReplyToUsername ?? '',
          t.createdAt ?? '',
          t.lang ?? '',
          t.author?.userName ?? '',
          t.author?.name ?? '',
          t.likeCount ?? 0,
          t.replyCount ?? 0,
          t.retweetCount ?? 0,
          t.quoteCount ?? 0,
          t.viewCount ?? 0,
          t.text ?? '',
        ];
        lines.push(row.map(csvEscape).join(','));
      } else if (sheet) {
        const rowObj = {
          id: excelSafeString(t.id),
          url: excelSafeString(t.url ?? ''),
          isReply: Boolean((t as any).isReply),
          inReplyToId: excelSafeString((t as any).inReplyToId ?? ''),
          conversationId: excelSafeString((t as any).conversationId ?? ''),
          inReplyToUserId: excelSafeString((t as any).inReplyToUserId ?? ''),
          inReplyToUsername: excelSafeString((t as any).inReplyToUsername ?? ''),
          createdAt: excelSafeString(t.createdAt ?? ''),
          lang: excelSafeString(t.lang ?? ''),
          authorUserName: excelSafeString(t.author?.userName ?? ''),
          authorName: excelSafeString(t.author?.name ?? ''),
          likeCount: t.likeCount ?? 0,
          replyCount: t.replyCount ?? 0,
          retweetCount: t.retweetCount ?? 0,
          quoteCount: t.quoteCount ?? 0,
          viewCount: t.viewCount ?? 0,
          text: excelSafeString(t.text ?? ''),
        };
        sheet.addRow(rowObj);

        // Also append to combined workbook (global dedupe across windows)
        if (opts.combine) {
          if (!opts.combine.seen.has(t.id)) {
            opts.combine.seen.add(t.id);
            opts.combine.sheet.addRow({
              windowSince: opts.combine.windowSince,
              windowUntil: opts.combine.windowUntilInclusive,
              ...rowObj,
            });
          }
        }
      }

      if (seen.size >= maxTweets) break;
    }

    hasNext = Boolean(page.has_next_page);
    nextCursor = page.next_cursor || '';

    if (pagesFetched === 1 || pagesFetched % logEvery === 0) {
      log(
        'info',
        'page',
        {
          ...(window ? { window } : {}),
          page: pagesFetched,
          elapsedMs: elapsed,
          returned: page.tweets?.length ?? 0,
          added: addedThisPage,
          totalUnique: seen.size,
          duplicatesSkipped,
          hasNext,
          cursorHead: cursorPreview(cursor),
          nextCursorHead: cursorPreview(nextCursor),
          avgMsPerPage,
          etaMsApprox: etaMsForCaps,
          caps: { maxPages, maxTweets },
        },
        logFilePath
      );
    }

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
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (format === 'csv') {
    const csv = lines.join('\n');
    writeFileSync(outPath, csv, { encoding: 'utf8' });
  } else if (workbook) {
    const buffer = await workbook.xlsx.writeBuffer();
    writeFileSync(outPath, Buffer.from(buffer as ArrayBuffer));
  }

  log(
    'info',
    'done',
    {
      ...(window ? { window } : {}),
      outPath,
      tweetsWrittenUnique: seen.size,
      pagesFetched,
      maxPages,
      maxTweets,
      duplicatesSkipped,
      stoppedBecause,
      elapsedMs: Date.now() - startedAt,
      lastCursor: cursorPreview(cursor),
      lastNextCursor: cursorPreview(nextCursor),
      rowsWritten: seen.size,
    },
    logFilePath
  );

  return { tweetsWrittenUnique: seen.size, pagesFetched, stoppedBecause };
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      query: { type: 'string', short: 'q' },
      queryFile: { type: 'string' }, // read query from file to avoid shell quoting issues
      queryType: { type: 'string' }, // Latest | Top
      format: { type: 'string' }, // xlsx | csv
      maxPages: { type: 'string' },
      maxTweets: { type: 'string' },
      delayMs: { type: 'string' },
      out: { type: 'string' },
      keyType: { type: 'string' }, // shared | monitor
      logEvery: { type: 'string' }, // log every N pages
      logFile: { type: 'string' }, // optional JSONL log file path
      splitMonths: { type: 'string' }, // e.g. 3
      startDate: { type: 'string' }, // YYYY-MM-DD (inclusive)
      endDate: { type: 'string' }, // YYYY-MM-DD (inclusive)
      outPrefix: { type: 'string' }, // used in split mode
      combineOut: { type: 'string' }, // if set, also write a single combined workbook
      windowConcurrency: { type: 'string' }, // how many windows to run in parallel
      qps: { type: 'string' }, // global API QPS across all windows
    },
    // PowerShell quoting can sometimes split a long query into multiple args.
    // We accept positionals and recombine them into the query (with a warning).
    allowPositionals: true,
  });

  let query = '';
  if (values.queryFile) {
    const p = String(values.queryFile);
    query = readFileSync(p, { encoding: 'utf8' }).trim();
  } else {
    query = String(values.query || '').trim();
  }

  if (Array.isArray(positionals) && positionals.length > 0) {
    const pos = positionals.join(' ').trim();
    if (pos) {
      if (query) {
        log('warn', 'positionals_detected_appending_to_query', {
          positionalsCount: positionals.length,
          positionalsPreview: pos.slice(0, 80),
        });
        query = `${query} ${pos}`.trim();
      } else {
        log('warn', 'positionals_used_as_query', {
          positionalsCount: positionals.length,
          positionalsPreview: pos.slice(0, 80),
        });
        query = pos;
      }
    }
  }
  // Normalize whitespace/newlines so multi-line here-strings behave.
  query = query.replace(/\s+/g, ' ').trim();
  if (!query) {
    throw new Error('Missing required --query (or --queryFile)');
  }

  const queryType = normalizeQueryType(values.queryType);
  const format = normalizeFormat(values.format);
  const maxPages = clampInt(values.maxPages, 200, 1, 5000);
  const maxTweets = clampInt(values.maxTweets, 2000, 1, 50000);
  const delayMs = clampInt(values.delayMs, 350, 0, 5000);
  const keyType = normalizeKeyType(values.keyType);
  const logEvery = clampInt(values.logEvery, 1, 1, 1000);
  const logFilePath = values.logFile ? String(values.logFile) : undefined;

  const defaultExt = format === 'csv' ? 'csv' : 'xlsx';
  const outPath = values.out || `advanced-search-${queryType.toLowerCase()}-${Date.now()}.${defaultExt}`;
  const splitMonths = values.splitMonths ? clampInt(values.splitMonths, 0, 0, 12) : 0;
  const startDate = parseIsoDate(values.startDate);
  const endDateInclusive = parseIsoDate(values.endDate);
  const outPrefix = values.outPrefix ? String(values.outPrefix) : `advanced-search-${queryType.toLowerCase()}`;
  const combineOut = values.combineOut ? String(values.combineOut) : undefined;
  const windowConcurrency = values.windowConcurrency ? clampInt(values.windowConcurrency, 1, 1, 8) : 1;
  const qps = values.qps ? clampInt(values.qps, 2, 1, 50) : 2;
  const limiter = createRateLimiter(qps);

  log('info', 'start', {
    queryType,
    format,
    maxPages,
    maxTweets,
    delayMs,
    keyType,
    outPath,
    queryLen: query.length,
    apiUrl: process.env.TWITTER_API_URL || 'https://api.twitterapi.io',
    logFilePath: logFilePath || null,
    splitMonths,
    startDate: startDate ? formatIsoDateUTC(startDate) : null,
    endDate: endDateInclusive ? formatIsoDateUTC(endDateInclusive) : null,
    outPrefix,
    combineOut: combineOut || null,
    windowConcurrency,
    qps: limiter.qps,
    qpsMinIntervalMs: limiter.minIntervalMs,
  }, logFilePath);

  if (splitMonths > 0) {
    if (!startDate || !endDateInclusive) {
      throw new Error('When using --splitMonths, you must also pass --startDate and --endDate (YYYY-MM-DD).');
    }
    if (startDate.getTime() > endDateInclusive.getTime()) {
      throw new Error('--startDate must be <= --endDate');
    }

    // Twitter search semantics: until: is BEFORE (NOT inclusive).
    // We treat --endDate as inclusive and convert to endExclusive = endDate + 1 day.
    const endExclusive = new Date(endDateInclusive.getTime() + 24 * 60 * 60 * 1000);
    const baseQuery = stripTimeOperators(query);
    if (baseQuery !== query) {
      log('warn', 'stripped_existing_time_operators', { beforeLen: query.length, afterLen: baseQuery.length }, logFilePath);
    }

    // Create calendar-aligned windows starting at the month of startDate.
    const startMonth = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
    const endMonth = new Date(Date.UTC(endDateInclusive.getUTCFullYear(), endDateInclusive.getUTCMonth(), 1));

    const windows: Array<{ since: Date; untilExclusive: Date }> = [];
    let m = startMonth;
    while (m.getTime() <= endMonth.getTime()) {
      const next = addMonthsUTC(m, splitMonths);
      windows.push({ since: m, untilExclusive: next });
      m = next;
    }

    log('info', 'split_plan', { splitMonths, totalWindows: windows.length }, logFilePath);

    // Optional combined workbook (xlsx only)
    let combinedWorkbook: ExcelJS.Workbook | null = null;
    let combinedSheet: ExcelJS.Worksheet | null = null;
    const combinedSeen = new Set<string>();
    if (combineOut) {
      if (format !== 'xlsx') {
        throw new Error('--combineOut is only supported with --format xlsx');
      }
      combinedWorkbook = new ExcelJS.Workbook();
      combinedWorkbook.creator = 'Identity Labs';
      combinedWorkbook.created = new Date();
      combinedSheet = combinedWorkbook.addWorksheet('Tweets', { views: [{ state: 'frozen', ySplit: 1 }] });
      combinedSheet.columns = [
        { header: 'windowSince', key: 'windowSince', width: 14 },
        { header: 'windowUntil', key: 'windowUntil', width: 14 },
        { header: 'id', key: 'id', width: 22 },
        { header: 'url', key: 'url', width: 42 },
        { header: 'isReply', key: 'isReply', width: 8 },
        { header: 'inReplyToId', key: 'inReplyToId', width: 22 },
        { header: 'conversationId', key: 'conversationId', width: 22 },
        { header: 'inReplyToUserId', key: 'inReplyToUserId', width: 22 },
        { header: 'inReplyToUsername', key: 'inReplyToUsername', width: 18 },
        { header: 'createdAt', key: 'createdAt', width: 24 },
        { header: 'lang', key: 'lang', width: 8 },
        { header: 'authorUserName', key: 'authorUserName', width: 18 },
        { header: 'authorName', key: 'authorName', width: 22 },
        { header: 'likeCount', key: 'likeCount', width: 10 },
        { header: 'replyCount', key: 'replyCount', width: 10 },
        { header: 'retweetCount', key: 'retweetCount', width: 12 },
        { header: 'quoteCount', key: 'quoteCount', width: 10 },
        { header: 'viewCount', key: 'viewCount', width: 12 },
        { header: 'text', key: 'text', width: 90 },
      ];
      combinedSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: combinedSheet.columns.length },
      };
      const headerRow = combinedSheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.alignment = { vertical: 'middle' };
      log('info', 'combine_start', { combineOut }, logFilePath);
    }

    const total = windows.length;
    let nextIndex = 0;

    const worker = async (workerId: number) => {
      while (true) {
        const i = nextIndex;
        nextIndex += 1;
        if (i >= windows.length) return;

        const raw = windows[i];
        const since = raw.since.getTime() < startDate.getTime() ? startDate : raw.since;
        const untilExclusive = raw.untilExclusive.getTime() > endExclusive.getTime() ? endExclusive : raw.untilExclusive;

        const sinceStr = formatIsoDateUTC(since);
        const untilExclusiveStr = formatIsoDateUTC(untilExclusive);

        // Human-readable inclusive end for filename
        const inclusiveEnd = new Date(untilExclusive.getTime() - 24 * 60 * 60 * 1000);
        const inclusiveEndStr = formatIsoDateUTC(inclusiveEnd);

        const windowQuery = `${baseQuery} since:${sinceStr} until:${untilExclusiveStr}`.trim();
        const windowOutPath = `${outPrefix}-${sinceStr}_to_${inclusiveEndStr}.${defaultExt}`;

        log('info', 'window_start', { workerId, index: i + 1, total, since: sinceStr, untilExclusive: untilExclusiveStr, outPath: windowOutPath }, logFilePath);

        await runExport({
          query: windowQuery,
          queryType,
          format,
          maxPages,
          maxTweets,
          delayMs,
          keyType,
          logEvery,
          outPath: windowOutPath,
          logFilePath,
          limiter,
          window: { index: i + 1, total, since: sinceStr, untilExclusive: untilExclusiveStr },
          ...(combineOut && combinedSheet
            ? {
                combine: {
                  sheet: combinedSheet,
                  seen: combinedSeen,
                  windowSince: sinceStr,
                  windowUntilInclusive: inclusiveEndStr,
                },
              }
            : {}),
        });

        log('info', 'window_done', { workerId, index: i + 1, total }, logFilePath);
      }
    };

    const workers = Array.from({ length: Math.min(windowConcurrency, windows.length) }, (_, idx) => worker(idx + 1));
    await Promise.all(workers);

    if (combineOut && combinedWorkbook) {
      const buffer = await combinedWorkbook.xlsx.writeBuffer();
      writeFileSync(combineOut, Buffer.from(buffer as ArrayBuffer));
      log('info', 'combine_done', { combineOut, uniqueTweets: combinedSeen.size }, logFilePath);
    }

    log('info', 'all_windows_done', { totalWindows: windows.length }, logFilePath);
    return;
  }

  await runExport({
    query,
    queryType,
    format,
    maxPages,
    maxTweets,
    delayMs,
    keyType,
    logEvery,
    outPath,
    logFilePath,
    limiter,
  });
}

main().catch((e) => {
  log('error', 'fatal', { message: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
});


