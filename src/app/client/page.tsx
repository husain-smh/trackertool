import Link from 'next/link';

import Navbar from '@/components/Navbar';
import { ClientPermissionsTab, type ClientPermissionRow } from '@/app/client/_components/ClientPermissionsTab';
import { ManagedClientsTab, type ManagedClientRow } from '@/app/client/_components/ManagedClientsTab';
import { listUserReportClients } from '@/lib/user-report';
import { getAllCampaigns } from '@/lib/models/socap/campaigns';
import { getXOAuthCollection } from '@/lib/models/x-oauth';
import { getAllClients } from '@/lib/models/clients';

type ClientTab = 'reports' | 'permissions' | 'monitoring';

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDateTime(value: Date | null | undefined) {
  if (!value) return undefined;
  return dateTimeFormatter.format(value);
}

function normalizeClientId(value: string) {
  return value.trim().replace(/^@/, '');
}

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ClientPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const tabParam = firstSearchParam(sp.tab);
  const tab: ClientTab = tabParam === 'permissions' ? 'permissions' : tabParam === 'monitoring' ? 'monitoring' : 'reports';

  return (
    <div className="min-h-screen bg-transparent text-[#2B2B2B] font-sans">
      <Navbar />

      <main className="relative pt-24 md:pt-32 pb-12 md:pb-20 px-4 md:px-6">
        {/* Simple center tabs: just two words + underline */}
        <div className="max-w-[1200px] mx-auto mb-12">
          <div className="flex items-center justify-center gap-12">
            <Link
              href="/client?tab=reports"
              className={`text-[1.25rem] leading-[1.6] font-normal transition-colors ${
                tab === 'reports' ? 'text-[#2B2B2B]' : 'text-[#6B6B6B] hover:text-[#2B2B2B]'
              }`}
            >
              Reports
            </Link>
            <Link
              href="/client?tab=permissions"
              className={`text-[1.25rem] leading-[1.6] font-normal transition-colors ${
                tab === 'permissions' ? 'text-[#2B2B2B]' : 'text-[#6B6B6B] hover:text-[#2B2B2B]'
              }`}
            >
              Permissions
            </Link>
            <Link
              href="/client?tab=monitoring"
              className={`text-[1.25rem] leading-[1.6] font-normal transition-colors ${
                tab === 'monitoring' ? 'text-[#2B2B2B]' : 'text-[#6B6B6B] hover:text-[#2B2B2B]'
              }`}
            >
              Monitoring
            </Link>
          </div>

          <div className="mt-3 flex items-center justify-center">
            <div className="w-[390px] border-b border-[#E8E4DF]" />
          </div>
          <div className="mt-1 flex items-center justify-center">
            <div
              className="h-[2px] w-[120px] bg-[#2F6FED] transition-transform duration-200"
              style={{ transform: tab === 'reports' ? 'translateX(-135px)' : tab === 'permissions' ? 'translateX(0px)' : 'translateX(135px)' }}
            />
          </div>
        </div>

        {tab === 'reports' ? <ClientReportsTab /> : tab === 'permissions' ? <ClientPermissionsServerTab /> : <ManagedClientsServerTab />}
      </main>
    </div>
  );
}

