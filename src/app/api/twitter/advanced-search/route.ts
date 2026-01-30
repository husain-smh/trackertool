import { NextRequest, NextResponse } from 'next/server';
import { fetchAdvancedSearchPage, type AdvancedSearchQueryType } from '@/lib/twitter-advanced-search';
import { TwitterApiError } from '@/lib/external-api';

const MAX_QUERY_LEN = 1200;
const MAX_CURSOR_LEN = 5000;

function normalizeQueryType(value: string | null): AdvancedSearchQueryType {
  if (value === 'Top') return 'Top';
  return 'Latest';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const query = (searchParams.get('query') || '').trim();
    const queryType = normalizeQueryType(searchParams.get('queryType'));
    const cursor = searchParams.get('cursor') || '';

    if (!query) {
      return NextResponse.json({ error: 'Missing required parameter: query' }, { status: 400 });
    }
    if (query.length > MAX_QUERY_LEN) {
      return NextResponse.json(
        { error: `Query is too long. Please keep it under ${MAX_QUERY_LEN} characters.` },
        { status: 400 }
      );
    }
    if (cursor.length > MAX_CURSOR_LEN) {
      return NextResponse.json({ error: 'Cursor is too long.' }, { status: 400 });
    }

    const data = await fetchAdvancedSearchPage({
      query,
      queryType,
      cursor,
      retries: 2,
      keyType: 'shared',
    });

    return NextResponse.json({
      success: true,
      query,
      queryType,
      cursorUsed: cursor,
      ...data,
    });
  } catch (error) {
    console.error('[api/twitter/advanced-search] error', error);

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
      { error: 'Failed to fetch advanced search results', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}


