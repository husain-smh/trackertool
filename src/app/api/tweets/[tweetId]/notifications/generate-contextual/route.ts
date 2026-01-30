import { NextRequest, NextResponse } from 'next/server';
import { generateAndStoreContextualNotifications } from '@/lib/contextual-notifications';

/**
 * POST /api/tweets/:tweetId/notifications/generate-contextual
 *
 * Generates SOCAP-style contextual notifications:
 * - uses main tweet text + quote/reply texts (stored in tweet_engagements)
 * - returns one unique notification per engagement
 * - also persists llm_copy/llm_sentiment on each engagement doc
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tweetId: string }> }
) {
  try {
    const { tweetId } = await params;
    const body = await request.json().catch(() => ({}));

    // If omitted, we generate for ALL above-threshold engagers (recommended).
    const hasLimitQuotes = body && Object.prototype.hasOwnProperty.call(body, 'limitQuotes');
    const hasLimitReplies = body && Object.prototype.hasOwnProperty.call(body, 'limitReplies');
    const limitQuotes = hasLimitQuotes ? Number(body?.limitQuotes) : undefined;
    const limitReplies = hasLimitReplies ? Number(body?.limitReplies) : undefined;
    const minImportanceScore = Math.max(0, Math.min(100, Number(body?.minImportanceScore ?? 5)));
    const suggestions = await generateAndStoreContextualNotifications(tweetId, {
      limitQuotes,
      limitReplies,
      minImportanceScore,
    });

    return NextResponse.json({
      success: true,
      data: {
        tweetId,
        count: suggestions.length,
      },
    });
  } catch (error) {
    console.error('Error generating contextual notifications:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate contextual notifications',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

