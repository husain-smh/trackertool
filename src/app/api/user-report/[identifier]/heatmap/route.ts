import { NextRequest, NextResponse } from 'next/server';
import { Document } from 'mongodb';
import { getTweetsCollection, getEngagersCollection } from '@/lib/models/tweets';
import { mapLocationToCountryCodes } from '@/lib/socap/location-mapper';
import { distributeRegionEngagements } from '@/lib/socap/heatmap-aggregator';
import { enqueueTweetLocationEnrichmentJob } from '@/lib/models/tweet-location-enrichment-jobs';

export const maxDuration = 30;

type LocationHeatmapData = {
  location: string;
  country_codes: string[];
  region_type: 'country' | 'region';
  confidence: 'high' | 'medium' | 'low';
  engagement_count: number;
  unique_users: number;
  importance_score_avg: number;
  importance_score_max: number;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeUsername(value: string): string {
  return value.trim().replace(/^@/, '');
}

async function findTweetsByIdentifier(identifier: string) {
  const trimmed = identifier.trim();
  if (!trimmed) return [];

  const tweetsCollection = await getTweetsCollection();
  const usernameTarget = sanitizeUsername(trimmed);

  if (usernameTarget) {
    const usernameRegex = new RegExp(`^@?${escapeRegex(usernameTarget)}$`, 'i');
    const tweets = await tweetsCollection
      .find({ author_username: usernameRegex })
      .sort({ created_at: 1 })
      .toArray();
    if (tweets.length > 0) return tweets;
  }

  const nameRegex = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
  return tweetsCollection.find({ author_name: nameRegex }).sort({ created_at: 1 }).toArray();
}

/**
 * GET /api/user-report/[identifier]/heatmap
 * User-scoped heatmap using accurate `account_based_in` across all tweets for that author.
 * Dedupes by userId across tweets (unique engagers).
 *
 * Query:
 * - distribute_regions: boolean (default true)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await params;
  const cleanedIdentifier = String(identifier || '').trim();
  if (!cleanedIdentifier) {
    return NextResponse.json({ success: false, error: 'Missing identifier' }, { status: 400 });
  }

  const tweets = await findTweetsByIdentifier(cleanedIdentifier);
  if (tweets.length === 0) {
    return NextResponse.json({ success: false, error: 'Author not found' }, { status: 404 });
  }

  const tweetIds = tweets.map((t: any) => t.tweet_id).filter(Boolean);
  // Kick enrichment idempotently for all tweets so userReport improves over time.
  await Promise.all(tweetIds.map((id: string) => enqueueTweetLocationEnrichmentJob(id)));

  const { searchParams } = new URL(request.url);
  const distributeRegions = searchParams.get('distribute_regions') !== 'false';

  const engagersCollection = await getEngagersCollection();

  // Total engager rows across all tweets (not deduped)
  const totalRows = await engagersCollection.countDocuments({ tweet_id: { $in: tweetIds } });

  // We dedupe by userId first, then group by account_based_in.
  // Prefer freshest account_based_in per user via sort by updated_at.
  const pipeline: Document[] = [
    {
      $match: {
        tweet_id: { $in: tweetIds },
        account_based_in: { $exists: true, $nin: [null, ''] },
        userId: { $exists: true, $nin: [null, ''] },
      },
    },
    { $sort: { account_based_in_updated_at: -1 } },
    {
      $group: {
        _id: '$userId',
        account_based_in: { $first: '$account_based_in' },
        importance_score: { $max: '$importance_score' },
      },
    },
    {
      $group: {
        _id: '$account_based_in',
        unique_users: { $sum: 1 },
        engagement_count: { $sum: 1 }, // user-level count (since we're deduped)
        importance_score_avg: { $avg: '$importance_score' },
        importance_score_max: { $max: '$importance_score' },
      },
    },
    {
      $project: {
        location: '$_id',
        engagement_count: 1,
        unique_users: 1,
        importance_score_avg: { $round: ['$importance_score_avg', 2] },
        importance_score_max: 1,
      },
    },
    { $sort: { unique_users: -1 } },
  ];

  const raw = await engagersCollection.aggregate(pipeline).toArray();

  const mapped: LocationHeatmapData[] = raw.map((row: any) => {
    const mapping = mapLocationToCountryCodes(row.location);
    return {
      location: row.location,
      country_codes: mapping.country_codes,
      region_type: mapping.region_type,
      confidence: mapping.confidence,
      engagement_count: Number(row.engagement_count ?? 0),
      unique_users: Number(row.unique_users ?? 0),
      importance_score_avg: Number(row.importance_score_avg ?? 0),
      importance_score_max: Number(row.importance_score_max ?? 0),
    };
  });

  const locations = distributeRegions ? distributeRegionEngagements(mapped as any) : mapped;
  const unmappedCount = locations.filter(
    (l) => l.confidence === 'low' && (!l.country_codes || l.country_codes.length === 0),
  ).length;

  // Missing rows (not deduped) — useful for “enrichment in progress” messaging
  const missingRows = await engagersCollection.countDocuments({
    tweet_id: { $in: tweetIds },
    $or: [
      { account_based_in: { $exists: false } },
      { account_based_in: null },
      { account_based_in: '' },
    ],
  });

  return NextResponse.json({
    success: true,
    data: {
      locations,
      total_engagements: totalRows,
      total_locations: locations.length,
      metadata: {
        locations_with_data: mapped.length,
        locations_missing_data: missingRows,
        locations_unmapped: unmappedCount,
        last_updated: new Date().toISOString(),
      },
    },
  });
}


