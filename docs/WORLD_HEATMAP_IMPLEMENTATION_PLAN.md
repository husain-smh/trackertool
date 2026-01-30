# World Heatmap Implementation Plan

## Overview

Create an interactive world heatmap visualization showing engager locations from `account_based_in` data. The map will use color intensity to represent engagement density per country/region.

## Library Selection

### Recommended: `react-simple-maps` + `topojson-client`

**Why this combination:**
- ✅ Lightweight (~50KB gzipped)
- ✅ React-friendly (works seamlessly with Next.js)
- ✅ SVG-based (scalable, customizable)
- ✅ Good performance for 5k-10k data points
- ✅ Easy to style with CSS/Tailwind
- ✅ Built-in tooltip support
- ✅ Supports country-level and region-level mapping

**Alternatives considered:**
- `react-leaflet` - Too heavy, requires external map tiles
- `@react-jvectormap/core` - jQuery dependency, outdated
- `d3-geo` - Lower-level, more complex setup

### Installation

```bash
npm install react-simple-maps topojson-client
```

## Data Structure & Aggregation

### Backend Aggregation (Critical for Performance)

**Problem:** Sending 5k-10k individual engagement records to frontend is inefficient.

**Solution:** Aggregate on backend before sending to frontend.

```typescript
// API Response Structure
interface LocationHeatmapData {
  locations: Array<{
    location: string;           // "India", "South Asia", "United States"
    country_code?: string;     // "IN", "US" (ISO 3166-1 alpha-2)
    region_type: 'country' | 'region'; // Classification
    engagement_count: number;   // Total engagements from this location
    unique_users: number;       // Unique engagers from this location
    importance_score_avg: number; // Average importance score
  }>;
  total_engagements: number;
  total_locations: number;
  metadata: {
    locations_with_data: number;
    locations_missing_data: number;
    last_updated: string;
  };
}
```

### Aggregation Query (MongoDB)

```typescript
// Aggregate engagements by account_based_in
const pipeline = [
  {
    $match: {
      campaign_id: campaignId,
      'account_profile.account_based_in': { $exists: true, $ne: null, $ne: '' }
    }
  },
  {
    $group: {
      _id: '$account_profile.account_based_in',
      engagement_count: { $sum: 1 },
      unique_users: { $addToSet: '$user_id' },
      importance_score_avg: { $avg: '$importance_score' },
      max_importance: { $max: '$importance_score' }
    }
  },
  {
    $project: {
      location: '$_id',
      engagement_count: 1,
      unique_users: { $size: '$unique_users' },
      importance_score_avg: { $round: ['$importance_score_avg', 2] },
      max_importance: 1
    }
  },
  {
    $sort: { engagement_count: -1 }
  }
];
```

## Location Normalization Strategy

### Challenge: Mixed Granularity

Location data can be:
- **Country-level**: "India", "United States", "United Kingdom"
- **Region-level**: "South Asia", "North America", "Europe"
- **Ambiguous**: "Asia", "Americas"

### Solution: Multi-Tier Mapping

Create a mapping system that handles:

1. **Direct Country Mapping** (ISO 3166-1 alpha-2)
   - "India" → "IN"
   - "United States" → "US"
   - "United Kingdom" → "GB"

2. **Region-to-Countries Mapping**
   - "South Asia" → ["IN", "PK", "BD", "LK", "NP", "BT", "MV", "AF"]
   - "North America" → ["US", "CA", "MX"]
   - "Europe" → [all EU countries]

3. **Fuzzy Matching**
   - Handle variations: "USA" → "US", "UK" → "GB"
   - Handle common misspellings

### Implementation: Location Mapper Service

```typescript
// src/lib/socap/location-mapper.ts

interface LocationMapping {
  location: string;
  country_codes: string[];  // Can be multiple for regions
  region_type: 'country' | 'region';
  confidence: 'high' | 'medium' | 'low';
}

// Mapping database
const LOCATION_MAPPINGS: Record<string, LocationMapping> = {
  // Countries
  'India': { location: 'India', country_codes: ['IN'], region_type: 'country', confidence: 'high' },
  'United States': { location: 'United States', country_codes: ['US'], region_type: 'country', confidence: 'high' },
  'United States of America': { location: 'United States', country_codes: ['US'], region_type: 'country', confidence: 'high' },
  'USA': { location: 'United States', country_codes: ['US'], region_type: 'country', confidence: 'high' },
  
  // Regions
  'South Asia': {
    location: 'South Asia',
    country_codes: ['IN', 'PK', 'BD', 'LK', 'NP', 'BT', 'MV', 'AF'],
    region_type: 'region',
    confidence: 'high'
  },
  'North America': {
    location: 'North America',
    country_codes: ['US', 'CA', 'MX'],
    region_type: 'region',
    confidence: 'high'
  },
  // ... more mappings
};

export function mapLocationToCountryCodes(location: string): LocationMapping {
  // Direct match
  if (LOCATION_MAPPINGS[location]) {
    return LOCATION_MAPPINGS[location];
  }
  
  // Case-insensitive match
  const normalized = location.trim();
  const match = Object.values(LOCATION_MAPPINGS).find(
    m => m.location.toLowerCase() === normalized.toLowerCase()
  );
  if (match) return match;
  
  // Fuzzy match (handle common variations)
  // ... fuzzy matching logic
  
  // Default: return as-is with low confidence
  return {
    location,
    country_codes: [],
    region_type: 'region',
    confidence: 'low'
  };
}
```

