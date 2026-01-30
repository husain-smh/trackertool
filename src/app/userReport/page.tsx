import Link from 'next/link';

import Navbar from '@/components/Navbar';
import { listUserReportClients } from '@/lib/user-report';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatDate(value: string | null) {
  if (!value) return '—';
  return dateFormatter.format(new Date(value));
}

export default async function UserReportIndexPage() {
  const clients = await listUserReportClients();

  return (
    <div className="min-h-screen bg-transparent text-[#2B2B2B] font-sans">
      <Navbar />

      <main className="relative pt-32 pb-20 px-6">
        <div className="max-w-[800px] mx-auto text-center mb-16">
          <h1 className="text-[2.5rem] leading-[1.3] font-normal mb-6 text-[#2B2B2B]">
            Client Reports
          </h1>
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
                      <tr
                        key={client.identifier}
                        className="hover:bg-[#F5F3F0]/50 transition-colors"
                      >
                        <td className="px-6 py-4">
                          <div className="font-medium text-[#2B2B2B]">{client.name}</div>
                          <div className="text-xs text-[#6B6B6B]">
                            {client.username
                              ? `@${client.username.replace('@', '')}`
                              : client.identifier}
                          </div>
                        </td>
                        <td className="px-6 py-4 font-medium text-[#2B2B2B]">
                          {client.tweetCount}
                        </td>
                        <td className="px-6 py-4 text-[#6B6B6B] text-sm">
                          {formatDate(client.lastTweetAt)}
                        </td>
                        <td className="px-6 py-4 text-[#6B6B6B] text-sm">
                          {formatDate(client.lastAnalyzedAt)}
                        </td>
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
      </main>
    </div>
  );
}



