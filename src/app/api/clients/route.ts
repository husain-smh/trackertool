import { NextRequest, NextResponse } from 'next/server';
import { addClient, getAllClients, getClient } from '@/lib/models/clients';
import { makeApiRequest } from '@/lib/twitter-api-client';
import { getTwitterApiConfig } from '@/lib/config/twitter-api-config';

// GET - List all managed clients
export async function GET() {
  try {
    const clients = await getAllClients();
    return NextResponse.json({ success: true, clients });
  } catch (error) {
    console.error('[clients] Error listing clients:', error);
    return NextResponse.json(
      { error: 'Failed to list clients', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST - Add a new managed client
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { x_username } = body;

    if (!x_username || typeof x_username !== 'string') {
      return NextResponse.json(
        { error: 'x_username is required' },
        { status: 400 }
      );
    }

    const normalized = x_username.replace(/^@/, '').toLowerCase().trim();
    if (!normalized) {
      return NextResponse.json(
        { error: 'Invalid username' },
        { status: 400 }
      );
    }

    // Check if already exists
    const existing = await getClient(normalized);
    if (existing) {
      return NextResponse.json(
        { error: 'Client already exists', client: existing },
        { status: 409 }
      );
    }

    // Fetch first page of last_tweets to establish baseline last_known_tweet_id
    const config = getTwitterApiConfig('shared');
    const url = new URL(`${config.apiUrl}/twitter/user/last_tweets`);
    url.searchParams.set('userName', normalized);

    let lastKnownTweetId: string | undefined;
    let displayName: string | undefined;
    let xUserId: string | undefined;

    try {
      const data = await makeApiRequest(url.toString(), config);
      const tweets = data.tweets || [];

      if (tweets.length > 0) {
        // First tweet is the newest (sorted by created_at desc)
        lastKnownTweetId = tweets[0].id;
        displayName = tweets[0].author?.name;
        xUserId = tweets[0].author?.id;
      }

      console.log(`[clients] Baseline for @${normalized}: lastTweetId=${lastKnownTweetId}, ${tweets.length} tweets found`);
    } catch (fetchError) {
      console.warn(`[clients] Could not fetch baseline tweets for @${normalized}:`, fetchError);
      // Still add the client, just without a baseline
    }

    const client = await addClient(normalized, {
      display_name: displayName,
      x_user_id: xUserId,
      last_known_tweet_id: lastKnownTweetId,
    });

    return NextResponse.json({
      success: true,
      message: `Client @${normalized} added successfully`,
      client,
    });
  } catch (error) {
    console.error('[clients] Error adding client:', error);
    return NextResponse.json(
      { error: 'Failed to add client', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
