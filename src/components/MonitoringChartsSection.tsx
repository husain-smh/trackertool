'use client';

import { useState, useEffect, useCallback } from 'react';
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
}

interface MonitoringChartsProps {
  tweetId: string;
  defaultCollapsed?: boolean;
}

export default function MonitoringChartsSection({ tweetId, defaultCollapsed = true }: MonitoringChartsProps) {
  const [snapshots, setSnapshots] = useState<MetricSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);

  const fetchData = useCallback(async () => {
    if (!tweetId) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/monitor-tweet/${tweetId}`);
      const result = await response.json();

      if (response.ok && result.success) {
        setSnapshots(result.snapshots || []);
        setError(null);
      } else {
        setError(result.error || 'Failed to fetch monitoring data');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [tweetId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Format data for charts
  const chartData = snapshots.map((snapshot) => ({
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
  }));

  const chartColor = '#2F6FED';

  const metricCharts = [
    { key: 'Likes', title: 'Likes' },
    { key: 'Retweets', title: 'Retweets' },
    { key: 'Replies', title: 'Replies' },
    { key: 'Quotes', title: 'Quotes' },
    { key: 'Views', title: 'Views' },
    { key: 'Bookmarks', title: 'Bookmarks' },
  ];

  if (loading) {
    return (
      <section className="mb-12">
        <div className="border-b-2 border-foreground pb-2 mb-6">
          <h3 className="font-sans text-2xl font-bold">Engagement Trends</h3>
        </div>
        <div className="border border-foreground/20 p-8 text-center">
          <div className="font-mono text-sm text-muted-foreground animate-pulse">
            LOADING ENGAGEMENT DATA...
          </div>
        </div>
      </section>
    );
  }

  if (error || chartData.length === 0) {
    return null;
  }

  return (
    <section className="mb-12">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between border-b-2 border-foreground pb-2 mb-6 text-left group"
      >
        <h3 className="font-sans text-2xl font-bold">Engagement Trends</h3>
        <span className="font-mono text-sm text-muted-foreground group-hover:text-foreground transition-colors">
          {isExpanded ? '[ COLLAPSE ]' : '[ EXPAND ]'}
        </span>
      </button>

      {isExpanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {metricCharts.map((cfg) => (
            <div key={cfg.key} className="border border-foreground/20 p-4 bg-white/50">
              <h4 className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-3">
                {cfg.title}
              </h4>
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart data={chartData}>
                  <defs>
                    <linearGradient id={`grad-trends-${cfg.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColor} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={chartColor} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="time"
                    stroke="var(--muted-foreground)"
                    style={{ fontSize: '10px' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    style={{ fontSize: '10px' }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--background)',
                      border: '1px solid var(--foreground)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                    }}
                    labelStyle={{ color: 'var(--muted-foreground)' }}
                    itemStyle={{ color: 'var(--foreground)' }}
                  />
                  <Area
                    type="monotone"
                    dataKey={cfg.key}
                    stroke={chartColor}
                    strokeWidth={2}
                    fill={`url(#grad-trends-${cfg.key})`}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
