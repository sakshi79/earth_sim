// Place names and search via OpenStreetMap Nominatim. Usage policy: at most 1 request per
// second, no search-as-you-type, credit © OpenStreetMap contributors.
import { sources } from '../config.ts';
import { PacedJsonClient } from './pacedClient.ts';

const client = new PacedJsonClient(1100);

interface NominatimAddress {
  [key: string]: string | undefined;
}

export interface NominatimResult {
  place_id?: number;
  lat: string;
  lon: string;
  importance?: number;
  name?: string;
  display_name?: string;
  address?: NominatimAddress;
  error?: string;
}

export interface SearchHit {
  label: string;
  lat: number;
  lon: number;
}

const LOCAL_KEYS = [
  'village', 'town', 'city', 'hamlet', 'suburb', 'municipality', 'county',
  'state_district', 'state', 'region', 'archipelago', 'island',
] as const;

/** A short "place, region, country" label from a Nominatim result, or null if it has nothing. */
export function placeLabel(result: Pick<NominatimResult, 'name' | 'display_name' | 'address' | 'error'>): string | null {
  if (result.error) return null;
  const address = result.address ?? {};
  const local = result.name || LOCAL_KEYS.map((k) => address[k]).find(Boolean);
  const parts: string[] = [];
  for (const part of [local, address.state, address.country]) {
    if (part && !parts.includes(part)) parts.push(part);
  }
  if (parts.length > 0) return parts.join(', ');
  return result.display_name?.split(',').slice(0, 3).map((s) => s.trim()).join(', ') || null;
}

export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  // Rounded to ~100 m so nearby clicks share the cache.
  const url = `${sources.nominatim}/reverse?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&format=jsonv2&zoom=10&addressdetails=1&accept-language=en`;
  return placeLabel(await client.getJson<NominatimResult>(url));
}

/** OpenStreetMap often names natural features without the generic word ("Kilimanjaro"). */
export function simplifyQuery(query: string): string {
  return query.replace(/^\s*(mount|mt\.?|mountain|the)\s+/i, '').trim();
}

/** Most important first, duplicates removed, at most `limit`. */
export function rankResults(results: readonly NominatimResult[], limit = 6): NominatimResult[] {
  const seen = new Set<number | string>();
  return [...results]
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    .filter((r) => {
      const key = r.place_id ?? `${r.lat},${r.lon}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export async function searchPlaces(query: string): Promise<SearchHit[]> {
  const search = (q: string): Promise<NominatimResult[]> =>
    client.getJson<NominatimResult[]>(
      `${sources.nominatim}/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=8&addressdetails=1&accept-language=en`,
    );
  let results = await search(query);
  // Only minor matches (e.g. "Mount Kilimanjaro" → a school): also try without the generic word.
  const simpler = simplifyQuery(query);
  if (Math.max(0, ...results.map((r) => r.importance ?? 0)) < 0.2 && simpler && simpler !== query.trim()) {
    results = [...results, ...(await search(simpler))];
  }
  return rankResults(results).map((r) => ({
    label: r.display_name?.split(',').slice(0, 3).map((s) => s.trim()).join(', ') ?? placeLabel(r) ?? query,
    lat: Number(r.lat),
    lon: Number(r.lon),
  }));
}
