'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface MetricSnapshot {
  timestamp: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  viewCount: number;
  bookmarkCount: number;
  quoteViewSum?: number;
  quoteTweetCount?: number;
}

interface MonitoringData {
  job: {
    tweet_id: string;
    tweet_url: string;
    status: 'active' | 'completed';
    started_at: string;
    created_at: string;
  };
  snapshots: MetricSnapshot[];
  stats: {
    total_snapshots: number;
    is_active: boolean;
    hours_remaining: number;
    minutes_remaining: number;
  };
}

export default function MonitoringDashboard() {
  const params = useParams();
  const router = useRouter();
  const tweetId = params?.tweetId as string;
  
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch(`/api/monitor-tweet/${tweetId}`);
      const result = await response.json();

      if (response.ok && result.success) {
        setData(result);
        setError(null);
      } else {
        setError(result.error || 'Failed to fetch monitoring data');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [tweetId]);

  useEffect(() => {
    if (tweetId) {
      fetchData();
    }
  }, [tweetId, fetchData]);

  useEffect(() => {
    if (data?.stats.is_active) {
      // Auto-refresh every 30 seconds if monitoring is active
      const interval = setInterval(() => {
        fetchData();
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [data?.stats.is_active, fetchData]);

  const handleStopMonitoring = async () => {
    if (!tweetId || !data?.stats.is_active) return;

    setIsStopping(true);
    try {
      const response = await fetch('/api/monitor-tweet/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tweetId }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Refresh data to show updated status
        await fetchData();
      } else {
        setError(result.error || 'Failed to stop monitoring');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsStopping(false);
    }
  };

  // Format data for charts
  const chartData = data?.snapshots.map((snapshot) => ({
    time: new Date(snapshot.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    fullTime: new Date(snapshot.timestamp).toLocaleString(),
    Likes: snapshot.likeCount,
    Retweets: snapshot.retweetCount,
    Replies: snapshot.replyCount,
    Quotes: snapshot.quoteCount,
    Views: snapshot.viewCount,
    Bookmarks: snapshot.bookmarkCount,
    QuoteViews: snapshot.quoteViewSum ?? 0,
    QuoteTweets: snapshot.quoteTweetCount ?? 0,
  })) || [];

  const chartColor = '#2F6FED'; // Vibrant Blue accent (Design-v2 updated)

  const metricCharts = [
    { key: 'Likes', title: 'Likes Over Time', color: chartColor },
    { key: 'Retweets', title: 'Retweets Over Time', color: chartColor },
    { key: 'Replies', title: 'Replies Over Time', color: chartColor },
    { key: 'Quotes', title: 'Quotes Over Time', color: chartColor },
    { key: 'Views', title: 'Views Over Time', color: chartColor },
    { key: 'Bookmarks', title: 'Bookmarks Over Time', color: chartColor },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading monitoring data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center card-base p-8 max-w-md">
            <div className="w-16 h-16 bg-destructive/10 border border-destructive/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-foreground text-xl font-bold mb-2">Error</h2>
            <p className="text-muted-foreground mb-6">{error || 'Monitoring data not found'}</p>
            <button
              onClick={() => router.push('/monitor')}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-2 px-6 rounded-xl transition-all"
            >
              Go Back to All
            </button>
          </div>
        </div>
      </div>
    );
  }

  const latestSnapshot = data.snapshots[data.snapshots.length - 1];
  const firstSnapshot = data.snapshots[0];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      
      <div className="relative z-10">
        {/* Header */}
        <div className="pt-24 pb-8">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-2">
                  Tweet Monitoring
                </h1>
                <p className="text-muted-foreground">
                  Real-time engagement metrics over 72 hours
                </p>
              </div>
              <div className="flex items-center gap-3">
                {data.stats.is_active && (
                  <button
                    onClick={handleStopMonitoring}
                    disabled={isStopping}
                    className="bg-destructive hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed border border-destructive text-destructive-foreground font-semibold py-2 px-4 rounded-xl transition-all flex items-center gap-2"
                  >
                    {isStopping ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent"></div>
                        Stopping...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                        </svg>
                        Stop Monitoring
                      </>
                    )}
                  </button>
                )}
                <Link
                  href="/monitor"
                  className="bg-card hover:bg-muted border border-border text-foreground font-semibold py-2 px-4 rounded-xl transition-all flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back to All
                </Link>
              </div>
            </div>

            {/* Status Card */}
            <div className="card-base p-6 mb-6">
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <p className="text-muted-foreground text-sm mb-1">Status</p>
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${
                      data.stats.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'
                    }`}></div>
                    <span className="text-foreground font-semibold capitalize">
                      {data.job.status}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground text-sm mb-1">Started</p>
                  <p className="text-foreground font-medium">
                    {new Date(data.job.started_at).toLocaleString()}
                  </p>
                </div>
                {data.stats.is_active && (
                  <div>
                    <p className="text-muted-foreground text-sm mb-1">Time Remaining</p>
                    <p className="text-foreground font-medium">
                      {data.stats.hours_remaining}h {data.stats.minutes_remaining}m
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-sm mb-1">Total Snapshots</p>
                  <p className="text-foreground font-medium">{data.stats.total_snapshots}</p>
                </div>
                <div className="ml-auto">
                  <a
                    href={data.job.tweet_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80 font-medium flex items-center gap-2"
                  >
                    View Tweet
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>
            </div>

            {/* Current Metrics */}
            {latestSnapshot && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
                <div className="card-base p-4">
                  <p className="text-muted-foreground text-sm mb-1">Likes</p>
                  <p className="text-2xl font-bold text-foreground">{latestSnapshot.likeCount.toLocaleString()}</p>
                  {firstSnapshot && latestSnapshot.likeCount > firstSnapshot.likeCount && (
                    <p className="text-emerald-500 text-xs mt-1">+{(latestSnapshot.likeCount - firstSnapshot.likeCount).toLocaleString()}</p>
                  )}
                </div>
                <div className="card-base p-4">
                  <p className="text-muted-foreground text-sm mb-1">Retweets</p>
                  <p className="text-2xl font-bold text-foreground">{latestSnapshot.retweetCount.toLocaleString()}</p>
                  {firstSnapshot && latestSnapshot.retweetCount > firstSnapshot.retweetCount && (
                    <p className="text-emerald-500 text-xs mt-1">+{(latestSnapshot.retweetCount - firstSnapshot.retweetCount).toLocaleString()}</p>
                  )}
                </div>
                <div className="card-base p-4">
                  <p className="text-muted-foreground text-sm mb-1">Replies</p>
                  <p className="text-2xl font-bold text-foreground">{latestSnapshot.replyCount.toLocaleString()}</p>
                  {firstSnapshot && latestSnapshot.replyCount > firstSnapshot.replyCount && (
                    <p className="text-emerald-500 text-xs mt-1">+{(latestSnapshot.replyCount - firstSnapshot.replyCount).toLocaleString()}</p>
                  )}
                </div>
                <div className="card-base p-4">
                  <p className="text-muted-foreground text-sm mb-1">Quotes</p>
                  <p className="text-2xl font-bold text-foreground">{latestSnapshot.quoteCount.toLocaleString()}</p>
                  {firstSnapshot && latestSnapshot.quoteCount > firstSnapshot.quoteCount && (
                    <p className="text-emerald-500 text-xs mt-1">+{(latestSnapshot.quoteCount - firstSnapshot.quoteCount).toLocaleString()}</p>
                  )}
                </div>
                <div className="card-base p-4">
                  <p className="text-muted-foreground text-sm mb-1">Views</p>
                  <p className="text-2xl font-bold text-foreground">{latestSnapshot.viewCount.toLocaleString()}</p>
                  {firstSnapshot && latestSnapshot.viewCount > firstSnapshot.viewCount && (
                    <p className="text-emerald-500 text-xs mt-1">+{(latestSnapshot.viewCount - firstSnapshot.viewCount).toLocaleString()}</p>
                  )}
                </div>
                <div className="card-base p-4">
                  <p className="text-muted-foreground text-sm mb-1">Bookmarks</p>
                  <p className="text-2xl font-bold text-foreground">{latestSnapshot.bookmarkCount.toLocaleString()}</p>
                  {firstSnapshot && latestSnapshot.bookmarkCount > firstSnapshot.bookmarkCount && (
                    <p className="text-emerald-500 text-xs mt-1">+{(latestSnapshot.bookmarkCount - firstSnapshot.bookmarkCount).toLocaleString()}</p>
                  )}
                </div>
              </div>
            )}

            {/* Charts */}
            {chartData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {metricCharts.map((cfg) => (
                  <div key={cfg.key} className="card-base p-6">
                    <h2 className="text-foreground text-lg font-bold mb-4">{cfg.title}</h2>
                    <ResponsiveContainer width="100%" height={260}>
                      <ComposedChart data={chartData}>
                        <defs>
                          <linearGradient id={`grad-${cfg.key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={cfg.color} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={cfg.color} stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="time"
                          stroke="var(--muted-foreground)"
                          style={{ fontSize: '12px' }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          stroke="var(--muted-foreground)"
                          style={{ fontSize: '12px' }}
                          tickLine={false}
                          axisLine={false}
                        />
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
                        <Area
                          type="monotone"
                          dataKey={cfg.key}
                          stroke={cfg.color}
                          strokeWidth={2}
                          fill={`url(#grad-${cfg.key})`}
                          dot={{ r: 2, strokeWidth: 1, fill: cfg.color }}
                          activeDot={{ r: 5 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
            ) : (
              <div className="card-base p-12 text-center">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="text-foreground text-lg font-semibold mb-2">No Data Yet</h3>
                <p className="text-muted-foreground">
                  {data.stats.is_active 
                    ? 'Waiting for first metrics snapshot. Scheduler will collect data every few minutes.'
                    : 'Monitoring has completed. No snapshots were collected.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
