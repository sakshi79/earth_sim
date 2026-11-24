// Nearby species from iNaturalist. Usage: ≤ 1 request/s, credit photos individually.
import { sources } from '../config.ts';
import { PacedJsonClient } from './pacedClient.ts';

const client = new PacedJsonClient(1100, 15_000);

export type TaxonGroup = 'bird' | 'mammal' | 'reptile' | 'amphibian' | 'fish' | 'insect' | 'plant' | 'fungus' | 'other';

export interface NearbySpecies {
  id: number;
  name: string;
  commonName: string;
  group: TaxonGroup;
  photoUrl: string | null;
  photoAttribution: string | null;
  observationCount: number;
  conservation: string | null;
}

interface INatTaxon {
  id: number;
  name: string;
  preferred_common_name?: string;
  iconic_taxon_name?: string;
  default_photo?: { medium_url?: string; attribution?: string };
  conservation_status?: { status_name?: string };
  observations_count?: number;
}

const GROUP_MAP: Record<string, TaxonGroup> = {
  Aves: 'bird',
  Mammalia: 'mammal',
  Reptilia: 'reptile',
  Amphibia: 'amphibian',
  Actinopterygii: 'fish',
  Insecta: 'insect',
  Arachnida: 'insect',
  Plantae: 'plant',
  Fungi: 'fungus',
  Mollusca: 'other',
  Chromista: 'plant',
};

function toGroup(iconic: string | undefined): TaxonGroup {
  return (iconic ? GROUP_MAP[iconic] : undefined) ?? 'other';
}

function toSpecies(taxon: INatTaxon, count: number): NearbySpecies {
  return {
    id: taxon.id,
    name: taxon.name,
    commonName: taxon.preferred_common_name ?? taxon.name,
    group: toGroup(taxon.iconic_taxon_name),
    photoUrl: taxon.default_photo?.medium_url ?? null,
    photoAttribution: taxon.default_photo?.attribution ?? null,
    observationCount: count,
    conservation: taxon.conservation_status?.status_name ?? null,
  };
}

/**
 * Top species observed near a point, widening the radius if sparse.
 * Returns up to `limit` species sorted by observation count (most common first).
 */
export async function fetchNearbySpecies(
  lat: number,
  lon: number,
  options: { limit?: number; radiusKm?: number; aquatic?: boolean } = {},
): Promise<NearbySpecies[]> {
  const limit = options.limit ?? 40;
  const startRadius = options.radiusKm ?? (options.aquatic ? 30 : 15);

  for (const radius of [startRadius, startRadius * 2, 100]) {
    const species = await querySpecies(lat, lon, radius, limit);
    if (species.length >= 10 || radius >= 100) return species;
  }
  return [];
}

async function querySpecies(lat: number, lon: number, radiusKm: number, limit: number): Promise<NearbySpecies[]> {
  const url =
    `${sources.inaturalist}/observations/species_counts?` +
    `lat=${lat}&lng=${lon}&radius=${radiusKm}` +
    `&quality_grade=research&per_page=${limit}` +
    `&order_by=count`;
  const data = await client.getJson<{
    results?: { taxon: INatTaxon; count: number }[];
  }>(url);
  return (data.results ?? []).map((r) => toSpecies(r.taxon, r.count));
}

/** Fetch a Wikipedia summary for a species (best effort). */
export async function fetchSpeciesSummary(scientificName: string): Promise<string | null> {
  try {
    const url = sources.wikipediaSummary(scientificName);
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = (await response.json()) as { extract?: string };
    return data.extract ?? null;
  } catch {
    return null;
  }
}
