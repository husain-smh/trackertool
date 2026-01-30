'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import {
  ComposedChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import dynamic from 'next/dynamic';
import type { LocationHeatmapData } from '@/components/WorldHeatmap';

// Lazy load WorldHeatmap (maps don't need SSR)
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

declare global {
  interface Window {
    twttr?: any;
  }
}

let twitterWidgetsPromise: Promise<any> | null = null;
const loadTwitterWidgets = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.twttr?.widgets) return Promise.resolve(window.twttr);
  if (twitterWidgetsPromise) return twitterWidgetsPromise;

  twitterWidgetsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://platform.twitter.com/widgets.js';
    script.async = true;
    script.onload = () => resolve(window.twttr);
    script.onerror = reject;
    document.body.appendChild(script);
  });

  return twitterWidgetsPromise;
};

interface DashboardData {
  campaign: any;
  metrics: {
    total_likes: number;
    total_retweets: number;
    total_quotes: number;
    total_replies: number;
    total_views: number;
    total_quote_views?: number;
    total_engagements: number;
  };
  latest_engagements: any[];
  category_breakdown: Record<string, number>;
  category_totals?: {
    main_twt: CategoryMetrics;
    influencer_twt: CategoryMetrics;
    investor_twt: CategoryMetrics;
  };
  tweets?: Array<{
    tweet_id: string;
    category: 'main_twt' | 'influencer_twt' | 'investor_twt';
    author_username: string;
    metrics?: {
      likeCount: number;
      retweetCount: number;
      quoteCount: number;
      replyCount: number;
      viewCount: number;
      quoteViewsFromQuotes?: number;
    };
  }>;
}

type CategoryMetrics = {
  likes: number;
  retweets: number;
  quotes: number;
  replies: number;
  views: number;
  quote_views?: number;
};

// Design.json palette
const COLORS = ['#4D4DFF', '#C4B5FD', '#10B981', '#3B82F6', '#F472B6', '#FBBF24', '#FB923C', '#9CA3AF'];
const REFRESH_INTERVAL_MS = 180_000; // 3 minutes
const CHART_BLUE = '#4D4DFF'; // vibrantBlue

type FilterType = 'all' | 'main_twt' | 'influencer_twt' | 'investor_twt';

type MetricKey =
  | 'likes'
  | 'retweets'
  | 'quotes'
  | 'replies'
  | 'views'
  | 'quoteViews';

type SecondDegreeTotals = {
  views: number;
  likes: number;
  retweets: number;
  replies: number;
  second_order_retweets: number;
  second_order_replies: number;
};

interface MetricChartProps {
  title: string;
  metric: MetricKey;
  chartData: Array<{ time: string; [key: string]: any }>;
}

