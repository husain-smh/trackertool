'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Bell, RefreshCw } from 'lucide-react';
import Navbar from '@/components/Navbar';

type AlertItem = {
  key: string;
  action_type: 'quote' | 'reply' | 'retweet' | 'like';
  user_id: string;
  account: { username: string; name: string; followers: number; verified: boolean };
  engagement_tweet_url?: string;
  engagement_text?: string;
  notification: string | null;
  sentiment: 'positive' | 'neutral' | 'critical' | null;
  importance_score?: number | null;
  llm_generated_at: string | null;
};

export default function TweetAlertsPage() {
  const params = useParams();
  const tweetId = params?.tweetId as string;

  const [tweetUrl, setTweetUrl] = useState<string | null>(null);
  const [items, setItems] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minImportanceScore, setMinImportanceScore] = useState<number>(5);

  // Editing
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [contextualDraftText, setContextualDraftText] = useState<string>('');
  const [sendingContextualKey, setSendingContextualKey] = useState<string | null>(null);

  const [slackTarget, setSlackTarget] = useState<'creative' | 'client'>('creative');
  const [filterScore, setFilterScore] = useState<number>(0);

  const headerLabel = useMemo(() => 'Notifications', []);

  // Filter items by importance score
  const filteredItems = useMemo(() => {
    if (filterScore <= 0) return items;
    return items.filter(item => (item.importance_score ?? 0) >= filterScore);
  }, [items, filterScore]);

  const fetchAlerts = useCallback(async () => {
    if (!tweetId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/tweets/${tweetId}/notifications/contextual?limit=120`, { method: 'GET' });
      const json = await res.json();

      if (!json?.success) {
        setError(json?.error || 'Failed to fetch alerts');
        setItems([]);
        setTweetUrl(null);
        return;
      }

      setItems((json?.data?.items || []) as AlertItem[]);
      setTweetUrl((json?.data?.tweet_url || null) as string | null);
    } catch (e) {
      console.error('Error fetching alerts:', e);
      setError('Failed to fetch alerts');
      setItems([]);
      setTweetUrl(null);
    } finally {
      setLoading(false);
    }
  }, [tweetId]);

  const generateAlerts = useCallback(async () => {
    if (!tweetId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/tweets/${tweetId}/notifications/generate-contextual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minImportanceScore }),
      });
      const json = await res.json();
      if (!json?.success) {
        setError(json?.error || 'Failed to generate alerts');
        return;
      }
      // Re-fetch from DB-backed endpoint so what you see matches what's stored.
      await fetchAlerts();
    } catch (e) {
      console.error('Error generating alerts:', e);
      setError('Failed to generate alerts');
    } finally {
      setGenerating(false);
    }
  }, [tweetId, fetchAlerts, minImportanceScore]);

  const startEditContextual = useCallback((item: AlertItem) => {
    setEditingKey(item.key);
    setContextualDraftText(item.notification || '');
  }, []);

  const cancelEditContextual = useCallback(() => {
    setEditingKey(null);
    setContextualDraftText('');
  }, []);

  const saveContextual = useCallback(async () => {
    if (!tweetId || !editingKey) return;
    setError(null);
    try {
      const res = await fetch(`/api/tweets/${tweetId}/notifications/contextual`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: editingKey, text: contextualDraftText }),
      });
      const json = await res.json();
      if (!json?.success) {
        setError(json?.error || 'Failed to save edit');
        return;
      }
      setEditingKey(null);
      setContextualDraftText('');
      await fetchAlerts();
    } catch (e) {
      console.error('Error saving contextual edit:', e);
      setError('Failed to save edit');
    }
  }, [tweetId, editingKey, contextualDraftText, fetchAlerts]);

  const sendContextualToSlack = useCallback(
    async (key: string) => {
      if (!tweetId) return;
      const item = items.find((i) => i.key === key);
      const text = (editingKey === key ? contextualDraftText : item?.notification) || '';
      if (!text.trim()) {
        setError('Nothing to send: notification text is empty');
        return;
      }

      setSendingContextualKey(key);
      try {
        const res = await fetch(`/api/tweets/${tweetId}/notifications/send-slack`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: slackTarget, text }),
        });
        const json = await res.json();

        if (!json?.success) {
          setError(json?.error || 'Failed to send to Slack');
          return;
        }
      } catch (e) {
        console.error('Error sending contextual Slack message:', e);
        setError('Failed to send to Slack');
      } finally {
        setSendingContextualKey(null);
      }
    },
    [tweetId, items, editingKey, contextualDraftText, slackTarget]
  );

  useEffect(() => {
    void fetchAlerts();
  }, [fetchAlerts]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      <div className="relative z-10 pt-24 pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                <h1 className="text-2xl font-bold text-foreground truncate">{headerLabel}</h1>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                <Link href={`/tweets/${tweetId}`} className="text-primary hover:underline underline-offset-4">
                  Back to tweet analysis
                </Link>
                {tweetUrl ? (
                  <a
                    href={tweetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline underline-offset-4"
                  >
                    View original tweet →
                  </a>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm">
                <span className="text-muted-foreground">Min importance</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={minImportanceScore}
                  onChange={(e) => setMinImportanceScore(Number(e.target.value))}
                  className="w-16 px-2 py-1 bg-background border border-input rounded-md text-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none"
                  aria-label="Minimum importance score"
                />
                <span className="text-muted-foreground">&nbsp;(generates for &gt; this)</span>
              </div>
              <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm">
                <span className="text-muted-foreground">Filter</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={filterScore}
                  onChange={(e) => setFilterScore(Number(e.target.value))}
                  className="w-16 px-2 py-1 bg-background border border-input rounded-md text-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none"
                  aria-label="Filter by importance score"
                />
                <span className="text-muted-foreground">&nbsp;(show &ge; this)</span>
              </div>
              <select
                value={slackTarget}
                onChange={(e) => setSlackTarget(e.target.value as 'creative' | 'client')}
                className="px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none transition-all text-sm"
                aria-label="Slack target"
              >
                <option value="creative">Slack: Creative</option>
                <option value="client">Slack: Client</option>
              </select>
              <button
                type="button"
                onClick={fetchAlerts}
                disabled={loading || !tweetId}
                className="px-3 py-2 rounded-lg border border-border bg-background text-foreground hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium inline-flex items-center gap-2"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <button
                type="button"
                onClick={generateAlerts}
                disabled={generating || !tweetId}
                className="px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                title="Generate contextual notifications"
              >
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-6 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
              {error}
            </div>
          ) : null}

          <div className="mt-6 card-base p-6">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : items.length === 0 ? (
              <div className="text-sm text-muted-foreground">No notifications yet.</div>
            ) : filteredItems.length === 0 ? (
              <div className="text-sm text-muted-foreground">No notifications match the filter (score &ge; {filterScore}).</div>
            ) : (
              <div className="space-y-3">
                {filteredItems.map((item) => (
                  <div key={item.key} className="border border-border rounded-lg bg-muted/10 p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        {/* Header with name, username, action type, and importance score */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-sm font-semibold text-foreground">
                            {item.account.name}{' '}
                            <span className="text-muted-foreground">@{item.account.username}</span>{' '}
                            <span className="text-xs uppercase text-muted-foreground ml-1">
                              {item.action_type}
                            </span>
                          </div>
                          {typeof item.importance_score === 'number' && (
                            <span className="bg-[#2B2B2B] text-white px-2 py-0.5 rounded text-xs font-mono">
                              Score: {item.importance_score.toFixed(1)}
                            </span>
                          )}
                        </div>

                        {/* Engagement text (the original quote/reply content) */}
                        {item.engagement_text && (
                          <div className="mt-2 p-2 bg-muted/20 border-l-2 border-[#6B6B6B] text-sm italic text-foreground/80">
                            &ldquo;{item.engagement_text}&rdquo;
                          </div>
                        )}

                        {/* Notification text (editable) */}
                        {editingKey === item.key ? (
                          <div className="mt-2">
                            <textarea
                              value={contextualDraftText}
                              onChange={(e) => setContextualDraftText(e.target.value)}
                              rows={4}
                              className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground placeholder-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none transition-all text-sm"
                            />
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={saveContextual}
                                className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditContextual}
                                className="px-3 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground hover:bg-muted/40 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => void sendContextualToSlack(item.key)}
                                disabled={sendingContextualKey === item.key}
                                className="ml-auto px-3 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                title={`Send to Slack (${slackTarget})`}
                              >
                                {sendingContextualKey === item.key ? 'Sending…' : 'Send to Slack'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 text-sm text-foreground/90 whitespace-pre-wrap">{item.notification || '—'}</div>
                        )}

                        {/* Actions and links */}
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                          {item.engagement_tweet_url && (
                            <a
                              href={item.engagement_tweet_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline underline-offset-4"
                            >
                              View on X →
                            </a>
                          )}
                          {!item.engagement_tweet_url && tweetUrl && (
                            <a
                              href={tweetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline underline-offset-4"
                            >
                              View tweet →
                            </a>
                          )}
                          <span className="text-muted-foreground">
                            {item.account.followers.toLocaleString()} followers
                          </span>
                        </div>
                      </div>

                      {editingKey !== item.key ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEditContextual(item)}
                            className="px-3 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground hover:bg-muted/40 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void sendContextualToSlack(item.key)}
                            disabled={sendingContextualKey === item.key}
                            className="px-3 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title={`Send to Slack (${slackTarget})`}
                          >
                            {sendingContextualKey === item.key ? 'Sending…' : 'Send to Slack'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

