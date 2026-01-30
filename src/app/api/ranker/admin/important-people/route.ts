import { NextRequest, NextResponse } from 'next/server';
import { getImportantPeople } from '@/lib/models/ranker';

// GET - List important people with pagination
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // Validate pagination parameters
    // Allow higher limits for search functionality (up to 1000)
    if (page < 1 || limit < 1 || limit > 1000) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters. Page must be >= 1, limit must be between 1 and 1000' },
        { status: 400 }
      );
    }

    const { people, total } = await getImportantPeople(page, limit);

    return NextResponse.json({
      success: true,
      data: {
        people,
        pagination: {
          page,
          limit,
          total,
          total_pages: Math.ceil(total / limit),
        },
      },
    });

  } catch (error) {
    console.error('Error fetching important people:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to fetch important people',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

