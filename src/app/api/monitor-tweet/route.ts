import { NextRequest, NextResponse } from 'next/server';
import { getAllMonitoringJobs, getMetricSnapshots } from '@/lib/models/monitoring';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '100');
    const skip = parseInt(searchParams.get('skip') || '0');

    const jobs = await getAllMonitoringJobs(limit, skip);

    // Calculate time remaining and snapshot counts for each job (5 days = 120 hours)
    const now = new Date();
    const jobsWithStats = await Promise.all(
      jobs.map(async (job) => {
        const startedAt = new Date(job.started_at);
        const monitorDurationMs = 5 * 24 * 60 * 60 * 1000; // 5 days
        const elapsed = now.getTime() - startedAt.getTime();
        const remaining = Math.max(0, monitorDurationMs - elapsed);
        const isActive = job.status === 'active' && remaining > 0;

        // Get snapshot count
        const snapshots = await getMetricSnapshots(job.tweet_id);

        return {
          tweet_id: job.tweet_id,
          tweet_url: job.tweet_url,
          status: job.status,
          started_at: job.started_at,
          created_at: job.created_at,
          stats: {
            is_active: isActive,
            hours_remaining: Math.floor(remaining / (60 * 60 * 1000)),
            minutes_remaining: Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000)),
            total_snapshots: snapshots.length,
          },
        };
      })
    );

    return NextResponse.json({
      success: true,
      jobs: jobsWithStats,
      total: jobsWithStats.length,
    });
  } catch (error) {
    console.error('Error fetching monitoring jobs:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to fetch monitoring jobs',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

