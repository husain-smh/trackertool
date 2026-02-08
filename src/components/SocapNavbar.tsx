'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SocapNavbar() {
  const pathname = usePathname();

  const navItems = [
    { name: 'Campaigns', href: '/socap' },
    { name: 'Settings', href: '/socap/settings' },
    { name: 'Monitor', href: '/monitor' },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-border shadow-sm">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/socap" className="flex items-center group">
          <span className="text-foreground font-bold text-lg tracking-tight group-hover:opacity-70 transition-opacity">
            BrandWorks
          </span>
        </Link>

        <div className="flex items-center gap-6">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/socap' && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm font-medium transition-colors border-b-2 py-1 ${
                  isActive
                    ? 'text-primary border-primary'
                    : 'text-muted-foreground border-transparent hover:text-foreground hover:border-muted-foreground'
                }`}
              >
                {item.name}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
