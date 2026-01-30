'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface AlertEngagementProfile {
  username: string;
  name: string;
  followers: number;
  verified: boolean;
}

interface AlertEngagement {
  _id: string;
  action_type: 'retweet' | 'reply' | 'quote';
  timestamp: string;
  importance_score: number;
  tweet_id: string; // Original tweet being engaged with
  engagement_tweet_id?: string; // ID of the actual quote/reply tweet
  account_profile: AlertEngagementProfile;
  account_categories: string[];
}

interface AlertItem {
  _id: string;
  campaign_id: string;
  engagement_id: string;
  user_id: string;
  action_type: 'retweet' | 'reply' | 'quote';
  importance_score: number;
  run_batch: string;
  scheduled_send_time: string;
  status: 'pending' | 'sent' | 'skipped';
  sent_at: string | null;
  created_at: string;
  engagement: AlertEngagement | null;
  llm_copy?: string | null;
  llm_sentiment?: 'positive' | 'neutral' | 'critical' | null;
  llm_group_parent_id?: string | null;
}

interface AlertHistoryItem {
  _id: string;
  campaign_id: string;
  user_id: string;
  action_type: 'retweet' | 'reply' | 'quote';
  timestamp_hour: string;
  sent_at: string;
  channel: 'slack' | 'email';
}

interface AlertsApiResponse {
  alerts: AlertItem[];
  history: AlertHistoryItem[];
}

