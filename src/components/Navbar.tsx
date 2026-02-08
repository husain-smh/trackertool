'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

export default function Navbar() {
  const pathname = usePathname();

  const navItems = [
    { name: 'Home', href: '/' },
    { name: 'Campaigns', href: '/socap' },
    { name: 'Monitor', href: '/monitor' },
    // Hidden for now — will be re-enabled as new features:
    // { name: 'Quote Tweets', href: '/quotetweets' },
    // { name: 'Engagement', href: '/twtengagement' },
    // { name: 'Ranker', href: '/ranker' },
    // { name: 'Tweets', href: '/tweets' },
    // { name: 'Client', href: '/client' },
    // { name: 'Notifications', href: '/notifications' },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-b border-border text-foreground">
      <div className="max-w-[1200px] mx-auto px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo/Brand */}
          <Link href="/" className="flex items-center gap-2 group">
             {/* Assuming image is transparent/suitable, otherwise might need filter */}
            <Image
              src="/social-capital-logo.png"
              alt="BrandWorks Logo"
              width={28}
              height={28}
              className="object-contain rounded"
            />
            <span className="font-sans text-lg font-bold text-foreground group-hover:opacity-70 transition-opacity">
              BrandWorks
            </span>
          </Link>

          {/* Navigation Items */}
          <div className="flex items-center gap-8 overflow-x-auto">
            {navItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-sm font-mono uppercase tracking-widest transition-colors whitespace-nowrap border-b-2 py-1 ${
                    isActive
                      ? 'text-foreground border-foreground'
                      : 'text-muted-foreground border-transparent hover:text-foreground hover:border-muted-foreground'
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}

