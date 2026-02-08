'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Pencil, PauseCircle, Play, Pin } from 'lucide-react';

interface Campaign {
  _id: string;
  launch_name: string;
  client_info: {
    name: string;
    email: string;
  };
  status: 'active' | 'paused' | 'completed';
  monitor_window: {
    start_date: string;
    end_date: string;
  };
  created_at: string;
}

export default function SocapCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    action: 'delete' | 'pause' | 'resume';
    campaign: Campaign;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchCampaigns();
  }, []);

  async function fetchCampaigns() {
    try {
      setError(null);
      const response = await fetch('/api/socap/campaigns');
      const data = await response.json();

      if (data.success) {
        setCampaigns(data.data || []);
      } else {
        setError(data.error || 'Failed to load campaigns');
      }
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      setError('Failed to connect to the server. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }

  function getStatusPill(status: string) {
    switch (status) {
      case 'active':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'paused':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'completed':
        return 'bg-muted text-muted-foreground border-border';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  }

  const openConfirm = (action: 'delete' | 'pause' | 'resume', campaign: Campaign) => {
    setActionError(null);
    setConfirmModal({ action, campaign });
  };

  const closeConfirm = () => {
    if (actionLoading) return;
    setConfirmModal(null);
  };

  const handleConfirmAction = async () => {
    if (!confirmModal) return;
    setActionLoading(true);
    setActionError(null);

    try {
      let response: Response;

      if (confirmModal.action === 'delete') {
        response = await fetch(`/api/socap/campaigns/${confirmModal.campaign._id}`, {
          method: 'DELETE',
        });
      } else {
        const status = confirmModal.action === 'pause' ? 'paused' : 'active';
        response = await fetch(`/api/socap/campaigns/${confirmModal.campaign._id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
      }

      const result = await response.json();

      if (!result.success) {
        setActionError(result.error || 'Action failed. Please try again.');
        return;
      }

      if (confirmModal.action === 'delete') {
        setCampaigns((prev) => prev.filter((c) => c._id !== confirmModal.campaign._id));
      } else {
        const status = confirmModal.action === 'pause' ? 'paused' : 'active';
        setCampaigns((prev) =>
          prev.map((c) => (c._id === confirmModal.campaign._id ? { ...c, status } : c))
        );
      }

      setConfirmModal(null);
    } catch (error) {
      console.error('Error updating campaign:', error);
      setActionError('Something went wrong while processing the request.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans">
        <main className="pt-6 pb-20 px-6">
          <div className="max-w-[1200px] mx-auto text-center pt-12">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary border-t-transparent mx-auto" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <main className="pt-6 pb-20 px-6">
        <div className="max-w-[1200px] mx-auto">
          <div className="mb-10">
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Campaigns
            </h1>
            <p className="text-muted-foreground">
              Create and monitor campaigns. Alerts, metrics, and dashboards live inside each campaign.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Link
                href="/socap/create"
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-2 px-5 rounded-xl transition-all"
              >
                Create Campaign
              </Link>
              <Link
                href="/socap/settings"
                className="bg-card hover:bg-muted border border-border text-foreground font-medium py-2 px-5 rounded-xl transition-all"
              >
                System Settings
              </Link>
            </div>
          </div>

          {error ? (
            <div className="bg-card border border-border rounded-xl shadow-[var(--shadow-card)] p-8 text-center">
              <p className="text-foreground font-medium mb-2">Error loading campaigns</p>
              <p className="text-muted-foreground text-sm mb-6">{error}</p>
              <button
                onClick={fetchCampaigns}
                className="text-primary hover:underline font-medium"
              >
                Retry
              </button>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">No campaigns yet</p>
              <Link href="/socap/create" className="text-primary hover:underline font-medium">
                Create your first campaign
              </Link>
            </div>
          ) : (
            <div className="grid gap-6">
              {campaigns.map((campaign) => (
                <div
                  key={campaign._id}
                  className="bg-card border border-border rounded-xl shadow-[var(--shadow-card)] p-6 transition-all hover:shadow-[var(--shadow-hard)] hover:border-primary/30"
                >
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div className="min-w-0">
                      <Link
                        href={`/socap/campaigns/${campaign._id}`}
                        className="text-xl font-bold text-foreground hover:text-primary transition-colors break-words"
                      >
                        {campaign.launch_name}
                      </Link>
                      <p className="text-muted-foreground mt-2 text-sm">
                        Client: {campaign.client_info.name}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {new Date(campaign.monitor_window.start_date).toLocaleDateString()} -{' '}
                        {new Date(campaign.monitor_window.end_date).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex flex-col md:items-end gap-3">
                      <span
                        className={`inline-flex px-3 py-1 rounded-full text-xs font-medium border capitalize ${getStatusPill(campaign.status)}`}
                      >
                        {campaign.status}
                      </span>
                      <div className="flex flex-wrap gap-2 md:justify-end text-sm">
                        <Link
                          href={`/socap/campaigns/${campaign._id}/edit`}
                          className="text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1.5"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </Link>
                        {campaign.status === 'active' ? (
                          <button
                            onClick={() => openConfirm('pause', campaign)}
                            className="text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1.5"
                          >
                            <PauseCircle className="w-3.5 h-3.5" />
                            Pause
                          </button>
                        ) : (
                          <button
                            onClick={() => openConfirm('resume', campaign)}
                            className="text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1.5"
                          >
                            <Play className="w-3.5 h-3.5" />
                            Resume
                          </button>
                        )}
                        <button
                          onClick={() => openConfirm('delete', campaign)}
                          className="text-muted-foreground hover:text-destructive transition-colors inline-flex items-center gap-1.5"
                        >
                          <Pin className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {confirmModal && (
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 px-6">
              <div className="bg-card border border-border rounded-xl shadow-[var(--shadow-hard)] p-8 max-w-md w-full">
                <h3 className="text-xl font-bold mb-3 text-foreground">
                  {confirmModal.action === 'delete'
                    ? 'Delete Campaign'
                    : confirmModal.action === 'pause'
                    ? 'Pause Campaign'
                    : 'Resume Campaign'}
                </h3>
                <p className="text-sm text-muted-foreground mb-6">
                  {confirmModal.action === 'delete'
                    ? 'This will permanently remove the campaign.'
                    : confirmModal.action === 'pause'
                    ? 'The campaign will stop processing new engagements.'
                    : 'The campaign will resume processing engagements.'}{' '}
                  <span className="text-foreground font-medium">&ldquo;{confirmModal.campaign.launch_name}&rdquo;</span>
                </p>
                {actionError && <p className="text-sm text-destructive mb-4">{actionError}</p>}
                <div className="flex justify-end gap-3">
                  <button
                    onClick={closeConfirm}
                    disabled={actionLoading}
                    className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-xl transition-all disabled:opacity-50 text-sm font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmAction}
                    disabled={actionLoading}
                    className={`px-4 py-2 rounded-xl transition-all disabled:opacity-50 text-sm font-medium ${
                      confirmModal.action === 'delete'
                        ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
                        : 'bg-primary hover:bg-primary/90 text-primary-foreground'
                    }`}
                  >
                    {actionLoading ? 'Processing...' : 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
