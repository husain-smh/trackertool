# World Heatmap - Quick Start Guide

## Key Recommendations Summary

### 1. Library Choice: `react-simple-maps` ✅

**Why:**
- Lightweight (50KB)
- React-friendly
- Good performance
- Easy to customize

**Install:**
```bash
npm install react-simple-maps topojson-client
```

### 2. Critical: Aggregate Data on Backend ⚠️

**Don't:** Send 5k-10k individual engagement records to frontend
**Do:** Aggregate by location on backend, send only location counts

**Example:**
```typescript
// ❌ BAD: Sending all engagements
const engagements = await getEngagementsByCampaign(campaignId);
// 5000+ records!

// ✅ GOOD: Aggregated data
const heatmapData = await getLocationHeatmapData(campaignId);
// Only 50-100 location records
```

### 3. Handle Mixed Granularity

**Problem:** "South Asia" vs "India"

**Solution:** 
- Map regions to multiple countries
- Distribute engagement count across countries
- Show clear labeling

### 4. Color Scheme: Blue Gradient

Matches your design system:
- Light blue (#E0E7FF) = Low engagement
- Dark blue (#312E81) = High engagement

### 5. Performance Checklist

- ✅ Aggregate on backend
- ✅ Cache aggregated data (5-10 min)
- ✅ Use SVG (react-simple-maps)
- ✅ Memoize component
- ✅ Lazy load map component
- ✅ Add MongoDB index on `account_based_in`

## Critical Edge Cases

### 1. Missing Location Data
- Show "Unknown" in legend
- Don't render on map
- Display count: "X engagers (location unknown)"

### 2. Region Data (e.g., "South Asia")
- Split count across all countries in region
- Example: 100 engagements → 12.5 per country (8 countries)
- Add tooltip: "Data distributed across region"

### 3. Zero Engagement Countries
- Use logarithmic scale OR discrete buckets
- Minimum threshold for visibility
- Gray color for zero

### 4. Unmapped Locations
- Fallback to "Other" category
- Log for future mapping updates
- Don't break the UI

### 5. Rapid Updates
- Cache for 5-10 minutes
- Show "Last updated" timestamp
- Invalidate on new data

## Implementation Priority

1. **High Priority:**
   - Backend aggregation API
   - Basic location mapping
   - Simple map component

2. **Medium Priority:**
   - Region-to-countries mapping
   - Tooltip functionality
   - Legend

3. **Low Priority:**
   - Click to filter
   - Zoom controls
   - Animations

## Quick Code Snippets

### Backend Aggregation

```typescript
// src/lib/socap/heatmap-aggregator.ts
export async function getLocationHeatmapData(campaignId: string) {
  const collection = await getEngagementsCollection();
  
  const pipeline = [
    {
      $match: {
        campaign_id: campaignId,
        'account_profile.account_based_in': { 
          $exists: true, 
          $ne: null, 
          $ne: '' 
        }
      }
    },
    {
      $group: {
        _id: '$account_profile.account_based_in',
        engagement_count: { $sum: 1 },
        unique_users: { $addToSet: '$user_id' },
        importance_score_avg: { $avg: '$importance_score' }
      }
    },
    {
      $project: {
        location: '$_id',
        engagement_count: 1,
        unique_users: { $size: '$unique_users' },
        importance_score_avg: { $round: ['$importance_score_avg', 2] }
      }
    },
    { $sort: { engagement_count: -1 } }
  ];
  
  return await collection.aggregate(pipeline).toArray();
}
```

### Frontend Map Component (Basic)

```typescript
// src/components/WorldHeatmap.tsx
'use client';

import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import { geoMercator } from 'd3-geo';

interface LocationData {
  location: string;
  country_codes: string[];
  engagement_count: number;
}

export function WorldHeatmap({ data }: { data: LocationData[] }) {
  const maxCount = Math.max(...data.map(d => d.engagement_count));
  
  const getColor = (count: number) => {
    if (count === 0) return '#E5E7EB';
    const intensity = count / maxCount;
    // Interpolate blue colors
    if (intensity < 0.3) return '#E0E7FF';
    if (intensity < 0.6) return '#6366F1';
    return '#312E81';
  };
  
  return (
    <ComposableMap>
      <Geographies geography="/world-110m.json">
        {({ geographies }) =>
          geographies.map((geo) => {
            const countryCode = geo.properties.ISO_A2;
            const locationData = data.find(d => 
              d.country_codes.includes(countryCode)
            );
            const count = locationData?.engagement_count || 0;
            
            return (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill={getColor(count)}
                style={{
                  default: { outline: 'none' },
                  hover: { outline: '2px solid #6366F1', cursor: 'pointer' }
                }}
              />
            );
          })
        }
      </Geographies>
    </ComposableMap>
  );
}
```

## Next Steps

1. Read full plan: `WORLD_HEATMAP_IMPLEMENTATION_PLAN.md`
2. Install dependencies: `npm install react-simple-maps topojson-client`
3. Create backend API endpoint
4. Build location mapper service
5. Create frontend component
6. Integrate into campaign dashboard

## Questions to Consider

1. **Region Distribution:** How should "South Asia" be displayed?
   - Split across countries? (Recommended)
   - Show as overlay?
   - Separate view toggle?

2. **Color Scale:** Linear or logarithmic?
   - Linear: Simple, but may hide small differences
   - Logarithmic: Better for wide ranges

3. **Interaction:** Click to filter?
   - Yes: More interactive
   - No: Simpler, faster

4. **Mobile:** Full map or simplified?
   - Full: Better UX but heavier
   - Simplified: Faster but less detail

