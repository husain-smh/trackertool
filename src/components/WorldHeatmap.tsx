'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';

// World map GeoJSON (Natural Earth) with ISO country codes (ISO_A2).
const geoUrl =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';

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

interface WorldHeatmapProps {
  data: LocationHeatmapData[];
  onCountryClick?: (countryCode: string, data: LocationHeatmapData | undefined) => void;
  height?: number;
  scale?: number;
  frameRatio?: number;
}

// Ink-based Choropleth Scale
// From faint trace to deep ink saturation
const NO_ENGAGERS_FILL = 'transparent'; 
const CHOROPLETH_COLORS = [
  'var(--muted)', // Trace
  '#fed7aa', // Orange 200
  '#fb923c', // Orange 400
  '#ea580c', // Orange 600
  '#c2410c', // Orange 700
  '#9a3412', // Orange 800
  '#7c2d12', // Orange 900
  '#431407', // Deepest Brown/Black
];

function getFillColorForEngagers(engagers: number, maxEngagers: number): string {
  if (maxEngagers <= 0) return NO_ENGAGERS_FILL;
  if (!Number.isFinite(engagers) || engagers <= 0) return NO_ENGAGERS_FILL;

  const normalized = Math.log10(engagers + 1) / Math.log10(maxEngagers + 1);
  const idx = Math.min(CHOROPLETH_COLORS.length - 1, Math.floor(normalized * CHOROPLETH_COLORS.length));
  return CHOROPLETH_COLORS[idx];
}