## Color Scheme Strategy

### Option 1: Single Color Gradient (Recommended)

**Color:** Blue gradient (matches your design system)
- Lightest blue (#E0E7FF) = 0 engagements
- Medium blue (#6366F1) = medium engagements
- Darkest blue (#312E81) = highest engagements

**Advantages:**
- Clean, professional look
- Matches existing chart colors
- Easy to understand

### Option 2: Heat Scale (Red-Yellow-Green)

**Color:** Red → Yellow → Green
- Red (#EF4444) = High engagement
- Yellow (#FBBF24) = Medium engagement
- Green (#10B981) = Low engagement

**Advantages:**
- Intuitive "heat" metaphor
- High contrast

**Disadvantages:**
- May imply "bad" for green (low engagement)
- Doesn't match your blue theme

### Option 3: Multi-Color Scale

**Color:** Blue → Purple → Pink
- Matches your COLORS array: `['#4D4DFF', '#C4B5FD', '#10B981', '#3B82F6', '#F472B6']`

### Recommended: Single Color Gradient (Blue)

```typescript
// Color calculation function
function getColorForEngagementCount(
  count: number,
  maxCount: number,
  minCount: number = 0
): string {
  if (count === 0) return '#E5E7EB'; // Gray for no data
  
  // Normalize to 0-1 range
  const normalized = (count - minCount) / (maxCount - minCount);
  
  // Interpolate between light and dark blue
  const colors = [
    { stop: 0, color: '#E0E7FF' },    // Lightest
    { stop: 0.3, color: '#A5B4FC' },   // Light
    { stop: 0.6, color: '#6366F1' },   // Medium
    { stop: 1, color: '#312E81' }      // Darkest
  ];
  
  // Find color based on normalized value
  // ... interpolation logic
  
  return interpolatedColor;
}
```

## Edge Cases & Solutions

### 1. Missing Location Data

**Problem:** Some engagers don't have `account_based_in` set.

**Solution:**
- Show "Unknown" category in legend
- Display count: "X engagers (location unknown)"
- Don't render on map (or show in separate "Other" section)

### 2. Region-Level Data (e.g., "South Asia")

**Problem:** "South Asia" spans multiple countries. How to display?

**Solutions:**

**Option A: Distribute Across Countries** (Recommended)
- Split engagement count across all countries in region
- Example: 100 engagements from "South Asia" → 12.5 per country (8 countries)
- Pros: Shows geographic distribution
- Cons: May be misleading (not actual country data)

**Option B: Show as Overlay**
- Display region name as text overlay
- Color all countries in region with same intensity
- Pros: Accurate representation
- Cons: Less granular

**Option C: Separate Region View**
- Toggle between "Country View" and "Region View"
- Pros: Most accurate
- Cons: More complex UI

**Recommendation:** Option A with clear labeling

### 3. Ambiguous Locations

**Problem:** "Asia" could mean many countries.

**Solution:**
- Use fuzzy matching with confidence scores
- Show warning tooltip: "Location may be approximate"
- Prefer specific locations over ambiguous ones

### 4. Very Large Numbers (5k-10k engagers)

**Problem:** Performance issues with rendering.

**Solutions:**
- ✅ Aggregate on backend (already planned)
- ✅ Use SVG (react-simple-maps uses SVG - performant)
- ✅ Memoize map component
- ✅ Virtualize if needed (unlikely with aggregated data)
- ✅ Debounce tooltip updates

### 5. Zero or Very Low Engagement Countries

**Problem:** Countries with 1-2 engagers look same as countries with 0.

**Solution:**
- Use logarithmic scale for color calculation
- Or use discrete buckets: 0, 1-10, 11-50, 51-200, 201+
- Add minimum threshold for visibility

### 6. Country Code Mismatches

**Problem:** Some locations don't map to standard ISO codes.

**Solution:**
- Maintain fallback mapping
- Show "Other" category for unmapped locations
- Log unmapped locations for future updates

### 7. Multiple Engagements Per User

**Problem:** Same user might have multiple engagements.

**Solution:**
- Count unique users per location (already in aggregation)
- Show both metrics: "X engagements from Y users"
- Use unique users for color calculation (more accurate)

### 8. Rapid Data Updates

**Problem:** Location enrichment happens continuously.

**Solution:**
- Cache aggregated data for 5-10 minutes
- Invalidate cache when new location data arrives
- Show "Last updated" timestamp

## Performance Optimization

### Backend Optimizations

1. **Aggregate Before Sending**
   ```typescript
   // Don't send raw engagements
   // Send pre-aggregated location data
   ```

2. **Cache Aggregated Data**
   ```typescript
   // Cache for 5-10 minutes
   // Key: `heatmap:${campaignId}`
   ```

3. **Index on account_based_in**
   ```typescript
   // Ensure MongoDB index exists
   await collection.createIndex({ 
     'account_profile.account_based_in': 1,
     campaign_id: 1 
   });
   ```

### Frontend Optimizations

1. **Memoize Map Component**
   ```typescript
   const MemoizedMap = React.memo(WorldHeatmap);
   ```

2. **Lazy Load Map Component**
   ```typescript
   const WorldHeatmap = dynamic(() => import('./WorldHeatmap'), {
     ssr: false, // Maps don't need SSR
     loading: () => <MapSkeleton />
   });
   ```

3. **Debounce Tooltip Updates**
   ```typescript
   const debouncedTooltip = useMemo(
     () => debounce(updateTooltip, 100),
     []
   );
   ```

4. **Use CSS for Hover Effects**
   ```css
   /* Instead of JavaScript hover handlers */
   .country:hover {
     opacity: 0.8;
     cursor: pointer;
   }
   ```

## UI/UX Considerations

### Layout Options

**Option 1: Full-Width Card** (Recommended)
```
┌─────────────────────────────────────┐
│  Engagement Heatmap                 │
│  ┌───────────────────────────────┐ │
│  │                               │ │
│  │      [World Map]              │ │
│  │                               │ │
│  └───────────────────────────────┘ │
│  Legend: ████ High  ███ Medium    │
└─────────────────────────────────────┘
```

**Option 2: Side-by-Side with Stats**
```
┌──────────────┬──────────────────────┐
│ Top Locations│  [World Map]        │
│ 1. India (50)│                      │
│ 2. US (30)   │                      │
│ 3. UK (20)   │                      │
└──────────────┴──────────────────────┘
```

### Interactive Features

1. **Hover Tooltip**
   - Show: Country name, engagement count, unique users
   - Format: "India: 1,234 engagements from 890 users"

2. **Click to Filter** (Optional)
   - Click country to filter engagements list
   - Show only engagers from that location

3. **Zoom Controls** (Optional)
   - Allow zooming for better visibility
   - Reset button

4. **Legend**
   - Color scale with engagement ranges
   - "No data" indicator

### Responsive Design

- **Desktop:** Full-width map, detailed tooltips
- **Tablet:** Slightly smaller, simplified tooltips
- **Mobile:** Stack layout, map below stats, touch-friendly

## Implementation Steps

### Phase 1: Backend API Endpoint

1. Create aggregation function
2. Create location mapper service
3. Create API endpoint: `/api/socap/campaigns/[id]/heatmap`
4. Add caching layer
5. Add MongoDB indexes

### Phase 2: Location Mapping Database

1. Create location mappings file
2. Add country code mappings
3. Add region-to-countries mappings
4. Add fuzzy matching logic
5. Test with sample data

### Phase 3: Frontend Component

1. Install `react-simple-maps`
2. Create `WorldHeatmap` component
3. Implement color calculation
4. Add tooltip functionality
5. Add legend

### Phase 4: Integration

1. Add heatmap section to campaign dashboard
2. Fetch data from API
3. Handle loading/error states
4. Add responsive styling

### Phase 5: Polish

1. Add animations (fade-in)
2. Add loading skeleton
3. Optimize performance
4. Add error boundaries
5. Test with real data

## API Endpoint Design

```typescript
// GET /api/socap/campaigns/[id]/heatmap

Response:
{
  success: true,
  data: {
    locations: [
      {
        location: "India",
        country_codes: ["IN"],
        region_type: "country",
        engagement_count: 1234,
        unique_users: 890,
        importance_score_avg: 45.2
      },
      // ...
    ],
    total_engagements: 5000,
    total_locations: 45,
    metadata: {
      locations_with_data: 45,
      locations_missing_data: 120,
      last_updated: "2024-01-15T10:30:00Z"
    }
  }
}
```

## Testing Considerations

1. **Empty Data:** Campaign with no location data
2. **Single Location:** All engagers from one country
3. **Region Data:** Test with "South Asia", "Europe" etc.
4. **Mixed Granularity:** Mix of countries and regions
5. **Large Dataset:** 10k engagers across 50+ countries
6. **Missing Data:** Some engagers without location
7. **Unmapped Locations:** Locations not in mapping DB
8. **Performance:** Load time with large datasets

## Future Enhancements

1. **Time-based Animation:** Show engagement growth over time
2. **Filter by Engagement Type:** Show only retweets, replies, etc.
3. **Comparison Mode:** Compare two campaigns side-by-side
4. **Export:** Download as PNG/SVG
5. **Drill-down:** Click country to see city-level data (if available)

## Estimated Implementation Time

- Backend API: 4-6 hours
- Location Mapper: 3-4 hours
- Frontend Component: 6-8 hours
- Integration & Testing: 3-4 hours
- **Total: 16-22 hours**