export default function CampaignAlertsPage() {
  const params = useParams();
  const campaignId = params.id as string;

  const [data, setData] = useState<AlertsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingAlertId, setSendingAlertId] = useState<string | null>(null);
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<'all' | 'retweet' | 'reply' | 'quote'>('all');
  const [dedupeLoading, setDedupeLoading] = useState(false);
  const [backfillLoading, setBackfillLoading] = useState(false);

  const fetchAlerts = useCallback(async () => {
    if (!campaignId) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/socap/campaigns/${campaignId}/alerts`);
      const result = await response.json();

      if (result.success) {
        setData(result.data);
      } else {
        setError(result.error || 'Failed to load alerts');
      }
    } catch (err) {
      console.error('Error loading alerts:', err);
      setError('Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  async function handleSendSlack(alertId: string) {
    try {
      setSendingAlertId(alertId);
      const response = await fetch('/api/socap/alerts/send-slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId }),
      });

      const result = await response.json();

      if (!result.success) {
        alert(`Failed to generate Slack preview: ${result.error || 'Unknown error'}`);
        return;
      }

      alert('Slack notification preview generated. Check server logs for full payload.');
    } catch (err) {
      console.error('Error sending Slack preview:', err);
      alert('Failed to generate Slack preview');
    } finally {
      setSendingAlertId(null);
    }
  }

  async function handleDeduplicate() {
    if (!campaignId) return;
    try {
      setDedupeLoading(true);
      const response = await fetch(
        `/api/socap/campaigns/${campaignId}/alerts/dedupe`,
        { method: 'POST' }
      );
      const result = await response.json();

      if (!result.success) {
        alert(`Failed to deduplicate alerts: ${result.error || 'Unknown error'}`);
        return;
      }

      await fetchAlerts();
      alert(
        `Deduplication complete. Kept ${result.data?.kept ?? 0}, deleted ${
          result.data?.deleted ?? 0
        }.`
      );
    } catch (err) {
      console.error('Error deduplicating alerts:', err);
      alert('Failed to deduplicate alerts');
    } finally {
      setDedupeLoading(false);
    }
  }

  async function handleBackfillLlm() {
    if (!campaignId) return;
    try {
      setBackfillLoading(true);
      const response = await fetch(
        `/api/socap/campaigns/${campaignId}/alerts/backfill-llm`,
        { method: 'POST' }
      );
      const result = await response.json();

      if (!result.success) {
        alert(`Failed to backfill LLM notifications: ${result.error || 'Unknown error'}`);
        return;
      }

      await fetchAlerts();
      alert(
        result.message ||
        `Backfill complete. Processed ${result.data?.processed ?? 0} alerts, generated ${
          result.data?.generated ?? 0
        } notifications.`
      );
    } catch (err) {
      console.error('Error backfilling LLM notifications:', err);
      alert('Failed to backfill LLM notifications');
    } finally {
      setBackfillLoading(false);
    }
  }

  function formatDate(value: string | null | undefined) {
    if (!value) return '-';
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }

  function humanActionLabel(action: AlertItem['action_type']) {
    if (action === 'retweet') return 'Retweeted';
    if (action === 'reply') return 'Replied';
    if (action === 'quote') return 'Quote-tweeted';
    return action;
  }

  function buildEngagementUrl(engagement: AlertEngagement | null): string | null {
    if (!engagement) return null;

    const username = engagement.account_profile.username;
    if (!username) return null;

    // For quotes and replies, link to the actual engagement tweet if we have the ID
    if ((engagement.action_type === 'quote' || engagement.action_type === 'reply') && engagement.engagement_tweet_id) {
      return `https://twitter.com/${username}/status/${engagement.engagement_tweet_id}`;
    }

    // For retweets, link to the original tweet (retweets don't have their own tweet ID)
    if (engagement.action_type === 'retweet' && engagement.tweet_id) {
      return `https://twitter.com/i/status/${engagement.tweet_id}`;
    }

    // Fallback: link to user's profile
    return `https://twitter.com/${username}`;
  }

  function buildOriginalTweetUrl(engagement: AlertEngagement | null): string | null {
    if (!engagement || !engagement.tweet_id) return null;
    return `https://twitter.com/i/status/${engagement.tweet_id}`;
  }

  function buildNotificationPreview(alert: AlertItem): string | null {
    const engagement = alert.engagement;
    if (!engagement) return null;

    const profile = engagement.account_profile;
    const name = profile.name || profile.username || 'Someone';
    const username = profile.username || '';

    const actionText =
      alert.action_type === 'retweet'
        ? 'retweeted'
        : alert.action_type === 'reply'
        ? 'replied to'
        : alert.action_type === 'quote'
        ? 'quote-tweeted'
        : 'engaged with';

    // Client-facing preview: no importance score
    return `${name}${username ? ` (@${username})` : ''} ${actionText} your post.`;
  }

  function resolveNotificationDetails(alert: AlertItem) {
    if (!data) {
      return { text: null as string | null, sentiment: null as AlertItem['llm_sentiment'] };
    }

    const parent: AlertItem | undefined = alert.llm_group_parent_id
      ? data.alerts.find((candidate) => candidate._id === alert.llm_group_parent_id)
      : undefined;

    return {
      text: alert.llm_copy || parent?.llm_copy || null,
      sentiment: alert.llm_sentiment || parent?.llm_sentiment || null,
      isGrouped: Boolean(alert.llm_group_parent_id),
    };
  }

  function renderSentimentBadge(sentiment: AlertItem['llm_sentiment']) {
    if (!sentiment) return null;

    const styles: Record<NonNullable<AlertItem['llm_sentiment']>, string> = {
      positive: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
      neutral: 'bg-muted/40 text-muted-foreground border border-border',
      critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
    };

    return (
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${styles[sentiment]}`}>
        {sentiment.toUpperCase()}
      </span>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-5rem)] py-24">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-2 border-border border-t-transparent mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading alerts...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-5rem)] py-24">
          <div className="text-center">
            <p className="text-destructive text-lg">{error}</p>
            <Link href={`/socap/campaigns/${campaignId}`} className="mt-4 inline-block text-[#2F6FED] hover:underline underline-offset-4">
              Back to Campaign
            </Link>
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
            <p className="text-muted-foreground text-lg">No alert data available for this campaign.</p>
            <Link href={`/socap/campaigns/${campaignId}`} className="mt-4 inline-block text-[#2F6FED] hover:underline underline-offset-4">
              Back to Campaign
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const pendingAlerts = data.alerts.filter((a) => a.status === 'pending');
  const sentOrSkippedAlerts = data.alerts.filter((a) => a.status !== 'pending');

  const filterByAction = (alert: AlertItem) =>
    actionFilter === 'all' || alert.action_type === actionFilter;

  const pendingAlertsFilteredAndSorted = pendingAlerts
    .filter(filterByAction)
    .slice()
    .sort((a, b) => b.importance_score - a.importance_score);

  const sentOrSkippedAlertsFilteredAndSorted = sentOrSkippedAlerts
    .filter(filterByAction)
    .slice()
    .sort((a, b) => b.importance_score - a.importance_score);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative z-10">
        {/* Header Section */}
        <div className="pt-6 pb-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Link href={`/socap/campaigns/${campaignId}`} className="inline-flex items-center gap-2 text-[#2F6FED] hover:underline underline-offset-4 text-sm mb-6 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Campaign Dashboard
            </Link>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 space-y-8">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex flex-col gap-3">
                <div>
                  <h1 className="text-2xl font-normal text-foreground mb-2">Campaign Alerts</h1>
                  <p className="text-sm text-muted-foreground">
                    Visualize how notifications are formed, when they are generated, and how they are spaced.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Filter by type:</span>
                  <select
                    value={actionFilter}
                    onChange={(e) =>
                      setActionFilter(e.target.value as 'all' | 'retweet' | 'reply' | 'quote')
                    }
                    className="px-3 py-2 text-sm rounded-sm border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
                  >
                    <option value="all">All notifications</option>
                    <option value="retweet">Retweet notifications</option>
                    <option value="reply">Reply notifications</option>
                    <option value="quote">Quote tweet notifications</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleBackfillLlm}
                  disabled={backfillLoading}
                  className="px-3 py-1.5 text-xs border border-border text-foreground bg-card hover:bg-muted/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm transition-colors"
                >
                  {backfillLoading ? 'Backfilling...' : 'Generate LLM Notifications'}
                </button>
                <button
                  type="button"
                  onClick={handleDeduplicate}
                  disabled={dedupeLoading}
                  className="px-3 py-1.5 text-xs bg-card border border-border text-foreground rounded-sm hover:bg-muted/30 disabled:opacity-50 transition-colors"
                >
                  {dedupeLoading ? 'Deduplicating...' : 'Deduplicate Alerts'}
                </button>
              </div>
            </div>
          </div>

          {/* Pending alerts (not yet sent) */}
          <section>
            <div className="glass rounded-sm p-6 mb-6">
              <h2 className="text-xl font-normal text-foreground mb-2">Pending Alerts (Queued Notifications)</h2>
              <p className="text-sm text-muted-foreground">
                These alerts have been generated but not yet processed by the sender. Each card shows:
                the high-importance engager, when the alert was generated, and when it is scheduled to be sent.
              </p>
            </div>

            {pendingAlertsFilteredAndSorted.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">No pending alerts for this campaign.</div>
            ) : (
              <div className="space-y-4">
                {pendingAlertsFilteredAndSorted.map((alert) => {
                  const engagement = alert.engagement;
                  const { text: llmCopy, sentiment, isGrouped } = resolveNotificationDetails(alert);
                  const preview = llmCopy || buildNotificationPreview(alert);
                  return (
                    <div
                      key={alert._id}
                      className="glass rounded-sm p-6 flex flex-col justify-between transition-all hover:border-border"
                    >
                      <div>
                        <div className="text-xs uppercase text-muted-foreground mb-3">
                          {humanActionLabel(alert.action_type)} • Importance{' '}
                          <span className="text-emerald-400 font-bold">{alert.importance_score}</span>
                        </div>
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <div className="text-lg text-foreground flex items-center gap-2">
                              {engagement
                                ? `@${engagement.account_profile.username}`
                                : 'Unknown account'}
                              {engagement?.account_profile.verified && (
                                <svg
                                  className="w-4 h-4 text-[#2F6FED]"
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
                            {engagement && (
                              <div className="text-sm text-muted-foreground mt-1">
                                {engagement.account_profile.name}
                              </div>
                            )}
                          </div>
                          {engagement && (
                            <div className="text-right text-sm">
                              <div className="text-foreground">{engagement.account_profile.followers.toLocaleString()} followers</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                Categories: {engagement.account_categories.join(', ') || 'N/A'}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="mt-4 space-y-3">
                          {preview && (
                            <div className="bg-muted/30 rounded-sm p-4 border border-border">
                              <div className="text-sm text-foreground mb-2 flex items-center gap-2">
                                Notification{' '}
                                {renderSentimentBadge(sentiment)}
                              </div>
                              <div className="text-base text-foreground">
                                {preview}
                              </div>
                              {isGrouped && (
                                <div className="text-xs text-muted-foreground mt-2">
                                  Bundled with another quote highlight.
                                </div>
                              )}
                            </div>
                          )}
                          {engagement && (
                            <div className="space-y-2">
                              <div className="text-xs text-muted-foreground">
                                {humanActionLabel(alert.action_type)} your post{' '}
                                {engagement.tweet_id && (
                                  <span className="font-mono text-[11px] text-foreground">
                                    (Tweet ID: {engagement.tweet_id})
                                  </span>
                                )}
                              </div>
                              {/* Link to the engagement (quote/reply/retweet) */}
                              {buildEngagementUrl(engagement) && (
                                <a
                                  href={buildEngagementUrl(engagement)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-sm text-[#2F6FED] hover:underline underline-offset-4 transition-colors"
                                >
                                  <span>
                                    {engagement.action_type === 'quote' && 'View quote tweet'}
                                    {engagement.action_type === 'reply' && 'View reply'}
                                    {engagement.action_type === 'retweet' && 'View original tweet'}
                                  </span>
                                  <svg
                                    className="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                    />
                                  </svg>
                                </a>
                              )}
                              {/* Link to the original code tweet */}
                              {buildOriginalTweetUrl(engagement) && (
                                <div>
                                  <a
                                    href={buildOriginalTweetUrl(engagement)!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-4 transition-colors"
                                  >
                                    <span>View original tweet (ID: {engagement.tweet_id})</span>
                                    <svg
                                      className="w-4 h-4"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                      />
                                    </svg>
                                  </a>
                                </div>
                              )}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedAlertId((current) =>
                                current === alert._id ? null : alert._id
                              )
                            }
                            className="mt-2 text-xs text-[#2F6FED] hover:underline underline-offset-4 transition-colors"
                          >
                            {expandedAlertId === alert._id ? 'Hide details' : 'Show details'}
                          </button>
                          {expandedAlertId === alert._id && (
                            <div className="mt-3 space-y-2 border-t border-border pt-3">
                              <div>
                                <span className="text-foreground">Code Tweet ID:</span>{' '}
                                <span className="text-muted-foreground font-mono text-xs">
                                  {engagement?.tweet_id || '-'}
                                </span>
                                {engagement?.tweet_id && (
                                  <a
                                    href={buildOriginalTweetUrl(engagement)!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-2 text-[#2F6FED] hover:underline underline-offset-4 text-xs transition-colors"
                                  >
                                    (view)
                                  </a>
                                )}
                              </div>
                              {engagement?.engagement_tweet_id && (
                                <div>
                                  <span className="text-foreground">
                                    {engagement.action_type === 'quote' ? 'Quote Tweet ID' : 'Reply Tweet ID'}:
                                  </span>{' '}
                                  <span className="text-muted-foreground font-mono text-xs">
                                    {engagement.engagement_tweet_id}
                                  </span>
                                  {buildEngagementUrl(engagement) && (
                                    <a
                                      href={buildEngagementUrl(engagement)!}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="ml-2 text-[#2F6FED] hover:underline underline-offset-4 text-xs transition-colors"
                                    >
                                      (view)
                                    </a>
                                  )}
                                </div>
                              )}
                              <div>
                                <span className="text-foreground">Engagement Time:</span>{' '}
                                <span className="text-muted-foreground">
                                  {engagement ? formatDate(engagement.timestamp) : '-'}
                                </span>
                              </div>
                              <div>
                                <span className="text-foreground">Notification Generated At:</span>{' '}
                                <span className="text-muted-foreground">{formatDate(alert.created_at)}</span>
                              </div>
                              <div>
                                <span className="text-foreground">Scheduled Send Time:</span>{' '}
                                <span className="text-muted-foreground">{formatDate(alert.scheduled_send_time)}</span>
                              </div>
                              <div>
                                <span className="text-foreground">Run Batch:</span>{' '}
                                <span className="text-muted-foreground">{formatDate(alert.run_batch)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between pt-4 border-t border-border">
                        <div className="text-xs">
                          Status: <span className="font-semibold text-yellow-400">Pending</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSendSlack(alert._id)}
                          disabled={sendingAlertId === alert._id}
                          className="px-3 py-1.5 text-sm rounded-sm border border-border bg-card text-foreground hover:bg-muted/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {sendingAlertId === alert._id ? 'Previewing…' : 'Send on Slack (Preview)'}
                        </button>
                      </div>
                    </div>
                  );
                })}
          </div>
        )}
      </section>

          {/* Already processed alerts from queue */}
          <section>
            <div className="glass rounded-sm p-6 mb-6">
              <h2 className="text-xl font-normal text-foreground mb-2">Processed Alerts (From Queue)</h2>
              <p className="text-sm text-muted-foreground">
                These alerts were generated earlier and have already been marked as sent or skipped by the
                sender process. Useful to understand historical spacing and generation times.
              </p>
            </div>

            {sentOrSkippedAlertsFilteredAndSorted.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">No processed alerts in the queue for this campaign.</div>
            ) : (
              <div className="space-y-2">
                {sentOrSkippedAlertsFilteredAndSorted.map((alert) => (
                  <div
                    key={alert._id}
                    className="glass rounded-sm p-4 flex items-center justify-between transition-all hover:border-border"
                  >
                    <div>
                      <div className="text-foreground">
                        {humanActionLabel(alert.action_type)} • Importance{' '}
                        <span className="text-emerald-400">{alert.importance_score}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Generated: {formatDate(alert.created_at)} • Scheduled:{' '}
                        {formatDate(alert.scheduled_send_time)} • Sent:{' '}
                        {formatDate(alert.sent_at)}
                      </div>
                    </div>
                    <div className="text-xs font-semibold">
                      {alert.status === 'sent' && <span className="text-emerald-400">Sent</span>}
                      {alert.status === 'skipped' && <span className="text-muted-foreground">Skipped</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Alert history (dedup + channels) */}
          <section>
            <div className="glass rounded-sm p-6 mb-6">
              <h2 className="text-xl font-normal text-foreground mb-2">Alert History (Per Channel)</h2>
              <p className="text-sm text-muted-foreground">
                This is the canonical history used for deduplication. It shows, per channel, when alerts
                were actually sent to the outside world.
              </p>
            </div>

            {data.history.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">No alert history for this campaign yet.</div>
            ) : (
              <div className="glass rounded-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">User ID</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Channel</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hour Bucket</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sent At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.history.map((item) => (
                        <tr key={item._id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-6 py-4 font-mono text-xs text-foreground">
                            {item.user_id}
                          </td>
                          <td className="px-6 py-4 text-foreground">{humanActionLabel(item.action_type)}</td>
                          <td className="px-6 py-4 text-foreground capitalize">{item.channel}</td>
                          <td className="px-6 py-4 text-xs text-muted-foreground">
                            {formatDate(item.timestamp_hour)}
                          </td>
                          <td className="px-6 py-4 text-xs text-muted-foreground">
                            {formatDate(item.sent_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}


