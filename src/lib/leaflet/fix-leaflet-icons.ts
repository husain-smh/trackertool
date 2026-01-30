'use client';

// Leaflet default marker icons often fail to load in bundlers (including Next.js)
// because Leaflet's internal icon path resolution relies on runtime URLs.
//
// This "fix" explicitly points Leaflet to the bundled marker images.
// Safe to import from any client component.

import L from 'leaflet';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

function normalizeAssetUrl(asset: unknown): string {
  if (typeof asset === 'string') return asset;
  if (asset && typeof asset === 'object' && 'src' in asset && typeof (asset as any).src === 'string') {
    return (asset as any).src;
  }
  return '';
}

const iconRetinaUrl = normalizeAssetUrl(markerIcon2x);
const iconUrl = normalizeAssetUrl(markerIcon);
const shadowUrl = normalizeAssetUrl(markerShadow);

// Only patch if we can resolve all asset URLs.
if (iconUrl && iconRetinaUrl && shadowUrl) {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl,
    iconUrl,
    shadowUrl,
  });
}


