import { NextRequest, NextResponse } from 'next/server';
import { fetchAdvancedSearchBulk, type AdvancedSearchQueryType } from '@/lib/twitter-advanced-search';
import { TwitterApiError } from '@/lib/external-api';
import ExcelJS from 'exceljs';

const MAX_QUERY_LEN = 20000;

export const runtime = 'nodejs';

function normalizeQueryType(value: unknown): AdvancedSearchQueryType {
  if (value === 'Top') return 'Top';
  return 'Latest';
}

function safeNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function safeFormat(value: unknown): 'xlsx' | 'csv' {
  if (value === 'csv') return 'csv';
  return 'xlsx';
}

function excelSafeString(value: unknown): string {
  const s = String(value ?? '');
  // Excel formula injection guard: prefix dangerous leading chars.
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as any;

    const query = String(body.query || '').trim();
    const queryType = normalizeQueryType(body.queryType ?? body.section);
    const format = safeFormat(body.format);
    const maxPages = safeNumber(body.maxPages, 50);
    const maxTweets = safeNumber(body.maxTweets, 1000);
    const pageDelayMs = safeNumber(body.pageDelayMs, 350);

    if (!query) {
      return NextResponse.json({ error: 'Missing required field: query' }, { status: 400 });
    }
    if (query.length > MAX_QUERY_LEN) {
      return NextResponse.json({ error: `Query is too long. Please keep it under ${MAX_QUERY_LEN} characters.` }, { status: 400 });
    }

    // Bulk fetch (cursor pagination)
    const result = await fetchAdvancedSearchBulk({
      query,
      queryType,
      maxPages,
      maxTweets,
      pageDelayMs,
      keyType: 'shared',
    });

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Social Capital Inc.';
      workbook.created = new Date();
      const sheet = workbook.addWorksheet('Tweets', { views: [{ state: 'frozen', ySplit: 1 }] });

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

      for (const t of result.tweets) {
        sheet.addRow({
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
        });
      }

      // Light header styling
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.alignment = { vertical: 'middle' };

      const now = new Date();
      const stamp = now.toISOString().replace(/[:.]/g, '-');
      const filename = `advanced-search-${queryType.toLowerCase()}-${stamp}.xlsx`;
      const buffer = await workbook.xlsx.writeBuffer();

      return new NextResponse(Buffer.from(buffer as ArrayBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-Export-Tweets': String(result.tweets.length),
          'X-Export-Pages': String(result.meta.pagesFetched),
          'X-Export-Stopped': result.meta.stoppedBecause,
        },
      });
    }

    // CSV output (Excel compatible)
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

    const rows = result.tweets.map((t) => [
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
    ]);

    // UTF-8 BOM helps Excel read UTF-8 correctly.
    const bom = '\uFEFF';
    const csv =
      bom +
      [header.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n');

    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const filename = `advanced-search-${queryType.toLowerCase()}-${stamp}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // Useful metadata for debugging in browser devtools
        'X-Export-Tweets': String(result.tweets.length),
        'X-Export-Pages': String(result.meta.pagesFetched),
        'X-Export-Stopped': result.meta.stoppedBecause,
      },
    });
  } catch (error) {
    console.error('[api/twitter/advanced-search/export] error', error);

    if (error instanceof TwitterApiError) {
      return NextResponse.json(
        {
          error: error.message,
          statusCode: error.statusCode ?? 500,
          retryable: error.isRetryable,
          context: error.context,
        },
        { status: error.statusCode && error.statusCode >= 100 ? error.statusCode : 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to export advanced search results', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}


