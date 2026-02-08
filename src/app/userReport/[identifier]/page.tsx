import Link from 'next/link';

import Navbar from '@/components/Navbar';
import { FollowerTierChart } from '@/app/userReport/_components/FollowerTierChart';
import { ProfileTypeDistributionSection } from '@/app/userReport/_components/ProfileTypeDistributionSection';
import { UserReportHeatmapSection } from '@/app/userReport/_components/UserReportHeatmapSection';
import { ImportantAccountsSection } from '@/app/userReport/_components/ImportantAccountsSection';
import { getUserReport } from '@/lib/user-report';

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const standardNumber = new Intl.NumberFormat('en-US');

const percentFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatCompact(value: number) {
  return compactNumber.format(value);
}

function formatPercent(value: number) {
  return `${percentFormatter.format(value)}%`;
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

type SectionProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

// Ink-style Section Component (Non-collapsible, "Lab Report" feel)
function ReportSection({ title, description, children }: SectionProps) {
  return (
    <section className="mb-16">
      <div className="flex items-baseline justify-between mb-6 border-b-2 border-foreground pb-1">
        <div>
          <h3 className="font-sans text-2xl font-bold inline-block">
            {title}
          </h3>
        </div>
      </div>
      {description && (
        <p className="font-sans text-muted-foreground italic mb-6 -mt-4 text-sm">
          {description}
        </p>
      )}
      <div className="border-l-2 border-foreground/10 pl-0 md:pl-0 border-none">
        {children}
      </div>
    </section>
  );
}

type PostMetricKey =
  | 'replies'
  | 'retweets'
  | 'likes'
  | 'bookmarks'
  | 'quotes'
  | 'views'
  | 'totalEngagers';

interface PageParams {
  identifier: string;
}

export default async function UserReportPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { identifier } = await params;
  const report = await getUserReport(identifier);

  if (!report) {
    return (
      <div className="min-h-screen pb-20">
        <Navbar />
        <div className="max-w-5xl mx-auto px-4 md:px-6 pt-20 md:pt-24">
          <div className="border-2 border-dashed border-foreground/30 p-12 text-center">
            <h1 className="font-sans text-2xl font-bold mb-4">No Data Logged</h1>
            <p className="font-mono text-sm text-muted-foreground mb-8">
              Subject “{identifier}” has no analyzed tweets in the archive.
            </p>
            <div className="flex justify-center gap-4">
              <Link
                href="/tweets"
                className="font-mono text-xs uppercase border border-foreground px-4 py-2 hover:bg-foreground hover:text-background transition-colors"
              >
                Browse Index
              </Link>
              <Link
                href="/monitor"
                className="font-mono text-xs uppercase bg-foreground text-background border border-foreground px-4 py-2 hover:bg-transparent hover:text-foreground transition-colors"
              >
                Initiate Monitor
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const metricEntries = [
    { label: 'Total Likes', value: report.metricTotals.likes },
    { label: 'Total Retweets', value: report.metricTotals.retweets },
    { label: 'Total Quotes', value: report.metricTotals.quotes },
    { label: 'Total Replies', value: report.metricTotals.replies },
    { label: 'Total Views', value: report.metricTotals.views },
    { label: 'Total Bookmarks', value: report.metricTotals.bookmarks },
  ];

  const engagementBasics = [
    {
      label: 'Total engagements',
      value: standardNumber.format(report.engagers.totalEngagements),
    },
    {
      label: 'Unique engagers',
      value: standardNumber.format(report.engagers.uniqueEngagers),
    },
    {
      label: 'Repeat Rate',
      value: report.engagers.totalEngagements > 0
          ? formatPercent((report.engagers.repeatEngagements / report.engagers.totalEngagements) * 100)
          : '0%',
      helper: 'of all engagements',
    },
  ];

  const verificationStats = [
    {
      label: 'Verified',
      value: standardNumber.format(report.engagers.verifiedCount),
    },
    {
      label: 'Non-verified',
      value: standardNumber.format(report.engagers.nonVerifiedCount),
    },
    {
      label: 'High Value (≥10K)',
      value: `${standardNumber.format(report.engagers.highFollowerCount)}`,
      helper: `(${formatPercent(report.engagers.highFollowerShare)})`,
    },
  ];

  const engagementMix = [
    { label: 'Replied', value: formatPercent(report.engagers.engagementMix.repliedPct) },
    {
      label: 'Retweeted',
      value: formatPercent(report.engagers.engagementMix.retweetedPct),
    },
    { label: 'Quoted', value: formatPercent(report.engagers.engagementMix.quotedPct) },
  ];

  const importanceStats = [
    {
      label: 'Avg. Importance',
      value: report.engagers.importance.average.toFixed(2),
    },
    {
      label: 'Max Importance',
      value: report.engagers.importance.max.toFixed(2),
    },
    {
      label: 'High-Signal Count',
      value: standardNumber.format(report.engagers.importance.population),
    },
  ];

  const hasTimeline = report.timeline.points.length > 0;

  // Simplified metric config for the table/log
  const postMetricConfig: {
    key: PostMetricKey;
    label: string;
    shortLabel: string;
  }[] = [
    { key: 'views', label: 'Views', shortLabel: 'VWS' },
    { key: 'likes', label: 'Likes', shortLabel: 'LKS' },
    { key: 'retweets', label: 'Retweets', shortLabel: 'RTS' },
    { key: 'replies', label: 'Replies', shortLabel: 'REP' },
    { key: 'quotes', label: 'Quotes', shortLabel: 'QTS' },
    { key: 'bookmarks', label: 'Bookmarks', shortLabel: 'BKM' },
    { key: 'totalEngagers', label: 'Engagers', shortLabel: 'ENG' },
  ];

  return (
    <div className="min-h-screen pb-20">
      <Navbar />
      
      <div className="max-w-5xl mx-auto px-4 md:px-6 pt-20 md:pt-24">
        {/* Lab Report Header */}
        <div className="mb-12 border-b-2 border-foreground pb-6">
            <div className="flex justify-between items-start mb-6">
                <Link href="/client" className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground hover:underline">
                    ← Back to Clients
                </Link>
                <div className="font-mono text-xs uppercase text-right text-muted-foreground">
                    <div>User</div>
                    <div>{identifier}</div>
                </div>
            </div>

            <h1 className="text-3xl md:text-5xl lg:text-6xl font-sans font-bold text-foreground mb-6 leading-tight ink-text break-words">
                {report.author.name}
            </h1>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 border-t border-dotted border-foreground/50 pt-4">
                <div>
                    <div className="lab-header-item">HANDLE</div>
                    <div className="lab-header-value">
                        {report.author.username ? `@${report.author.username.replace('@', '')}` : 'UNKNOWN'}
                    </div>
                </div>
                <div>
                    <div className="lab-header-item">TOTAL ANALYZED</div>
                    <div className="lab-header-value">{report.timeline.points.length} TWEETS</div>
                </div>
                 <div>
                    <div className="lab-header-item">LAST UPDATED</div>
                    <div className="lab-header-value">{formatDate(new Date().toISOString())}</div>
                </div>
                 <div>
                    <div className="lab-header-item">TOTAL REACH</div>
                    <div className="lab-header-value">{formatCompact(report.metricTotals.views)}</div>
                </div>
            </div>
        </div>

        {/* I. Posts (Timeline) - Styled as Data Log */}
        {hasTimeline && (
            <ReportSection title="I. Posts">
                <div className="overflow-x-auto border border-foreground">
                    <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-foreground text-background">
                            <tr>
                                <th className="p-3 uppercase tracking-wider font-normal">Date / Tweet</th>
                                {postMetricConfig.map(m => (
                                    <th key={m.key} className="p-3 text-right uppercase tracking-wider font-normal w-16">{m.shortLabel}</th>
                                ))}
                                <th className="p-3 text-right uppercase tracking-wider font-normal">Link</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-foreground/20">
                            {[...report.timeline.points]
                                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                                .map((point) => (
                                <tr key={point.tweetId} className="hover:bg-foreground/5">
                                    <td className="p-3">
                                        <div className="font-bold">{formatDate(point.createdAt)}</div>
                                        <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">ID: {point.tweetId}</div>
                                    </td>
                                    {postMetricConfig.map((metric) => {
                                        const value =
                                            metric.key === 'totalEngagers' ? point.totalEngagers :
                                            metric.key === 'views' ? point.views :
                                            metric.key === 'likes' ? point.likes :
                                            metric.key === 'retweets' ? point.retweets :
                                            metric.key === 'replies' ? point.replies :
                                            metric.key === 'bookmarks' ? point.bookmarks :
                                            point.quotes;
                                        return (
                                            <td key={metric.key} className="p-3 text-right tabular-nums">
                                                {typeof value === 'number' ? formatCompact(value) : '-'}
                                            </td>
                                        );
                                    })}
                                    <td className="p-3 text-right">
                                        <div className="flex justify-end gap-2">
                                            <Link href={`/tweets/${point.tweetId}`} className="underline hover:text-foreground/70">
                                                REPORT
                                            </Link>
                                            <a href={point.tweetUrl} target="_blank" className="text-muted-foreground hover:text-foreground">
                                                ↗
                                            </a>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </ReportSection>
        )}

        {/* II. Aggregate Metrics */}
        <ReportSection title="II. Aggregate Metrics">
            <div className="border-y-2 border-foreground overflow-hidden">
                <div className="grid grid-cols-3 md:grid-cols-6 divide-x divide-foreground bg-white/20">
                    {metricEntries.map((m, i) => (
                        <div key={i} className="p-4 text-center">
                            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{m.label.replace('Total ', '')}</div>
                            <div className="font-mono text-2xl font-bold tabular-nums ink-text">{formatCompact(m.value || 0)}</div>
                        </div>
                    ))}
                </div>
            </div>
        </ReportSection>

        {/* III. Engagement Intelligence */}
        <ReportSection title="III. Engagement Intelligence" description="Deduplicated analysis of unique user interactions.">
             <div className="grid gap-8 lg:grid-cols-2">
                {/* Volume & Quality Block */}
                <div className="border border-foreground p-6 bg-foreground/5">
                    <h4 className="font-mono text-xs uppercase tracking-widest mb-4 border-b border-foreground/20 pb-2">Volume & Verification</h4>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            {engagementBasics.map((entry) => (
                                <div key={entry.label}>
                                    <div className="font-mono text-[10px] uppercase text-muted-foreground">{entry.label}</div>
                                    <div className="font-sans text-xl font-bold">{entry.value}</div>
                                    {entry.helper && <div className="font-mono text-[10px] text-muted-foreground">{entry.helper}</div>}
                                </div>
                            ))}
                        </div>
                        <div className="h-px bg-foreground/20 my-2"></div>
                        <div className="grid grid-cols-3 gap-2">
                             {verificationStats.map((entry) => (
                                <div key={entry.label}>
                                    <div className="font-mono text-[10px] uppercase text-muted-foreground">{entry.label}</div>
                                    <div className="font-sans text-lg font-bold">{entry.value}</div>
                                    {entry.helper && <div className="font-mono text-[10px] text-muted-foreground">{entry.helper}</div>}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Signals Block */}
                <div className="border border-foreground p-6 bg-foreground/5">
                    <h4 className="font-mono text-xs uppercase tracking-widest mb-4 border-b border-foreground/20 pb-2">Signals & Mix</h4>
                    <div className="space-y-6">
                        <div>
                            <div className="font-mono text-[10px] uppercase text-muted-foreground mb-2">Importance Scores</div>
                            <div className="grid grid-cols-3 gap-2">
                                {importanceStats.map((entry) => (
                                    <div key={entry.label}>
                                        <div className="font-sans text-lg font-bold">{entry.value}</div>
                                        <div className="font-mono text-[9px] uppercase text-muted-foreground">{entry.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        <div>
                            <div className="font-mono text-[10px] uppercase text-muted-foreground mb-2">Action Distribution</div>
                            <div className="flex gap-4">
                                {engagementMix.map((entry) => (
                                    <div key={entry.label} className="border border-foreground/20 px-2 py-1 flex-1 text-center bg-white/40">
                                        <div className="font-sans font-bold">{entry.value}</div>
                                        <div className="font-mono text-[9px] uppercase text-muted-foreground">{entry.label.split(' ')[0]}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
             </div>

             <div className="mt-8">
                <figure className="relative">
                    <div className="border border-foreground p-4 bg-white/20">
                        <FollowerTierChart tiers={report.engagers.followerTiers} />
                    </div>
                    <figcaption>Fig 1.0 - Follower Tier Distribution</figcaption>
                </figure>
             </div>
        </ReportSection>

        {/* IV. Heatmap of Accounts */}
        <ReportSection title="IV. Heatmap of Accounts">
            <figure className="border border-foreground p-0 bg-blue-50/20">
                <UserReportHeatmapSection identifier={identifier} />
            </figure>
            <figcaption>Fig 2.0 - Audience Heatmap</figcaption>
        </ReportSection>

        {/* V. Profile Classification */}
        <ReportSection title="V. Profile Classification">
             <figure className="border border-foreground p-6 bg-white/20">
                {report.profileDistribution.totalEngagers === 0 ? (
                    <div className="text-center font-mono text-xs text-muted-foreground py-8">
                        INSUFFICIENT DATA FOR CLASSIFICATION
                    </div>
                ) : (
                    <ProfileTypeDistributionSection distribution={report.profileDistribution} />
                )}
             </figure>
             <figcaption>Fig 3.0 - Professional Segmentation</figcaption>
        </ReportSection>

        {/* VI. Important Accounts */}
        <ReportSection title="VI. Important Accounts" description="Ranked by importance score.">
          <ImportantAccountsSection identifier={identifier} initialLimit={50} />
        </ReportSection>

        {/* Footer Stamp */}
        <div className="mt-24 mb-12 text-center opacity-50">
            <div className="inline-block border-2 border-foreground p-4 transform -rotate-2">
                <div className="font-mono text-xs uppercase tracking-widest mb-1">BrandWorks</div>
                <div className="font-sans italic text-sm">Confidential User Analysis</div>
            </div>
        </div>
      </div>
    </div>
  );
}