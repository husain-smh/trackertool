import { NextRequest, NextResponse } from 'next/server';
import { rankEngagers, saveEngagementRanking, EngagerInput } from '@/lib/models/ranker';

// POST - Rank a list of engagers by importance score
// Supports three input formats:
// 1. Object format: { tweet_id: "123", engagers: [...] }
// 2. N8N array format: [{ sheetdata: [{ tweet_url: "..." }] }, { username: "...", userId: "..." }, ...]
// 3. N8N $input.all() format: [{ json: { sheetdata: [...] } }, { json: { username: "..." } }, ...]
//    The API automatically unwraps the "json" property from each item

// Retry helper for MongoDB operations
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if it's a MongoDB SSL/TLS error
      const isSSLError = errorMessage.includes('SSL') || 
                        errorMessage.includes('TLS') || 
                        errorMessage.includes('ECONNRESET') ||
                        errorMessage.includes('connection') ||
                        errorMessage.includes('MongoServerError');
      
      if (isSSLError && attempt < maxRetries) {
        const waitTime = delayMs * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`⚠️ Attempt ${attempt}/${maxRetries} failed with SSL/connection error. Retrying in ${waitTime}ms...`);
        console.log(`   Error: ${errorMessage}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // If not an SSL error or last attempt, throw
      throw error;
    }
  }
  
  throw lastError || new Error('Operation failed after retries');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    let tweet_id: string;
    let engagers: unknown[];

    // Check if body is an array (N8N format) or object (direct API format)
    if (Array.isArray(body)) {
      console.log('📦 Received N8N array format with', body.length, 'items');
      
      // Unwrap n8n $input.all() format if items have "json" property
      let unwrappedBody = body;
      if (body.length > 0 && body[0] && typeof body[0] === 'object' && 'json' in body[0]) {
        console.log('🔓 Unwrapping n8n $input.all() format...');
        unwrappedBody = body.map((item: Record<string, unknown>) => item.json as Record<string, unknown>);
      }
      
      // Find the sheetdata item (first item with tweet_url)
      const sheetDataItem = unwrappedBody.find((item: unknown) => {
        const i = item as Record<string, unknown>;
        return i.sheetdata;
      });
      
      if (!sheetDataItem || !sheetDataItem.sheetdata || !sheetDataItem.sheetdata[0]?.tweet_url) {
        return NextResponse.json(
          { error: 'First array item must contain sheetdata with tweet_url' },
          { status: 400 }
        );
      }

      const tweetUrl = sheetDataItem.sheetdata[0].tweet_url;
      
      // Extract tweet ID from URL (format: https://x.com/username/status/1234567890)
      const tweetIdMatch = tweetUrl.match(/status\/(\d+)/);
      if (!tweetIdMatch) {
        return NextResponse.json(
          { error: `Could not extract tweet_id from URL: ${tweetUrl}` },
          { status: 400 }
        );
      }
      
      tweet_id = tweetIdMatch[1];
      
      // Filter out sheetdata item and get remaining engagers
      engagers = unwrappedBody.filter((item: unknown) => {
        const i = item as Record<string, unknown>;
        return !i.sheetdata;
      });
      
      console.log(`✅ Extracted tweet_id: ${tweet_id} from URL: ${tweetUrl}`);
      console.log(`✅ Found ${engagers.length} engagers`);
      
    } else {
      // Original object format
      console.log('📦 Received object format');
      tweet_id = body.tweet_id;
      engagers = body.engagers;

      // Validation for object format
      if (!tweet_id || typeof tweet_id !== 'string') {
        return NextResponse.json(
          { error: 'tweet_id is required and must be a string' },
          { status: 400 }
        );
      }
    }

    // Common validation for both formats
    if (!Array.isArray(engagers) || engagers.length === 0) {
      return NextResponse.json(
        { error: 'engagers is required and must be a non-empty array' },
        { status: 400 }
      );
    }

    // Validate engagers array
    for (const engager of engagers) {
      const e = engager as Record<string, unknown>;
      if (!e.username || !e.userId) {
        return NextResponse.json(
          { error: 'Each engager must have username and userId' },
          { status: 400 }
        );
      }
    }

    // Prepare engagers list (preserving all metadata)
    const engagersObj: EngagerInput[] = engagers.map((engager: unknown) => {
      const e = engager as Record<string, unknown>;
      return {
        username: (e.username as string).trim(),
        userId: (e.userId as string).trim(),
        name: e.name ? (e.name as string).trim() : (e.username as string).trim(),
        bio: e.bio as string | undefined,
        location: e.location as string | undefined,
        followers: e.followers as number | undefined,
        verified: e.verified as boolean | undefined,
        replied: e.replied as boolean | undefined,
        retweeted: e.retweeted as boolean | undefined,
        quoted: e.quoted as boolean | undefined,
      };
    });

    console.log(`Ranking ${engagersObj.length} engagers for tweet ${tweet_id}`);
    
    // Rank the engagers with retry logic
    const rankedEngagers = await withRetry(async () => {
      return await rankEngagers(engagersObj);
    });
    
    // Save the ranking result with retry logic
    await withRetry(async () => {
      await saveEngagementRanking(tweet_id, rankedEngagers);
    });
    
    console.log(`Ranking complete. Top engagers:`);
    rankedEngagers.slice(0, 5).forEach((e, i) => {
      console.log(`  ${i + 1}. @${e.username} - Score: ${e.importance_score}`);
    });

    // Transform followed_by to just usernames array
    const simplifiedEngagers = rankedEngagers.map(engager => ({
      ...engager,
      followed_by: engager.followed_by.map(person => person.username),
    }));

    // Prepare response with statistics
    const totalEngagers = simplifiedEngagers.length;
    const engagersWithScore = simplifiedEngagers.filter(e => e.importance_score > 0).length;
    const engagersWithoutScore = totalEngagers - engagersWithScore;
    const maxScore = simplifiedEngagers.length > 0 ? simplifiedEngagers[0].importance_score : 0;
    const avgScore = simplifiedEngagers.length > 0
      ? simplifiedEngagers.reduce((sum, e) => sum + e.importance_score, 0) / simplifiedEngagers.length
      : 0;

    // Return simplified response without wrapper
    return NextResponse.json({
      tweet_id,
      ranked_engagers: simplifiedEngagers,
      statistics: {
        total_engagers: totalEngagers,
        engagers_with_score: engagersWithScore,
        engagers_without_score: engagersWithoutScore,
        max_score: maxScore,
        avg_score: parseFloat(avgScore.toFixed(2)),
      },
      analyzed_at: new Date(),
    });

  } catch (error) {
    console.error('Error ranking engagers:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to rank engagers',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

