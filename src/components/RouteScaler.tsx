'use client';

import { ReactNode } from 'react';

interface RouteScalerProps {
  children: ReactNode;
}

export default function RouteScaler({ children }: RouteScalerProps) {
  return (
    <div style={{ position: 'relative', zIndex: 1 }}>
      {children}
    </div>
  );
}
