import { NextRequest, NextResponse } from 'next/server';
import { getCampaignById } from '@/lib/models/socap/campaigns';
import { getTweetsByCampaign } from '@/lib/models/socap/tweets';

// Vercel Hobby has 10s hard limit, Pro allows up to 60s
// We optimize code to stay under 10s whenever possible
export const maxDuration = 10;

/**
 * GET /socap/campaigns/:id/dashboard
 * Get dashboard data for a campaign
 * 
 * Optimized for serverless cold starts:
 * - Parallel DB queries instead of sequential
 * - Reduced data transfer with projections handled at model level
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Run both queries in PARALLEL to save time on cold starts
    // This is much faster than sequential: campaign -> tweets
    const [campaign, tweets] = await Promise.all([
      getCampaignById(id),
      getTweetsByCampaign(id),
    ]);
    
    if (!campaign) {
      return NextResponse.json(
        {
          success: false,
          error: 'Campaign not found',
        },
        { status: 404 }
      );
    }
    
    // Calculate total metrics + per-category breakdown (for cards)
    let totalLikes = 0;
    let totalRetweets = 0;
    let totalQuotes = 0;
    let totalReplies = 0;
    let totalViews = 0;
    let totalQuoteViews = 0;

    const categoryTotals = {
      main_twt: { likes: 0, retweets: 0, quotes: 0, replies: 0, views: 0, quote_views: 0 },
      influencer_twt: { likes: 0, retweets: 0, quotes: 0, replies: 0, views: 0, quote_views: 0 },
      investor_twt: { likes: 0, retweets: 0, quotes: 0, replies: 0, views: 0, quote_views: 0 },
    };
    
    for (const tweet of tweets) {
      const metrics = tweet.metrics;
      const category = tweet.category as keyof typeof categoryTotals;

      totalLikes += metrics.likeCount;
      totalRetweets += metrics.retweetCount;
      totalQuotes += metrics.quoteCount;
      totalReplies += metrics.replyCount;
      totalViews += metrics.viewCount;
      // Safe access for older documents without quoteViewsFromQuotes
      totalQuoteViews += (metrics as any).quoteViewsFromQuotes || 0;

      if (categoryTotals[category]) {
        categoryTotals[category].likes += metrics.likeCount;
        categoryTotals[category].retweets += metrics.retweetCount;
        categoryTotals[category].quotes += metrics.quoteCount;
        categoryTotals[category].replies += metrics.replyCount;
        categoryTotals[category].views += metrics.viewCount;
        categoryTotals[category].quote_views += (metrics as any).quoteViewsFromQuotes || 0;
      }
    }
    
    // Engagement total = interactions (likes, retweets, replies, quote tweets)
    const totalEngagements = totalLikes + totalRetweets + totalReplies + totalQuotes;
    
    // NOTE: Engagements are now lazy loaded via /api/socap/campaigns/:id/engagements
    // when user expands the "Important People" section. This removes the heavy
    // getAllUniqueEngagersByCampaign query that was causing 10-15 second load times.
    
    return NextResponse.json({
      success: true,
      data: {
        campaign,
        metrics: {
          total_likes: totalLikes,
          total_retweets: totalRetweets,
          total_quotes: totalQuotes,
          total_replies: totalReplies,
          total_views: totalViews,
          total_quote_views: totalQuoteViews,
          total_engagements: totalEngagements,
        },
        category_totals: categoryTotals,
        tweets: tweets.map((t) => ({
          tweet_id: t.tweet_id,
          category: t.category,
          author_username: t.author_username,
          metrics: t.metrics,
        })),
        // Engagements are lazy loaded via separate API call now
        latest_engagements: [],
        category_breakdown: {},
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch dashboard data',
      },
      { status: 500 }
    );
  }
}

