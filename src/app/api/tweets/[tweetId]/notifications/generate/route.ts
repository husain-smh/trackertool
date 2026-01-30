import { NextRequest, NextResponse } from 'next/server';
import { getTweet, getEngagers, getEngagersStats } from '@/lib/models/tweets';
import { generateTweetSlackDrafts } from '@/lib/generate-tweet-slack-drafts';

/**
 * POST /api/tweets/:tweetId/notifications/generate
 *
 * Generates Slack-ready draft notifications for the tweet report.
 * Uses tweet.ai_report when available (best results), and falls back to stats/top engagers.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ tweetId: string }> }
) {
  try {
    const { tweetId } = await params;

    const tweet = await getTweet(tweetId);
    if (!tweet) {
      return NextResponse.json({ success: false, error: 'Tweet not found' }, { status: 404 });
    }

    // Pull a small, high-signal set of engagers for the prompt (ranked).
    const [topEngagersRes, stats] = await Promise.all([
      getEngagers(tweetId, { limit: 12, skip: 0, sortBy: 'importance_score', sortOrder: 'desc' }),
      getEngagersStats(tweetId),
    ]);

    const drafts = await generateTweetSlackDrafts({
      tweet: {
        tweet_id: tweet.tweet_id,
        tweet_url: tweet.tweet_url,
        author_name: tweet.author_name,
        author_username: tweet.author_username,
        metrics: tweet.metrics,
        total_engagers: tweet.total_engagers,
      },
      stats,
      aiReport: tweet.ai_report
        ? {
            narrative: tweet.ai_report.narrative,
            structured_stats: tweet.ai_report.structured_stats,
            notable_people: tweet.ai_report.notable_people,
          }
        : undefined,
      topEngagers: topEngagersRes.engagers.map((e) => ({
        username: e.username,
        name: e.name,
        followers: e.followers,
        verified: e.verified,
        replied: e.replied,
        retweeted: e.retweeted,
        quoted: e.quoted,
        importance_score: e.importance_score,
      })),
    });

    return NextResponse.json({
      success: true,
      data: {
        tweetId,
        drafts,
        usedAiReport: Boolean(tweet.ai_report),
      },
    });
  } catch (error) {
    console.error('Error generating tweet Slack drafts:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate Slack drafts',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

