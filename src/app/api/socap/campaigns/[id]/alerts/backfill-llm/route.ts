import { NextRequest, NextResponse } from 'next/server';
import { backfillQuoteNotifications } from '@/lib/socap/alert-detector';

/**
 * POST /api/socap/campaigns/[id]/alerts/backfill-llm
 *
 * Backfill LLM-generated notifications for existing quote tweet alerts that don't have them.
 * This is useful when LLM generation is added to an existing campaign.
 *
 * Note: In Next.js 15 route handlers, `params` is async and must be awaited.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await context.params;

    const result = await backfillQuoteNotifications(campaignId);

    return NextResponse.json({
      success: true,
      data: result,
      message: `Backfill complete: ${result.processed} alerts processed, ${result.generated} notifications generated, ${result.errors} errors.`,
    });
  } catch (error) {
    console.error('Error backfilling quote notifications:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to backfill quote notifications',
      },
      { status: 500 }
    );
  }
}

