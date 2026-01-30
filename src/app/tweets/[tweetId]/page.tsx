'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import ReactMarkdown from 'react-markdown';
import dynamic from 'next/dynamic';
import type { LocationHeatmapData } from '@/components/WorldHeatmap';
import MonitoringChartsSection from '@/components/MonitoringChartsSection';

// Lazy load WorldHeatmap (maps don't need SSR)
const WorldHeatmap = dynamic(() => import('@/components/WorldHeatmap').then(mod => ({ default: mod.WorldHeatmap })), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12 border border-dashed border-foreground/30">
      <span className="font-mono text-sm">LOADING_MAP_DATA...</span>
    </div>
  ),
});

const HeatmapLegend = dynamic(() => import('@/components/WorldHeatmap').then(mod => ({ default: mod.HeatmapLegend })), {
  ssr: false,
});

interface Engager {
  userId: string;
  username: string;
  name: string;
  bio?: string;
  location?: string;
  account_based_in?: string | null;
  followers: number;
  verified: boolean;
  replied: boolean;
  retweeted: boolean;
  quoted: boolean;
  liked?: boolean;
  importance_score?: number;
  followed_by?: string[];
}

type CategoryKey =
  | 'founders'
  | 'vcs'
  | 'ai_creators'
  | 'media'
  | 'developers'
  | 'c_level'
  | 'yc_alumni'
  | 'others';

type CategorizedEngagers = Record<CategoryKey, Engager[]>;

// Ink Palette for Charts
const CATEGORY_CONFIG: {
  key: CategoryKey;
  label: string;
  color: string;
}[] = [
  { key: 'founders', label: 'Founders', color: 'var(--chart-1)' }, // Navy
  { key: 'vcs', label: 'VCs', color: 'var(--chart-3)' }, // Green
  { key: 'ai_creators', label: 'AI Creators', color: 'var(--chart-4)' }, // Burnt Orange
  { key: 'media', label: 'Media', color: 'var(--chart-2)' }, // Red
  { key: 'developers', label: 'Developers', color: 'var(--chart-5)' }, // Purple
  { key: 'c_level', label: 'C-Level', color: '#854D0E' }, // Dark Gold
  { key: 'yc_alumni', label: 'YC Alumni', color: '#EA580C' }, // Strong Orange
  { key: 'others', label: 'Others', color: '#525252' }, // Dark Gray
];

