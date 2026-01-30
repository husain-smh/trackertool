import { getTweetsByCampaign } from '../models/socap/tweets';
import { createMetricSnapshot } from '../models/socap/metric-snapshots';
import { roundToHour } from '../models/socap/metric-snapshots';

/**
 * Aggregate metrics across all tweets in a campaign
 */
export async function aggregateCampaignMetrics(campaignId: string): Promise<void> {
  const tweets = await getTweetsByCampaign(campaignId);
  
  // Calculate totals
  let totalLikes = 0;
  let totalRetweets = 0;
  let totalQuotes = 0;
  let totalReplies = 0;
  let totalViews = 0;
  let totalQuoteViews = 0;
  
  // Breakdown by category
  const breakdown = {
    main_twt: { likes: 0, retweets: 0, quotes: 0, replies: 0, views: 0 },
    influencer_twt: { likes: 0, retweets: 0, quotes: 0, replies: 0, views: 0 },
    investor_twt: { likes: 0, retweets: 0, quotes: 0, replies: 0, views: 0 },
  };
  
  for (const tweet of tweets) {
    const metrics = tweet.metrics;
    
    totalLikes += metrics.likeCount;
    totalRetweets += metrics.retweetCount;
    totalQuotes += metrics.quoteCount;
    totalReplies += metrics.replyCount;
    totalViews += metrics.viewCount;
    // Backward-safe: quoteViewsFromQuotes may be missing on older docs
    totalQuoteViews += (metrics as any).quoteViewsFromQuotes || 0;
    
    // Add to category breakdown - ensure category is valid
    const category = tweet.category as keyof typeof breakdown;
    if (category && breakdown[category]) {
      const catBreakdown = breakdown[category];
      catBreakdown.likes += metrics.likeCount;
      catBreakdown.retweets += metrics.retweetCount;
      catBreakdown.quotes += metrics.quoteCount;
      catBreakdown.replies += metrics.replyCount;
      catBreakdown.views += metrics.viewCount;
    } else {
      console.warn(`Invalid or missing category for tweet ${tweet.tweet_id}: ${tweet.category}`);
    }
  }
  
  // Create snapshot (hourly)
  const snapshotTime = roundToHour(new Date());
  
  await createMetricSnapshot({
    campaign_id: campaignId,
    snapshot_time: snapshotTime,
    total_likes: totalLikes,
    total_retweets: totalRetweets,
    total_quotes: totalQuotes,
    total_replies: totalReplies,
    total_views: totalViews,
    total_quote_views: totalQuoteViews,
    tweet_breakdown: breakdown,
  });
  
  console.log(`Created metric snapshot for campaign ${campaignId}`);
}

