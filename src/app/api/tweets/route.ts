import { NextRequest, NextResponse } from 'next/server';
import { getAllTweets, createTweetsIndexes } from '@/lib/models/tweets';

// Track if indexes have been created this session to avoid repeated calls
let indexesEnsured = false;

// GET - List all tweets (paginated)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const limit = parseInt(searchParams.get('limit') || '50');
    const skip = parseInt(searchParams.get('skip') || '0');
    
    // Ensure indexes exist (only once per cold start, runs in background after first request)
    if (!indexesEnsured) {
      // Don't await - let it run in background to not block the response
      createTweetsIndexes()
        .then(() => {
          indexesEnsured = true;
        })
        .catch((err) => {
          console.error('Failed to create indexes:', err);
        });
    }
    
    const { tweets, total } = await getAllTweets(limit, skip);
    
    return NextResponse.json({
      success: true,
      tweets,
      pagination: {
        limit,
        skip,
        returned: tweets.length,
        total, // Now we know the total count for proper pagination
        hasMore: skip + tweets.length < total,
      },
    });
    
  } catch (error) {
    console.error('Error fetching tweets:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to fetch tweets',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
