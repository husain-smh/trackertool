import { NextRequest, NextResponse } from 'next/server';
import { sendAlerts } from '@/lib/socap/alert-sender';

/**
 * POST /socap/alerts/process
 * Process and send pending alerts
 * Called by cron job every 2-3 minutes
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const limit = body.limit || 50;
    
    const stats = await sendAlerts(limit);
    
    return NextResponse.json({
      success: true,
      message: 'Alerts processed',
      data: stats,
    });
  } catch (error) {
    console.error('Error processing alerts:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process alerts',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

