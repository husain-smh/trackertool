'use client';

import { useMemo, useState } from 'react';

export type ClientPermissionRow = {
  client_id: string;
  display_name: string;
  oauth_status: 'connected' | 'not_connected' | 'expired' | 'revoked';
  x_username?: string;
  x_name?: string;
  authorized_at?: string;
};

function buildConnectLink(clientId: string) {
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  return `${baseUrl}/auth/connect?client_id=${encodeURIComponent(clientId)}`;
}

export function ClientPermissionsTab({ rows }: { rows: ClientPermissionRow[] }) {
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [copiedClientId, setCopiedClientId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      // Put not-connected first so it's easy to action.
      const score = (status: ClientPermissionRow['oauth_status']) =>
        status === 'not_connected' ? 0 : status === 'expired' ? 1 : status === 'revoked' ? 2 : 3;
      const diff = score(a.oauth_status) - score(b.oauth_status);
      if (diff !== 0) return diff;
      return a.display_name.localeCompare(b.display_name);
    });
  }, [rows]);

  const copyLink = async (clientId: string) => {
    const link = buildConnectLink(clientId);
    try {
      await navigator.clipboard.writeText(link);
      setCopiedClientId(clientId);
      setTimeout(() => setCopiedClientId((prev) => (prev === clientId ? null : prev)), 1500);
    } catch {
      // If clipboard is blocked, user can still manually copy from the visible link.
      setCopiedClientId(null);
    }
  };

  const statusBadge = (status: ClientPermissionRow['oauth_status']) => {
    if (status === 'connected') {
      return 'bg-emerald-100 text-emerald-700';
    }
    if (status === 'expired') {
      return 'bg-amber-100 text-amber-700';
    }
    if (status === 'revoked') {
      return 'bg-red-100 text-red-700';
    }
    return 'bg-stone-100 text-stone-700';
  };

  const statusLabel = (status: ClientPermissionRow['oauth_status']) => {
    if (status === 'connected') return 'Connected';
    if (status === 'expired') return 'Expired';
    if (status === 'revoked') return 'Revoked';
    return 'Not connected';
  };

  return (
    <div className="max-w-[1200px] mx-auto">
      <div className="bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-[#F5F3F0] text-[#6B6B6B] text-sm uppercase tracking-wide border-b border-[#E8E4DF]">
              <tr>
                <th className="px-6 py-4 font-normal">Client</th>
                <th className="px-6 py-4 font-normal">Status</th>
                <th className="px-6 py-4 font-normal">X Account</th>
                <th className="px-6 py-4 font-normal">Authorized</th>
                <th className="px-6 py-4 font-normal">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8E4DF]">
              {sorted.map((row) => {
                const isExpanded = expandedClientId === row.client_id;
                const link = isExpanded ? buildConnectLink(row.client_id) : null;
                const canGenerate = row.oauth_status === 'not_connected';
                const showGenerate = canGenerate;

                return (
                  <tr key={row.client_id} className="hover:bg-[#F5F3F0]/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-[#2B2B2B]">{row.display_name}</div>
                      <div className="text-xs text-[#6B6B6B]">{row.client_id}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${statusBadge(
                          row.oauth_status,
                        )}`}
                      >
                        {statusLabel(row.oauth_status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-[#2B2B2B]">
                      {row.x_username ? (
                        <div>
                          <div className="font-medium">@{row.x_username}</div>
                          {row.x_name ? <div className="text-xs text-[#6B6B6B]">{row.x_name}</div> : null}
                        </div>
                      ) : (
                        <span className="text-[#6B6B6B]">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-[#6B6B6B]">{row.authorized_at ?? '—'}</td>
                    <td className="px-6 py-4 text-sm">
                      {showGenerate ? (
                        <div className="space-y-2">
                          <button
                            onClick={() =>
                              setExpandedClientId((prev) => (prev === row.client_id ? null : row.client_id))
                            }
                            className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline"
                          >
                            {isExpanded ? 'Hide link' : 'Generate link'}
                          </button>
                          {isExpanded && link ? (
                            <div className="flex items-center gap-3">
                              <div className="flex-1 overflow-hidden">
                                <div className="text-[10px] text-[#6B6B6B] mb-1">Permanent auth link:</div>
                                <div className="text-xs text-[#2B2B2B] font-mono truncate">{link}</div>
                              </div>
                              <button
                                onClick={() => copyLink(row.client_id)}
                                className="px-3 py-1.5 rounded-sm text-xs transition-colors flex items-center gap-1.5 border bg-[#FEFEFE] text-[#2F6FED] border-[#2F6FED] hover:bg-[#2F6FED]/5"
                              >
                                {copiedClientId === row.client_id ? 'Copied!' : 'Copy'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-[#6B6B6B]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

