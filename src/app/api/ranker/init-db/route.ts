import { NextResponse } from 'next/server';
import { initializeRankerDatabase } from '@/lib/init-ranker-db';

/**
 * Database Initialization Endpoint
 * 
 * Call this endpoint once to set up indexes for the twitter_ranker database
 * GET /api/ranker/init-db
 */
export async function GET() {
  try {
    await initializeRankerDatabase();
    
    return NextResponse.json({
      success: true,
      message: 'Database initialized successfully with all indexes',
      indexes: {
        important_people: ['username', 'user_id', 'is_active'],
        following_index: ['followed_user_id', 'followed_username', 'importance_score', 'followed_by.user_id'],
        engagement_rankings: ['tweet_id', 'analyzed_at']
      }
    });
    
  } catch (error) {
    console.error('Error initializing database:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to initialize database',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