export default function TweetDetailPage() {
  const params = useParams();
  const tweetId = params?.tweetId as string;
  
  const [tweet, setTweet] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [engagers, setEngagers] = useState<Engager[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [likersStatus, setLikersStatus] = useState<{
    client_id: string | null;
    has_oauth: boolean;
    oauth_status: string | null;
    blocked_until: string | null;
    backfill_complete: boolean;
    cursor: string | null;
    last_success: string | null;
    last_error: string | null;
    progress?: {
      likes_total: number | null;
      likers_synced: number;
    } | null;
    job?: {
      status: string;
      retry_after: string | null;
      retry_count: number;
      max_retries: number;
      last_error: string | null;
      stats: any | null;
      updated_at: string;
    } | null;
  } | null>(null);
  const [syncingLikers, setSyncingLikers] = useState(false);
  const likersStatusPollRef = useRef<number | null>(null);
  
  // Heatmap state
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
  const [isHeatmapLoading, setIsHeatmapLoading] = useState(false);
  
  // AI Report state
  const [aiReport, setAiReport] = useState<any>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  
  // Filters
  const [minFollowers, setMinFollowers] = useState<string>('');
  const [sortBy, setSortBy] = useState('importance_score');
  const [engagementFilter, setEngagementFilter] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  
  // Pagination
  const [page, setPage] = useState(1);
  const limit = 50;

  const formatCompact = useCallback((value: unknown) => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return '0';
    return new Intl.NumberFormat('en', {
      notation: 'compact',
      compactDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(n);
  }, []);

  const formatDateTime = useCallback((value: unknown) => {
    if (!value) return '—';
    const d = new Date(value as any);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }, []);

  // XLSX Export state
  const [exporting, setExporting] = useState(false);
  const [exportAll, setExportAll] = useState(false);

  // Interactive category selection for charts
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey | null>(null);

  // Monitor charts visibility
  const [hasMonitoringData, setHasMonitoringData] = useState(false);

  const fetchTweetData = useCallback(async () => {
    if (!tweetId) return;
    try {
      setLoading(true);
      const params = new URLSearchParams({
        include_engagers: 'true',
        limit: limit.toString(),
        skip: ((page - 1) * limit).toString(),
        sort_by: sortBy,
        sort_order: 'desc',
      });
      if (minFollowers) params.append('min_followers', minFollowers);
      if (engagementFilter) params.append('engagement_type', engagementFilter);
      if (verifiedOnly) params.append('verified_only', 'true');
      
      const res = await fetch(`/api/tweets/${tweetId}?${params}`);
      const data = await res.json();
      
      if (data.success) {
        setTweet(data.tweet);
        setStats(data.stats);
        setEngagers(data.engagers.engagers);
        setTotal(data.engagers.total);
        if (data.tweet?.ai_report) {
          setAiReport(data.tweet.ai_report);
        }
      } else {
        setError(data.error || 'Failed to fetch tweet');
      }
    } catch {
      setError('Failed to fetch tweet');
    } finally {
      setLoading(false);
    }
  }, [tweetId, page, minFollowers, sortBy, engagementFilter, verifiedOnly]);

  const fetchLikersStatus = useCallback(async () => {
    if (!tweetId) return;
    try {
      const res = await fetch(`/api/tweets/${tweetId}/likers/status`);
      const json = await res.json();
      if (json?.success) {
        setLikersStatus({
          client_id: json.client_id ?? null,
          has_oauth: Boolean(json.has_oauth),
          oauth_status: json.oauth_status ?? null,
          blocked_until: json.blocked_until ?? null,
          backfill_complete: Boolean(json.backfill_complete),
          cursor: json.cursor ?? null,
          last_success: json.last_success ?? null,
          last_error: json.last_error ?? null,
          progress: json.progress ?? null,
          job: json.job ?? null,
        });
      }
    } catch {
      setLikersStatus(null);
    }
  }, [tweetId]);

  const syncLikers = useCallback(async () => {
    if (!tweetId) return;
    setSyncingLikers(true);
    try {
      // Enqueue-only: server-side cron drains the job safely.
      await fetch(`/api/tweets/${tweetId}/likers/sync`, { method: 'POST' });
      await Promise.all([fetchLikersStatus(), fetchTweetData()]);
    } catch {
      // No blocking alerts for background work; status UI will show errors.
    } finally {
      setSyncingLikers(false);
    }
  }, [tweetId, fetchLikersStatus, fetchTweetData]);

  // Status-only polling (no direct auto-sync). The cron worker is responsible for execution.
  useEffect(() => {
    if (!tweetId) return;
    // Always do an initial status fetch quickly.
    void fetchLikersStatus();

    // Poll while OAuth is present and backfill isn't complete (or while a job is running).
    if (!likersStatus?.has_oauth) return;
    const shouldPoll =
      !likersStatus.backfill_complete ||
      (likersStatus.job && ['pending', 'processing', 'retrying'].includes(String(likersStatus.job.status)));
    if (!shouldPoll) return;

    if (likersStatusPollRef.current) window.clearInterval(likersStatusPollRef.current);
    likersStatusPollRef.current = window.setInterval(() => {
      void fetchLikersStatus();
    }, 10_000);

    return () => {
      if (likersStatusPollRef.current) window.clearInterval(likersStatusPollRef.current);
      likersStatusPollRef.current = null;
    };
  }, [tweetId, likersStatus?.has_oauth, likersStatus?.backfill_complete, likersStatus?.job, likersStatus?.job?.status, fetchLikersStatus]);

  const fetchHeatmap = useCallback(async () => {
    if (!tweetId) return;
    setIsHeatmapLoading(true);
    try {
      const res = await fetch(`/api/tweets/${tweetId}/heatmap?distribute_regions=true`);
      const json = await res.json();
      if (json?.success) {
        setHeatmapData(json.data);
      } else {
        setHeatmapData(null);
      }
    } catch {
      setHeatmapData(null);
    } finally {
      setIsHeatmapLoading(false);
    }
  }, [tweetId]);

  useEffect(() => {
    fetchTweetData();
    fetchHeatmap();
    fetchLikersStatus();
  }, [fetchTweetData, fetchHeatmap, fetchLikersStatus]);

  // Check if monitoring data exists for this tweet
  useEffect(() => {
    if (!tweetId) return;
    fetch(`/api/monitor-tweet/${tweetId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.snapshots?.length > 0) {
          setHasMonitoringData(true);
        } else {
          setHasMonitoringData(false);
        }
      })
      .catch(() => setHasMonitoringData(false));
  }, [tweetId]);

  // Categorization Logic (Same as before, preserved)
  const categorizeEngagerProfile = (engager: Engager): CategoryKey[] => {
    const bio = (engager.bio || '').toLowerCase();
    const name = (engager.name || '').toLowerCase();
    const username = (engager.username || '').toLowerCase();
    const combined = `${bio} ${name} ${username}`;
    const categories: CategoryKey[] = [];
    const ycKeywords = ['y combinator', 'yc s', 'yc w', 'yc ', 'ycombinator'];
    if (ycKeywords.some(kw => combined.includes(kw))) categories.push('yc_alumni');
    const cLevelKeywords = ['cto', 'cfo', 'coo', 'chief technology', 'chief financial', 'chief operating'];
    if (cLevelKeywords.some(kw => combined.includes(kw)) && !combined.includes('founder') && !combined.includes('ceo')) categories.push('c_level');
    const founderKeywords = ['founder', 'co-founder', 'cofounder', 'ceo', 'chief executive', 'startup founder', 'company founder'];
    if (founderKeywords.some(kw => combined.includes(kw))) categories.push('founders');
    const vcKeywords = ['vc', 'venture capital', 'venture capitalist', 'investor', 'angel investor', 'a16z', 'andreessen horowitz', 'partner at', 'investment partner', 'venture partner', 'seed fund', 'series a', 'series b', 'series c', 'portfolio', 'backed by'];
    if (vcKeywords.some(kw => combined.includes(kw))) categories.push('vcs');
    const aiCreatorKeywords = ['ai content creator', 'ai influencer', 'ai writer', 'ai educator', 'newsletter', 'ai newsletter', 'building in ai', 'ai builder', 'ai creator', 'ai content', 'generative ai', 'llm', 'chatgpt', 'ai researcher', 'ai practitioner'];
    if (aiCreatorKeywords.some(kw => combined.includes(kw))) categories.push('ai_creators');
    const mediaKeywords = ['journalist', 'reporter', 'media', 'press', 'writer', 'editor', 'tech journalist', 'tech reporter', 'news', 'publication', 'techcrunch', 'the verge', 'wired', 'forbes', 'bloomberg'];
    if (mediaKeywords.some(kw => combined.includes(kw))) categories.push('media');
    const developerKeywords = ['developer', 'engineer', 'software engineer', 'programmer', 'coder', 'building', 'builder', 'full stack', 'backend', 'frontend', 'dev', 'tech lead', 'senior engineer', 'principal engineer'];
    if (developerKeywords.some(kw => combined.includes(kw))) categories.push('developers');
    if (categories.length === 0) categories.push('others');
    return categories;
  };

  const categorizedEngagers = useMemo<CategorizedEngagers>(() => {
    const initial: CategorizedEngagers = { founders: [], vcs: [], ai_creators: [], media: [], developers: [], c_level: [], yc_alumni: [], others: [] };

    const rawCategorized = aiReport?.structured_stats?.categorized_engagers as Partial<Record<CategoryKey, unknown[]>> | undefined;
    if (rawCategorized) {
      const convert = (raw: unknown): Engager => {
        const e = raw as Partial<Engager> & Record<string, unknown>;
        return {
          userId: String(e.userId ?? ''),
          username: String(e.username ?? ''),
          name: String(e.name ?? ''),
          bio: typeof e.bio === 'string' ? e.bio : undefined,
          followers: typeof e.followers === 'number' ? e.followers : Number(e.followers ?? 0),
          verified: Boolean(e.verified),
          replied: Boolean(e.replied),
          retweeted: Boolean(e.retweeted),
          quoted: Boolean(e.quoted),
          liked: typeof e.liked === 'boolean' ? e.liked : undefined,
          importance_score: typeof e.importance_score === 'number' ? e.importance_score : undefined,
          location: typeof e.location === 'string' ? e.location : undefined,
          account_based_in: typeof e.account_based_in === 'string' ? e.account_based_in : null,
          followed_by: Array.isArray(e.followed_by) ? (e.followed_by as string[]) : undefined,
        };
      };

      for (const key of Object.keys(initial) as CategoryKey[]) {
        const list = rawCategorized[key] ?? [];
        initial[key] = list.map(convert).filter(e => e.userId);
      }

      return initial;
    }

    for (const engager of engagers) {
      const cats = categorizeEngagerProfile(engager);
      for (const cat of cats) {
        initial[cat].push(engager);
      }
    }
    return initial;
  }, [aiReport, engagers]);

  const handleGenerateReport = async () => {
    if (!tweetId) return;
    setGeneratingReport(true);
    setReportError(null);
    try {
      const res = await fetch(`/api/tweets/${tweetId}/generate-report`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setAiReport(data.report);
        await fetchTweetData();
      } else {
        setReportError(data.error || 'Failed to generate report');
      }
    } catch {
      setReportError('Failed to generate report.');
    } finally {
      setGeneratingReport(false);
    }
  };

  if (loading && !tweet) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono">
        <div className="text-center">
          <div className="text-sm uppercase tracking-widest mb-2">Retrieving Data</div>
          <div className="animate-pulse">...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono">
         <div className="border-2 border-destructive p-8 max-w-md text-center">
            <h2 className="text-destructive font-bold mb-4">ERROR_LOG</h2>
            <p className="mb-6">{error}</p>
            <Link href="/tweets" className="underline hover:bg-muted/50 px-2 py-1">Return to Index</Link>
         </div>
      </div>
    );
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="min-h-screen pb-20">
      <Navbar />
      
      <div className="max-w-5xl mx-auto px-6 pt-24">
        {/* Lab Report Header */}
        <div className="mb-12 border-b-2 border-foreground pb-6">
            <div className="flex justify-between items-start mb-6">
                <Link href="/tweets" className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground hover:underline">
                    ← Back to Index
                </Link>
                <div className="font-mono text-xs uppercase text-right text-muted-foreground">
                    <div>Tweet ID</div>
                    <div>{tweetId}</div>
                </div>
            </div>

            <h1 className="text-5xl md:text-6xl font-sans font-bold text-foreground mb-6 leading-tight ink-text">
                {tweet?.author_name}
            </h1>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 border-t border-dotted border-foreground/50 pt-4">
                <div>
                    <div className="lab-header-item">SUBJECT HANDLE</div>
                    <div className="lab-header-value">@{tweet?.author_username}</div>
                </div>
                <div>
                    <div className="lab-header-item">DATE OBTAINED</div>
                    <div className="lab-header-value">{new Date(tweet?.created_at).toLocaleDateString()}</div>
                </div>
                 <div>
                    <div className="lab-header-item">STATUS</div>
                    <div className="lab-header-value">{aiReport ? 'ANALYZED' : 'PENDING ANALYSIS'}</div>
                </div>
                 <div>
                    <div className="lab-header-item">SOURCE</div>
                    <a href={tweet?.tweet_url} target="_blank" className="lab-header-value hover:underline text-blue-800">Twitter Link ↗</a>
                </div>
            </div>
        </div>

        {/* Engagement Trends (only if monitoring data exists) */}
        {hasMonitoringData && (
          <MonitoringChartsSection tweetId={tweetId} defaultCollapsed={true} />
        )}

        {/* Observation Log (Metrics) */}
        <section className="mb-16">
            <h3 className="font-sans text-2xl font-bold mb-6 border-b-2 border-foreground inline-block pb-1">
                I. Tweet Metrics
            </h3>
            
            <div className="border-y-2 border-foreground overflow-hidden">
                <div className="grid grid-cols-3 md:grid-cols-6 divide-x divide-foreground bg-white/20">
                    {[
                        { label: 'Views', value: tweet?.metrics?.viewCount },
                        { label: 'Likes', value: tweet?.metrics?.likeCount },
                        { label: 'Reposts', value: tweet?.metrics?.retweetCount },
                        { label: 'Replies', value: tweet?.metrics?.replyCount },
                        { label: 'Quotes', value: tweet?.metrics?.quoteCount },
                        { label: 'Saves', value: tweet?.metrics?.bookmarkCount },
                    ].map((m, i) => (
                        <div key={i} className="p-4 text-center">
                            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{m.label}</div>
                            <div className="font-mono text-2xl font-bold tabular-nums ink-text">{formatCompact(m.value || 0)}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Signal Calibration (Likers Sync) - The "Paper Lab" Version of Connect/Sync */}
            <div className="mt-8 border border-foreground/30 p-4 bg-foreground/5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                     <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        ACCOUNT STATUS: {likersStatus?.has_oauth ? 'ONLINE' : 'OFFLINE'}
                     </div>
                     {likersStatus?.last_success && (
                        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                            LAST SYNC: {formatDateTime(likersStatus.last_success)}
                        </div>
                     )}
                </div>

                <div className="flex items-center gap-3">
                    {likersStatus?.client_id && !likersStatus.has_oauth && (
                        <a
                            href={`/api/auth/x/authorize?client_id=${encodeURIComponent(likersStatus.client_id)}&return_to=${encodeURIComponent(`/tweets/${tweetId}`)}`}
                            className="font-mono text-xs uppercase border border-foreground px-3 py-1.5 hover:bg-foreground hover:text-background transition-colors"
                        >
                            Connect Account
                        </a>
                    )}
                    
                    <button
                        onClick={syncLikers}
                        disabled={syncingLikers || !likersStatus?.has_oauth}
                        className="font-mono text-xs uppercase border border-foreground px-3 py-1.5 hover:bg-foreground hover:text-background transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {syncingLikers ? 'SYNCING...' : 'SYNC LIKERS'}
                    </button>
                </div>
            </div>
            
            {likersStatus?.blocked_until && (
                <div className="mt-2 font-mono text-[10px] text-destructive uppercase">
                    ⚠ RATE LIMIT ACTIVE UNTIL {new Date(likersStatus.blocked_until).toLocaleTimeString()}
                </div>
            )}

            {likersStatus?.has_oauth &&
              !likersStatus.backfill_complete &&
              !likersStatus.blocked_until &&
              (likersStatus?.job?.status ? (
                <div className="mt-2 font-mono text-[10px] text-muted-foreground uppercase animate-pulse">
                  ⟳ BACKGROUND LIKES SYNC {String(likersStatus.job.status).toUpperCase()}
                </div>
              ) : (
                <div className="mt-2 font-mono text-[10px] text-muted-foreground uppercase">
                  ⟳ LIKES SYNC NOT STARTED YET (ENQUEUE TO BEGIN)
                </div>
              ))}

            {likersStatus?.progress && (
                <div className="mt-2 font-mono text-[10px] text-muted-foreground uppercase">
                    LIKERS SYNCED: {likersStatus.progress.likers_synced.toLocaleString()}
                    {typeof likersStatus.progress.likes_total === 'number' && (
                      <> / {likersStatus.progress.likes_total.toLocaleString()}</>
                    )}
                </div>
            )}

            {likersStatus?.job?.status && (
                <div className="mt-1 font-mono text-[10px] text-muted-foreground uppercase">
                    JOB: {String(likersStatus.job.status).toUpperCase()}
                    {likersStatus.job.retry_after && (
                      <> · RETRY AT {new Date(likersStatus.job.retry_after).toLocaleTimeString()}</>
                    )}
                </div>
            )}

            {/* Engager Summary */}
            <div className="mt-4 font-mono text-xs text-muted-foreground text-center">
                Detailed Engagement: {stats?.total?.toLocaleString() ?? 0} unique accounts identified.
                <span className="ml-4">
                    High Value ({'>'}10k): <strong>{stats?.above_10k?.toLocaleString() ?? 0}</strong>
                </span>
            </div>
        </section>

        {/* AI Analysis Report */}
        <section className="mb-16 relative">
             <div className="flex items-baseline justify-between mb-6 border-b-2 border-foreground pb-1">
                 <h3 className="font-sans text-2xl font-bold">
                    II. Qualitative Analysis
                </h3>
                 <button
                    onClick={handleGenerateReport}
                    disabled={generatingReport}
                    className="font-mono text-xs uppercase underline hover:bg-black hover:text-white px-2 py-1 transition-all"
                >
                    {generatingReport ? 'GENERATING...' : aiReport ? 'REGENERATE DATA' : 'INITIATE ANALYSIS'}
                </button>
             </div>

            {reportError && (
                 <div className="border border-destructive text-destructive p-4 font-mono text-sm mb-6 bg-red-50/50">
                    ⚠ ERROR: {reportError}
                 </div>
            )}

             {aiReport ? (
                <div className="columns-1 md:columns-2 gap-12 text-justify">
                     <div className="prose prose-stone prose-p:font-sans prose-p:text-lg prose-p:leading-relaxed max-w-none ink-text">
                        <ReactMarkdown>
                            {aiReport.narrative}
                        </ReactMarkdown>
                     </div>
                </div>
             ) : (
                <div className="border-2 border-dashed border-muted p-12 text-center font-mono text-sm text-muted-foreground">
                    NO QUALITATIVE DATA AVAILABLE.<br/>
                    INITIATE ANALYSIS TO GENERATE REPORT.
                </div>
             )}
        </section>

        {/* Visual Data (Figures) */}
        {aiReport && (
            <section className="mb-16">
                 <h3 className="font-sans text-2xl font-bold mb-8 border-b-2 border-foreground inline-block pb-1">
                    III. Visual Data
                </h3>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    {/* Figure 1: Profile Distribution */}
                    <figure className="relative">
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                <Pie
                                    data={CATEGORY_CONFIG.map(cfg => ({
                                        key: cfg.key,
                                        name: cfg.label,
                                        color: cfg.color,
                                        value: aiReport.structured_stats.categories[cfg.key]?.count || 0,
                                    })).filter(item => item.value > 0)}
                                    dataKey="value"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={90}
                                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                    labelLine={{ stroke: 'var(--foreground)', strokeWidth: 1 }}
                                    onClick={(_, index) => {
                                        const pieData = CATEGORY_CONFIG.map(cfg => ({
                                          key: cfg.key,
                                          name: cfg.label,
                                          color: cfg.color,
                                          value: aiReport.structured_stats.categories[cfg.key]?.count || 0,
                                        })).filter(item => item.value > 0);
                                        const clicked = pieData[index];
                                        if (!clicked) return;
                                        setSelectedCategory(prev => prev === clicked.key ? null : clicked.key);
                                    }}
                                >
                                    {CATEGORY_CONFIG.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
                                    ))}
                                </Pie>
                                <Tooltip 
                                    contentStyle={{ 
                                        backgroundColor: 'var(--background)', 
                                        border: '1px solid var(--foreground)',
                                        fontFamily: 'var(--font-mono)',
                                        textTransform: 'uppercase'
                                    }} 
                                />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <figcaption>Fig 1.1 - Profile Classification Model</figcaption>

                        {/* Pie Chart Selection List - Overlay or Below */}
                        {selectedCategory && (
                            <div className="mt-4 border-t border-dashed border-foreground pt-4">
                                <div className="flex justify-between items-center mb-2">
                                    <h4 className="font-mono text-xs uppercase font-bold">
                                        Subset: {CATEGORY_CONFIG.find(c => c.key === selectedCategory)?.label}
                                    </h4>
                                    <button 
                                        onClick={() => setSelectedCategory(null)}
                                        className="text-xs text-muted-foreground hover:text-foreground"
                                    >
                                        [CLEAR]
                                    </button>
                                </div>
                                <div className="max-h-48 overflow-y-auto space-y-1 pr-2">
                                    {(categorizedEngagers[selectedCategory] || [])
                                        .filter((e, i, self) => i === self.findIndex((t) => t.userId === e.userId)) // Dedupe
                                        .sort((a, b) => b.followers - a.followers)
                                        .slice(0, 50)
                                        .map((engager) => (
                                            <div key={`${engager.userId}-${engager.username}`} className="font-mono text-[10px] flex justify-between hover:bg-black/5 p-1">
                                                <span>{engager.name} (@{engager.username})</span>
                                                <span className="text-muted-foreground">{formatCompact(engager.followers)}</span>
                                            </div>
                                    ))}
                                    {(categorizedEngagers[selectedCategory]?.length || 0) === 0 && (
                                        <div className="text-[10px] italic text-muted-foreground">No accounts identified in this subset.</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </figure>

                    {/* Figure 2: Follower Tiers */}
                     {aiReport.structured_stats.follower_tiers && (
                        <figure>
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={aiReport.structured_stats.follower_tiers} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--muted)" vertical={false} />
                                        <XAxis dataKey="tier" stroke="var(--foreground)" tick={{fontSize: 10, fontFamily: 'var(--font-mono)'}} axisLine={{strokeWidth: 2}} tickLine={false} />
                                        <YAxis stroke="var(--foreground)" tick={{fontSize: 10, fontFamily: 'var(--font-mono)'}} axisLine={false} tickLine={false} />
                                        <Tooltip
                                            cursor={{fill: 'var(--muted)', opacity: 0.2}}
                                            contentStyle={{
                                                backgroundColor: 'var(--background)',
                                                border: '1px solid var(--foreground)',
                                                fontFamily: 'var(--font-mono)'
                                            }}
                                        />
                                        <Bar dataKey="count" fill="var(--chart-1)" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <figcaption>Fig 1.2 - Audience Reach Stratification</figcaption>
                        </figure>
                     )}
                </div>
            </section>
        )}

        {/* Heatmap Section */}
         <section className="mb-16">
            <h3 className="font-sans text-2xl font-bold mb-6 border-b-2 border-foreground inline-block pb-1">
                IV. Geographic Distribution
            </h3>
            <figure className="p-0 border-2 border-foreground bg-blue-50/20">
                {isHeatmapLoading ? (
                    <div className="h-[400px] flex items-center justify-center font-mono text-sm">LOADING GEOSPATIAL DATA...</div>
                ) : heatmapData && heatmapData.locations.length > 0 ? (
                    <div className="relative">
                        <WorldHeatmap data={heatmapData.locations} height={400} scale={175} frameRatio={5.8} />
                        <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end pointer-events-none">
                            <div className="bg-background/80 p-2 border border-foreground backdrop-blur-sm pointer-events-auto">
                                <HeatmapLegend maxCount={Math.max(...heatmapData.locations.map(l => l.unique_users))} />
                            </div>
                            <div className="font-mono text-[10px] bg-background/80 p-1 border border-foreground text-right">
                                DATA POINTS: {heatmapData.metadata.locations_with_data}
                                <br/>
                                UNMAPPED: {heatmapData.metadata.locations_unmapped}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-[400px] flex items-center justify-center font-mono text-sm text-muted-foreground">
                        NO GEOSPATIAL DATA AVAILABLE
                    </div>
                )}
            </figure>
            <figcaption>Fig 2.0 - Global Engagement Heatmap</figcaption>
        </section>

        {/* Raw Data Table (Engagers) */}
        <section className="mb-24">
             <div className="flex items-center justify-between mb-6 border-b-2 border-foreground pb-1">
                <h3 className="font-sans text-2xl font-bold">
                    V. Important Engagers
                </h3>
                <div className="flex gap-2">
                     <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={exportAll}
                          onChange={(e) => setExportAll(e.target.checked)}
                          className="accent-foreground"
                        />
                        Export all (max 10k)
                     </label>
                     <button
                        onClick={async () => {
                             if (!tweetId || exporting) return;
                             setExporting(true);
                             try {
                                const params = new URLSearchParams({
                                  sort_by: sortBy,
                                  sort_order: 'desc',
                                });

                                if (exportAll) {
                                  params.set('all', 'true');
                                  params.set('limit', '10000');
                                } else {
                                  params.set('limit', String(limit));
                                  params.set('skip', String((page - 1) * limit));
                                }

                                if (minFollowers) params.append('min_followers', minFollowers);
                                if (engagementFilter) params.append('engagement_type', engagementFilter);
                                if (verifiedOnly) params.append('verified_only', 'true');

                                const url = `/api/tweets/${tweetId}/engagers/export?${params.toString()}`;
                                window.location.href = url;
                             } catch {
                                 alert('Export failed');
                             } finally {
                                 setExporting(false);
                             }
                        }}
                        className="font-mono text-xs uppercase border border-foreground px-3 py-1 hover:bg-foreground hover:text-background transition-colors"
                     >
                        {exporting ? 'PROCESSING...' : 'DOWNLOAD XLSX'}
                     </button>
                </div>
             </div>

             {/* Filters Bar - Styled like a control panel */}
             <div className="flex flex-wrap gap-4 mb-6 p-4 border border-foreground bg-muted/10 items-end">
                <div>
                     <label className="block font-mono text-[10px] uppercase mb-1">Min. Followers</label>
                     <input 
                        type="number" 
                        value={minFollowers} 
                        onChange={e => setMinFollowers(e.target.value)}
                        className="bg-transparent border-b border-foreground w-24 font-mono text-sm focus:outline-none"
                        placeholder="0"
                     />
                </div>
                 <div>
                     <label className="block font-mono text-[10px] uppercase mb-1">Sort Metric</label>
                     <select 
                        value={sortBy} 
                        onChange={e => setSortBy(e.target.value)}
                        className="bg-transparent border-b border-foreground font-mono text-sm focus:outline-none pr-4"
                     >
                        <option value="importance_score">IMPORTANCE</option>
                        <option value="followers">FOLLOWERS</option>
                     </select>
                </div>
                <div>
                     <label className="block font-mono text-[10px] uppercase mb-1">Filter Type</label>
                     <select 
                        value={engagementFilter} 
                        onChange={e => setEngagementFilter(e.target.value)}
                        className="bg-transparent border-b border-foreground font-mono text-sm focus:outline-none pr-4"
                     >
                        <option value="">ALL TYPES</option>
                        <option value="replied">REPLIED</option>
                        <option value="retweeted">RETWEETED</option>
                        <option value="quoted">QUOTED</option>
                        <option value="liked">LIKED</option>
                     </select>
                </div>
                <div className="flex items-center gap-2">
                     <input
                        id="verified-only"
                        type="checkbox"
                        checked={verifiedOnly}
                        onChange={(e) => setVerifiedOnly(e.target.checked)}
                        className="accent-foreground"
                     />
                     <label htmlFor="verified-only" className="font-mono text-[10px] uppercase">
                        VERIFIED ONLY
                     </label>
                </div>
             </div>

             {/* The Table */}
             <div className="overflow-x-auto border-t-2 border-foreground">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-foreground/50">
                            <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider w-20">Score</th>
                            <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider">User Entity</th>
                            <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider text-right">Reach</th>
                            <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider">Signals</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-foreground/20">
                        {engagers.map((engager) => (
                            <tr key={engager.userId} className="hover:bg-foreground/5 transition-colors">
                                <td className="py-3 font-mono text-sm text-muted-foreground align-top tabular-nums">
                                    {Number.isFinite(engager.importance_score) ? (engager.importance_score as number).toFixed(2) : '—'}
                                </td>
                                <td className="py-3 pr-4 align-top">
                                    <div className="font-sans font-bold text-lg leading-none mb-1">
                                        {engager.name}
                                        {engager.verified && <span className="ml-1 text-blue-600 text-[10px] align-top">✓</span>}
                                    </div>
                                    <div className="font-mono text-xs text-muted-foreground mb-1">@{engager.username}</div>
                                    {engager.bio && <div className="text-xs text-foreground/80 italic leading-snug line-clamp-2 max-w-md">{engager.bio}</div>}
                                </td>
                                <td className="py-3 pr-4 text-right align-top font-mono text-sm">
                                    {engager.followers.toLocaleString()}
                                </td>
                                <td className="py-3 align-top">
                                     <div className="flex gap-1 flex-wrap">
                                        {engager.replied && <span className="px-1 border border-foreground text-[10px] font-mono uppercase">REP</span>}
                                        {engager.retweeted && <span className="px-1 border border-foreground text-[10px] font-mono uppercase">RT</span>}
                                        {engager.quoted && <span className="px-1 border border-foreground text-[10px] font-mono uppercase">QT</span>}
                                        {engager.liked && <span className="px-1 border border-foreground text-[10px] font-mono uppercase">LIKE</span>}
                                     </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
             </div>
             
             {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-between items-center mt-6 pt-4 border-t border-foreground">
                <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="font-mono text-xs uppercase disabled:opacity-30 hover:underline"
                >
                    ← Previous Page
                </button>
                <div className="font-mono text-xs">
                    PAGE {page} OF {totalPages}
                </div>
                <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="font-mono text-xs uppercase disabled:opacity-30 hover:underline"
                >
                    Next Page →
                </button>
              </div>
            )}
        </section>

        {/* Footer Stamp */}
        <div className="mt-24 mb-12 text-center opacity-50">
            <div className="inline-block border-2 border-foreground p-4 transform -rotate-2">
                <div className="font-mono text-xs uppercase tracking-widest mb-1">Social Capital Inc.</div>
                <div className="font-sans italic text-sm">Social Intelligence Analytics</div>
            </div>
        </div>
      </div>
    </div>
  );
}
