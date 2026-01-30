'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface CampaignData {
  campaign: any;
  tweets?: Array<{
    tweet_id: string;
    category: 'main_twt' | 'influencer_twt' | 'investor_twt';
    author_username: string;
    metrics?: {
      likeCount: number;
      retweetCount: number;
      quoteCount: number;
      replyCount: number;
      viewCount: number;
    };
  }>;
}

type TweetCategory = 'main_twt' | 'influencer_twt' | 'investor_twt';

const CATEGORY_LABELS: Record<TweetCategory, string> = {
  main_twt: 'Main Tweet',
  influencer_twt: 'Influencer Tweet',
  investor_twt: 'Investor Tweet',
};

const CATEGORY_COLORS: Record<TweetCategory, string> = {
  // Design v2 pastel tabs
  main_twt: 'bg-[#F5D98E]/60 text-foreground border-border',
  influencer_twt: 'bg-[#FFB3BA]/60 text-foreground border-border',
  investor_twt: 'bg-[#B8E6C9]/60 text-foreground border-border',
};

export default function EditCampaignPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;
  const [data, setData] = useState<CampaignData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state for alert preferences
  const [settingsForm, setSettingsForm] = useState({
    importance_threshold: 10,
    alert_spacing_minutes: 20,
    frequency_window_minutes: 30,
    channels: ['email'] as string[],
  });

  // Form state for new tweets to add
  const [newTweets, setNewTweets] = useState<{
    maintweets_raw: string;
    influencer_twts_raw: string;
    investor_twts_raw: string;
  }>({
    maintweets_raw: '',
    influencer_twts_raw: '',
    investor_twts_raw: '',
  });

  const fetchCampaignData = useCallback(async () => {
    try {
      const response = await fetch(`/api/socap/campaigns/${campaignId}/dashboard`);
      const result = await response.json();
      
      if (result.success) {
        setData(result.data);
        // Initialize settings form from campaign data
        if (result.data.campaign?.alert_preferences) {
          setSettingsForm({
            importance_threshold: result.data.campaign.alert_preferences.importance_threshold || 10,
            alert_spacing_minutes: result.data.campaign.alert_preferences.alert_spacing_minutes || 20,
            frequency_window_minutes: result.data.campaign.alert_preferences.frequency_window_minutes || 30,
            channels: result.data.campaign.alert_preferences.channels || ['email'],
          });
        }
      }
    } catch (error) {
      console.error('Error fetching campaign data:', error);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    fetchCampaignData();
  }, [fetchCampaignData]);

  function handleSettingsChange(field: keyof typeof settingsForm, value: any) {
    setSettingsForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleChannel(channel: string) {
    setSettingsForm((prev) => ({
      ...prev,
      channels: prev.channels.includes(channel)
        ? prev.channels.filter((c: string) => c !== channel)
        : [...prev.channels, channel],
    }));
  }

  /**
   * Extract tweet URLs from a free-form textarea string.
   */
  function extractTweetUrls(input: string): string[] {
    if (!input) return [];

    const matches = input.match(/https?:\/\/\S+/g) || [];

    return matches
      .map((raw) => {
        let url = raw.trim();
        url = url.replace(/[),;]+$/g, '');
        return url;
      })
      .filter((url) => url.length > 0);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      // Get existing tweet URLs
      const existingTweets = {
        main_twt: [] as string[],
        influencer_twt: [] as string[],
        investor_twt: [] as string[],
      };

      if (data?.tweets) {
        for (const tweet of data.tweets) {
          const url = `https://x.com/${tweet.author_username}/status/${tweet.tweet_id}`;
          existingTweets[tweet.category].push(url);
        }
      }

      // Extract new tweet URLs from form
      const newMainTweets = extractTweetUrls(newTweets.maintweets_raw);
      const newInfluencerTweets = extractTweetUrls(newTweets.influencer_twts_raw);
      const newInvestorTweets = extractTweetUrls(newTweets.investor_twts_raw);

      // Combine existing and new tweets
      const allMainTweets = [
        ...existingTweets.main_twt,
        ...newMainTweets,
      ].map((url) => ({ url }));

      const allInfluencerTweets = [
        ...existingTweets.influencer_twt,
        ...newInfluencerTweets,
      ].map((url) => ({ url }));

      const allInvestorTweets = [
        ...existingTweets.investor_twt,
        ...newInvestorTweets,
      ].map((url) => ({ url }));

      const totalUrls =
        allMainTweets.length + allInfluencerTweets.length + allInvestorTweets.length;

      if (totalUrls === 0) {
        alert('Please add at least one tweet URL before updating the campaign.');
        setSaving(false);
        return;
      }

      // Update campaign
      const response = await fetch(`/api/socap/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alert_preferences: settingsForm,
          maintweets: allMainTweets,
          influencer_twts: allInfluencerTweets,
          investor_twts: allInvestorTweets,
        }),
      });

      const result = await response.json();

      if (result.success) {
        alert('Campaign updated successfully');
        router.push(`/socap/campaigns/${campaignId}`);
      } else {
        alert(`Failed to update: ${result.error}`);
      }
    } catch (error) {
      console.error('Error updating campaign:', error);
      alert('Failed to update campaign');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-5rem)] py-24">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-2 border-border border-t-transparent mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading campaign...</p>
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
            <p className="text-destructive text-lg">Campaign not found</p>
            <Link href="/socap" className="mt-4 inline-block text-[#2F6FED] hover:underline underline-offset-4 transition-colors">
              Back to Campaigns
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Group tweets by category
  const tweetsByCategory = {
    main_twt: data.tweets?.filter((t) => t.category === 'main_twt') || [],
    influencer_twt: data.tweets?.filter((t) => t.category === 'influencer_twt') || [],
    investor_twt: data.tweets?.filter((t) => t.category === 'investor_twt') || [],
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative z-10">
        <div className="pt-6 pb-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Link 
              href={`/socap/campaigns/${campaignId}`} 
              className="inline-flex items-center gap-2 text-[#2F6FED] hover:underline underline-offset-4 text-sm mb-6 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Campaign
            </Link>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
          {/* Header */}
          <div className="glass rounded-sm p-6 mb-6">
            <h1 className="text-[2.5rem] leading-[1.3] font-normal text-foreground mb-2">
              Edit Campaign: {data.campaign.launch_name}
            </h1>
            <p className="text-sm text-muted-foreground">
              Client: {data.campaign.client_info.name}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Existing Tweets Display */}
            <div className="glass rounded-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-normal text-foreground">Existing Tweets</h2>
                <div className="px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full text-xs font-medium">
                  Protected - Cannot be deleted
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                All existing tweets and their engagement data are preserved. You can only add new tweets below.
              </p>
              
              {data.tweets && data.tweets.length > 0 ? (
                <div className="space-y-6">
                  {(['main_twt', 'influencer_twt', 'investor_twt'] as TweetCategory[]).map((category) => {
                    const tweets = tweetsByCategory[category];
                    if (tweets.length === 0) return null;

                    return (
                      <div key={category}>
                        <h3 className="text-lg text-muted-foreground mb-4 flex items-center gap-2">
                          <span className={`px-3 py-1 rounded-full text-sm border ${CATEGORY_COLORS[category]}`}>
                            {CATEGORY_LABELS[category]}
                          </span>
                          <span className="text-muted-foreground text-sm">
                            ({tweets.length} {tweets.length === 1 ? 'tweet' : 'tweets'})
                          </span>
                        </h3>
                        <div className="grid gap-3">
                          {tweets.map((tweet) => {
                            const tweetUrl = `https://x.com/${tweet.author_username}/status/${tweet.tweet_id}`;
                            return (
                              <div
                                key={tweet.tweet_id}
                                className="bg-muted/20 border border-border rounded-sm p-4 hover:bg-muted/30 transition-colors"
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex-1 min-w-0">
                                    <a
                                      href={tweetUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[#2F6FED] hover:underline underline-offset-4 text-sm font-mono break-all"
                                    >
                                      {tweetUrl}
                                    </a>
                                    <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                                      <span>@{tweet.author_username}</span>
                                      {tweet.metrics && (
                                        <>
                                          <span>❤️ {tweet.metrics.likeCount.toLocaleString()}</span>
                                          <span>🔄 {tweet.metrics.retweetCount.toLocaleString()}</span>
                                          <span>💬 {tweet.metrics.replyCount.toLocaleString()}</span>
                                          <span>🔁 {tweet.metrics.quoteCount.toLocaleString()}</span>
                                          <span>👁️ {tweet.metrics.viewCount.toLocaleString()}</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-12">
                  <p>No tweets added to this campaign yet.</p>
                  <p className="text-sm mt-2">Add tweets below to get started.</p>
                </div>
              )}
            </div>

            {/* Add New Tweets */}
            <div className="glass rounded-sm p-6">
              <h2 className="text-2xl font-normal text-foreground mb-6">Add New Tweets</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Paste tweet URLs below to add them to the campaign. Existing tweets will be preserved.
              </p>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">
                    Main Tweets
                  </label>
                  <textarea
                    value={newTweets.maintweets_raw}
                    onChange={(e) =>
                      setNewTweets((prev) => ({ ...prev, maintweets_raw: e.target.value }))
                    }
                    className="w-full px-4 py-3 bg-background border border-input rounded-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none transition-all min-h-[100px] font-mono text-sm"
                    placeholder={`Paste one or more main tweet URLs.\nExamples:\nhttps://x.com/user/status/123\nhttps://twitter.com/user2/status/456, https://x.com/user3/status/789`}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    You can separate URLs with newlines, spaces, or commas. Each occurrence of an http(s) URL will be treated as a separate tweet.
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-muted-foreground mb-2">
                    Influencer Tweets
                  </label>
                  <textarea
                    value={newTweets.influencer_twts_raw}
                    onChange={(e) =>
                      setNewTweets((prev) => ({ ...prev, influencer_twts_raw: e.target.value }))
                    }
                    className="w-full px-4 py-3 bg-background border border-input rounded-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none transition-all min-h-[100px] font-mono text-sm"
                    placeholder={`Paste influencer tweet URLs. Any text is fine as long as the URLs start with http(s)://`}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Same rules: every http(s) URL is parsed as a separate influencer tweet.
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-muted-foreground mb-2">
                    Investor Tweets
                  </label>
                  <textarea
                    value={newTweets.investor_twts_raw}
                    onChange={(e) =>
                      setNewTweets((prev) => ({ ...prev, investor_twts_raw: e.target.value }))
                    }
                    className="w-full px-4 py-3 bg-background border border-input rounded-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none transition-all min-h-[100px] font-mono text-sm"
                    placeholder={`Paste investor tweet URLs here.`}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    URLs can be separated by commas, spaces, or new lines.
                  </p>
                </div>
              </div>
            </div>

            {/* Alert Settings */}
            <div className="glass rounded-sm p-6">
              <h2 className="text-2xl font-normal text-foreground mb-6">Alert Settings</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    Importance Threshold
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={settingsForm.importance_threshold}
                    onChange={(e) =>
                      handleSettingsChange(
                        'importance_threshold',
                        parseInt(e.target.value || '0', 10)
                      )
                    }
                    className="w-full px-3 py-2 bg-background border border-input rounded-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none transition-all"
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Minimum importance score to trigger alerts
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    Alert Spacing (minutes)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={settingsForm.alert_spacing_minutes}
                    onChange={(e) =>
                      handleSettingsChange(
                        'alert_spacing_minutes',
                        parseInt(e.target.value || '0', 10)
                      )
                    }
                    className="w-full px-3 py-2 bg-background border border-input rounded-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none transition-all"
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Time window to spread alerts from same run (recommended: 80% of schedule interval)
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    Frequency Window (minutes)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={settingsForm.frequency_window_minutes}
                    onChange={(e) =>
                      handleSettingsChange(
                        'frequency_window_minutes',
                        parseInt(e.target.value || '0', 10)
                      )
                    }
                    className="w-full px-3 py-2 bg-background border border-input rounded-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none transition-all"
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Don&apos;t send duplicate alerts within this window
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-muted-foreground mb-2">
                    Alert Channels
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center text-foreground">
                      <input
                        type="checkbox"
                        checked={settingsForm.channels.includes('email')}
                        onChange={() => toggleChannel('email')}
                        className="mr-2 rounded-sm border-input bg-background text-[#2F6FED] focus:ring-ring focus:ring-2"
                      />
                      Email
                    </label>
                    <label className="flex items-center text-foreground">
                      <input
                        type="checkbox"
                        checked={settingsForm.channels.includes('slack')}
                        onChange={() => toggleChannel('slack')}
                        className="mr-2 rounded-sm border-input bg-background text-[#2F6FED] focus:ring-ring focus:ring-2"
                      />
                      Slack
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 justify-end">
              <Link
                href={`/socap/campaigns/${campaignId}`}
                className="px-6 py-3 bg-card border border-border rounded-sm text-foreground hover:bg-muted/30 transition-colors"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 rounded-sm border border-[#2F6FED] text-[#2F6FED] hover:bg-[#2F6FED]/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

