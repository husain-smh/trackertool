'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function CreateCampaignPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    launch_name: '',
    client_name: '',
    client_email: '',
    importance_threshold: '10',
    frequency_window_minutes: '30',
    alert_spacing_minutes: '20',
    channels: ['email'] as string[],
    start_date: '',
    end_date: '',
    maintweets_raw: '',
    influencer_twts_raw: '',
    investor_twts_raw: '',
  });

  function handleInputChange(field: string, value: any) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

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

  function handleChannelToggle(channel: string) {
    setFormData((prev) => {
      const channels = prev.channels.includes(channel)
        ? prev.channels.filter((c) => c !== channel)
        : [...prev.channels, channel];
      return { ...prev, channels };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const maintweets = extractTweetUrls(formData.maintweets_raw).map((url) => ({ url }));
      const influencer_twts = extractTweetUrls(formData.influencer_twts_raw).map((url) => ({ url }));
      const investor_twts = extractTweetUrls(formData.investor_twts_raw).map((url) => ({ url }));

      const payload = {
        launch_name: formData.launch_name,
        client_info: {
          name: formData.client_name,
          email: formData.client_email,
        },
        maintweets,
        influencer_twts,
        investor_twts,
        monitor_window: {
          start_date: new Date(formData.start_date).toISOString(),
          end_date: new Date(formData.end_date).toISOString(),
        },
        alert_preferences: {
          importance_threshold: parseInt(formData.importance_threshold, 10),
          channels: formData.channels,
          frequency_window_minutes: parseInt(formData.frequency_window_minutes, 10),
          alert_spacing_minutes: parseInt(formData.alert_spacing_minutes, 10),
        },
      };

      const response = await fetch('/api/socap/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to create campaign');
      }

      router.push(`/socap/campaigns/${data.data.campaign._id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign');
      setLoading(false);
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const fiveDaysLater = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  if (!formData.start_date) {
    formData.start_date = today;
  }
  if (!formData.end_date) {
    formData.end_date = fiveDaysLater;
  }

  const inputClass = "w-full px-4 py-2.5 bg-input border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none transition-all";

  return (
    <div className="max-w-[800px] mx-auto px-6 pb-20">
      <div className="mb-10">
        <Link href="/socap" className="text-primary hover:underline mb-3 inline-block text-sm font-medium">
          ← Back to Campaigns
        </Link>
        <h1 className="text-3xl font-bold text-foreground">Create New Campaign</h1>
        <p className="text-muted-foreground mt-2">
          Add the campaign details and paste tweet URLs (any format is fine as long as URLs start with http(s)://).
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-xl mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl shadow-[var(--shadow-card)] p-8 space-y-8">
        {/* Campaign Info */}
        <div>
          <h2 className="text-xl font-bold text-foreground mb-6">Campaign Information</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">
                Launch Name *
              </label>
              <input
                type="text"
                required
                value={formData.launch_name}
                onChange={(e) => handleInputChange('launch_name', e.target.value)}
                className={inputClass}
                placeholder="e.g., Product Launch Q1 2025"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">
                  Client Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.client_name}
                  onChange={(e) => handleInputChange('client_name', e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">
                  Client Email *
                </label>
                <input
                  type="email"
                  required
                  value={formData.client_email}
                  onChange={(e) => handleInputChange('client_email', e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Monitor Window */}
        <div>
          <h2 className="text-xl font-bold text-foreground mb-6">Monitor Window</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">
                Start Date *
              </label>
              <input
                type="date"
                required
                value={formData.start_date}
                onChange={(e) => handleInputChange('start_date', e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">
                End Date *
              </label>
              <input
                type="date"
                required
                value={formData.end_date}
                onChange={(e) => handleInputChange('end_date', e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {/* Tweet URLs */}
        <div>
          <h2 className="text-xl font-bold text-foreground mb-6">Tweet URLs</h2>

          <div className="space-y-6">
            <div>
              <label className="block text-sm text-muted-foreground mb-2">
                Main Tweets
              </label>
              <textarea
                value={formData.maintweets_raw}
                onChange={(e) => handleInputChange('maintweets_raw', e.target.value)}
                className={`${inputClass} min-h-[96px]`}
                placeholder={`Paste one or more tweet URLs.\nExamples:\nhttps://x.com/user/status/123\nhttps://twitter.com/user2/status/456, https://x.com/user3/status/789`}
              />
              <p className="text-xs text-muted-foreground mt-2">
                You can separate URLs with newlines, spaces, or commas.
              </p>
            </div>

            <div>
              <label className="block text-sm text-muted-foreground mb-2">
                Influencer Tweets
              </label>
              <textarea
                value={formData.influencer_twts_raw}
                onChange={(e) => handleInputChange('influencer_twts_raw', e.target.value)}
                className={`${inputClass} min-h-[96px]`}
                placeholder="Paste influencer tweet URLs. Any text is fine as long as the URLs start with http(s)://"
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
                value={formData.investor_twts_raw}
                onChange={(e) => handleInputChange('investor_twts_raw', e.target.value)}
                className={`${inputClass} min-h-[96px]`}
                placeholder="Paste investor tweet URLs here."
              />
              <p className="text-xs text-muted-foreground mt-2">
                URLs can be separated by commas, spaces, or new lines.
              </p>
            </div>
          </div>
        </div>

        {/* Alert Preferences */}
        <div>
          <h2 className="text-xl font-bold text-foreground mb-6">Alert Preferences</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">
                Importance Threshold *
              </label>
              <input
                type="number"
                required
                min="0"
                value={formData.importance_threshold}
                onChange={(e) => handleInputChange('importance_threshold', e.target.value)}
                className={inputClass}
              />
              <p className="text-xs text-muted-foreground mt-2">
                Minimum importance score to trigger alerts (default: 10)
              </p>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-2">
                Alert Channels *
              </label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.channels.includes('email')}
                    onChange={() => handleChannelToggle('email')}
                    className="mr-2 rounded"
                  />
                  <span className="text-sm text-foreground">Email</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.channels.includes('slack')}
                    onChange={() => handleChannelToggle('slack')}
                    className="mr-2 rounded"
                  />
                  <span className="text-sm text-foreground">Slack</span>
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">
                  Frequency Window (minutes)
                </label>
                <input
                  type="number"
                  min="1"
                  value={formData.frequency_window_minutes}
                  onChange={(e) => handleInputChange('frequency_window_minutes', e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">
                  Alert Spacing (minutes)
                </label>
                <input
                  type="number"
                  min="1"
                  value={formData.alert_spacing_minutes}
                  onChange={(e) => handleInputChange('alert_spacing_minutes', e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 py-2.5 rounded-xl transition-all disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Campaign'}
          </button>
          <Link
            href="/socap"
            className="bg-muted hover:bg-muted/80 text-foreground font-medium px-6 py-2.5 rounded-xl transition-all"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
