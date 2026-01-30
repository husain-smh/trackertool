import { NextRequest, NextResponse } from 'next/server';
import { addImportantPerson, getImportantAccountCandidates } from '@/lib/models/ranker';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '30', 10);
    const minFollowers = parseInt(searchParams.get('minFollowers') || '3', 10);
    const minWeight = parseFloat(searchParams.get('minWeight') || '0');

    if (
      !Number.isFinite(limit) ||
      !Number.isFinite(minFollowers) ||
      !Number.isFinite(minWeight) ||
      limit < 1 ||
      limit > 100 ||
      minFollowers < 1 ||
      minWeight < 0
    ) {
      return NextResponse.json(
        { error: 'Invalid query params. limit (1-100), minFollowers >=1, minWeight >=0' },
        { status: 400 }
      );
    }

    const candidates = await getImportantAccountCandidates({
      limit,
      minFollowers,
      minWeight,
    });

    return NextResponse.json({
      success: true,
      data: {
        candidates,
        summary: {
          returned: candidates.length,
          limit,
          minFollowers,
          minWeight,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching important account candidates:', error);
    return NextResponse.json(
      {
        error: 'Failed to extract candidate accounts',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

interface AddCandidateResult {
  username: string;
  success: boolean;
  message: string;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { usernames } = body;

    if (!Array.isArray(usernames) || usernames.length === 0) {
      return NextResponse.json(
        { error: '`usernames` must be a non-empty array of strings' },
        { status: 400 }
      );
    }

    const normalized = Array.from(
      new Set(
        usernames
          .map((u: unknown) => (typeof u === 'string' ? u.trim() : ''))
          .filter((u: string) => u.length > 0)
      )
    );

    if (normalized.length === 0) {
      return NextResponse.json(
        { error: 'No valid usernames provided' },
        { status: 400 }
      );
    }

    const results: AddCandidateResult[] = [];

    for (const user of normalized) {
      try {
        await addImportantPerson(user);
        results.push({
          username: user,
          success: true,
          message: `@${user} added successfully`,
        });
      } catch (error) {
        const duplicate = error instanceof Error && /duplicate key/i.test(error.message);
        results.push({
          username: user,
          success: false,
          message: duplicate ? `@${user} already exists` : `Failed to add @${user}`,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    let status = 200;
    if (successCount === 0) {
      status = 500;
    } else if (failureCount > 0) {
      status = 207;
    }

    return NextResponse.json(
      {
        success: successCount > 0,
        summary: {
          total: results.length,
          added: successCount,
          failed: failureCount,
        },
        results,
      },
      { status }
    );
  } catch (error) {
    console.error('Error adding candidate important accounts:', error);
    return NextResponse.json(
      {
        error: 'Failed to add candidate accounts',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

