/**
 * Native Tweet Analysis Endpoint
 * Replaces N8N webhook call with native implementation
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractTweetIdFromUrl } from '@/lib/utils/tweet-utils';
import { createTweet, getTweet, updateTweetAuthorInfo, updateTweetStatus } from '@/lib/models/tweets';
import { jobQueue } from '@/lib/jobs/analyze-tweet-job';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.setRequestId(requestId);

  try {
    const body = await request.json();
    const { tweetUrl, reanalyze = false } = body;

    logger.info('Received analysis request', { tweetUrl, reanalyze });

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
    const tweetId = extractTweetIdFromUrl(tweetUrl);
    if (!tweetId) {
      return NextResponse.json(
        { error: 'Could not extract tweet ID from URL' },
        { status: 400 }
      );
    }

    logger.info('Extracted tweet ID', { tweetId });

    // Check if tweet has already been analyzed (unless reanalyze flag is set)
    if (!reanalyze) {
      const existingTweet = await getTweet(tweetId);
      
      if (existingTweet) {
        logger.info('Tweet already exists', { tweetId, status: existingTweet.status });
        
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
    }

    // IMPORTANT: Keep this endpoint fast.
    // We do NOT block the request on external API calls (like twitterapi.io).
    // The background job (`analyzeTweet`) already fetches tweet details/text if missing.
    //
    // This prevents the UI from "just running" for 30-60s when the external API is slow.
    const authorName: string | undefined = undefined;
    const authorUsername: string | undefined = undefined;

    // Ensure a tweet record exists immediately so status polling works.
    // IMPORTANT: For re-analysis, also flip the status away from "completed" right away,
    // otherwise the frontend polling may instantly redirect to the old analysis.
    const existingTweet = await getTweet(tweetId);
    if (existingTweet) {
      await updateTweetStatus(tweetId, 'pending');
      // If we already have author info stored, keep it.
      // The background job may update it again from fresh tweet details.
    } else {
      await createTweet(tweetId, tweetUrl, 'Unknown', undefined);
    }

    // Enqueue background job
    const jobId = await jobQueue.enqueue(tweetId, tweetUrl, {
      reanalyze,
      // Provide any stored author info we may already have; otherwise the job will fill it in.
      authorName: existingTweet?.author_name,
      authorUsername: existingTweet?.author_username,
    });

    logger.info('Job enqueued', { jobId, tweetId });

    // Return immediately
    return NextResponse.json({
      success: true,
      message: 'Analysis started. Processing in background.',
      tweet_id: tweetId,
      job_id: jobId,
      status: 'analyzing',
      view_url: `/tweets/${tweetId}`,
    });

  } catch (error) {
    logger.error('Error in analyze-native endpoint', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to start analysis',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

