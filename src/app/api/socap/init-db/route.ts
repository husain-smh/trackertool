import { NextResponse } from 'next/server';
import { initializeSocapIndexes } from '@/lib/models/socap';

/**
 * GET /socap/init-db
 * Initialize all SOCAP database indexes
 * Call this once during setup
 */
export async function GET() {
  try {
    await initializeSocapIndexes();
    
    return NextResponse.json({
      success: true,
      message: 'SOCAP database indexes initialized successfully',
    });
  } catch (error) {
    console.error('Error initializing SOCAP database:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to initialize database',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

