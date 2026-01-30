'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';

interface ClientWithNotifications {
  x_username: string;
  display_name: string;
  total_notifications: number;
  tweets_with_notifications: number;
}

interface TweetWithNotifications {
  tweet_id: string;
  tweet_url: string;
  notification_count: number;
  created_at: string;
}

export default function NotificationsPage() {
  const [clients, setClients] = useState<ClientWithNotifications[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [clientTweets, setClientTweets] = useState<Record<string, TweetWithNotifications[]>>({});
  const [loadingTweets, setLoadingTweets] = useState<string | null>(null);

  const fetchClients = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/notifications/by-client');
      const json = await res.json();

      if (json.success) {
        setClients(json.data || []);
        setError(null);
      } else {
        setError(json.error || 'Failed to fetch clients');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchClientTweets = useCallback(async (username: string) => {
    if (clientTweets[username]) {
      // Already fetched
      return;
    }

    setLoadingTweets(username);
    try {
      const res = await fetch(`/api/notifications/by-client/${encodeURIComponent(username)}`);
      const json = await res.json();

      if (json.success) {
        setClientTweets(prev => ({
          ...prev,
          [username]: json.data?.tweets || [],
        }));
      }
    } catch {
      // Silent fail - will just show no tweets
    } finally {
      setLoadingTweets(null);
    }
  }, [clientTweets]);

  const toggleClient = useCallback((username: string) => {
    if (expandedClient === username) {
      setExpandedClient(null);
    } else {
      setExpandedClient(username);
      fetchClientTweets(username);
    }
  }, [expandedClient, fetchClientTweets]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatCompact = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  return (
    <div className="min-h-screen bg-[#F2F0E9] text-[#1a1a1a]">
      <Navbar />

      <div className="pt-24 pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-12 border-b-2 border-[#1a1a1a] pb-6">
            <h1 className="text-4xl font-bold text-[#1a1a1a] mb-2">Notifications</h1>
            <p className="text-[#6B6B6B]">Review engagement alerts for your clients</p>
          </div>

          {error && (
            <div className="mb-6 p-4 border border-red-300 bg-red-50 text-red-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-center py-12">
              <div className="font-mono text-sm text-[#6B6B6B] animate-pulse">
                LOADING CLIENTS...
              </div>
            </div>
          ) : clients.length === 0 ? (
            <div className="text-center py-12 border border-[#E8E4DF] bg-white">
              <p className="text-[#6B6B6B] mb-4">No notifications found.</p>
              <p className="text-sm text-[#A0A0A0]">
                Generate notifications from tweet analysis pages to see them here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {clients.map(client => (
                <div
                  key={client.x_username}
                  className="border border-[#E8E4DF] bg-white"
                >
                  {/* Client Row */}
                  <button
                    onClick={() => toggleClient(client.x_username)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-[#F5F3F0] transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-[#1a1a1a]">
                        {client.display_name}
                      </div>
                      <div className="text-sm text-[#6B6B6B]">
                        @{client.x_username}
                      </div>
                      <div className="text-xs text-[#A0A0A0] mt-1">
                        {client.tweets_with_notifications} tweet{client.tweets_with_notifications !== 1 ? 's' : ''} with notifications
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-2xl font-bold text-[#1a1a1a] tabular-nums">
                          {formatCompact(client.total_notifications)}
                        </div>
                        <div className="text-xs text-[#6B6B6B]">notifications</div>
                      </div>
                      <span className="font-mono text-[#6B6B6B]">
                        {expandedClient === client.x_username ? '▼' : '▶'}
                      </span>
                    </div>
                  </button>

                  {/* Expanded Tweets List */}
                  {expandedClient === client.x_username && (
                    <div className="border-t border-[#E8E4DF]">
                      {loadingTweets === client.x_username ? (
                        <div className="p-4 text-center text-sm text-[#6B6B6B]">
                          Loading tweets...
                        </div>
                      ) : (clientTweets[client.x_username] || []).length === 0 ? (
                        <div className="p-4 text-center text-sm text-[#6B6B6B]">
                          No tweets with notifications found.
                        </div>
                      ) : (
                        <div className="divide-y divide-[#E8E4DF]">
                          {(clientTweets[client.x_username] || []).map(tweet => (
                            <div
                              key={tweet.tweet_id}
                              className="p-4 pl-8 flex items-center justify-between hover:bg-[#F5F3F0] transition-colors"
                            >
                              <div>
                                <div className="font-mono text-sm text-[#1a1a1a]">
                                  ...{tweet.tweet_id.slice(-8)}
                                </div>
                                <div className="text-xs text-[#6B6B6B] mt-1">
                                  Posted: {formatDate(tweet.created_at)}
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <div className="font-bold text-[#1a1a1a] tabular-nums">
                                    {formatCompact(tweet.notification_count)}
                                  </div>
                                  <div className="text-xs text-[#6B6B6B]">alerts</div>
                                </div>
                                <Link
                                  href={`/tweet/${tweet.tweet_id}/alerts`}
                                  className="font-mono text-xs text-[#2F6FED] hover:underline"
                                >
                                  View alerts →
                                </Link>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
