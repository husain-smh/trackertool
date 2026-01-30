'use client';

import { useState } from 'react';

export type ManagedClientRow = {
  x_username: string;
  display_name?: string;
  monitoring_enabled: boolean;
  auto_analyze: boolean;
  last_checked_at?: string;
  last_known_tweet_id?: string;
  added_at: string;
};

export function ManagedClientsTab({ rows }: { rows: ManagedClientRow[] }) {
  const [clients, setClients] = useState(rows);
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addClient = async () => {
    const trimmed = username.trim().replace(/^@/, '');
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x_username: trimmed }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to add client');
        return;
      }

      setClients((prev) => [
        {
          x_username: data.client.x_username,
          display_name: data.client.display_name,
          monitoring_enabled: data.client.monitoring_enabled,
          auto_analyze: data.client.auto_analyze,
          last_checked_at: data.client.last_checked_at,
          last_known_tweet_id: data.client.last_known_tweet_id,
          added_at: data.client.added_at,
        },
        ...prev,
      ]);
      setUsername('');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const removeClient = async (xUsername: string) => {
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(xUsername)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setClients((prev) => prev.filter((c) => c.x_username !== xUsername));
      }
    } catch {
      // silent
    }
  };

  const toggleField = async (xUsername: string, field: 'monitoring_enabled' | 'auto_analyze', value: boolean) => {
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(xUsername)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        setClients((prev) =>
          prev.map((c) => (c.x_username === xUsername ? { ...c, [field]: value } : c))
        );
      }
    } catch {
      // silent
    }
  };

  const formatDate = (value?: string) => {
    if (!value) return '--';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  };

  return (
    <div>
      <div className="max-w-[800px] mx-auto text-center mb-16">
        <h1 className="text-[2.5rem] leading-[1.3] font-normal mb-6 text-[#2B2B2B]">Add Client</h1>
        <p className="text-[1.125rem] leading-[1.75] text-[#6B6B6B] max-w-[65ch] mx-auto">
          Track engagement for your clients automatically.
        </p>
      </div>

      {/* Add client form */}
      <div className="max-w-[1200px] mx-auto mb-8">
        <div className="flex gap-3 items-center">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addClient()}
            placeholder="@username"
            className="flex-1 max-w-[300px] px-4 py-2.5 border border-[#E8E4DF] rounded-sm bg-white text-[#2B2B2B] text-sm placeholder:text-[#A0A0A0] focus:outline-none focus:border-[#2F6FED]"
          />
          <button
            onClick={addClient}
            disabled={loading || !username.trim()}
            className="px-5 py-2.5 bg-[#2B2B2B] text-white text-sm rounded-sm hover:bg-[#1a1a1a] disabled:opacity-40 transition-colors"
          >
            {loading ? 'Adding...' : 'Add Client'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* Clients table */}
      <div className="max-w-[1200px] mx-auto">
        {clients.length === 0 ? (
          <div className="text-center text-[#6B6B6B]">
            <p>No managed clients yet. Add one above to get started.</p>
          </div>
        ) : (
          <div className="bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#F5F3F0] text-[#6B6B6B] text-sm uppercase tracking-wide border-b border-[#E8E4DF]">
                  <tr>
                    <th className="px-6 py-4 font-normal">Client</th>
                    <th className="px-6 py-4 font-normal">Monitoring</th>
                    <th className="px-6 py-4 font-normal">Auto-Analyze</th>
                    <th className="px-6 py-4 font-normal">Last Checked</th>
                    <th className="px-6 py-4 font-normal">Last Tweet</th>
                    <th className="px-6 py-4 font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8E4DF]">
                  {clients.map((client) => (
                    <tr key={client.x_username} className="hover:bg-[#F5F3F0]/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-[#2B2B2B]">
                          {client.display_name || client.x_username}
                        </div>
                        <div className="text-xs text-[#6B6B6B]">@{client.x_username}</div>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => toggleField(client.x_username, 'monitoring_enabled', !client.monitoring_enabled)}
                          className={`px-3 py-1 text-xs rounded-full ${
                            client.monitoring_enabled
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-stone-100 text-stone-500'
                          }`}
                        >
                          {client.monitoring_enabled ? 'On' : 'Off'}
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => toggleField(client.x_username, 'auto_analyze', !client.auto_analyze)}
                          className={`px-3 py-1 text-xs rounded-full ${
                            client.auto_analyze
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-stone-100 text-stone-500'
                          }`}
                        >
                          {client.auto_analyze ? 'On' : 'Off'}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-[#6B6B6B] text-sm">
                        {formatDate(client.last_checked_at)}
                      </td>
                      <td className="px-6 py-4 text-[#6B6B6B] text-sm font-mono">
                        {client.last_known_tweet_id
                          ? `...${client.last_known_tweet_id.slice(-6)}`
                          : '--'}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => removeClient(client.x_username)}
                          className="text-sm text-red-500 hover:text-red-700 hover:underline"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
