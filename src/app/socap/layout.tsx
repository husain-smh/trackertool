import type { ReactNode } from 'react';
import './socap.css';
import SocapShell from '@/components/SocapShell';

export default function SocapLayout({ children }: { children: ReactNode }) {
  return <SocapShell>{children}</SocapShell>;
}


