import { NextRequest, NextResponse } from 'next/server';
import { getTweet } from '@/lib/models/tweets';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tweetUrl, reanalyze = false } = body;

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

    // Extract tweet ID from URL
    const tweetIdMatch = tweetUrl.match(/status\/(\d+)/);
    if (!tweetIdMatch) {
      return NextResponse.json(
        { error: 'Could not extract tweet ID from URL' },
        { status: 400 }
      );
    }
    const tweetId = tweetIdMatch[1];

    // Check if tweet has already been analyzed (unless reanalyze flag is set)
    if (!reanalyze) {
      try {
        const existingTweet = await getTweet(tweetId);
        
        if (existingTweet) {
          // Tweet already exists in database
          return NextResponse.json({
            already_exists: true,
            tweet_id: tweetId,
            status: existingTweet.status,
            author_name: existingTweet.author_name,
            total_engagers: existingTweet.total_engagers,
            engagers_above_10k: existingTweet.engagers_above_10k,
            engagers_below_10k: existingTweet.engagers_below_10k,
            analyzed_at: existingTweet.analyzed_at,
            created_at: existingTweet.created_at,
            message: existingTweet.status === 'completed' 
              ? 'This tweet has already been analyzed' 
              : existingTweet.status === 'analyzing'
              ? 'This tweet is currently being analyzed'
              : existingTweet.status === 'pending'
              ? 'This tweet analysis is queued'
              : 'Previous analysis failed',
          });
        }
      } catch (dbError) {
        // If DB check fails, log it but continue with analysis
        console.warn('⚠️ Could not check existing tweet, proceeding with analysis:', dbError);
      }
    }

    // Send to your N8N webhook for engagement analysis
    const webhookUrl = 'https://mdhusainil.app.n8n.cloud/webhook/analyzeTwt';
    // const webhookUrl = 'https://mdhusainil.app.n8n.cloud/webhook/analyzeTwtEngagement';
    // const webhookUrl = 'https://yuvaanjoshua.app.n8n.cloud/webhook-test/analyzeFollowers';
    
    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // N8N workflow expects tweetUrl nested under 'body' property
      body: JSON.stringify({ 
        body: { tweetUrl }
      }),
    });

    if (!webhookResponse.ok) {
      throw new Error(`Webhook responded with status: ${webhookResponse.status}`);
    }

    const webhookData = await webhookResponse.json();

    // Enhanced logging for debugging
    console.log('=== WEBHOOK DEBUG INFO ===');
    console.log('Webhook URL:', webhookUrl);
    console.log('Webhook Status:', webhookResponse.status);
    console.log('Webhook Headers:', Object.fromEntries(webhookResponse.headers.entries()));
    console.log('Raw Webhook Response:', JSON.stringify(webhookData, null, 2));
    console.log('Response Type:', typeof webhookData);
    console.log('Is Array:', Array.isArray(webhookData));
    
    if (Array.isArray(webhookData) && webhookData[0]) {
      console.log('First item keys:', Object.keys(webhookData[0]));
      console.log('First item sheetdata:', webhookData[0].sheetdata);
    }
    
    if (webhookData.sheetdata) {
      console.log('Direct sheetdata:', webhookData.sheetdata);
    }
    console.log('=== END WEBHOOK DEBUG ===');

    return NextResponse.json({
      success: true,
      message: 'Tweet engagement analysis completed successfully',
      data: webhookData,
    });

  } catch (error) {
    console.error('Error analyzing tweet engagement:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to analyze tweet engagement',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
