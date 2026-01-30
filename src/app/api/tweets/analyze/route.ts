import { NextRequest, NextResponse } from 'next/server';
import {
  createTweet,
  getTweet,
  storeEngagers,
  updateTweetStatus,
  updateEngagersWithRanking,
  deleteEngagersByTweetId,
  EngagerInput,
} from '@/lib/models/tweets';
import { rankEngagers } from '@/lib/models/ranker';

// POST - Receive engagers from n8n and start analysis
// Supports two formats:
// 1. N8N array format: [{ sheetdata: [...] }, { engager1 }, { engager2 }, ...]
// 2. Direct object format: { tweet_id, tweet_url, author_name, engagers: [...] }
export async function POST(request: NextRequest) {
  try {
    let body = await request.json();
    
    console.log('📥 Received analysis request from n8n');
    
    let tweet_id: string;
    let tweet_url: string;
    let author_name: string;
    let author_username: string | undefined;
    let engagers: any[];
    
    // Check if body is an array (N8N format)
    if (Array.isArray(body)) {
      console.log('📦 Detected N8N array format');
      
      // Handle n8n wrapper format: [{"json": {...}, "pairedItem": {...}}]
      // Strip the wrapper if present
      if (body.length > 0 && body[0].json !== undefined) {
        console.log('🔄 Unwrapping n8n item structure');
        body = body.map((item: any) => item.json);
      }
      
      // First item should have sheetdata
      const sheetDataItem = body.find((item: any) => item.sheetdata);
      
      if (!sheetDataItem || !sheetDataItem.sheetdata || !sheetDataItem.sheetdata[0]) {
        return NextResponse.json(
          { error: 'First array item must contain sheetdata with tweet info' },
          { status: 400 }
        );
      }
      
      const sheetData = sheetDataItem.sheetdata[0];
      tweet_url = sheetData.tweet_url;
      author_name = sheetData.author_name;
      
      // Extract tweet ID from URL
      const tweetIdMatch = tweet_url.match(/status\/(\d+)/);
      if (!tweetIdMatch) {
        return NextResponse.json(
          { error: `Could not extract tweet_id from URL: ${tweet_url}` },
          { status: 400 }
        );
      }
      tweet_id = tweetIdMatch[1];
      
      // Filter out sheetdata item, rest are engagers
      engagers = body.filter((item: any) => !item.sheetdata);
      
      console.log(`✅ Extracted tweet_id: ${tweet_id} from URL`);
      console.log(`✅ Found ${engagers.length} engagers`);
      
    } else {
      // Direct object format
      console.log('📦 Detected direct object format');
      
      tweet_id = body.tweet_id;
      tweet_url = body.tweet_url;
      author_name = body.author_name;
      author_username = body.author_username;
      engagers = body.engagers;
      
      if (!tweet_id || !tweet_url || !author_name) {
        return NextResponse.json(
          { error: 'tweet_id, tweet_url, and author_name are required' },
          { status: 400 }
        );
      }
    }
    
    // Validate engagers
    if (!Array.isArray(engagers) || engagers.length === 0) {
      return NextResponse.json(
        { error: 'engagers must be a non-empty array' },
        { status: 400 }
      );
    }
    
    console.log(`✅ Tweet ${tweet_id}: ${engagers.length} engagers received`);
    
    // Step 1: Check if tweet exists (for re-analysis)
    const existingTweet = await getTweet(tweet_id);
    
    if (existingTweet) {
      // This is a re-analysis - clean up old engagers
      console.log(`🔄 Re-analyzing tweet ${tweet_id}, deleting old engagers...`);
      const deletedCount = await deleteEngagersByTweetId(tweet_id);
      console.log(`✅ Deleted ${deletedCount} old engagers`);
      
      // Reset tweet status to pending
      await updateTweetStatus(tweet_id, 'pending');
    } else {
      // New tweet - create entry
      await createTweet(tweet_id, tweet_url, author_name, author_username);
    }
    
    // Step 2: Store all engagers
    const engagerInputs: EngagerInput[] = engagers.map((e: any) => ({
      userId: e.userId,
      username: e.username,
      name: e.name || e.username,
      bio: e.bio,
      location: e.location,
      followers: e.followers || 0,
      verified: Boolean(e.verified),
      replied: Boolean(e.replied),
      retweeted: Boolean(e.retweeted),
      quoted: Boolean(e.quoted),
    }));
    
    await storeEngagers(tweet_id, engagerInputs);
    
    console.log(`✅ Tweet ${tweet_id}: Engagers stored in database`);
    
    // Step 3: Start background ranking (fire and forget)
    // We don't await this - it runs in background
    rankEngagersInBackground(tweet_id, engagerInputs).catch(error => {
      console.error(`❌ Background ranking failed for tweet ${tweet_id}:`, error);
    });
    
    // Step 4: Return immediately
    return NextResponse.json({
      success: true,
      message: 'Analysis started',
      tweet_id,
      total_engagers: engagers.length,
      status: 'analyzing',
      view_url: `/tweets/${tweet_id}`,
    });
    
  } catch (error) {
    console.error('❌ Error in /api/tweets/analyze:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to start analysis',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * Background job to rank engagers
 * Runs asynchronously without blocking the API response
 */
async function rankEngagersInBackground(
  tweetId: string,
  engagers: EngagerInput[]
): Promise<void> {
  try {
    console.log(`🔄 Starting background ranking for tweet ${tweetId}...`);
    
    // Call existing ranker
    const rankedEngagers = await rankEngagers(engagers);
    
    console.log(`✅ Ranking complete for tweet ${tweetId}`);
    
    // Update engagers with importance scores
    const rankingData = rankedEngagers.map(re => ({
      userId: re.userId,
      importance_score: re.importance_score,
      followed_by: re.followed_by.map(p => p.username),
    }));
    
    await updateEngagersWithRanking(tweetId, rankingData);
    
    console.log(`✅ Engagers updated with ranking data for tweet ${tweetId}`);
    
    // Mark tweet as completed
    await updateTweetStatus(tweetId, 'completed');
    
    console.log(`✅ Tweet ${tweetId} analysis completed`);
    
  } catch (error) {
    console.error(`❌ Background ranking error for tweet ${tweetId}:`, error);
    
    // Mark tweet as failed
    await updateTweetStatus(
      tweetId,
      'failed',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}
