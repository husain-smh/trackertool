'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { LocationHeatmapData } from '@/components/WorldHeatmap';

const WorldHeatmap = dynamic(() => import('@/components/WorldHeatmap').then(mod => ({ default: mod.WorldHeatmap })), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
      <span className="ml-3 text-muted-foreground text-sm">Loading map...</span>
    </div>
  ),
});

const HeatmapLegend = dynamic(() => import('@/components/WorldHeatmap').then(mod => ({ default: mod.HeatmapLegend })), {
  ssr: false,
});

export function UserReportHeatmapSection({ identifier }: { identifier: string }) {
  const [heatmapData, setHeatmapData] = useState<{
    locations: LocationHeatmapData[];
    total_engagements: number;
    total_locations: number;
    metadata: {
      locations_with_data: number;
      locations_missing_data: number;
      locations_unmapped: number;
      last_updated: string;
    };
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/user-report/${encodeURIComponent(identifier)}/heatmap?distribute_regions=true`);
        const json = await res.json();
        if (!cancelled) {
          setHeatmapData(json?.success ? json.data : null);
        }
      } catch {
        if (!cancelled) setHeatmapData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [identifier]);

  return (
    <div className="card-base p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-2xl font-semibold text-foreground">Location heatmap</h3>
        <span className="text-xs text-muted-foreground">Geographic distribution of engagers</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
          <span className="ml-3 text-muted-foreground text-sm">Loading heatmap...</span>
        </div>
      ) : heatmapData && heatmapData.locations.length > 0 ? (
        <div className="space-y-4">
          <div className="bg-muted/20 rounded-lg p-4 border border-border">
            <WorldHeatmap data={heatmapData.locations} height={300} scale={175} frameRatio={5.8} />
          </div>
          <div className="flex items-center justify-between">
            <HeatmapLegend maxCount={Math.max(...heatmapData.locations.map(l => l.unique_users))} />
            <div className="text-xs text-muted-foreground">
              {heatmapData.metadata.locations_with_data} location strings
              {heatmapData.metadata.locations_missing_data > 0 &&
                ` • ${heatmapData.metadata.locations_missing_data} engagements missing location`}
            </div>
          </div>
          {heatmapData.metadata.locations_unmapped > 0 && (
            <div className="text-xs text-yellow-600 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2">
              ⚠️ {heatmapData.metadata.locations_unmapped} location(s) could not be mapped to countries
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-10 text-muted-foreground text-sm">
          No accurate location data yet — enrichment is running in the background.
        </div>
      )}
    </div>
  );
}


