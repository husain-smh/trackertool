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

  const getStatusBadge = (job: MonitoringJob) => {
    if (job.stats.is_active) {
      return (
        <span className="text-[#4A4A4A]">Active</span>
      );
    }
    return (
      <span className="text-[#6B6B6B]">Completed</span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent text-[#2B2B2B] font-sans">
        <Navbar />
        <div className="pt-32 flex justify-center">
          <p className="text-[#6B6B6B]">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-transparent text-[#2B2B2B] font-sans">
        <Navbar />
        <div className="pt-32 flex flex-col items-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={fetchJobs}
            className="text-[#2B2B2B] underline"
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
    <div className="min-h-screen bg-transparent text-[#2B2B2B] font-sans">
      <Navbar />
      
      <main className="relative pt-32 pb-20 px-6">
        <div className="max-w-[800px] mx-auto text-center mb-16">
          <h1 className="text-[2.5rem] leading-[1.3] font-normal mb-6 text-[#2B2B2B]">
            Monitored Tweets
          </h1>
          <p className="text-[1.125rem] leading-[1.75] text-[#6B6B6B] max-w-[65ch] mx-auto">
            View active monitoring jobs.
          </p>
        </div>

        <div className="max-w-[1200px] mx-auto">
          {/* Stats Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            <div className="bg-[#FEFEFE] border border-[#E8E4DF] p-6 rounded-sm">
              <p className="text-[#6B6B6B] text-sm mb-1">Total</p>
              <p className="text-2xl text-[#2B2B2B]">{jobs.length}</p>
            </div>
            <div className="bg-[#FEFEFE] border border-[#E8E4DF] p-6 rounded-sm">
              <p className="text-[#6B6B6B] text-sm mb-1">Active</p>
              <p className="text-2xl text-[#2B2B2B]">{activeJobs.length}</p>
            </div>
            <div className="bg-[#FEFEFE] border border-[#E8E4DF] p-6 rounded-sm">
              <p className="text-[#6B6B6B] text-sm mb-1">Completed</p>
              <p className="text-2xl text-[#2B2B2B]">{completedJobs.length}</p>
            </div>
          </div>

          {jobs.length === 0 ? (
            <div className="text-center text-[#6B6B6B]">
              <p>No monitoring jobs yet.</p>
            </div>
          ) : (
            <div className="bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[#F5F3F0] text-[#6B6B6B] text-sm uppercase tracking-wide border-b border-[#E8E4DF]">
                    <tr>
                      <th className="px-6 py-4 font-normal">Tweet</th>
                      <th className="px-6 py-4 font-normal">Status</th>
                      <th className="px-6 py-4 font-normal">Started</th>
                      <th className="px-6 py-4 font-normal">Time Remaining</th>
                      <th className="px-6 py-4 font-normal">Snapshots</th>
                      <th className="px-6 py-4 font-normal">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8E4DF]">
                    {jobs.map((job) => (
                      <tr key={job.tweet_id} className="hover:bg-[#F5F3F0]/50 transition-colors">
                        <td className="px-6 py-4">
                          <a
                            href={job.tweet_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline"
                          >
                            {job.tweet_id}
                          </a>
                        </td>
                        <td className="px-6 py-4">
                          {getStatusBadge(job)}
                        </td>
                        <td className="px-6 py-4 text-[#6B6B6B] text-sm">
                          {new Date(job.started_at).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-[#6B6B6B] text-sm">
                          {job.stats.is_active ? (
                            <span>
                              {job.stats.hours_remaining}h {job.stats.minutes_remaining}m
                            </span>
                          ) : (
                            <span>-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-[#2B2B2B]">
                          {job.stats.total_snapshots}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <Link
                            href={`/monitor/${job.tweet_id}`}
                            className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline"
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

