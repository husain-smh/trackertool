import { NextRequest, NextResponse } from 'next/server';
import { getTweetsByCampaign } from '@/lib/models/socap/tweets';
import { getQuoteViews } from '@/lib/socap/n8n-quote-views';
import { updateTweetQuoteViewsFromQuotes } from '@/lib/models/socap/tweets';

/**
 * POST /api/socap/campaigns/[id]/test-quote-views
 * 
 * Test endpoint to manually calculate quote views for all tweets in a campaign.
 * This helps debug if quote views calculation is working.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await params;
    
    console.log(`\n========== TEST QUOTE VIEWS CALCULATION ==========`);
    console.log(`Campaign ID: ${campaignId}`);
    console.log(`Backend: ${process.env.QUOTE_VIEWS_BACKEND || 'n8n (default)'}`);
    console.log(`==================================================\n`);
    
    // Get all tweets in campaign
    const tweets = await getTweetsByCampaign(campaignId);
    console.log(`Found ${tweets.length} tweets to process\n`);
    
    const results = [];
    let totalCalculated = 0;
    let errors = 0;
    
    for (const tweet of tweets) {
      console.log(`\n--- Processing Tweet ${tweet.tweet_id} ---`);
      console.log(`  Current quoteViewsFromQuotes: ${(tweet.metrics as any).quoteViewsFromQuotes || 0}`);
      
      try {
        const startTime = Date.now();
        
        // Calculate quote views
        console.log(`  Calling getQuoteViews()...`);
        const viewsResult = await getQuoteViews(tweet.tweet_id);
        
        const duration = Date.now() - startTime;
        console.log(`  ✅ Got result in ${duration}ms:`, {
          totalViews: viewsResult.totalViews,
          totalQuotes: viewsResult.totalQuotes,
          backend: viewsResult.backend,
        });
        
        // Update database
        console.log(`  Updating database...`);
        await updateTweetQuoteViewsFromQuotes(tweet.tweet_id, viewsResult.totalViews);
        console.log(`  ✅ Database updated: ${viewsResult.totalViews} views`);
        
        totalCalculated += viewsResult.totalViews;
        
        results.push({
          tweet_id: tweet.tweet_id,
          tweet_url: tweet.tweet_url,
          success: true,
          old_value: (tweet.metrics as any).quoteViewsFromQuotes || 0,
          new_value: viewsResult.totalViews,
          total_quotes: viewsResult.totalQuotes,
          backend: viewsResult.backend,
          duration_ms: duration,
        });
      } catch (error) {
        console.error(`  ❌ ERROR:`, error);
        errors++;
        
        results.push({
          tweet_id: tweet.tweet_id,
          tweet_url: tweet.tweet_url,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    
    console.log(`\n========== SUMMARY ==========`);
    console.log(`Total tweets processed: ${tweets.length}`);
    console.log(`Successful: ${tweets.length - errors}`);
    console.log(`Errors: ${errors}`);
    console.log(`Total quote views calculated: ${totalCalculated.toLocaleString()}`);
    console.log(`=============================\n`);
    
    return NextResponse.json({
      success: true,
      message: `Processed ${tweets.length} tweets`,
      data: {
        campaign_id: campaignId,
        tweets_processed: tweets.length,
        successful: tweets.length - errors,
        errors,
        total_quote_views: totalCalculated,
        backend: process.env.QUOTE_VIEWS_BACKEND || 'n8n',
        results,
      },
    });
  } catch (error) {
    console.error('Error in test-quote-views:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to calculate quote views',
      },
      { status: 500 }
    );
  }
}

