import { NextRequest, NextResponse } from 'next/server';
import { getEngagersCollection, getTweetsCollection } from '@/lib/models/tweets';

function parseBoundedInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

type ImportantEngagerRow = {
  userId: string;
  username: string;
  name: string;
  bio?: string;
  followers: number;
  verified: boolean;
  importance_score: number;
  tweetEngagements: Array<{
    tweetId: string;
    tweetUrl: string;
    actions: string[];
  }>;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> },
) {
  try {
    const { identifier } = await params;
    const { searchParams } = new URL(request.url);

    const limit = parseBoundedInt(searchParams.get('limit'), 50, 1, 200);
    const skip = parseBoundedInt(searchParams.get('skip'), 0, 0, 1_000_000);

    const tweetsCollection = await getTweetsCollection();

    // Find tweets for this author (same matching logic as the report: username (preferred), fallback to name).
    const trimmed = identifier.trim();
    const sanitizedUsername = trimmed.replace(/^@/, '');
    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    let tweets: Array<{ tweet_id: string; tweet_url: string }> = [];
    if (sanitizedUsername) {
      const usernameRegex = new RegExp(`^@?${escapeRegex(sanitizedUsername)}$`, 'i');
      tweets = (await tweetsCollection
        .find({ author_username: usernameRegex })
        .project({ tweet_id: 1, tweet_url: 1, _id: 0 })
        .toArray()) as Array<{ tweet_id: string; tweet_url: string }>;
    }

    if (tweets.length === 0) {
      const nameRegex = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
      tweets = (await tweetsCollection
        .find({ author_name: nameRegex })
        .project({ tweet_id: 1, tweet_url: 1, _id: 0 })
        .toArray()) as Array<{ tweet_id: string; tweet_url: string }>;
    }

    if (tweets.length === 0) {
      return NextResponse.json({ error: 'Author not found' }, { status: 404 });
    }

    const tweetIds = tweets.map((t: any) => String(t.tweet_id));
    const tweetUrlById = new Map<string, string>(
      tweets.map((t: any) => [String(t.tweet_id), String(t.tweet_url)]),
    );

    const engagersCollection = await getEngagersCollection();

    // Aggregate by userId across *all* tweets for this author, keep max importance score for ordering.
    const match = {
      tweet_id: { $in: tweetIds },
      importance_score: { $gt: 0 },
      $or: [{ replied: true }, { retweeted: true }, { quoted: true }, { liked: true }],
    };

    const pipeline: any[] = [
      { $match: match },
      { $sort: { importance_score: -1, followers: -1 } },
      {
        $group: {
          _id: '$userId',
          userId: { $first: '$userId' },
          username: { $first: '$username' },
          name: { $first: '$name' },
          bio: { $first: '$bio' },
          followers: { $max: '$followers' },
          verified: { $max: { $cond: ['$verified', 1, 0] } },
          importance_score: { $max: '$importance_score' },
          tweetEngagements: {
            $push: {
              tweetId: '$tweet_id',
              replied: '$replied',
              retweeted: '$retweeted',
              quoted: '$quoted',
              liked: '$liked',
            },
          },
        },
      },
      { $sort: { importance_score: -1, followers: -1 } },
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: 'value' }],
        },
      },
    ];

    const aggregated = await engagersCollection.aggregate(pipeline).toArray();
    const facet = aggregated?.[0] ?? { items: [], total: [] };

    const total = Number(facet.total?.[0]?.value ?? 0);

    const items: ImportantEngagerRow[] = (facet.items ?? []).map((row: any) => {
      const tweetEngagements = (row.tweetEngagements ?? [])
        .map((te: any) => {
          const actions: string[] = [];
          if (te.replied) actions.push('replied');
          if (te.retweeted) actions.push('retweeted');
          if (te.quoted) actions.push('quoted');
          if (te.liked) actions.push('liked');
          return {
            tweetId: String(te.tweetId),
            tweetUrl:
              tweetUrlById.get(String(te.tweetId)) ??
              `https://twitter.com/i/status/${String(te.tweetId)}`,
            actions,
          };
        })
        .filter((te: any) => te.actions.length > 0);

      return {
        userId: String(row.userId),
        username: String(row.username ?? ''),
        name: String(row.name ?? ''),
        bio: typeof row.bio === 'string' ? row.bio : undefined,
        followers: Number(row.followers ?? 0),
        verified: Boolean(row.verified),
        importance_score: Number(row.importance_score ?? 0),
        tweetEngagements,
      };
    });

    return NextResponse.json({
      success: true,
      page: {
        limit,
        skip,
        total,
        hasMore: skip + items.length < total,
      },
      items,
    });
  } catch (error) {
    console.error('Failed to fetch important engagers', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch important engagers',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

