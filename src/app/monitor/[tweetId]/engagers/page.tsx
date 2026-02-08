'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';

interface Engager {
  id: string;
  user_id: string;
  username: string;
  name: string;
  action_type: 'retweet' | 'reply' | 'quote' | 'like';
  followers: number;
  verified: boolean;
  bio?: string;
  location?: string;
  importance_score: number;
  followed_by?: Array<{ username: string; weight: number }>;
  engagement_id?: string;
  engagement_url?: string;
  engagement_text?: string;
  engagement_created_at?: string;
  quote_metrics?: {
    viewCount?: number;
    likeCount?: number;
    retweetCount?: number;
    replyCount?: number;
  };
  first_seen_at: string;
  last_seen_at: string;
  is_deleted: boolean;
  deleted_at?: string;
}

type ActionFilter = 'all' | 'reply' | 'retweet' | 'quote' | 'like';
type SortBy = 'importance' | 'followers' | 'recent';

export default function EngagersPage() {
  const params = useParams();
  const tweetId = params?.tweetId as string;

  const [engagers, setEngagers] = useState<Engager[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('importance');
  const [minImportance, setMinImportance] = useState<number>(0);
  const [showDeleted, setShowDeleted] = useState(false);
  const [total, setTotal] = useState(0);
  const [deletedCount, setDeletedCount] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchEngagers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (actionFilter !== 'all') {
        params.set('action_type', actionFilter);
      }
      if (minImportance > 0) {
        params.set('min_importance', minImportance.toString());
      }
      if (showDeleted) {
        params.set('include_deleted', 'true');
      }
      params.set('sort', sortBy);
      params.set('limit', '100');

      const response = await fetch(`/api/monitor-tweet/${tweetId}/engagers?${params.toString()}`);
      const result = await response.json();

      if (response.ok && result.success) {
        setEngagers(result.engagers);
        setTotal(result.total);
        setDeletedCount(result.deleted_count);
        setError(null);
      } else {
        setError(result.error || 'Failed to fetch engagers');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [tweetId, actionFilter, sortBy, minImportance, showDeleted]);

  useEffect(() => {
    if (tweetId) {
      fetchEngagers();
    }
  }, [tweetId, fetchEngagers]);

  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case 'retweet':
        return '🔄';
      case 'reply':
        return '💬';
      case 'quote':
        return '🔁';
      case 'like':
        return '❤️';
      default:
        return '📝';
    }
  };

  const getActionColor = (actionType: string) => {
    switch (actionType) {
      case 'retweet':
        return 'bg-green-100 text-green-800';
      case 'reply':
        return 'bg-blue-100 text-blue-800';
      case 'quote':
        return 'bg-purple-100 text-purple-800';
      case 'like':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (actionFilter !== 'all') {
        params.set('action_type', actionFilter);
      }
      if (minImportance > 0) {
        params.set('min_importance', minImportance.toString());
      }
      if (showDeleted) {
        params.set('include_deleted', 'true');
      }
      params.set('sort', sortBy);
      params.set('limit', '10000');

      const response = await fetch(`/api/monitor-tweet/${tweetId}/engagers?${params.toString()}`);
      const result = await response.json();

      if (response.ok && result.success) {
        // Convert to CSV
        const headers = ['Username', 'Name', 'Action', 'Followers', 'Importance Score', 'Verified', 'Bio', 'Location', 'First Seen', 'Deleted'];
        const rows = result.engagers.map((e: Engager) => [
          e.username,
          e.name,
          e.action_type,
          e.followers,
          e.importance_score,
          e.verified ? 'Yes' : 'No',
          e.bio?.replace(/"/g, '""') || '',
          e.location || '',
          new Date(e.first_seen_at).toISOString(),
          e.is_deleted ? 'Yes' : 'No',
        ]);

        const csv = [
          headers.join(','),
          ...rows.map((row: (string | number | boolean)[]) => row.map(cell => `"${cell}"`).join(',')),
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `engagers-${tweetId}-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError('Failed to export');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading engagers...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      <div className="relative z-10">
        <div className="pt-24 pb-8">
          <div className="max-w-7xl mx-auto px-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-3xl font-bold text-foreground mb-2">Engagers</h1>
                <p className="text-muted-foreground">
                  All engagement data for tweet {tweetId.slice(0, 10)}...
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleExport}
                  className="bg-card hover:bg-muted border border-border text-foreground font-semibold py-2 px-4 rounded-xl transition-all flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export CSV
                </button>
                <Link
                  href={`/monitor/${tweetId}`}
                  className="bg-card hover:bg-muted border border-border text-foreground font-semibold py-2 px-4 rounded-xl transition-all flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back to Dashboard
                </Link>
              </div>
            </div>

            {/* Error Alert */}
            {error && (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-xl mb-6">
                {error}
                <button onClick={() => setError(null)} className="ml-4 underline">
                  Dismiss
                </button>
              </div>
            )}

            {/* Filters */}
            <div className="card-base p-4 mb-6">
              <div className="flex flex-wrap items-center gap-4">
                {/* Action Type Filter */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Action:</span>
                  <div className="flex gap-1">
                    {(['all', 'reply', 'retweet', 'quote', 'like'] as ActionFilter[]).map((action) => (
                      <button
                        key={action}
                        onClick={() => setActionFilter(action)}
                        className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                          actionFilter === action
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted hover:bg-muted/80 text-foreground'
                        }`}
                      >
                        {action === 'all' ? 'All' : getActionIcon(action)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sort By */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Sort:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortBy)}
                    className="px-3 py-1 rounded-lg bg-muted border border-border text-foreground text-sm"
                  >
                    <option value="importance">Importance</option>
                    <option value="followers">Followers</option>
                    <option value="recent">Recent</option>
                  </select>
                </div>

                {/* Min Importance */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Min Score:</span>
                  <input
                    type="number"
                    value={minImportance}
                    onChange={(e) => setMinImportance(parseInt(e.target.value) || 0)}
                    className="w-16 px-2 py-1 rounded-lg bg-muted border border-border text-foreground text-sm"
                    min="0"
                  />
                </div>

                {/* Show Deleted */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showDeleted}
                    onChange={(e) => setShowDeleted(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-muted-foreground">Show Deleted ({deletedCount})</span>
                </label>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="card-base p-4">
                <p className="text-muted-foreground text-sm">Total Engagers</p>
                <p className="text-2xl font-bold">{total}</p>
              </div>
              <div className="card-base p-4">
                <p className="text-muted-foreground text-sm">Deleted</p>
                <p className="text-2xl font-bold text-gray-500">{deletedCount}</p>
              </div>
              <div className="card-base p-4">
                <p className="text-muted-foreground text-sm">High Importance (5+)</p>
                <p className="text-2xl font-bold text-green-600">
                  {engagers.filter((e) => e.importance_score >= 5).length}
                </p>
              </div>
              <div className="card-base p-4">
                <p className="text-muted-foreground text-sm">Verified</p>
                <p className="text-2xl font-bold text-blue-600">
                  {engagers.filter((e) => e.verified).length}
                </p>
              </div>
            </div>

            {/* Engagers List */}
            {engagers.length === 0 ? (
              <div className="card-base p-12 text-center">
                <p className="text-muted-foreground">No engagers found matching your filters.</p>
              </div>
            ) : (
              <div className="card-base overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted border-b border-border">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">User</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Action</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Followers</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Score</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Followed By</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">First Seen</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {engagers.map((engager) => (
                      <>
                        <tr
                          key={engager.id}
                          className={`hover:bg-muted/50 cursor-pointer ${engager.is_deleted ? 'opacity-50' : ''}`}
                          onClick={() => setExpandedId(expandedId === engager.id ? null : engager.id)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div>
                                <div className="flex items-center gap-1">
                                  <span className="font-medium">{engager.name}</span>
                                  {engager.verified && (
                                    <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                                    </svg>
                                  )}
                                </div>
                                <a
                                  href={`https://x.com/${engager.username}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm text-muted-foreground hover:text-primary"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  @{engager.username}
                                </a>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 text-xs rounded-full ${getActionColor(engager.action_type)}`}>
                              {getActionIcon(engager.action_type)} {engager.action_type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {engager.followers.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-bold ${engager.importance_score >= 5 ? 'text-green-600' : ''}`}>
                              {engager.importance_score}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {engager.followed_by && engager.followed_by.length > 0 ? (
                              <span className="text-sm text-muted-foreground">
                                {engager.followed_by.slice(0, 2).map((f) => f.username).join(', ')}
                                {engager.followed_by.length > 2 && ` +${engager.followed_by.length - 2}`}
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">
                            {new Date(engager.first_seen_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {engager.is_deleted ? (
                              <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full">Deleted</span>
                            ) : (
                              <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">Active</span>
                            )}
                          </td>
                        </tr>
                        {expandedId === engager.id && (
                          <tr>
                            <td colSpan={7} className="px-4 py-4 bg-muted/30">
                              <div className="space-y-3">
                                {engager.bio && (
                                  <div>
                                    <span className="text-sm font-medium text-muted-foreground">Bio:</span>
                                    <p className="text-sm mt-1">{engager.bio}</p>
                                  </div>
                                )}
                                {engager.location && (
                                  <div>
                                    <span className="text-sm font-medium text-muted-foreground">Location:</span>
                                    <p className="text-sm mt-1">{engager.location}</p>
                                  </div>
                                )}
                                {engager.engagement_text && (
                                  <div>
                                    <span className="text-sm font-medium text-muted-foreground">Engagement Text:</span>
                                    <p className="text-sm mt-1 bg-card p-2 rounded">{engager.engagement_text}</p>
                                  </div>
                                )}
                                {engager.engagement_url && (
                                  <div>
                                    <a
                                      href={engager.engagement_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-sm text-primary hover:underline"
                                    >
                                      View Engagement Tweet
                                    </a>
                                  </div>
                                )}
                                {engager.quote_metrics && (
                                  <div>
                                    <span className="text-sm font-medium text-muted-foreground">Quote Metrics:</span>
                                    <div className="flex gap-4 mt-1 text-sm">
                                      <span>{engager.quote_metrics.viewCount?.toLocaleString() || 0} views</span>
                                      <span>{engager.quote_metrics.likeCount?.toLocaleString() || 0} likes</span>
                                      <span>{engager.quote_metrics.retweetCount?.toLocaleString() || 0} RTs</span>
                                    </div>
                                  </div>
                                )}
                                {engager.followed_by && engager.followed_by.length > 0 && (
                                  <div>
                                    <span className="text-sm font-medium text-muted-foreground">Followed By:</span>
                                    <div className="flex flex-wrap gap-2 mt-1">
                                      {engager.followed_by.map((f) => (
                                        <span key={f.username} className="px-2 py-1 text-xs bg-card rounded">
                                          @{f.username} (w:{f.weight})
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
