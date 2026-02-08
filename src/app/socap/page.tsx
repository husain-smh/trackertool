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

  function getStatusColor(status: string) {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'paused':
        return 'bg-yellow-100 text-yellow-800';
      case 'completed':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
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
      <div className="min-h-screen bg-transparent text-[#2B2B2B] font-sans">
        <main className="relative pt-6 pb-20 px-6">
          <div className="max-w-[1200px] mx-auto text-center">
            <p className="text-[#6B6B6B]">Loading campaigns...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-[#2B2B2B] font-sans">
      <main className="relative pt-6 pb-20 px-6">
        <div className="max-w-[1200px] mx-auto">
          <div className="max-w-[800px] mx-auto text-center mb-16">
            <h1 className="text-[2.5rem] leading-[1.3] font-normal mb-6 text-[#2B2B2B]">
              BrandWorks Campaigns
            </h1>
            <p className="text-[1.125rem] leading-[1.75] text-[#6B6B6B] max-w-[65ch] mx-auto">
              Create and monitor campaigns. Alerts, metrics, and dashboards live inside each campaign.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-[1rem]">
              <Link
                href="/socap/settings"
                className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline underline-offset-4 transition-colors"
              >
                System Settings
              </Link>
              <Link
                href="/socap/create"
                className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline underline-offset-4 transition-colors"
              >
                Create Campaign
              </Link>
            </div>
          </div>

          {error ? (
            <div className="bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm p-8 text-center">
              <p className="text-[#2B2B2B] font-normal mb-2">Error loading campaigns</p>
              <p className="text-[#6B6B6B] text-sm mb-6">{error}</p>
              <button
                onClick={fetchCampaigns}
                className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline underline-offset-4 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[#6B6B6B] mb-4">No campaigns yet</p>
              <Link href="/socap/create" className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline underline-offset-4">
                Create your first campaign
              </Link>
            </div>
          ) : (
            <div className="grid gap-8">
              {campaigns.map((campaign) => (
                <div
                  key={campaign._id}
                  className="bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm p-8 transition-colors hover:border-[#2F6FED]"
                >
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                    <div className="min-w-0">
                      <Link
                        href={`/socap/campaigns/${campaign._id}`}
                        className="text-[1.75rem] leading-[1.4] font-normal text-[#2B2B2B] hover:text-[#2F6FED] hover:underline decoration-1 underline-offset-4 transition-colors break-words"
                      >
                        {campaign.launch_name}
                      </Link>
                      <p className="text-[#6B6B6B] mt-3">
                        Client: {campaign.client_info.name}
                      </p>
                      <p className="text-sm text-[#6B6B6B] mt-2">
                        {new Date(campaign.monitor_window.start_date).toLocaleDateString()} -{' '}
                        {new Date(campaign.monitor_window.end_date).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex flex-col md:items-end gap-4">
                      <span
                        className={`inline-flex px-3 py-1 rounded-full text-sm font-normal border border-[#E8E4DF] ${getStatusColor(
                          campaign.status
                        )}`}
                      >
                        {campaign.status}
                      </span>
                      <div className="flex flex-wrap gap-3 md:justify-end text-sm">
                        <Link
                          href={`/socap/campaigns/${campaign._id}/edit`}
                          className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline underline-offset-4 transition-colors inline-flex items-center gap-2"
                        >
                          <Pencil className="w-4 h-4" />
                          Edit
                        </Link>
                        {campaign.status === 'active' ? (
                          <button
                            onClick={() => openConfirm('pause', campaign)}
                            className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline underline-offset-4 transition-colors inline-flex items-center gap-2"
                          >
                            <PauseCircle className="w-4 h-4" />
                            Pause
                          </button>
                        ) : (
                          <button
                            onClick={() => openConfirm('resume', campaign)}
                            className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline underline-offset-4 transition-colors inline-flex items-center gap-2"
                          >
                            <Play className="w-4 h-4" />
                            Resume
                          </button>
                        )}
                        <button
                          onClick={() => openConfirm('delete', campaign)}
                          className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline underline-offset-4 transition-colors inline-flex items-center gap-2"
                        >
                          <Pin className="w-4 h-4" />
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
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-6">
              <div className="bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm p-8 max-w-md w-full">
                <h3 className="text-[1.75rem] leading-[1.4] font-normal mb-3 text-[#2B2B2B]">
                  {confirmModal.action === 'delete'
                    ? 'Delete Campaign'
                    : confirmModal.action === 'pause'
                    ? 'Pause Campaign'
                    : 'Resume Campaign'}
                </h3>
                <p className="text-sm text-[#6B6B6B] mb-6">
                  {confirmModal.action === 'delete'
                    ? 'This will permanently remove the campaign.'
                    : confirmModal.action === 'pause'
                    ? 'The campaign will stop processing new engagements.'
                    : 'The campaign will resume processing engagements.'}{' '}
                  <span className="text-[#2B2B2B]">&ldquo;{confirmModal.campaign.launch_name}&rdquo;</span>
                </p>
                {actionError && <p className="text-sm text-red-700 mb-4">{actionError}</p>}
                <div className="flex justify-end gap-4 text-sm">
                  <button
                    onClick={closeConfirm}
                    disabled={actionLoading}
                    className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline underline-offset-4 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmAction}
                    disabled={actionLoading}
                    className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline underline-offset-4 disabled:opacity-50 transition-colors"
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