function MetricChart({ title, metric, chartData }: MetricChartProps) {
  // Custom tooltip to show cumulative value and delta
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const cumulativeValue = payload[0].value;
      const delta = data.delta !== undefined ? data.delta : null;

      return (
        <div
          style={{
            backgroundColor: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '12px',
            boxShadow: 'var(--shadow-card)',
            color: 'var(--popover-foreground)',
          }}
        >
          <p style={{ color: 'var(--muted-foreground)', marginBottom: '8px', fontWeight: 'bold' }}>
            {label}
          </p>
          <p style={{ color: CHART_BLUE, marginBottom: '4px' }}>
            {title}: <strong>{cumulativeValue?.toLocaleString()}</strong>
          </p>
          {delta !== null && (
            <p style={{ color: 'var(--muted-foreground)', fontSize: '12px', marginTop: '4px' }}>
              Δ (this period): <strong style={{ color: delta >= 0 ? '#10B981' : '#EF4444' }}>
                {delta >= 0 ? '+' : ''}{delta.toLocaleString()}
              </strong>
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  const isMultiDay = (() => {
    if (!chartData || chartData.length === 0) return false;
    const first = new Date(chartData[0].time);
    const last = new Date(chartData[chartData.length - 1].time);
    if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) {
      return false;
    }
    return (
      first.getFullYear() !== last.getFullYear() ||
      first.getMonth() !== last.getMonth() ||
      first.getDate() !== last.getDate()
    );
  })();

  const formatXAxisTick = (value: string, index: number) => {
    if (!chartData || chartData.length === 0) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const maxTicks = 8;
    const step = Math.max(1, Math.ceil(chartData.length / maxTicks));

    if (index % step !== 0) {
      return '';
    }

    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    if (isMultiDay) {
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      return `${month}/${day} ${hours}:${minutes}`;
    }

    return `${hours}:${minutes}`;
  };

  const gradientId = `grad-${metric}-${title.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <div className="card-base p-4">
      <h2 className="text-xl font-semibold text-foreground mb-4">{title}</h2>
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_BLUE} stopOpacity={0.2} />
                <stop offset="100%" stopColor={CHART_BLUE} stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              stroke="var(--muted-foreground)"
              tickFormatter={formatXAxisTick}
              tickLine={false}
              axisLine={false}
              fontSize={11}
            />
            <YAxis stroke="var(--muted-foreground)" tickLine={false} axisLine={false} fontSize={11} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey={metric}
              stroke={CHART_BLUE}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={{ r: 2, strokeWidth: 1, fill: CHART_BLUE }}
              activeDot={{ r: 5, fill: CHART_BLUE }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="text-center text-muted-foreground py-12">
          No metrics data yet
        </div>
      )}
    </div>
  );
}

export default function CampaignDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;
  const mainTweetContainerRef = useRef<HTMLDivElement | null>(null);
  const secondDegreeSectionRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartMinDate, setChartMinDate] = useState<Date | null>(null);
  const [metricsData, setMetricsData] = useState<any[]>([]);
  const [engagementSeries, setEngagementSeries] = useState<
    Array<{
      time: string;
      timeRaw?: Date;
      retweets: number;
      replies: number;
      quotes: number;
      total: number;
      retweetsDelta: number;
      repliesDelta: number;
      quotesDelta: number;
      totalDelta: number;
    }>
  >([]);
  const [engagementLastUpdated, setEngagementLastUpdated] = useState<Date | null>(null);

  const [mainEngagementSeries, setMainEngagementSeries] = useState<typeof engagementSeries>([]);
  const [influencerEngagementSeries, setInfluencerEngagementSeries] = useState<typeof engagementSeries>([]);
  const [mainEngagementLastUpdated, setMainEngagementLastUpdated] = useState<Date | null>(null);
  const [influencerEngagementLastUpdated, setInfluencerEngagementLastUpdated] = useState<Date | null>(null);

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
  const [isLoadingHeatmap, setIsLoadingHeatmap] = useState(false);
  const [heatmapLoaded, setHeatmapLoaded] = useState(false);
  const heatmapSectionRef = useRef<HTMLDivElement | null>(null);
  
  const [secondDegreeTotals, setSecondDegreeTotals] = useState<{
    main_twt: SecondDegreeTotals;
    influencer_twt: SecondDegreeTotals;
    investor_twt: SecondDegreeTotals;
  }>({
    main_twt: {
      views: 0,
      likes: 0,
      retweets: 0,
      replies: 0,
      second_order_retweets: 0,
      second_order_replies: 0,
    },
    influencer_twt: {
      views: 0,
      likes: 0,
      retweets: 0,
      replies: 0,
      second_order_retweets: 0,
      second_order_replies: 0,
    },
    investor_twt: {
      views: 0,
      likes: 0,
      retweets: 0,
      replies: 0,
      second_order_retweets: 0,
      second_order_replies: 0,
    },
  });
  
  const [globalFilter, setGlobalFilter] = useState<'all' | 'main_twt' | 'influencer_twt' | 'investor_twt'>('all');

  const chartMinDateRef = useRef<Date | null>(null);
  const mainTweetIdRef = useRef<string | null>(null);
  const [mainQuoteViewSeries, setMainQuoteViewSeries] = useState<
    Array<{ time: string; quoteViews: number; delta?: number }>
  >([]);
  
  const [actionTypeFilter, setActionTypeFilter] = useState<'all' | 'retweet' | 'reply' | 'quote'>('all');

  const [engagements, setEngagements] = useState<any[]>([]);
  const [engagementLimit] = useState(50);
  const [hasMoreEngagements, setHasMoreEngagements] = useState(true);
  const [isLoadingEngagements, setIsLoadingEngagements] = useState(false);
  const [isLoadingMoreEngagements, setIsLoadingMoreEngagements] = useState(false);
  const [isMetricsLoading, setIsMetricsLoading] = useState(false);
  const [isEngagementSeriesLoading, setIsEngagementSeriesLoading] = useState(false);
  const engagementOffsetRef = useRef(0);

  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());

  const INITIAL_IMPORTANT_VISIBLE = 20;
  const [importantPeopleOpen, setImportantPeopleOpen] = useState<{ main: boolean; influencer: boolean }>({
    main: false,
    influencer: false,
  });
  const [peopleVisibleCount, setPeopleVisibleCount] = useState<{ main: number; influencer: number }>({
    main: INITIAL_IMPORTANT_VISIBLE,
    influencer: INITIAL_IMPORTANT_VISIBLE,
  });
  
  // Potential viewers state
  const [potentialViewers, setPotentialViewers] = useState<Array<{
    user_id: string;
    username: string;
    name: string;
    bio?: string;
    location?: string;
    followers: number;
    verified: boolean;
    importance_score: number;
    connected_to_engagers: Array<{
      user_id: string;
      username: string;
      name: string;
    }>;
  }>>([]);
  const [isLoadingPotentialViewers, setIsLoadingPotentialViewers] = useState(false);
  const [potentialViewersOpen, setPotentialViewersOpen] = useState(false);
  const [potentialViewersVisibleCount, setPotentialViewersVisibleCount] = useState(INITIAL_IMPORTANT_VISIBLE);
  const mainTweet = useMemo(
    () => data?.tweets?.find((t) => t.category === 'main_twt'),
    [data]
  );

  const fetchDashboard = useCallback(async (): Promise<Date | null> => {
    try {
      const response = await fetch(`/api/socap/campaigns/${campaignId}/dashboard`);
      const result = await response.json();
      
      if (result.success) {
        setData(result.data);
        const minDate = result.data?.campaign?.chart_min_date
          ? new Date(result.data.campaign.chart_min_date)
          : null;
        setChartMinDate(minDate);
        chartMinDateRef.current = minDate;
        return minDate;
      }
    } catch (error) {
      console.error('Error fetching dashboard:', error);
    } finally {
      setLoading(false);
    }
    return null;
  }, [campaignId]);

  const fetchMetrics = useCallback(async (minDateOverride?: Date | null) => {
    setIsMetricsLoading(true);
    try {
      const params = new URLSearchParams({ granularity: 'hour' });
      const startDate = minDateOverride ?? chartMinDateRef.current;
      if (startDate) {
        params.set('start_date', startDate.toISOString());
      }

      const response = await fetch(
        `/api/socap/campaigns/${campaignId}/metrics?${params.toString()}`
      );
      const result = await response.json();
      
      if (result.success) {
        setMetricsData(result.data.snapshots || []);
      }
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setIsMetricsLoading(false);
    }
  }, [campaignId]);

  const mapEngagementSeries = (points: Array<{ time: string | Date; retweets?: number; replies?: number; quotes?: number; total?: number }>) => {
    const sortedPoints = [...points].sort((a, b) => {
      const timeA = new Date(a.time).getTime();
      const timeB = new Date(b.time).getTime();
      return timeA - timeB;
    });

    let cumulativeRetweets = 0;
    let cumulativeReplies = 0;
    let cumulativeQuotes = 0;
    let cumulativeTotal = 0;

    const mapped = sortedPoints.map((p) => {
      cumulativeRetweets += p.retweets ?? 0;
      cumulativeReplies += p.replies ?? 0;
      cumulativeQuotes += p.quotes ?? 0;
      cumulativeTotal += p.total ?? 0;

      return {
        time: new Date(p.time).toLocaleString(),
        timeRaw: new Date(p.time),
        retweets: cumulativeRetweets,
        replies: cumulativeReplies,
        quotes: cumulativeQuotes,
        total: cumulativeTotal,
        retweetsDelta: p.retweets ?? 0,
        repliesDelta: p.replies ?? 0,
        quotesDelta: p.quotes ?? 0,
        totalDelta: p.total ?? 0,
      };
    });

    const firstNonZeroIndex = mapped.findIndex((point) => {
      const hasRetweets = (point.retweets ?? 0) > 0;
      const hasReplies = (point.replies ?? 0) > 0;
      const hasQuotes = (point.quotes ?? 0) > 0;
      const hasTotal = (point.total ?? 0) > 0;
      return hasRetweets || hasReplies || hasQuotes || hasTotal;
    });

    return firstNonZeroIndex > 0 ? mapped.slice(firstNonZeroIndex) : mapped;
  };

  const fetchEngagementSeries = useCallback(async (minDateOverride?: Date | null) => {
    setIsEngagementSeriesLoading(true);
    try {
      const params = new URLSearchParams({
        granularity: 'half_hour',
      });
      const startDate = minDateOverride ?? chartMinDateRef.current;
      if (startDate) {
        params.set('start_date', startDate.toISOString());
      }

      const response = await fetch(
        `/api/socap/campaigns/${campaignId}/engagements/timeseries?${params.toString()}`
      );
      const result = await response.json();

      if (result.success) {
        const points = (result.data?.points || []) as Array<{
          time: string | Date;
          retweets?: number;
          replies?: number;
          quotes?: number;
          total?: number;
        }>;

        const trimmedSeries = mapEngagementSeries(points);

        setEngagementSeries(trimmedSeries);
        
        if (result.data?.last_updated) {
          setEngagementLastUpdated(new Date(result.data.last_updated));
        } else {
          setEngagementLastUpdated(null);
        }
      }
    } catch (error) {
      console.error('Error fetching engagement time series:', error);
    } finally {
      setIsEngagementSeriesLoading(false);
    }
  }, [campaignId]);

  const fetchCategoryEngagementSeries = useCallback(
    async (category: 'main_twt' | 'influencer_twt', minDateOverride?: Date | null) => {
      try {
        const params = new URLSearchParams({
          granularity: 'half_hour',
          category,
        });
        const startDate = minDateOverride ?? chartMinDateRef.current;
        if (startDate) {
          params.set('start_date', startDate.toISOString());
        }

        const response = await fetch(
          `/api/socap/campaigns/${campaignId}/engagements/timeseries?${params.toString()}`
        );
        const result = await response.json();

        if (result.success) {
          const points = (result.data?.points || []) as Array<{
            time: string | Date;
            retweets?: number;
            replies?: number;
            quotes?: number;
            total?: number;
          }>;

          const trimmedSeries = mapEngagementSeries(points);

          if (category === 'main_twt') {
            setMainEngagementSeries(trimmedSeries);
            setMainEngagementLastUpdated(result.data?.last_updated ? new Date(result.data.last_updated) : null);
          } else {
            setInfluencerEngagementSeries(trimmedSeries);
            setInfluencerEngagementLastUpdated(result.data?.last_updated ? new Date(result.data.last_updated) : null);
          }
        }
      } catch (error) {
        console.error(`Error fetching ${category} engagement time series:`, error);
      }
    },
    [campaignId, mapEngagementSeries]
  );

  const fetchEngagementsPage = useCallback(
    async (reset: boolean = false) => {
      if (!campaignId) return;
      const nextOffset = reset ? 0 : engagementOffsetRef.current;
      if (reset) {
        setIsLoadingEngagements(true);
        setHasMoreEngagements(true);
        engagementOffsetRef.current = 0;
      } else {
        setIsLoadingMoreEngagements(true);
      }

      try {
        const params = new URLSearchParams({
          limit: String(engagementLimit),
          offset: String(nextOffset),
        });
        if (actionTypeFilter !== 'all') {
          params.set('action_type', actionTypeFilter);
        }

        const response = await fetch(
          `/api/socap/campaigns/${campaignId}/engagements?${params.toString()}`
        );
        const result = await response.json();

        if (result.success) {
          const fetched = result.data?.engagements || [];
          setEngagements((prev) => (reset ? fetched : [...prev, ...fetched]));
          engagementOffsetRef.current = nextOffset + fetched.length;
          setHasMoreEngagements(fetched.length === engagementLimit);
        }
      } catch (error) {
        console.error('Error fetching engagements page:', error);
      } finally {
        if (reset) {
          setIsLoadingEngagements(false);
        } else {
          setIsLoadingMoreEngagements(false);
        }
      }
    },
    [campaignId, engagementLimit, actionTypeFilter]
  );

  const fetchPotentialViewers = useCallback(async () => {
    if (!campaignId) return;
    setIsLoadingPotentialViewers(true);
    try {
      const response = await fetch(
        `/api/socap/campaigns/${campaignId}/potential-viewers?limit=100&min_importance=0`
      );
      const result = await response.json();
      
      if (result.success) {
        setPotentialViewers(result.data?.potential_viewers || []);
      }
    } catch (error) {
      console.error('Error fetching potential viewers:', error);
    } finally {
      setIsLoadingPotentialViewers(false);
    }
  }, [campaignId]);

  const fetchHeatmap = useCallback(async () => {
    if (!campaignId) return;
    setIsLoadingHeatmap(true);
    try {
      const response = await fetch(`/api/socap/campaigns/${campaignId}/heatmap?distribute_regions=true`);
      const result = await response.json();
      if (result.success) {
        setHeatmapData(result.data);
      }
    } catch (error) {
      console.error('Error fetching heatmap data:', error);
    } finally {
      setIsLoadingHeatmap(false);
    }
  }, [campaignId]);

  const fetchSecondDegree = useCallback(async () => {
    try {
      const response = await fetch(`/api/socap/campaigns/${campaignId}/second-degree`);
      const result = await response.json();
      if (result.success) {
        setSecondDegreeTotals(result.data.totals);
      }
    } catch (error) {
      console.error('Error fetching second-degree metrics:', error);
    }
  }, [campaignId]);

  const fetchMainQuoteViewSeries = useCallback(
    async (tweetIdOverride?: string) => {
      const targetTweetId = tweetIdOverride ?? mainTweetIdRef.current;
      if (!targetTweetId) {
        setMainQuoteViewSeries([]);
        return;
      }

      try {
        const response = await fetch(`/api/monitor-tweet/${targetTweetId}`);
        const result = await response.json();

        if (response.ok && result?.success && Array.isArray(result.snapshots)) {
          let previous = 0;
          const mapped = result.snapshots
            .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .map((snap: any) => {
              const value = snap.quoteViewSum ?? 0;
              const point = {
                time: new Date(snap.timestamp).toLocaleString(),
                quoteViews: value,
                delta: value - previous,
              };
              previous = value;
              return point;
            });
          setMainQuoteViewSeries(mapped);
        } else {
          setMainQuoteViewSeries([]);
        }
      } catch (error) {
        console.error('Error fetching quote view series for main tweet:', error);
        setMainQuoteViewSeries([]);
      }
    },
    []
  );

  const initialLoadDoneRef = useRef(false);
  const [secondDegreeLoaded, setSecondDegreeLoaded] = useState(false);
  const [isSecondDegreeLoading, setIsSecondDegreeLoading] = useState(false);
  const [engagementsLoaded, setEngagementsLoaded] = useState(false);

  useEffect(() => {
    console.log('[Campaign] Main useEffect triggered, campaignId:', campaignId);
    initialLoadDoneRef.current = false;
    setSecondDegreeLoaded(false);
    setEngagementsLoaded(false);

    const loadAll = async () => {
      console.log('[Campaign] Starting fetch with chart min date awareness...');
      setLoading(true);
      const minDate = await fetchDashboard();
      await Promise.all([
        fetchMetrics(minDate),
        fetchEngagementSeries(minDate),
        fetchCategoryEngagementSeries('main_twt', minDate),
        fetchMainQuoteViewSeries(),
      ]);
      setLoading(false);
      initialLoadDoneRef.current = true;
      console.log('[Campaign] Initial load complete (engagements + second-degree deferred)');
    };

    loadAll();

    console.log('[Campaign] Setting up refresh interval');
    const interval = setInterval(() => {
      console.log('[Campaign] Auto-refresh triggered');
      const minDate = chartMinDateRef.current;
      const refreshPromises = [
        fetchDashboard(),
        fetchMetrics(minDate),
        fetchEngagementSeries(minDate),
        fetchCategoryEngagementSeries('main_twt', minDate),
        fetchMainQuoteViewSeries(),
      ];
      if (secondDegreeLoaded) {
        refreshPromises.push(fetchSecondDegree());
      }
      Promise.all(refreshPromises);
    }, REFRESH_INTERVAL_MS);

    return () => {
      console.log('[Campaign] Cleaning up interval');
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  useEffect(() => {
    if (!initialLoadDoneRef.current) {
      return;
    }
    if (!engagementsLoaded) {
      return;
    }
    fetchEngagementsPage(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionTypeFilter, engagementsLoaded]);

  // Lazy load heatmap when section becomes visible
  useEffect(() => {
    if (loading || heatmapLoaded) return;
    
    const sectionElement = heatmapSectionRef.current;
    if (!sectionElement) {
      return;
    }

    let hasTriggered = false;
    
    const triggerLoad = () => {
      if (hasTriggered) return;
      hasTriggered = true;
      setHeatmapLoaded(true);
      fetchHeatmap();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          triggerLoad();
          observer.disconnect();
        }
      },
      { 
        threshold: 0,
      }
    );

    observer.observe(sectionElement);

    return () => {
      observer.disconnect();
    };
  }, [loading, heatmapLoaded, fetchHeatmap]);

  useEffect(() => {
    if (loading || secondDegreeLoaded) return;
    
    const sectionElement = secondDegreeSectionRef.current;
    if (!sectionElement) {
      return;
    }

    let hasTriggered = false;
    
    const triggerLoad = () => {
      if (hasTriggered) return;
      hasTriggered = true;
      setSecondDegreeLoaded(true);
      setIsSecondDegreeLoading(true);
      fetchSecondDegree().finally(() => setIsSecondDegreeLoading(false));
    };

    const isElementVisible = () => {
      const rect = sectionElement.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          triggerLoad();
          observer.disconnect();
        }
      },
      { 
        threshold: 0,
        rootMargin: '200px'
      }
    );

    observer.observe(sectionElement);

    const fallbackTimer = setTimeout(() => {
      if (!hasTriggered && isElementVisible()) {
        triggerLoad();
        observer.disconnect();
      }
    }, 100);

    const handleScroll = () => {
      if (!hasTriggered && isElementVisible()) {
        triggerLoad();
        observer.disconnect();
      }
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      clearTimeout(fallbackTimer);
      window.removeEventListener('scroll', handleScroll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, secondDegreeLoaded, fetchSecondDegree]);

  useEffect(() => {
    if (!mainTweet?.tweet_id) {
      mainTweetIdRef.current = null;
      setMainQuoteViewSeries([]);
      return;
    }
    mainTweetIdRef.current = mainTweet.tweet_id;
    fetchMainQuoteViewSeries(mainTweet.tweet_id);
    if (!mainTweetContainerRef.current) return;
    let cancelled = false;

    const renderEmbed = async () => {
      try {
        const twttr = await loadTwitterWidgets();
        if (!twttr || cancelled || !mainTweetContainerRef.current) return;

        const parentWidth = mainTweetContainerRef.current.parentElement?.clientWidth ?? 700;
        const width = Math.min(Math.max(parentWidth, 640), 900);

        mainTweetContainerRef.current.style.display = 'flex';
        mainTweetContainerRef.current.style.justifyContent = 'center';
        mainTweetContainerRef.current.style.alignItems = 'center';
        mainTweetContainerRef.current.style.width = '100%';
        mainTweetContainerRef.current.style.maxWidth = '900px';
        mainTweetContainerRef.current.style.margin = '0 auto';
        mainTweetContainerRef.current.style.textAlign = 'center';

        mainTweetContainerRef.current.innerHTML = '';
        await twttr.widgets.createTweet(mainTweet.tweet_id, mainTweetContainerRef.current, {
          theme: 'dark',
          align: 'center',
          conversation: 'none',
          width,
        });
      } catch (error) {
        console.error('Error rendering Twitter embed:', error);
      }
    };

    renderEmbed();

    return () => {
      cancelled = true;
      if (mainTweetContainerRef.current) {
        mainTweetContainerRef.current.innerHTML = '';
      }
    };
  }, [fetchMainQuoteViewSeries, mainTweet?.tweet_id]);

  const categoryTotals = useMemo(() => {
    const empty = {
      main_twt: { likes: 0, retweets: 0, quotes: 0, replies: 0, views: 0, quote_views: 0 },
      influencer_twt: { likes: 0, retweets: 0, quotes: 0, replies: 0, views: 0, quote_views: 0 },
      investor_twt: { likes: 0, retweets: 0, quotes: 0, replies: 0, views: 0, quote_views: 0 },
    };

    if (data?.category_totals) {
      return data.category_totals;
    }

    if (!data?.tweets || data.tweets.length === 0) {
      return empty;
    }

    const totals = {
      main_twt: { ...empty.main_twt },
      influencer_twt: { ...empty.influencer_twt },
      investor_twt: { ...empty.investor_twt },
    };

    for (const tweet of data.tweets) {
      const target = totals[tweet.category as keyof typeof totals];
      if (!target) continue;

      const metrics = (tweet as any).metrics || {};
      target.likes += metrics.likeCount || 0;
      target.retweets += metrics.retweetCount || 0;
      target.quotes += metrics.quoteCount || 0;
      target.replies += metrics.replyCount || 0;
      target.views += metrics.viewCount || 0;
      target.quote_views += metrics.quoteViewsFromQuotes || 0;
    }

    return totals;
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-5rem)] py-24">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-5rem)] py-24">
          <div className="text-center">
            <p className="text-destructive text-lg">Campaign not found</p>
            <Link href="/socap" className="mt-4 inline-block px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
              Back to Campaigns
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const pieData = Object.entries(data.category_breakdown).map(([name, value]) => ({
    name,
    value,
  }));

  const baseChartData = metricsData.map((snapshot) => {
    const breakdown = snapshot.tweet_breakdown || {
      main_twt: { likes: 0, retweets: 0, quotes: 0, replies: 0, views: 0 },
      influencer_twt: { likes: 0, retweets: 0, quotes: 0, replies: 0, views: 0 },
      investor_twt: { likes: 0, retweets: 0, quotes: 0, replies: 0, views: 0 },
    };
    
    const getCategoryBreakdown = (category: 'main_twt' | 'influencer_twt' | 'investor_twt') => {
      const catData = breakdown[category];
      if (!catData || typeof catData !== 'object') {
        return { likes: 0, retweets: 0, quotes: 0, replies: 0, views: 0 };
      }
      const toNumber = (val: any): number => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const parsed = parseFloat(val);
          return isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };
      return {
        likes: toNumber(catData.likes),
        retweets: toNumber(catData.retweets),
        quotes: toNumber(catData.quotes),
        replies: toNumber(catData.replies),
        views: toNumber(catData.views),
      };
    };
    
    return {
      time: new Date(snapshot.snapshot_time).toLocaleString(),
      timeRaw: new Date(snapshot.snapshot_time),
      likes: snapshot.total_likes || 0,
      retweets: snapshot.total_retweets || 0,
      quotes: snapshot.total_quotes || 0,
      replies: snapshot.total_replies || 0,
      views: snapshot.total_views || 0,
      quoteViews: snapshot.total_quote_views || 0,
      breakdown: {
        main_twt: getCategoryBreakdown('main_twt'),
        influencer_twt: getCategoryBreakdown('influencer_twt'),
        investor_twt: getCategoryBreakdown('investor_twt'),
      },
    };
  });

  const calculateDeltas = <T extends { [key: string]: any }>(
    data: T[],
    metricKey: string
  ): Array<T & { delta?: number }> => {
    return data.map((item, index) => {
      const currentValue = item[metricKey] || 0;
      const previousValue = index > 0 ? (data[index - 1][metricKey] || 0) : 0;
      const delta = currentValue - previousValue;
      return { ...item, delta };
    });
  };

  const getFilteredChartData = (metric: MetricKey) => {
    const minDate = chartMinDate ?? chartMinDateRef.current;

    if (metric === 'retweets' || metric === 'replies' || metric === 'quotes') {
      let data = engagementSeries.map((point) => ({
        time: point.time,
        [metric]: point[metric],
        delta: metric === 'retweets' ? point.retweetsDelta : 
               metric === 'replies' ? point.repliesDelta : 
               point.quotesDelta,
      }));
      if (minDate) {
        data = data.filter((item) => {
          const t = new Date(item.time);
          return !Number.isNaN(t.getTime()) && t >= minDate;
        });
      }
      return data;
    }

    let data = baseChartData.map((item) => {
      let value: number;

      if (globalFilter === 'all') {
        value = item[metric] || 0;
      } else {
        if (metric === 'quoteViews') {
          value = item.quoteViews || 0;
        } else {
          const categoryData = item.breakdown?.[globalFilter];
          if (categoryData && typeof categoryData === 'object') {
            const metricValue = (categoryData as any)[metric];
            if (typeof metricValue === 'number') {
              value = metricValue;
            } else if (typeof metricValue === 'string') {
              const parsed = parseFloat(metricValue);
              value = isNaN(parsed) ? 0 : parsed;
            } else {
              value = 0;
            }
          } else {
            value = 0;
          }
        }
      }

      return {
        time: item.time,
        timeRaw: item.timeRaw,
        [metric]: value,
      };
    });

    data.sort((a, b) => {
      const timeA = (a as any).timeRaw?.getTime() || new Date(a.time).getTime();
      const timeB = (b as any).timeRaw?.getTime() || new Date(b.time).getTime();
      return timeA - timeB;
    });

    if (minDate) {
      data = data.filter((item) => {
        const t = (item as any).timeRaw ?? new Date(item.time);
        return t instanceof Date ? t >= minDate : false;
      });
    }

    return calculateDeltas(data, metric);
  };

  const getCategoryChartData = (metric: MetricKey, category: 'main_twt' | 'influencer_twt') => {
    const minDate = chartMinDate ?? chartMinDateRef.current;

    if (metric === 'retweets' || metric === 'replies' || metric === 'quotes') {
      const source = category === 'main_twt' ? mainEngagementSeries : influencerEngagementSeries;
      let data = source.map((point) => ({
        time: point.time,
        [metric]: point[metric],
        delta:
          metric === 'retweets'
            ? point.retweetsDelta
            : metric === 'replies'
            ? point.repliesDelta
            : point.quotesDelta,
      }));
      if (minDate) {
        data = data.filter((item) => {
          const t = new Date(item.time);
          return !Number.isNaN(t.getTime()) && t >= minDate;
        });
      }
      return data;
    }

    let data = baseChartData.map((item) => {
      if (metric === 'quoteViews') {
        return { time: item.time, [metric]: 0 };
      }
      const cat = item.breakdown?.[category];
      const valueRaw = (cat as any)?.[metric];
      const value =
        typeof valueRaw === 'number'
          ? valueRaw
          : typeof valueRaw === 'string'
          ? parseFloat(valueRaw) || 0
          : 0;
      return { time: item.time, timeRaw: item.timeRaw, [metric]: value };
    });

    data.sort((a, b) => {
      const timeA = (a as any).timeRaw?.getTime() || new Date(a.time).getTime();
      const timeB = (b as any).timeRaw?.getTime() || new Date(b.time).getTime();
      return timeA - timeB;
    });

    if (minDate) {
      data = data.filter((item) => {
        const t = (item as any).timeRaw ?? new Date(item.time);
        return t instanceof Date ? t >= minDate : false;
      });
    }

    return calculateDeltas(data, metric);
  };

  const getTweetInfo = (tweetId: string) => {
    return data.tweets?.find(t => t.tweet_id === tweetId);
  };

  interface GroupedEngagement {
    user_id: string;
    account_profile: {
      username: string;
      name: string;
      bio?: string;
      location?: string;
      followers: number;
      verified: boolean;
    };
    importance_score: number;
    account_categories: string[];
    actions: Array<{
      action_type: 'retweet' | 'reply' | 'quote';
      tweet_id: string;
      tweet_category?: 'main_twt' | 'influencer_twt' | 'investor_twt';
      timestamp: Date;
      engagement_tweet_id?: string;
    }>;
  }

  const groupEngagementsByUser = (engagements: any[]): GroupedEngagement[] => {
    const groupedMap = new Map<string, GroupedEngagement>();

    for (const engagement of engagements) {
      const userId = engagement.user_id;

      if (actionTypeFilter !== 'all' && engagement.action_type !== actionTypeFilter) {
        continue;
      }

      if (!groupedMap.has(userId)) {
        groupedMap.set(userId, {
          user_id: userId,
          account_profile: engagement.account_profile,
          importance_score: engagement.importance_score,
          account_categories: engagement.account_categories || [],
          actions: [],
        });
      }

      const grouped = groupedMap.get(userId)!;
      grouped.actions.push({
        action_type: engagement.action_type,
        tweet_id: engagement.tweet_id,
        tweet_category: engagement.tweet_category,
        timestamp: new Date(engagement.timestamp),
        engagement_tweet_id: engagement.engagement_tweet_id,
      });

      if (engagement.importance_score > grouped.importance_score) {
        grouped.importance_score = engagement.importance_score;
      }
    }

    return Array.from(groupedMap.values()).sort((a, b) => {
      if (b.importance_score !== a.importance_score) {
        return b.importance_score - a.importance_score;
      }
      return b.account_profile.followers - a.account_profile.followers;
    });
  };

  const groupedEngagements = groupEngagementsByUser(engagements);

  const filterEngagementsByCategory = (category: 'main_twt' | 'influencer_twt') =>
    groupedEngagements.filter((g) =>
      g.actions.some((a) => a.tweet_category === category)
    );

  const importantPeopleMain = filterEngagementsByCategory('main_twt');
  const visibleImportantPeopleMain = importantPeopleMain.slice(0, peopleVisibleCount.main);

  const toggleExpandedActions = (userId: string) => {
    setExpandedActions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  const toggleImportantSection = (category: 'main' | 'influencer') => {
    setImportantPeopleOpen((prev) => {
      const nextOpen = !prev[category];
      if (!nextOpen) {
        setPeopleVisibleCount((counts) => ({
          ...counts,
          [category]: INITIAL_IMPORTANT_VISIBLE,
        }));
      } else if (!engagementsLoaded) {
        console.log('[Campaign] Lazy loading engagements on section expand');
        setEngagementsLoaded(true);
        fetchEngagementsPage(true);
      }
      return { ...prev, [category]: nextOpen };
    });
  };

  const togglePotentialViewersSection = () => {
    setPotentialViewersOpen((prev) => {
      const nextOpen = !prev;
      if (!nextOpen) {
        setPotentialViewersVisibleCount(INITIAL_IMPORTANT_VISIBLE);
      } else if (potentialViewers.length === 0) {
        fetchPotentialViewers();
      }
      return nextOpen;
    });
  };

  const showMorePotentialViewers = () => {
    setPotentialViewersVisibleCount(potentialViewers.length);
  };

  const showLessPotentialViewers = () => {
    setPotentialViewersVisibleCount(INITIAL_IMPORTANT_VISIBLE);
  };

  const showMorePeople = (category: 'main' | 'influencer', total: number) => {
    setPeopleVisibleCount((prev) => ({
      ...prev,
      [category]: total,
    }));
  };

  const showLessPeople = (category: 'main' | 'influencer') => {
    setPeopleVisibleCount((prev) => ({
      ...prev,
      [category]: INITIAL_IMPORTANT_VISIBLE,
    }));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-20">
          {/* Campaign Header */}
          <div className="card-base p-6 mb-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-foreground mb-2">
                  {data.campaign.launch_name}
                </h1>
                <p className="text-sm text-muted-foreground mt-2">
                  Client: {data.campaign.client_info.name}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className={`px-4 py-2 rounded-full font-semibold text-sm border ${
                  data.campaign.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                  data.campaign.status === 'paused' ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' :
                  'bg-muted text-muted-foreground border-border'
                }`}>
                  {data.campaign.status}
                </div>
                <button
                  onClick={() => router.push(`/socap/campaigns/${campaignId}/alerts`)}
                  className="px-4 py-2 border border-primary/50 text-primary rounded-lg font-medium transition-colors hover:border-primary hover:bg-primary/5 flex items-center gap-2"
                >
                  <Bell className="w-4 h-4" />
                  Alerts
                </button>
              </div>
            </div>
          </div>

          {/* ===== Main Tweet Section ===== */}
          <div className="space-y-6 mb-10">
            <div className="card-base p-6">
              <h2 className="text-xl font-semibold text-foreground mb-4">Main Tweet</h2>
              {data.tweets?.find((t) => t.category === 'main_twt') ? (
                <div className="space-y-4">
                  <div className="bg-muted/30 rounded-xl p-4 border border-border">
                    <p className="text-sm text-muted-foreground mb-2">Embedded tweet</p>
                    <div className="bg-background rounded-lg p-4 border border-border text-center">
                      <div className="flex justify-center">
                        <div className="max-w-5xl w-full flex justify-center mx-auto" ref={mainTweetContainerRef} />
                      </div>
                      <div className="mt-3 text-right">
                        <a
                          href={
                            mainTweet
                              ? `https://x.com/${mainTweet.author_username || 'i/web'}/status/${mainTweet.tweet_id}`
                              : '#'
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:text-primary/80 text-sm"
                        >
                          Open in Twitter
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div className="card-base p-6 lg:col-span-2 md:col-span-2 shadow-sm border-primary/20">
                      <p className="text-sm font-semibold text-foreground">Views</p>
                      <p className="text-3xl font-black text-foreground mt-2">
                        {(categoryTotals.main_twt?.views ?? 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="card-base p-3">
                      <p className="text-xs text-muted-foreground">Likes</p>
                      <p className="text-xl font-semibold text-foreground mt-1">
                        {(categoryTotals.main_twt?.likes ?? 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="card-base p-3">
                      <p className="text-xs text-muted-foreground">Retweets</p>
                      <p className="text-xl font-semibold text-foreground mt-1">
                        {(categoryTotals.main_twt?.retweets ?? 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="card-base p-3">
                      <p className="text-xs text-muted-foreground">Replies</p>
                      <p className="text-xl font-semibold text-foreground mt-1">
                        {(categoryTotals.main_twt?.replies ?? 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="card-base p-3">
                      <p className="text-xs text-muted-foreground">Quote Tweets</p>
                      <p className="text-xl font-semibold text-foreground mt-1">
                        {(categoryTotals.main_twt?.quotes ?? 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="card-base p-3">
                      <p className="text-xs text-muted-foreground">Quote Views</p>
                      <p className="text-xl font-semibold text-foreground mt-1">
                        {(categoryTotals.main_twt?.quote_views ?? 0).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {mainEngagementLastUpdated && (
                    <div className="card-base p-4 border border-yellow-500/20 bg-yellow-500/5">
                      <p className="text-sm text-foreground">
                        <span className="font-semibold">Note:</span> Engagement charts (Retweets, Replies, Quotes) show data up to{' '}
                        <span className="font-mono">
                          {mainEngagementLastUpdated.toLocaleString()}
                        </span>
                        .
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    <MetricChart
                      title="Quote Tweets (Main)"
                      metric="quotes"
                      chartData={getCategoryChartData('quotes', 'main_twt')}
                    />
                    <MetricChart
                      title="Replies (Main)"
                      metric="replies"
                      chartData={getCategoryChartData('replies', 'main_twt')}
                    />
                    <MetricChart
                      title="Retweets (Main)"
                      metric="retweets"
                      chartData={getCategoryChartData('retweets', 'main_twt')}
                    />
                    <MetricChart
                      title="Views (Main)"
                      metric="views"
                      chartData={getCategoryChartData('views', 'main_twt')}
                    />
                    <MetricChart
                      title="Likes (Main)"
                      metric="likes"
                      chartData={getCategoryChartData('likes', 'main_twt')}
                    />
                  </div>

                  {/* ===== Location Heatmap Section ===== */}
                  <div ref={heatmapSectionRef} className="card-base p-6 border border-border">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl font-semibold text-foreground">Engagement Heatmap</h3>
                      <span className="text-xs text-muted-foreground">Geographic distribution of engagers</span>
                    </div>
                    {isLoadingHeatmap ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
                        <span className="ml-3 text-muted-foreground text-sm">Loading heatmap...</span>
                      </div>
                    ) : !heatmapLoaded ? (
                      <div className="text-center py-12 text-muted-foreground text-sm">
                        Scroll down to load heatmap...
                      </div>
                    ) : heatmapData && heatmapData.locations.length > 0 ? (
                      <div className="space-y-4">
                        <div className="bg-muted/20 rounded-lg p-4 border border-border">
                          <WorldHeatmap 
                            data={heatmapData.locations} 
                            height={300}
                            scale={175}
                            frameRatio={5.8}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <HeatmapLegend 
                            maxCount={Math.max(...heatmapData.locations.map(l => l.unique_users))} 
                          />
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
                      <div className="text-center py-12 text-muted-foreground text-sm">
                        No location data available yet. Location enrichment is in progress.
                      </div>
                    )}
                  </div>

                  <div className="card-base p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl font-semibold text-foreground">Important People (Main)</h3>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">Sorted by importance, then followers</span>
                        <button
                          onClick={() => toggleImportantSection('main')}
                          className="text-xs px-3 py-1 rounded-md border border-primary/50 text-primary hover:text-primary/80 hover:border-primary transition-colors"
                        >
                        <span
                          className={`inline-block mr-1 transition-transform ${importantPeopleOpen.main ? 'rotate-90' : ''}`}
                        >
                          &gt;
                        </span>
                        {importantPeopleOpen.main ? 'Collapse' : 'Show more'}
                        </button>
                      </div>
                    </div>
                    {importantPeopleOpen.main && isLoadingEngagements ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
                        <span className="ml-3 text-muted-foreground text-sm">Loading important people...</span>
                      </div>
                    ) : importantPeopleOpen.main ? (
                      <div className="space-y-4">
                        {visibleImportantPeopleMain.map((person) => {
                          const isExpanded = expandedActions.has(person.user_id);
                          const actionsToShow = isExpanded ? person.actions : person.actions.slice(0, 3);
                          const hasMoreActions = person.actions.length > 3;
                          const firstAction = person.actions[0];
                          if (firstAction?.tweet_category !== 'main_twt') {
                            
                          }
                          return (
                            <div
                              key={person.user_id}
                              className="rounded-xl border border-border bg-muted/20 p-4"
                            >
                              <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-8">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <div className="flex items-center gap-1">
                                      <span className="text-sm font-semibold text-foreground">
                                        {person.account_profile.name}
                                      </span>
                                      {person.account_profile.verified && (
                                        <svg
                                          className="w-4 h-4 text-primary"
                                          fill="currentColor"
                                          viewBox="0 0 20 20"
                                        >
                                          <path
                                            fillRule="evenodd"
                                            d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                            clipRule="evenodd"
                                          />
                                        </svg>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-sm text-muted-foreground mb-1">@{person.account_profile.username}</div>
                                  {person.account_profile.bio && (
                                    <div className="text-xs text-muted-foreground mb-2 line-clamp-2">
                                      {person.account_profile.bio}
                                    </div>
                                  )}
                                  <div className="text-xs text-muted-foreground">
                                    {person.account_profile.followers.toLocaleString()} followers
                                  </div>
                                </div>

                                <div className="md:w-2/5 flex flex-col gap-3 border-t border-border pt-3 md:border-t-0 md:border-l md:pl-4">
                                  <div className="flex items-center justify-between md:justify-end">
                                    <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                                      Imp. Score - 
                                    </span>
                                    <span className="text-lg font-bold text-emerald-600">
                                      {person.importance_score.toFixed(1)}
                                    </span>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                      <div className="text-xs font-medium text-foreground">
                                        Actions
                                      </div>
                                      {hasMoreActions && (
                                        <button
                                          onClick={() => toggleExpandedActions(person.user_id)}
                                          className="text-xs text-primary hover:text-primary/80 transition-colors"
                                        >
                                          {isExpanded ? 'Show Less' : 'Show All'}
                                        </button>
                                      )}
                                    </div>
                                    <div className={`space-y-0.5 ${isExpanded && hasMoreActions ? 'max-h-96 overflow-y-auto pr-2' : ''}`}>
                                      {actionsToShow.map((action, idx) => {
                                        if (action.tweet_category !== 'main_twt') return null;
                                        const tweetInfo = getTweetInfo(action.tweet_id);
                                        const hasEngagementTweet =
                                          (action.action_type === 'quote' || action.action_type === 'reply') &&
                                          !!action.engagement_tweet_id;
                                        
                                        const baseUsername = hasEngagementTweet
                                          ? person.account_profile.username
                                          : tweetInfo?.author_username;
                                        
                                        const targetTweetId = hasEngagementTweet
                                          ? action.engagement_tweet_id!
                                          : action.tweet_id;
                                        
                                        const tweetIdShort = targetTweetId.slice(-8);
                                        
                                        const tweetUrl = baseUsername
                                          ? `https://x.com/${baseUsername}/status/${targetTweetId}`
                                          : `https://x.com/i/web/status/${targetTweetId}`;
                                        
                                        return (
                                          <div key={idx} className="ml-2 text-xs text-foreground">
                                            <div className="flex items-center gap-1">
                                              <span className="text-muted-foreground">• </span>
                                              <span className="text-muted-foreground">
                                                {action.action_type === 'reply' && (hasEngagementTweet ? 'Replied ' : 'Replied to ')}
                                                {action.action_type === 'retweet' && 'Retweeted '}
                                                {action.action_type === 'quote' && (hasEngagementTweet ? 'Quoted ' : 'Quoted tweet ')}
                                              </span>
                                              <a
                                                href={tweetUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-primary hover:text-primary/80 hover:underline"
                                              >
                                                Tweet {tweetIdShort}
                                              </a>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {importantPeopleMain.length === 0 && (
                          <div className="text-center text-muted-foreground">No engagements on main tweet yet.</div>
                        )}
                        {importantPeopleMain.length > visibleImportantPeopleMain.length && (
                          <div className="text-center">
                            <button
                              onClick={() => showMorePeople('main', importantPeopleMain.length)}
                              className="text-sm text-primary hover:text-primary/80"
                            >
                              Show more people
                            </button>
                          </div>
                        )}
                        {importantPeopleMain.length > INITIAL_IMPORTANT_VISIBLE &&
                          importantPeopleMain.length === visibleImportantPeopleMain.length && (
                            <div className="text-center">
                              <button
                                onClick={() => showLessPeople('main')}
                                className="text-sm text-primary hover:text-primary/80"
                              >
                                Show less
                              </button>
                            </div>
                          )}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">Collapsed. Click “Show more” to view important people.</div>
                    )}
                  </div>

                  {/* ===== Potential Viewers Section ===== */}
                  <div className="card-base p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-xl font-semibold text-foreground">Potential Viewers</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          Important people who follow top engagers (might have seen your posts but haven&apos;t engaged yet)
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">Sorted by importance score</span>
                        <button
                          onClick={togglePotentialViewersSection}
                          className="text-xs px-3 py-1 rounded-md border border-primary/50 text-primary hover:text-primary/80 hover:border-primary transition-colors"
                        >
                          <span
                            className={`inline-block mr-1 transition-transform ${potentialViewersOpen ? 'rotate-90' : ''}`}
                          >
                            &gt;
                          </span>
                          {potentialViewersOpen ? 'Collapse' : 'Show more'}
                        </button>
                      </div>
                    </div>
                    {potentialViewersOpen && isLoadingPotentialViewers ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
                        <span className="ml-3 text-muted-foreground text-sm">Loading potential viewers...</span>
                      </div>
                    ) : potentialViewersOpen ? (
                      <div className="space-y-4">
                        {potentialViewers.slice(0, potentialViewersVisibleCount).map((viewer) => {
                          return (
                            <div
                              key={viewer.user_id}
                              className="rounded-xl border border-border bg-muted/20 p-4"
                            >
                              <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-8">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <div className="flex items-center gap-1">
                                      <a
                                        href={`https://x.com/${viewer.username}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm font-semibold text-foreground hover:text-primary hover:underline"
                                      >
                                        {viewer.name || viewer.username}
                                      </a>
                                      {viewer.verified && (
                                        <svg
                                          className="w-4 h-4 text-primary"
                                          fill="currentColor"
                                          viewBox="0 0 20 20"
                                        >
                                          <path
                                            fillRule="evenodd"
                                            d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                            clipRule="evenodd"
                                          />
                                        </svg>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-sm text-muted-foreground mb-1">@{viewer.username}</div>
                                  {viewer.bio && (
                                    <div className="text-xs text-muted-foreground mb-2 line-clamp-2">
                                      {viewer.bio}
                                    </div>
                                  )}
                                  {viewer.followers > 0 && (
                                    <div className="text-xs text-muted-foreground mb-2">
                                      {viewer.followers.toLocaleString()} followers
                                    </div>
                                  )}
                                  {viewer.connected_to_engagers.length > 0 && (
                                    <div className="text-xs text-muted-foreground mt-2 bg-blue-500/5 border border-blue-500/20 rounded-lg p-2">
                                      <span className="font-medium text-foreground">
                                        {viewer.name || viewer.username}
                                      </span>
                                      {' '}since they follow{' '}
                                      {viewer.connected_to_engagers.map((engager, idx) => (
                                        <span key={engager.user_id}>
                                          <span className="font-medium text-foreground">
                                            {engager.name || engager.username}
                                          </span>
                                          {idx < viewer.connected_to_engagers.length - 2 && ', '}
                                          {idx === viewer.connected_to_engagers.length - 2 && ' and '}
                                        </span>
                                      ))}{' '}
                                      who have engaged with your posts
                                    </div>
                                  )}
                                </div>

                                <div className="md:w-2/5 flex flex-col gap-3 border-t border-border pt-3 md:border-t-0 md:border-l md:pl-4">
                                  <div className="flex items-center justify-between md:justify-end">
                                    <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                                      Imp. Score - 
                                    </span>
                                    <span className="text-lg font-bold text-emerald-600">
                                      {viewer.importance_score.toFixed(1)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {potentialViewers.length === 0 && (
                          <div className="text-center text-muted-foreground py-8">
                            No potential viewers found. This could mean:
                            <ul className="list-disc list-inside mt-2 text-xs space-y-1">
                              <li>Top engagers don&apos;t have followers in the important people network</li>
                              <li>All important accounts in the network have already engaged</li>
                            </ul>
                          </div>
                        )}
                        {potentialViewers.length > potentialViewersVisibleCount && (
                          <div className="text-center">
                            <button
                              onClick={showMorePotentialViewers}
                              className="text-sm text-primary hover:text-primary/80"
                            >
                              Show more ({potentialViewers.length - potentialViewersVisibleCount} more)
                            </button>
                          </div>
                        )}
                        {potentialViewers.length > INITIAL_IMPORTANT_VISIBLE &&
                          potentialViewers.length === potentialViewersVisibleCount && (
                            <div className="text-center">
                              <button
                                onClick={showLessPotentialViewers}
                                className="text-sm text-primary hover:text-primary/80"
                              >
                                Show less
                              </button>
                            </div>
                          )}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">Collapsed. Click “Show more” to view potential viewers.</div>
                    )}
                  </div>

                  <div ref={secondDegreeSectionRef} className="card-base p-6 border border-border">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-foreground">Second-Degree Engagements (Main)</h3>
                      <span className="text-xs text-muted-foreground">From quote tweets & second-order</span>
                    </div>
                    {isSecondDegreeLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
                        <span className="ml-3 text-muted-foreground text-sm">Loading second-degree metrics...</span>
                      </div>
                    ) : !secondDegreeLoaded ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        Scroll down to load second-degree metrics...
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
                          <div className="card-base p-3 border border-primary/20">
                            <p className="text-xs text-muted-foreground">Quote Views</p>
                            <p className="text-xl font-bold text-foreground mt-1">
                              {(secondDegreeTotals.main_twt.views || 0).toLocaleString()}
                            </p>
                          </div>
                          <div className="card-base p-3">
                            <p className="text-xs text-muted-foreground">Quote Likes</p>
                            <p className="text-xl font-bold text-foreground mt-1">
                              {(secondDegreeTotals.main_twt.likes || 0).toLocaleString()}
                            </p>
                          </div>
                          <div className="card-base p-3">
                            <p className="text-xs text-muted-foreground">Quote Retweets</p>
                            <p className="text-xl font-bold text-foreground mt-1">
                              {(secondDegreeTotals.main_twt.retweets || 0).toLocaleString()}
                            </p>
                          </div>
                          <div className="card-base p-3">
                            <p className="text-xs text-muted-foreground">Quote Replies</p>
                            <p className="text-xl font-bold text-foreground mt-1">
                              {(secondDegreeTotals.main_twt.replies || 0).toLocaleString()}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4">
                          <div className="w-full lg:w-1/2 mx-auto">
                            <MetricChart
                              title="Quote Views from Quote Tweets (Main)"
                              metric="quoteViews"
                              chartData={mainQuoteViewSeries}
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground text-sm">No main tweet found for this campaign.</div>
              )}
            </div>
          </div>

          {/* ===== Combined Metrics ===== */}
          <div className="card-base p-6 mb-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">Combined Metrics</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
              <div className="card-base p-6 lg:col-span-2 md:col-span-2 shadow-sm border-primary/20">
                <p className="text-sm font-semibold text-foreground">First-degree Views</p>
                <p className="text-3xl font-black text-foreground mt-2">
                  {data.metrics.total_views.toLocaleString()}
                </p>
              </div>
              <div className="card-base p-4">
                <p className="text-sm font-semibold text-foreground">Total Views from Quote Twt</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {(data.metrics.total_quote_views ?? 0).toLocaleString()}
                </p>
              </div>
              <div className="card-base p-4">
                <p className="text-sm text-muted-foreground">Total Likes</p>
                <p className="text-2xl font-bold text-foreground mt-1">{data.metrics.total_likes.toLocaleString()}</p>
              </div>
              <div className="card-base p-4">
                <p className="text-sm text-muted-foreground">Total Retweets</p>
                <p className="text-2xl font-bold text-foreground mt-1">{data.metrics.total_retweets.toLocaleString()}</p>
              </div>
              <div className="card-base p-4">
                <p className="text-sm text-muted-foreground">Total Replies</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {data.metrics.total_replies.toLocaleString()}
                </p>
              </div>
              <div className="card-base p-4">
                <p className="text-sm text-muted-foreground">Total Quote Tweets</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {data.metrics.total_quotes.toLocaleString()}
                </p>
              </div>
              <div className="card-base p-4">
                <p className="text-sm text-muted-foreground">Total Engagements</p>
                <p className="text-2xl font-bold text-foreground mt-1">{data.metrics.total_engagements.toLocaleString()}</p>
              </div>
            </div>

            {/* Per-Category Metrics */}
            <div className="card-base p-6 mb-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-foreground">Metrics by Tweet Type</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(
                  [
                    { key: 'main_twt', label: 'Main Tweet' },
                    { key: 'influencer_twt', label: 'Influencer Tweet' },
                    { key: 'investor_twt', label: 'Investor Tweet' },
                  ] as const
                ).map(({ key, label }) => {
                  const totals = categoryTotals[key];
                  const hasTweets = (data.tweets || []).some((t) => t.category === key);
                  return (
                    <div key={key} className="card-base p-4 border border-border">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-muted-foreground font-semibold">{label}</p>
                        {!hasTweets && (
                          <span className="text-xs text-muted-foreground/60">No tweets yet</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                        <div>Likes</div>
                        <div className="text-right text-foreground font-semibold">{(totals?.likes || 0).toLocaleString()}</div>
                        <div>Retweets</div>
                        <div className="text-right text-foreground font-semibold">{(totals?.retweets || 0).toLocaleString()}</div>
                        <div>Replies</div>
                        <div className="text-right text-foreground font-semibold">{(totals?.replies || 0).toLocaleString()}</div>
                        <div>Quote Tweets</div>
                        <div className="text-right text-foreground font-semibold">{(totals?.quotes || 0).toLocaleString()}</div>
                        <div>Views</div>
                        <div className="text-right text-foreground font-semibold">{(totals?.views || 0).toLocaleString()}</div>
                        <div>Quote Views</div>
                        <div className="text-right text-foreground font-semibold">
                          {(totals?.quote_views || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Global Filter Toggle for combined charts */}
            <div className="card-base p-6 mb-6">
              <div className="flex justify-end items-center">
                <div className="flex items-center gap-3">
                  <label htmlFor="metric-filter" className="text-sm font-medium text-muted-foreground">
                    Filter Metrics By:
                  </label>
                  <select
                    id="metric-filter"
                    value={globalFilter}
                    onChange={(e) => setGlobalFilter(e.target.value as FilterType)}
                    className="px-4 py-2 text-sm border border-border rounded-lg bg-background text-foreground hover:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary cursor-pointer min-w-[200px] transition-all"
                  >
                    <option value="all">All (Combined)</option>
                    <option value="main_twt">Main Tweet</option>
                    <option value="influencer_twt">Influencer Tweets</option>
                    <option value="investor_twt">Investor Tweets</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-6">
              {engagementLastUpdated && (
                <div className="card-base p-4 border border-yellow-500/20 bg-yellow-500/5 col-span-full">
                  <p className="text-sm text-foreground">
                    <span className="font-semibold">Note:</span> Engagement charts (Retweets, Replies, Quotes) show data up to{' '}
                    <span className="font-mono">
                      {engagementLastUpdated.toLocaleString()}
                    </span>
                    .
                  </p>
                </div>
              )}

              <MetricChart
                title="Quote Tweets (Combined)"
                metric="quotes"
                chartData={getFilteredChartData('quotes')}
              />
              <MetricChart
                title="Replies (Combined)"
                metric="replies"
                chartData={getFilteredChartData('replies')}
              />
              <MetricChart
                title="Retweets (Combined)"
                metric="retweets"
                chartData={getFilteredChartData('retweets')}
              />
              <MetricChart
                title="Total Views (Combined)"
                metric="views"
                chartData={getFilteredChartData('views')}
              />
              <MetricChart
                title="Likes (Combined)"
                metric="likes"
                chartData={getFilteredChartData('likes')}
              />

              <div className="card-base p-6">
                <h2 className="text-xl font-semibold text-foreground mb-4">Account Categories</h2>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={100}
                        fill="var(--chart-1)"
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--popover)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          color: 'var(--popover-foreground)',
                          boxShadow: 'var(--shadow-card)',
                        }}
                        labelStyle={{ color: 'var(--muted-foreground)' }}
                        itemStyle={{ color: 'var(--foreground)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center text-muted-foreground py-12">
                    No category data yet
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
