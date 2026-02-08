'use client';

import Link from 'next/link';
import Navbar from '@/components/Navbar';

export default function Home() {
  const tools = [
    {
      name: 'Campaigns',
      description: 'Create and monitor campaigns with alerts, metrics, and dashboards.',
      href: '/socap',
    },
    {
      name: 'Monitored Tweets',
      description: 'Track real-time engagement metrics over 72 hours.',
      href: '/monitor',
    },
    // Hidden for now — will be re-enabled as new features:
    // { name: 'Quote Tweets', description: 'Analyze quote tweet engagement and viral content performance.', href: '/quotetweets' },
    // { name: 'Engagement Analysis', description: 'Deep-dive into tweet engagement patterns and user interaction data.', href: '/twtengagement' },
    // { name: 'Importance Ranker', description: 'Manage important people and rank tweet engagers.', href: '/ranker' },
    // { name: 'Tweets Analyzed', description: 'View all analyzed tweets and their metrics.', href: '/tweets' },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Navbar />

      <main className="relative pt-24 md:pt-32 pb-12 md:pb-20 px-4 md:px-6">
        {/* Header Section */}
        <div className="max-w-[800px] mx-auto text-center mb-12 md:mb-24">
          <h1 className="text-4xl md:text-[3.5rem] leading-[1.2] font-bold mb-6 md:mb-8 text-foreground">
            BrandWorks
          </h1>

          <p className="text-[1.125rem] leading-[1.75] text-muted-foreground max-w-[65ch] mx-auto">
            Social analytics and intelligence tools.
          </p>
        </div>

        {/* Tools Grid */}
        <div className="max-w-[1200px] mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tools.map((tool, index) => (
              <Link key={index} href={tool.href} className="group h-full">
                <div className="h-full bg-card border border-border rounded-lg p-8 transition-all duration-300 hover:border-[#1D9BF0] hover:shadow-[0_0_20px_rgba(29,155,240,0.1)]">
                  <div className="flex flex-col h-full">
                    <h2 className="text-[1.5rem] leading-[1.5] font-semibold text-foreground mb-4 group-hover:text-[#1D9BF0] transition-colors">
                      {tool.name}
                    </h2>

                    <p className="text-muted-foreground text-[1.125rem] leading-[1.75] flex-grow">
                      {tool.description}
                    </p>

                    <div className="mt-8 pt-6 border-t border-border flex items-center justify-between text-sm text-foreground">
                      <span>Access Tool</span>
                      <span className="group-hover:translate-x-1 transition-transform text-[#1D9BF0]">&rarr;</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-32 py-12 border-t border-border text-center">
          <p className="text-muted-foreground text-sm">
            BrandWorks
          </p>
        </div>
      </main>
    </div>
  );
}