async function ClientReportsTab() {
  // This is the same data source as `/userReport`.
  const clients = await listUserReportClients();

  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const formatDate = (value: string | null) => {
    if (!value) return '—';
    return dateFormatter.format(new Date(value));
  };

  return (
    <div>
      <div className="max-w-[800px] mx-auto text-center mb-16">
        <h1 className="text-[2.5rem] leading-[1.3] font-normal mb-6 text-[#2B2B2B]">Client Reports</h1>
        <p className="text-[1.125rem] leading-[1.75] text-[#6B6B6B] max-w-[65ch] mx-auto">
          View reports for each client in one place.
        </p>
      </div>

      <div className="max-w-[1200px] mx-auto">
        {clients.length === 0 ? (
          <div className="text-center text-[#6B6B6B]">
            <p>No client reports yet.</p>
          </div>
        ) : (
          <div className="bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#F5F3F0] text-[#6B6B6B] text-sm uppercase tracking-wide border-b border-[#E8E4DF]">
                  <tr>
                    <th className="px-6 py-4 font-normal">Client</th>
                    <th className="px-6 py-4 font-normal">Tweets</th>
                    <th className="px-6 py-4 font-normal">Last Tweet</th>
                    <th className="px-6 py-4 font-normal">Last Analyzed</th>
                    <th className="px-6 py-4 font-normal">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8E4DF]">
                  {clients.map((client) => (
                    <tr key={client.identifier} className="hover:bg-[#F5F3F0]/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-[#2B2B2B]">{client.name}</div>
                        <div className="text-xs text-[#6B6B6B]">
                          {client.username ? `@${client.username.replace('@', '')}` : client.identifier}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-medium text-[#2B2B2B]">{client.tweetCount}</td>
                      <td className="px-6 py-4 text-[#6B6B6B] text-sm">{formatDate(client.lastTweetAt)}</td>
                      <td className="px-6 py-4 text-[#6B6B6B] text-sm">{formatDate(client.lastAnalyzedAt)}</td>
                      <td className="px-6 py-4 text-sm">
                        <Link
                          href={`/userReport/${encodeURIComponent(client.identifier)}`}
                          className="text-[#2B2B2B] hover:text-[#2F6FED] hover:underline"
                        >
                          Details
                        </Link>
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

async function ClientPermissionsServerTab() {
  const [reportClients, campaigns] = await Promise.all([listUserReportClients(), getAllCampaigns()]);

  // Build the set of "clients we care about" from:
  // - User reports (tweet authors)
  // - Socap campaigns (explicit client_id)
  const displayById = new Map<string, string>();

  for (const client of reportClients) {
    const id = normalizeClientId(client.identifier);
    if (!id) continue;
    displayById.set(id, client.name || id);
  }

  for (const campaign of campaigns) {
    const id = campaign.client_id ? normalizeClientId(campaign.client_id) : '';
    if (!id) continue;
    if (!displayById.has(id)) displayById.set(id, id);
  }

  const clientIds = [...displayById.keys()];

  if (clientIds.length === 0) {
    return (
      <div className="max-w-[1200px] mx-auto text-center text-[#6B6B6B]">
        <p>No clients found yet.</p>
      </div>
    );
  }

  type OAuthSnapshot = {
    client_id: string;
    x_username?: string;
    x_name?: string;
    status?: 'active' | 'expired' | 'revoked';
    authorized_at?: Date;
  };

  const oauthCollection = await getXOAuthCollection();
  const oauthRecords = (await oauthCollection
    .find(
      { client_id: { $in: clientIds } },
      {
        projection: {
          client_id: 1,
          x_username: 1,
          x_name: 1,
          status: 1,
          authorized_at: 1,
        },
      },
    )
    .toArray()) as OAuthSnapshot[];

  const oauthById = new Map<string, OAuthSnapshot>();
  for (const record of oauthRecords) {
    oauthById.set(record.client_id, record);
  }

  const rows: ClientPermissionRow[] = clientIds.map((clientId) => {
    const oauth = oauthById.get(clientId);
    const status = oauth?.status;

    const oauth_status: ClientPermissionRow['oauth_status'] =
      status === 'active'
        ? 'connected'
        : status === 'expired'
          ? 'expired'
          : status === 'revoked'
            ? 'revoked'
            : 'not_connected';

    return {
      client_id: clientId,
      display_name: displayById.get(clientId) ?? clientId,
      oauth_status,
      x_username: oauth?.x_username,
      x_name: oauth?.x_name,
      authorized_at: formatDateTime(oauth?.authorized_at),
    };
  });

  return <ClientPermissionsTab rows={rows} />;
}

async function ManagedClientsServerTab() {
  const clients = await getAllClients();

  const rows: ManagedClientRow[] = clients.map((c) => ({
    x_username: c.x_username,
    display_name: c.display_name,
    monitoring_enabled: c.monitoring_enabled,
    auto_analyze: c.auto_analyze,
    last_checked_at: c.last_checked_at?.toISOString(),
    last_known_tweet_id: c.last_known_tweet_id,
    added_at: c.added_at.toISOString(),
  }));

  return <ManagedClientsTab rows={rows} />;
}
