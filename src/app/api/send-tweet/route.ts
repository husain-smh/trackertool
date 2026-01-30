import { NextRequest, NextResponse } from 'next/server';
import {
  extractTweetIdFromUrl,
  fetchTweetQuotesPage,
  TwitterApiError,
} from '@/lib/external-api';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tweetUrl } = body;

    // Validate tweet URL
    if (!tweetUrl || typeof tweetUrl !== 'string') {
      return NextResponse.json(
        { error: 'Tweet URL is required' },
        { status: 400 }
      );
    }

    // Basic Twitter URL validation
    const twitterUrlPattern = /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/\w+\/status\/\d+/i;
    if (!twitterUrlPattern.test(tweetUrl)) {
      return NextResponse.json(
        { error: 'Please provide a valid Twitter/X tweet URL' },
        { status: 400 }
      );
    }

    // Extract tweet ID (fallback to raw if already numeric)
    const extractedId = extractTweetIdFromUrl(tweetUrl);
    const tweetId = extractedId || tweetUrl.trim();

    // Fetch and aggregate quote tweets directly (no N8N dependency)
    const analytics = await aggregateQuoteTweetAnalytics(tweetId);

    const responseData = {
      totalQuoteTwtViews: analytics.statistics.totalViewsAcrossAllQuoteTweets.toString(),
      totalUniqueUsers: analytics.statistics.uniqueUsersKept.toString(),
      fullAnalytics: analytics,
    };

    return NextResponse.json({
      success: true,
      message: 'Tweet URL sent successfully',
      data: responseData,
    });

  } catch (error) {
    console.error('Error processing quote tweet analytics:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to process tweet URL',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Aggregate quote tweet analytics directly from twitterapi.io,
 * mirroring the previous N8N output shape.
 */
async function aggregateQuoteTweetAnalytics(tweetId: string) {
  const startTime = Date.now();

  const MAX_PAGES = 60; // aligns with prior N8N pagination cap
  let cursor: string | undefined;
  let hasNext = true;
  let totalPages = 0;
  let totalTweetsProcessed = 0;
  let totalUsersExtracted = 0;
  let duplicatesFound = 0;
  let totalViewsAcrossAll = 0;
  const errors: string[] = [];
  const uniqueUsersMap = new Map<
    string,
    {
      userId: string;
      username: string | null;
      name: string | null;
      verified: boolean;
      followers: number;
      bio: string | null;
      location: string | null;
      totalViewsFromQuoteTweets: number;
    }
  >();

  for (let page = 0; hasNext && page < MAX_PAGES; page++) {
    try {
      const data = await fetchTweetQuotesPage(tweetId, cursor);
      totalPages += 1;

      const tweets = Array.isArray(data.tweets) ? data.tweets : [];
      totalTweetsProcessed += tweets.length;

      for (const tweet of tweets) {
        try {
          const author: any = (tweet as any).author;
          if (!author || !author.id) {
            continue;
          }

          totalUsersExtracted += 1;

          const rawViews = (tweet as any).viewCount;
          const tweetViews =
            typeof rawViews === 'number'
              ? rawViews
              : typeof rawViews === 'string'
              ? Number.parseInt(rawViews, 10) || 0
              : 0;

          totalViewsAcrossAll += tweetViews;

          if (uniqueUsersMap.has(author.id)) {
            duplicatesFound += 1;
            const existing = uniqueUsersMap.get(author.id)!;
            existing.totalViewsFromQuoteTweets += tweetViews;
            continue;
          }

          const isVerified =
            author.isBlueVerified !== undefined
              ? Boolean(author.isBlueVerified)
              : Boolean(author.verified);

          const followers =
            Number.parseInt(
              (author.followers ?? author.followers_count ?? 0).toString(),
              10
            ) || 0;

          uniqueUsersMap.set(author.id, {
            userId: author.id,
            username: author.userName ?? author.screen_name ?? null,
            name: author.name ?? null,
            verified: isVerified,
            followers,
            bio: author.profile_bio?.description ?? null,
            location: author.location ?? null,
            totalViewsFromQuoteTweets: tweetViews,
          });
        } catch (innerErr) {
          const msg =
            innerErr instanceof Error ? innerErr.message : 'Unknown tweet processing error';
          errors.push(msg);
        }
      }

      const nextCursor =
        (data as any).next_cursor ??
        (data as any).nextCursor ??
        (data as any).meta?.next_token ??
        null;
      const hasNextPage =
        (data as any).has_next_page !== undefined
          ? Boolean((data as any).has_next_page)
          : (data as any).hasNextPage ?? true;

      cursor = nextCursor || undefined;
      hasNext = hasNextPage && !!nextCursor && tweets.length > 0;
    } catch (pageErr) {
      const retryable =
        pageErr instanceof TwitterApiError ? pageErr.isRetryable : false;
      errors.push(
        pageErr instanceof Error ? pageErr.message : 'Unknown pagination error'
      );
      if (retryable) {
        continue;
      }
      break;
    }
  }

  const processingTimeMs = Date.now() - startTime;
  const processingTimeSeconds = Math.round((processingTimeMs / 1000) * 100) / 100;
  const filteredUsers = Array.from(uniqueUsersMap.values());
  const statistics = {
    totalInputItems: totalPages, // aligns with N8N notion of items/pages processed
    totalPages,
    totalTweetsProcessed,
    totalUsersExtracted,
    totalUsersFiltered: filteredUsers.length,
    uniqueUsersKept: filteredUsers.length,
    duplicatesRemoved: duplicatesFound,
    deduplicationRate:
      totalUsersExtracted > 0
        ? Math.round((duplicatesFound / totalUsersExtracted) * 100)
        : 0,
    totalViewsAcrossAllQuoteTweets: totalViewsAcrossAll,
    processingTimeMs,
    processingTimeSeconds,
    errorCount: errors.length,
  };

  return {
    success: true,
    filteredUsers,
    statistics,
    errors: errors.slice(0, 10),
  };
}
