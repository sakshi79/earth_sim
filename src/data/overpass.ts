import { sources } from '../config.ts';

export interface OverpassRoad {
  highway: string;
  name: string | null;
  geometry: { lat: number; lon: number }[];
}

export interface OverpassPOI {
  name: string;
  category: string;
  lat: number;
  lon: number;
}

async function query(body: string): Promise<unknown> {
  const response = await fetch(sources.overpass, {
    method: 'POST',
    body: `data=${encodeURIComponent(body)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Overpass ${response.status}`);
  return response.json();
}

export async function queryRoads(south: number, west: number, north: number, east: number): Promise<OverpassRoad[]> {
  const bbox = `${south},${west},${north},${east}`;
  const data = (await query(`[out:json][timeout:15];(way["highway"](${bbox}););out geom;`)) as {
    elements?: { type: string; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[];
  };
  return (data.elements ?? [])
    .filter((e) => e.type === 'way' && e.geometry)
    .map((e) => ({
      highway: e.tags?.highway ?? 'unclassified',
      name: e.tags?.name ?? null,
      geometry: e.geometry!,
    }));
}

export async function queryPOIs(south: number, west: number, north: number, east: number): Promise<OverpassPOI[]> {
  const bbox = `${south},${west},${north},${east}`;
  const body = `[out:json][timeout:15];(
    node["name"]["tourism"~"viewpoint|attraction|museum|information"](${bbox});
    node["name"]["natural"~"peak|cliff|cave_entrance|spring|waterfall|beach|bay|cape|volcano"](${bbox});
    node["name"]["amenity"~"place_of_worship|shelter"](${bbox});
    node["name"]["historic"](${bbox});
    node["name"]["place"~"hamlet|village|town|city|suburb|neighbourhood|locality"](${bbox});
  );out body;`;
  const data = (await query(body)) as {
    elements?: { type: string; tags?: Record<string, string>; lat: number; lon: number }[];
  };
  return (data.elements ?? [])
    .filter((e) => e.type === 'node' && e.tags?.name)
    .map((e) => ({
      name: e.tags!.name!,
      category: e.tags!.tourism ?? e.tags!.natural ?? e.tags!.amenity ?? e.tags!.historic ?? e.tags!.place ?? 'other',
      lat: e.lat,
      lon: e.lon,
    }));
}
