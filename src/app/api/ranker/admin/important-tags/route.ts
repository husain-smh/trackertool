import { NextResponse } from 'next/server';
import { getDistinctImportantPersonTags } from '@/lib/models/ranker';

export async function GET() {
  try {
    const tags = await getDistinctImportantPersonTags();
    return NextResponse.json({
      success: true,
      data: {
        tags,
        count: tags.length,
      },
    });
  } catch (error) {
    console.error('Error fetching important person tags:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch tags',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

