'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface SystemSettings {
  schedule_interval_minutes: number;
  updated_at: string;
}

export default function SystemSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(30);

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const response = await fetch('/api/socap/system-settings');
      const result = await response.json();

      if (result.success) {
        setSettings(result.data);
        setIntervalMinutes(result.data.schedule_interval_minutes);
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
      alert('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const response = await fetch('/api/socap/system-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule_interval_minutes: intervalMinutes,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setSettings(result.data);
        alert('Settings saved successfully! Remember to update your N8N schedule to match.');
      } else {
        alert(`Failed to save: ${result.error}`);
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-[800px] mx-auto px-6 pb-20">
        <div className="py-20 text-center text-muted-foreground">Loading settings...</div>
      </div>
    );
  }

  const recommendedAlertSpacing = Math.max(2, Math.floor(intervalMinutes * 0.8));
  const inputClass = "w-full px-4 py-2.5 bg-input border border-border rounded-xl text-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none transition-all";

  return (
    <div className="max-w-[800px] mx-auto px-6 pb-20">
      <div className="mb-10">
        <Link href="/socap" className="text-primary hover:underline mb-3 inline-block text-sm font-medium">
          ← Back to Campaigns
        </Link>
        <h1 className="text-3xl font-bold text-foreground">System Settings</h1>
        <p className="text-muted-foreground mt-2">
          Configure global settings for the BrandWorks monitoring system.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-[var(--shadow-card)] p-8 space-y-8">
        {/* Schedule Interval */}
        <div>
          <label className="block text-sm text-muted-foreground mb-2">
            Worker Schedule Interval (minutes)
          </label>
          <input
            type="number"
            min="1"
            max="1440"
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(parseInt(e.target.value) || 30)}
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground mt-2">
            How often the N8N workflow triggers worker jobs (must match your N8N schedule)
          </p>
          <div className="mt-4 p-4 bg-muted border border-border rounded-xl">
            <p className="text-sm text-foreground font-medium">
              Important: this must match your N8N schedule exactly.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              If N8N runs every 30 minutes but this is set to 15 minutes (or vice versa), jobs may not be processed correctly.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              After changing this value, update your N8N workflow schedule to match immediately.
            </p>
            <p className="text-sm text-muted-foreground mt-3 pt-3 border-t border-border">
              Recommended alert spacing for campaigns: <span className="text-foreground font-medium">{recommendedAlertSpacing} minutes</span>
            </p>
          </div>
        </div>

        {settings && (
          <div className="text-sm text-muted-foreground pt-4 border-t border-border">
            Last updated: {new Date(settings.updated_at).toLocaleString()}
          </div>
        )}

        <div className="flex gap-3 justify-end pt-4">
          <button
            onClick={() => setIntervalMinutes(settings?.schedule_interval_minutes || 30)}
            className="px-4 py-2.5 bg-muted hover:bg-muted/80 text-foreground rounded-xl transition-all font-medium"
            disabled={saving}
          >
            Reset
          </button>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl transition-all font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* Info Section */}
      <div className="mt-10 bg-card border border-border rounded-xl shadow-[var(--shadow-card)] p-6">
        <h3 className="text-xl font-bold text-foreground mb-4">About Schedule Interval</h3>
        <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
          <li>This controls how often the system checks for new engagements</li>
          <li>Must match your N8N workflow schedule exactly</li>
          <li>Shorter intervals (5 min) = faster alerts but more API calls</li>
          <li>Longer intervals (30 min) = fewer API calls but slower detection</li>
          <li>Alert spacing automatically adjusts to 80% of this interval</li>
        </ul>
      </div>
    </div>
  );
}
