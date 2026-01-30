# Location Enrichment Implementation

## Overview

This service enriches engagement data with accurate location information (`account_based_in`) from the Twitter API's `user_about` endpoint. The location data is more accurate than the user-provided `location` field and is used for generating geographical heatmaps.

## Architecture

### Components

1. **User About API Client** (`src/lib/socap/user-about-api.ts`)
   - Fetches user location data from `https://api.twitterapi.io/twitter/user_about`
   - Handles rate limiting, retries, and error handling
   - Extracts `account_based_in` from API response

2. **Location Enrichment Service** (`src/lib/socap/location-enrichment-service.ts`)
   - Prioritizes users by `importance_score` first, then by `followers`
   - Processes users in batches (default: 20 per batch)
   - Updates engagement records with accurate location data
   - Handles rate limits gracefully

3. **Location Enrichment Worker** (`src/lib/socap/workers/location-enrichment-worker.ts`)
   - Background worker that processes location enrichment jobs
   - Low priority (priority 5) - doesn't block other jobs
   - Automatically re-queues if more users need processing

4. **Job Queue Integration**
   - New job type: `location_enrichment`
   - One job per campaign (not per-tweet)
   - Automatically enqueued when campaigns are triggered

## Priority System

Users are prioritized in this order:
1. **Primary**: `importance_score` (descending)
2. **Secondary**: `followers` count (descending)

Priority score calculation:
```
priority_score = (importance_score * 1,000,000) + followers
```

This ensures importance_score is the primary sort key, with followers as a tie-breaker.

## Data Storage

### Engagement Model Update

The `Engagement` interface now includes:
```typescript
account_profile: {
  username: string;
  name: string;
  bio?: string;
  location?: string;              // User-provided location (may be inaccurate)
  account_based_in?: string;     // Accurate location from Twitter API (for heatmap)
  followers: number;
  verified: boolean;
}
```

- `location`: Original user-provided location (preserved)
- `account_based_in`: Accurate location from Twitter API (new field)

## Processing Flow

1. **Job Enqueueing**
   - When campaigns are triggered via `/api/socap/workers/trigger`, location enrichment jobs are automatically enqueued
   - One job per campaign (uses special `tweet_id: "LOCATION_ENRICHMENT"`)

2. **Worker Processing**
   - Worker picks up `location_enrichment` jobs (low priority)
   - Fetches users needing enrichment, prioritized by importance_score → followers
   - Processes up to 20 users per batch (configurable via `LOCATION_ENRICHMENT_BATCH_SIZE`)
   - Adds 1 second delay between API requests (configurable via `LOCATION_ENRICHMENT_DELAY_MS`)

3. **Location Fetching**
   - For each user, calls `user_about` API endpoint
   - Extracts `account_based_in` from response
   - Updates all engagements for that user in the campaign

4. **Re-queuing**
   - After processing a batch, checks if more users need enrichment
   - If yes and no rate limits hit, re-queues the job automatically
   - Continues until all users are processed or rate limits are hit

## Rate Limiting

- **Default delay**: 1 second between requests
- **Rate limit handling**: If 429 error occurs, job is marked as failed and will retry later
- **Batch size**: Processes 20 users per batch to avoid long-running jobs

## Configuration

Environment variables:

- `LOCATION_ENRICHMENT_BATCH_SIZE`: Maximum users to process per batch (default: 20)
- `LOCATION_ENRICHMENT_DELAY_MS`: Delay between API requests in milliseconds (default: 1000)
- `TWITTER_API_KEY_SHARED` or `TWITTER_API_KEY`: API key for user_about endpoint

## Usage

### Automatic Processing

Location enrichment runs automatically:
- When campaigns are triggered (via N8N scheduler or manual trigger)
- As part of the regular job processing cycle
- In the background without blocking other jobs

### Manual Processing

You can also manually trigger location enrichment for a campaign:

```typescript
import { processLocationEnrichment } from '@/lib/socap/location-enrichment-service';

const stats = await processLocationEnrichment(campaignId, 50, 1000);
console.log(`Processed: ${stats.processed}, Updated: ${stats.updated}`);
```

### Querying Location Data

Location data is stored in engagement records:

```typescript
const engagements = await getEngagementsByCampaign(campaignId);
engagements.forEach(engagement => {
  const accurateLocation = engagement.account_profile.account_based_in;
  const userLocation = engagement.account_profile.location; // May be inaccurate
});
```

## Performance Considerations

- **Batch Processing**: Processes users in batches to avoid long-running jobs
- **Priority-Based**: Processes most important users first
- **Non-Blocking**: Low priority ensures it doesn't block critical jobs
- **Rate Limit Aware**: Respects API rate limits and handles 429 errors gracefully
- **Incremental**: Processes users incrementally as engagements are created

## Future Enhancements

- **Heatmap Generation**: Use `account_based_in` data to generate geographical heatmaps
- **Location Analytics**: Analyze engagement patterns by location
- **Caching**: Cache location data to avoid redundant API calls
- **Bulk Processing**: Process multiple users in parallel (if API supports it)

## Monitoring

The service logs:
- Users processed per batch
- Location updates made
- Rate limit hits
- Errors encountered

Check logs for:
- `[user-about]` - API client logs
- `Location enriched for user` - Successful enrichment
- `Rate limited while enriching location` - Rate limit warnings

