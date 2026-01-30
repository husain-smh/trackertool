import { NextRequest, NextResponse } from 'next/server';
import { getFollowingIndexCollection } from '@/lib/models/ranker';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let username = searchParams.get('username')?.trim();

    if (!username) {
      return NextResponse.json(
        { success: false, error: 'username query parameter is required' },
        { status: 400 }
      );
    }

    // Allow either "@username" or "username"
    if (username.startsWith('@')) {
      username = username.slice(1).trim();
    }

    if (!username) {
      return NextResponse.json(
        { success: false, error: 'Username cannot be empty' },
        { status: 400 }
      );
    }

    const followingIndexCollection = await getFollowingIndexCollection();

    // Case-insensitive match on followed_username.
    // Username space is small enough that a regex here is acceptable,
    // and keeps us from changing how usernames are stored.
    const entry = await followingIndexCollection.findOne({
      followed_username: { $regex: `^${username}$`, $options: 'i' },
    });

    if (!entry) {
      return NextResponse.json({
        success: true,
        data: {
          found: false,
          username,
          importance_score: 0,
          followed_by: [],
        },
      });
    }

    const followedBy = Array.isArray(entry.followed_by) ? entry.followed_by : [];

    return NextResponse.json({
      success: true,
      data: {
        found: true,
        followed_username: entry.followed_username,
        followed_user_id: entry.followed_user_id,
        importance_score: entry.importance_score ?? 0,
        followed_by: followedBy.map((follower) => ({
          username: follower.username,
          user_id: follower.user_id,
          name: follower.name,
          weight: follower.weight ?? 1,
        })),
      },
    });
  } catch (error) {
    console.error('Error looking up account importance:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to look up account importance',
      },
      { status: 500 }
    );
  }
}


