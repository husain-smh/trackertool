'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';

interface Tweet {
  tweet_id: string;
  tweet_url: string;
  author_name: string;
  status: string;
  total_engagers: number;
  engagers_above_10k: number;
  engagers_below_10k: number;
  created_at: string;
  analyzed_at?: string;
}

export default function TweetsPage() {
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTweets = useCallback(async (showLoader = true) => {
    if (showLoader) {
      setLoading(true);
    }
    try {
      const res = await fetch('/api/tweets');
      const data = await res.json();
      
      if (data.success) {
        setTweets(data.tweets);
      } else {
        setError(data.error || 'Failed to fetch tweets');
      }
    } catch {
      setError('Failed to fetch tweets');
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchTweets();
  }, [fetchTweets]);

  const hasActiveTweets = useMemo(
    () => tweets.some(t => t.status === 'analyzing' || t.status === 'pending'),
    [tweets]
  );

  useEffect(() => {
    if (!hasActiveTweets) {
      return;
    }

    const interval = setInterval(() => {
      fetchTweets(false);
    }, 10000);

    return () => clearInterval(interval);
  }, [hasActiveTweets, fetchTweets]);

  const getStatusBadge = (status: string) => {
    return (
      <span className="text-sm text-[#6B6B6B]">
        {status}
      </span>
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
            onClick={() => fetchTweets()}
            className="text-[#2B2B2B] underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-[#2B2B2B] font-sans">
      <Navbar />
      
      <main className="relative pt-32 pb-20 px-6">
        <div className="max-w-[800px] mx-auto text-center mb-16">
          <h1 className="text-[2.5rem] leading-[1.3] font-normal mb-6 text-[#2B2B2B]">
            Analyzed Tweets
          </h1>
          <p className="text-[1.125rem] leading-[1.75] text-[#6B6B6B] max-w-[65ch] mx-auto">
            View engagement data.
          </p>
        </div>

        <div className="max-w-[1200px] mx-auto">
          {tweets.length === 0 ? (
            <div className="text-center text-[#6B6B6B]">
              <p>No tweets analyzed yet.</p>
            </div>
          ) : (
            <div className="bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm overflow-hidden shadow-[var(--shadow-card)]">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[#F5F3F0] text-[#6B6B6B] text-sm uppercase tracking-wide border-b border-[#E8E4DF]">
                    <tr>
                      <th className="px-6 py-4 font-normal">Tweet</th>
                      <th className="px-6 py-4 font-normal">Author</th>
                      <th className="px-6 py-4 font-normal">Status</th>
                      <th className="px-6 py-4 font-normal">Engagers</th>
                      <th className="px-6 py-4 font-normal">Created</th>
                      <th className="px-6 py-4 font-normal">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8E4DF]">
                    {tweets.map((tweet) => (
                      <tr key={tweet.tweet_id} className="hover:bg-[#F5F3F0]/50 transition-colors">
                        <td className="px-6 py-4 font-medium text-[#2B2B2B]">
                          {tweet.tweet_id}
                        </td>
                        <td className="px-6 py-4 text-[#2B2B2B]">
                          {tweet.author_name}
                        </td>
                        <td className="px-6 py-4">
                          {getStatusBadge(tweet.status)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-[#2B2B2B]">
                            {tweet.total_engagers} total
                          </div>
                          <div className="text-xs text-[#6B6B6B]">
                            {tweet.engagers_above_10k} &gt;10k
                          </div>
                        </td>
                        <td className="px-6 py-4 text-[#6B6B6B] text-sm">
                          {new Date(tweet.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {tweet.status === 'completed' ? (
                            <Link
                              href={`/tweets/${tweet.tweet_id}`}
                              className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline"
                            >
                              Details
                            </Link>
                          ) : (
                            <span className="text-[#6B6B6B]">Processing...</span>
                          )}
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

