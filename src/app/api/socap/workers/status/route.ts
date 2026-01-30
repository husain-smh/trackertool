import { NextResponse } from 'next/server';
import { getJobQueueStats } from '@/lib/socap/job-queue';

/**
 * GET /socap/workers/status
 * Get worker and job queue status
 */
export async function GET() {
  try {
    const stats = await getJobQueueStats();
    
    return NextResponse.json({
      success: true,
      data: {
        job_queue: stats,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error fetching worker status:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch worker status',
      },
      { status: 500 }
    );
  }
}