export function WorldHeatmap({
  data,
  onCountryClick,
  height = 400,
  scale = 175,
  frameRatio = 3.2,
}: WorldHeatmapProps) {
  const [worldGeoJson, setWorldGeoJson] = useState<any | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      try {
        const res = await fetch(geoUrl, { signal: controller.signal, cache: 'force-cache' });
        const json = await res.json();
        if (!cancelled) setWorldGeoJson(json);
      } catch {
        if (!cancelled) setWorldGeoJson(null);
      }
    };

    run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const countryDataMap = useMemo(() => {
    const map = new Map<string, LocationHeatmapData>();

    for (const location of data) {
      for (const countryCode of location.country_codes) {
        if (!countryCode || countryCode === '-99') continue;

        const existing = map.get(countryCode);
        if (!existing) {
          map.set(countryCode, {
            location: countryCode,
            country_codes: [countryCode],
            region_type: 'country',
            confidence: 'high',
            engagement_count: location.engagement_count ?? 0,
            unique_users: location.unique_users ?? 0,
            importance_score_avg: location.importance_score_avg ?? 0,
            importance_score_max: location.importance_score_max ?? 0,
          });
          continue;
        }

        existing.engagement_count += location.engagement_count ?? 0;
        existing.unique_users = Math.max(existing.unique_users ?? 0, location.unique_users ?? 0);
        existing.importance_score_max = Math.max(
          existing.importance_score_max ?? 0,
          location.importance_score_max ?? 0
        );

        existing.importance_score_avg =
          (Number(existing.importance_score_avg ?? 0) + Number(location.importance_score_avg ?? 0)) / 2;
      }
    }

    return map;
  }, [data]);
  
  const maxEngagers = useMemo(() => {
    if (countryDataMap.size === 0) return 0;
    return Math.max(...Array.from(countryDataMap.values()).map(d => d.unique_users ?? 0));
  }, [countryDataMap]);

  const [tooltip, setTooltip] = useState<{
    countryName: string;
    locationData: LocationHeatmapData | undefined;
    x: number;
    y: number;
  } | null>(null);

  const [hoveredCountryCode, setHoveredCountryCode] = useState<string | null>(null);

  const handleCountryClick = (countryCode: string) => {
    if (onCountryClick) {
      const locationData = countryDataMap.get(countryCode);
      onCountryClick(countryCode, locationData);
    }
  };

  const VB_WIDTH = 1000;
  const ratio = Math.min(5, Math.max(1.8, Number(frameRatio)));
  const VB_HEIGHT = Math.round(VB_WIDTH / ratio);

  const { features, pathForFeature } = useMemo(() => {
    const empty = { features: [] as any[], pathForFeature: (_: any) => '' };
    if (!worldGeoJson?.features?.length) return empty;

    const projection = geoNaturalEarth1().fitSize([VB_WIDTH, VB_HEIGHT], worldGeoJson);
    const coverFactor = Math.max(0.6, Number(scale) / 175);
    projection.scale(projection.scale() * coverFactor);
    projection.translate([VB_WIDTH / 2, VB_HEIGHT / 2]);

    const path = geoPath(projection);

    return {
      features: worldGeoJson.features as any[],
      pathForFeature: (feature: any) => path(feature) ?? '',
    };
  }, [worldGeoJson, scale, VB_HEIGHT]);

  const getCountryMeta = (feature: any): {
    countryCode?: string;
    countryName: string;
    locationData?: LocationHeatmapData;
    engagerCount: number;
    fillColor: string;
  } => {
    const props: any = feature?.properties ?? {};
    const countryCodeRaw: unknown =
      props.ISO_A2 ?? props.iso_a2 ?? props.ISO2 ?? props['ISO-2'] ?? props.ISO_A2_EH;
    const countryCodeNormalized =
      typeof countryCodeRaw === 'string' ? countryCodeRaw.toUpperCase().trim() : undefined;
    const countryCode =
      countryCodeNormalized && countryCodeNormalized !== '-99' ? countryCodeNormalized : undefined;
    const countryName = props.ADMIN ?? props.name ?? props.NAME ?? countryCode ?? 'Unknown';
    const locationData = countryCode ? countryDataMap.get(countryCode) : undefined;
    const engagerCount = locationData?.unique_users || 0;
    const fillColor = getFillColorForEngagers(engagerCount, maxEngagers);

    return { countryCode, countryName, locationData, engagerCount, fillColor };
  };

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden" style={{ height }}>
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        className="block w-full h-full select-none"
        preserveAspectRatio="xMidYMid slice"
        onMouseLeave={() => {
          setTooltip(null);
          setHoveredCountryCode(null);
          if (containerRef.current) containerRef.current.style.cursor = 'default';
        }}
      >
        {/* Background is handled by container/HTML */}
        
        {features.map((feature: any, idx: number) => {
          const { countryCode, countryName, locationData, fillColor } = getCountryMeta(feature);
          const d = pathForFeature(feature);
          if (!d) return null;

          const isHovered = !!countryCode && hoveredCountryCode === countryCode;
          const interactive = !!onCountryClick && !!countryCode && countryCode.length === 2;

          return (
            <path
              key={countryCode ?? `${countryName}-${idx}`}
              d={d}
              fill={fillColor}
              stroke={isHovered ? 'var(--foreground)' : 'var(--muted-foreground)'}
              strokeWidth={isHovered ? 1.5 : 0.5}
              vectorEffect="non-scaling-stroke"
              onClick={() => {
                if (!interactive || !countryCode) return;
                handleCountryClick(countryCode);
              }}
              onMouseEnter={(e) => {
                if (!countryCode || countryCode.length !== 2) return;
                setHoveredCountryCode(countryCode);
                if (containerRef.current) {
                  containerRef.current.style.cursor = interactive ? 'pointer' : 'default';
                }
                setTooltip({
                  countryName,
                  locationData,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
              onMouseMove={(e) => {
                if (!countryCode || countryCode.length !== 2) return;
                setTooltip(prev =>
                  prev
                    ? { ...prev, x: e.clientX, y: e.clientY }
                    : {
                        countryName,
                        locationData,
                        x: e.clientX,
                        y: e.clientY,
                      }
                );
              }}
              onMouseLeave={() => {
                setTooltip(null);
                setHoveredCountryCode(null);
                if (containerRef.current) containerRef.current.style.cursor = 'default';
              }}
            />
          );
        })}
      </svg>

      {!worldGeoJson && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-foreground border-t-transparent"></div>
            <span className="ml-3 font-mono text-sm uppercase">Loading Map...</span>
          </div>
        </div>
      )}

      {tooltip && (
        <HeatmapTooltip
          countryName={tooltip.countryName}
          locationData={tooltip.locationData}
          x={tooltip.x}
          y={tooltip.y}
        />
      )}
    </div>
  );
}

export function HeatmapLegend({ maxCount }: { maxCount: number }) {
  const swatches = [
    { label: '0', color: 'transparent', borderColor: 'var(--muted)' },
    { label: 'Low', color: CHOROPLETH_COLORS[1] },
    { label: 'Mid', color: CHOROPLETH_COLORS[4] },
    { label: 'High', color: CHOROPLETH_COLORS[CHOROPLETH_COLORS.length - 1] },
  ];

  return (
    <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground uppercase">
      <span className="font-medium text-foreground">Engagers:</span>
      <div className="flex items-center gap-2">
        {swatches.map((stop, index) => (
          <div key={index} className="flex items-center gap-1">
            <div
              className="w-4 h-4"
              style={{ 
                  backgroundColor: stop.color,
                  border: stop.borderColor ? `1px solid ${stop.borderColor}` : 'none' 
              }}
            />
            <span>{stop.label}</span>
          </div>
        ))}
      </div>
      {maxCount > 0 && (
        <span className="text-muted-foreground ml-2">
          (Max: {maxCount.toLocaleString()})
        </span>
      )}
    </div>
  );
}

export function HeatmapTooltip({
  countryName,
  locationData,
  x,
  y,
}: {
  countryName: string;
  locationData: LocationHeatmapData | undefined;
  x: number;
  y: number;
}) {
  const engagements = locationData?.engagement_count ?? 0;

  return (
    <div
      className="fixed z-[1000] bg-background border border-foreground shadow-none p-3 pointer-events-none font-mono text-xs"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(12px, 12px)',
      }}
    >
      <div className="font-bold text-foreground mb-1 uppercase tracking-wider">
        {countryName}
      </div>
      <div className="text-muted-foreground space-y-1">
        <div>
          <span className="font-medium text-foreground">{Math.round(engagements).toLocaleString()}</span> ENGAGEMENTS
        </div>
      </div>
    </div>
  );
}
