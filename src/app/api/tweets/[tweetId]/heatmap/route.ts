import { NextRequest, NextResponse } from 'next/server';
import { getEngagersCollection } from '@/lib/models/tweets';
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

/**
 * GET /api/tweets/[tweetId]/heatmap
 * Tweet-scoped heatmap from accurate `account_based_in` (populated asynchronously).
 *
 * Query:
 * - distribute_regions: boolean (default true)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tweetId: string }> },
) {
  const { tweetId } = await params;
  const cleanedTweetId = String(tweetId || '').trim();
  if (!cleanedTweetId) {
    return NextResponse.json({ success: false, error: 'Missing tweetId' }, { status: 400 });
  }

  // Kick enrichment idempotently so the heatmap improves over time.
  await enqueueTweetLocationEnrichmentJob(cleanedTweetId);

  const { searchParams } = new URL(request.url);
  const distributeRegions = searchParams.get('distribute_regions') !== 'false';

  const collection = await getEngagersCollection();

  const totalRows = await collection.countDocuments({ tweet_id: cleanedTweetId });
  const missingRows = await collection.countDocuments({
    tweet_id: cleanedTweetId,
    $or: [
      { account_based_in: { $exists: false } },
      { account_based_in: null },
      { account_based_in: '' },
    ],
  });

  const pipeline: any[] = [
    {
      $match: {
        tweet_id: cleanedTweetId,
        account_based_in: { $exists: true, $nin: [null, ''] },
      },
    },
    {
      $group: {
        _id: '$account_based_in',
        engagement_count: { $sum: 1 },
        unique_users: { $addToSet: '$userId' },
        importance_score_avg: { $avg: '$importance_score' },
        importance_score_max: { $max: '$importance_score' },
      },
    },
    {
      $project: {
        location: '$_id',
        engagement_count: 1,
        unique_users: { $size: '$unique_users' },
        importance_score_avg: { $round: ['$importance_score_avg', 2] },
        importance_score_max: 1,
      },
    },
    { $sort: { engagement_count: -1 } },
  ];

  const raw = await collection.aggregate(pipeline).toArray();

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


