// Deep links: #/visit/<lat>,<lon>. They work on static hosting because only the hash changes.
import type { LatLon } from './geo/sphere.ts';

const VISIT = /^#\/visit\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;

export function parseVisitHash(hash: string): LatLon | null {
  const match = VISIT.exec(hash.trim());
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function formatVisitHash(lat: number, lon: number): string {
  return `#/visit/${lat.toFixed(5)},${lon.toFixed(5)}`;
}
