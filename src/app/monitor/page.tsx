'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';

interface MonitoringJob {
  tweet_id: string;
  tweet_url: string;
  status: 'active' | 'completed';
  started_at: string;
  created_at: string;
  stats: {
    is_active: boolean;
    hours_remaining: number;
    minutes_remaining: number;
    total_snapshots: number;
  };
}

export default function MonitorPage() {
  const [jobs, setJobs] = useState<MonitoringJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tweetUrl, setTweetUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/monitor-tweet');
      const data = await res.json();

      if (data.success) {
        setJobs(data.jobs);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch monitoring jobs');
      }
    } catch {
      setError('Failed to fetch monitoring jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (jobs.some(j => j.stats.is_active)) {
      const interval = setInterval(() => {
        fetchJobs();
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [jobs, fetchJobs]);

  const handleStartMonitoring = async () => {
    const trimmed = tweetUrl.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      const res = await fetch('/api/monitor-tweet/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tweetUrl: trimmed }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSubmitSuccess(`Monitoring started for tweet ${data.tweet_id}`);
        setTweetUrl('');
        fetchJobs();
      } else {
        setSubmitError(data.error || 'Failed to start monitoring');
      }
    } catch {
      setSubmitError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (job: MonitoringJob) => {
    if (job.stats.is_active) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Active
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
        Completed
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans">
        <Navbar />
        <div className="pt-32 flex justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans">
        <Navbar />
        <div className="pt-32 flex flex-col items-center">
          <p className="text-destructive mb-4">{error}</p>
          <button
            onClick={fetchJobs}
            className="text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const activeJobs = jobs.filter(j => j.stats.is_active);
  const completedJobs = jobs.filter(j => !j.stats.is_active);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Navbar />

      <main className="pt-20 pb-12 px-6">
        <div className="max-w-[1200px] mx-auto">
          <div className="mb-7">
            <h1 className="text-2xl font-bold text-foreground mb-1">
              Monitored Tweets
            </h1>
            <p className="text-muted-foreground">
              Track engagement metrics for any tweet over 5 days.
            </p>
          </div>

          {/* Add Tweet URL Input */}
          <div className="bg-card rounded-xl shadow-[var(--shadow-card)] border border-border p-5 mb-6">
            <h2 className="text-base font-semibold text-foreground mb-3">Start Monitoring a Tweet</h2>
            <div className="flex gap-3">
              <input
                type="text"
                value={tweetUrl}
                onChange={(e) => {
                  setTweetUrl(e.target.value);
                  setSubmitError(null);
                  setSubmitSuccess(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !submitting) handleStartMonitoring();
                }}
                placeholder="https://x.com/username/status/1234567890"
                disabled={submitting}
                className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all disabled:opacity-50"
              />
              <button
                onClick={handleStartMonitoring}
                disabled={submitting || !tweetUrl.trim()}
                className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
              >
                {submitting ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    Starting...
                  </>
                ) : (
                  'Start Monitoring'
                )}
              </button>
            </div>
            {submitError && (
              <p className="mt-3 text-sm text-destructive">{submitError}</p>
            )}
            {submitSuccess && (
              <p className="mt-3 text-sm text-emerald-600">{submitSuccess}</p>
            )}
          </div>

          {/* Horizontal Metric Strip */}
          <div className="bg-card rounded-xl shadow-[var(--shadow-card)] border border-border mb-6">
            <div className="flex flex-wrap">
              <div className="flex-1 min-w-[120px] px-5 py-3.5 border-r border-border last:border-r-0">
                <p className="text-xs text-muted-foreground mb-0.5">Total</p>
                <p className="text-xl font-bold text-foreground">{jobs.length}</p>
              </div>
              <div className="flex-1 min-w-[120px] px-5 py-3.5 border-r border-border last:border-r-0">
                <p className="text-xs text-muted-foreground mb-0.5">Active</p>
                <p className="text-xl font-bold text-foreground">{activeJobs.length}</p>
              </div>
              <div className="flex-1 min-w-[120px] px-5 py-3.5">
                <p className="text-xs text-muted-foreground mb-0.5">Completed</p>
                <p className="text-xl font-bold text-foreground">{completedJobs.length}</p>
              </div>
            </div>
          </div>

          {jobs.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <p>No monitoring jobs yet.</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl shadow-[var(--shadow-card)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-muted text-muted-foreground text-xs border-b border-border">
                    <tr>
                      <th className="px-5 py-3 font-medium">Tweet</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">Started</th>
                      <th className="px-5 py-3 font-medium">Time Remaining</th>
                      <th className="px-5 py-3 font-medium">Snapshots</th>
                      <th className="px-5 py-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {jobs.map((job) => (
                      <tr key={job.tweet_id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-5 py-3">
                          <a
                            href={job.tweet_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-foreground hover:text-primary hover:underline font-mono text-xs"
                          >
                            {job.tweet_id}
                          </a>
                        </td>
                        <td className="px-5 py-3">
                          {getStatusBadge(job)}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground text-xs">
                          {new Date(job.started_at).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground text-xs">
                          {job.stats.is_active ? (
                            <span>
                              {job.stats.hours_remaining}h {job.stats.minutes_remaining}m
                            </span>
                          ) : (
                            <span>-</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-foreground text-sm font-medium">
                          {job.stats.total_snapshots}
                        </td>
                        <td className="px-5 py-3 text-xs">
                          <Link
                            href={`/monitor/${job.tweet_id}`}
                            className="text-primary hover:text-primary/80 font-medium hover:underline"
                          >
                            Dashboard
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
