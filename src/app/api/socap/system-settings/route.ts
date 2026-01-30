import { NextRequest, NextResponse } from 'next/server';
import {
  getSystemSettings,
  updateSystemSettings,
} from '@/lib/models/socap/system-settings';

/**
 * GET /socap/system-settings
 * Get current system settings
 */
export async function GET() {
  try {
    const settings = await getSystemSettings();
    
    return NextResponse.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error('Error fetching system settings:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch system settings',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /socap/system-settings
 * Update system settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate schedule_interval_minutes if provided
    if (body.schedule_interval_minutes !== undefined) {
      const interval = parseInt(body.schedule_interval_minutes, 10);
      if (isNaN(interval) || interval < 1 || interval > 1440) {
        return NextResponse.json(
          {
            success: false,
            error: 'schedule_interval_minutes must be between 1 and 1440 (1 day)',
          },
          { status: 400 }
        );
      }
    }
    
    const success = await updateSystemSettings({
      schedule_interval_minutes: body.schedule_interval_minutes,
      updated_by: 'admin', // TODO: Get from auth if you add authentication
    });
    
    if (!success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to update system settings',
        },
        { status: 500 }
      );
    }
    
    const updatedSettings = await getSystemSettings();
    
    return NextResponse.json({
      success: true,
      message: 'System settings updated',
      data: updatedSettings,
    });
  } catch (error) {
    console.error('Error updating system settings:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update system settings',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

