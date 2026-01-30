'use client';

import { ReactNode } from 'react';

interface RouteScalerProps {
  children: ReactNode;
}

export default function RouteScaler({ children }: RouteScalerProps) {
  // Apply 75% zoom globally (mimics browser Ctrl+- zoom).
  // Using the non-standard `zoom` property because it scales layout + text together
  // similarly to browser zoom (what you get with Ctrl + -).
  // IMPORTANT:
  // `PaperTextureOverlay` is a fixed-position SVG that includes an opaque base fill.
  // Fixed/positioned elements paint above normal document flow by default, so without
  // an explicit stacking order the overlay can visually cover the entire app (appears "blank").
  // We fix that by ensuring the app content creates a positioned stacking context above it.
  const containerStyle = { zoom: 0.75, position: 'relative', zIndex: 1 } as const;

  return (
    <div style={containerStyle}>
      {children}
    </div>
  );
}

