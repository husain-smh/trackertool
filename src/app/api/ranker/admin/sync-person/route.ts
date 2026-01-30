import { NextRequest, NextResponse } from 'next/server';
import { getImportantPeopleCollection, updateFollowingIndex } from '@/lib/models/ranker';

// Type for sync result
interface SyncResult {
  username: string;
  success: boolean;
  message: string;
  following_count?: number;
  synced_at?: Date;
  error?: string;
}

/**
 * Syncs a single username by calling N8N webhook and updating following index
 * This is the extracted core logic that processes one username at a time
 */
async function syncSinglePerson(username: string): Promise<SyncResult> {
  const trimmedUsername = username.trim();
  
  try {
    // Check if person exists in database
    const collection = await getImportantPeopleCollection();
    const person = await collection.findOne({
      username: trimmedUsername,
      is_active: true,
    });

    if (!person) {
      return {
        username: trimmedUsername,
        success: false,
        message: 'Person not found in important people list',
        error: 'Not found in database',
      };
    }

    console.log(`Starting sync for @${trimmedUsername}...`);

    // Call N8N webhook to get following list
    const n8nWebhookUrl = 'https://mdhusainil.app.n8n.cloud/webhook/getFollowing';
    
    const n8nResponse = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: trimmedUsername }),
    });

    if (!n8nResponse.ok) {
      throw new Error(`N8N webhook responded with status: ${n8nResponse.status}`);
    }

    const n8nData = await n8nResponse.json();
    console.log(`N8N response received for @${trimmedUsername}:`, {
      type: typeof n8nData,
      isArray: Array.isArray(n8nData),
      keys: n8nData ? Object.keys(n8nData) : null
    });

    // Parse N8N response - it might return different formats
    let followingList: unknown[] = [];
    let userData: Record<string, unknown> | null = null;

    // Handle different response formats
    if (Array.isArray(n8nData)) {
      if (n8nData[0]?.following) {
        followingList = n8nData[0].following;
        userData = n8nData[0].user;
      } else {
        followingList = n8nData;
      }
    } else if (n8nData?.extractedUsers) {
      followingList = n8nData.extractedUsers;
    } else if (n8nData?.following) {
      followingList = n8nData.following;
      userData = n8nData.user;
    } else if (n8nData?.data) {
      followingList = n8nData.data;
    }

    if (!Array.isArray(followingList) || followingList.length === 0) {
      return {
        username: trimmedUsername,
        success: false,
        message: 'No following data found from N8N',
        error: 'Invalid N8N response',
      };
    }

    // Transform following list to our format
    const formattedFollowing = followingList.map((user: unknown) => {
      const u = user as Record<string, unknown>;
      return {
        username: (u.username || u.userName || u.screenName) as string,
        user_id: (u.userId || u.user_id || u.id) as string,
        name: (u.name || u.displayName || u.username) as string,
      };
    });

    // Prepare important person object
    const importantPersonObj = {
      username: trimmedUsername,
      user_id: (userData?.userId || userData?.user_id || userData?.id || person.user_id || trimmedUsername) as string,
      name: (userData?.name || userData?.displayName || person.name || trimmedUsername) as string,
      weight: person.weight ?? 1,
    };

    // Update the inverse index
    console.log(`Processing ${formattedFollowing.length} following accounts for @${trimmedUsername}...`);
    await updateFollowingIndex(importantPersonObj, formattedFollowing);
    console.log(`✅ Sync complete for @${trimmedUsername}`);

    return {
      username: trimmedUsername,
      success: true,
      message: `Successfully synced @${trimmedUsername}`,
      following_count: formattedFollowing.length,
      synced_at: new Date(),
    };

  } catch (error) {
    console.error(`Error syncing @${trimmedUsername}:`, error);
    
    return {
      username: trimmedUsername,
      success: false,
      message: `Failed to sync @${trimmedUsername}`,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// POST - Trigger sync for one or more important people (supports comma-separated usernames)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username } = body;

    // Validate username input
    if (!username || typeof username !== 'string') {
      return NextResponse.json(
        { error: 'username is required and must be a string (supports comma-separated values)' },
        { status: 400 }
      );
    }

    // Split by comma and clean up whitespace
    const usernames = username
      .split(',')
      .map(u => u.trim())
      .filter(u => u.length > 0); // Remove empty strings

    if (usernames.length === 0) {
      return NextResponse.json(
        { error: 'At least one valid username is required' },
        { status: 400 }
      );
    }

    console.log(`Starting sync for ${usernames.length} username(s): ${usernames.join(', ')}`);

    // Process each username sequentially
    const results: SyncResult[] = [];
    for (const user of usernames) {
      const result = await syncSinglePerson(user);
      results.push(result);
    }

    // Count successes and failures
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    // Determine response status
    // If all failed, return 500
    // If some succeeded, return 207 (Multi-Status)
    // If all succeeded, return 200
    let status = 200;
    if (failureCount === results.length) {
      status = 500;
    } else if (failureCount > 0) {
      status = 207; // Multi-Status: partial success
    }

    return NextResponse.json({
      success: successCount > 0,
      message: `Processed ${usernames.length} username(s): ${successCount} succeeded, ${failureCount} failed`,
      summary: {
        total: usernames.length,
        succeeded: successCount,
        failed: failureCount,
      },
      results,
    }, { status });

  } catch (error) {
    console.error('Error processing sync request:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to process sync request',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

