/**
 * Heatmap Data Aggregator
 * 
 * Aggregates engagement data by location for heatmap visualization.
 * Handles both country-level and region-level locations.
 */

import { getEngagementsCollection } from '../models/socap/engagements';
import { mapLocationToCountryCodes, type LocationMapping } from './location-mapper';
import { logger } from '../logger';

export interface LocationHeatmapData {
  location: string;
  country_codes: string[];
  region_type: 'country' | 'region';
  confidence: 'high' | 'medium' | 'low';
  engagement_count: number;
  unique_users: number;
  importance_score_avg: number;
  importance_score_max: number;
}

export interface HeatmapAggregationResult {
  locations: LocationHeatmapData[];
  total_engagements: number;
  total_locations: number;
  metadata: {
    locations_with_data: number;
    locations_missing_data: number;
    locations_unmapped: number;
    last_updated: string;
  };
}

/**
 * Aggregate engagement data by location for heatmap visualization
 * 
 * @param campaignId - Campaign ID to aggregate data for
 * @returns Aggregated location data with engagement counts
 */
export async function getLocationHeatmapData(
  campaignId: string
): Promise<HeatmapAggregationResult> {
  const collection = await getEngagementsCollection();
  
  try {
    // First, get total engagement count (including those without location)
    const totalEngagements = await collection.countDocuments({
      campaign_id: campaignId,
    });
    
    // Aggregate engagements by account_based_in
    const pipeline = [
      {
        $match: {
          campaign_id: campaignId,
          'account_profile.account_based_in': {
            $exists: true,
            $nin: [null, ''],
          },
        },
      },
      {
        $group: {
          _id: '$account_profile.account_based_in',
          engagement_count: { $sum: 1 },
          unique_users: { $addToSet: '$user_id' },
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
      {
        $sort: { engagement_count: -1 },
      },
    ];
    
    const rawResults = await collection.aggregate(pipeline).toArray();
    
    // Map locations to country codes and enrich with mapping data
    const locations: LocationHeatmapData[] = rawResults.map((result: any) => {
      const mapping = mapLocationToCountryCodes(result.location);
      
      return {
        location: result.location,
        country_codes: mapping.country_codes,
        region_type: mapping.region_type,
        confidence: mapping.confidence,
        engagement_count: result.engagement_count,
        unique_users: result.unique_users,
        importance_score_avg: result.importance_score_avg || 0,
        importance_score_max: result.importance_score_max || 0,
      };
    });
    
    // Count engagements without location data
    const engagementsWithoutLocation = await collection.countDocuments({
      campaign_id: campaignId,
      $or: [
        { 'account_profile.account_based_in': { $exists: false } },
        { 'account_profile.account_based_in': null },
        { 'account_profile.account_based_in': '' },
      ],
    });
    
    // Count unmapped locations (low confidence)
    const unmappedCount = locations.filter(l => l.confidence === 'low' && l.country_codes.length === 0).length;
    
    logger.info('Location heatmap data aggregated', {
      campaign_id: campaignId,
      total_locations: locations.length,
      total_engagements: totalEngagements,
      engagements_with_location: totalEngagements - engagementsWithoutLocation,
      engagements_without_location: engagementsWithoutLocation,
      unmapped_locations: unmappedCount,
    });
    
    return {
      locations,
      total_engagements: totalEngagements,
      total_locations: locations.length,
      metadata: {
        locations_with_data: locations.length,
        locations_missing_data: engagementsWithoutLocation,
        locations_unmapped: unmappedCount,
        last_updated: new Date().toISOString(),
      },
    };
  } catch (error) {
    logger.error('Error aggregating location heatmap data', error, {
      campaign_id: campaignId,
    });
    throw error;
  }
}

/**
 * Distribute region-level engagement counts across countries
 * 
 * This is useful for displaying region data on country-level maps.
 * For example, "South Asia" with 100 engagements gets distributed
 * across 8 countries (12.5 engagements each).
 * 
 * @param locations - Location data with region-level entries
 * @returns Expanded location data with region counts distributed
 */
export function distributeRegionEngagements(
  locations: LocationHeatmapData[]
): LocationHeatmapData[] {
  const expanded: LocationHeatmapData[] = [];
  const countryTotals = new Map<string, number>();
  
  for (const location of locations) {
    if (location.region_type === 'region' && location.country_codes.length > 0) {
      // Distribute engagement count across countries in region
      const countPerCountry = location.engagement_count / location.country_codes.length;
      const usersPerCountry = Math.ceil(location.unique_users / location.country_codes.length);
      
      for (const countryCode of location.country_codes) {
        const existingCount = countryTotals.get(countryCode) || 0;
        countryTotals.set(countryCode, existingCount + countPerCountry);
        
        expanded.push({
          location: `${location.location} (${countryCode})`,
          country_codes: [countryCode],
          region_type: 'country',
          confidence: 'medium', // Lower confidence since it's distributed
          engagement_count: countPerCountry,
          unique_users: usersPerCountry,
          importance_score_avg: location.importance_score_avg,
          importance_score_max: location.importance_score_max,
        });
      }
    } else {
      // Country-level or unmapped - add as-is
      expanded.push(location);
    }
  }
  
  // Aggregate by country code to combine distributed counts
  const aggregated = new Map<string, LocationHeatmapData>();
  
  for (const location of expanded) {
    for (const countryCode of location.country_codes) {
      const existing = aggregated.get(countryCode);
      if (existing) {
        existing.engagement_count += location.engagement_count;
        existing.unique_users = Math.max(existing.unique_users, location.unique_users);
        existing.importance_score_max = Math.max(
          existing.importance_score_max,
          location.importance_score_max
        );
      } else {
        aggregated.set(countryCode, { ...location });
      }
    }
  }
  
  return Array.from(aggregated.values()).sort(
    (a, b) => b.engagement_count - a.engagement_count
  );
}

