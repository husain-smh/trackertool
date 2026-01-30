'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import SocapNavbar from '@/components/SocapNavbar';

export default function SocapShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '';
  const showNav = !pathname.startsWith('/socap/auth');

  return (
    <div className="socap-scope min-h-screen bg-background text-foreground font-sans">
      {showNav ? <SocapNavbar /> : null}
      <div className={showNav ? 'pt-20' : ''}>{children}</div>
    </div>
  );
}



