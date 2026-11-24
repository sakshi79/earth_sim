import type { NearbySpecies } from './inaturalist.ts';

const STORAGE_KEY = 'earth-sim-journal';

export interface JournalEntry {
  name: string;
  commonName: string;
  group: string;
  firstSeen: string;
  place: string;
  points: number;
}

export interface PlaceProgress {
  species: number;
  points: number;
  stars: number;
}

const STAR_THRESHOLDS = [3, 8, 20];

export function rarityPoints(species: NearbySpecies): number {
  const count = species.observationCount;
  if (count >= 500) return 1;
  if (count >= 100) return 3;
  if (count >= 20) return 5;
  if (count >= 5) return 10;
  return 25;
}

export function readJournal(): Record<number, JournalEntry> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch { return {}; }
}

export function recordObservation(species: NearbySpecies, placeName: string): { points: number; isNew: boolean } {
  const journal = readJournal();
  const pts = rarityPoints(species);
  if (journal[species.id]) return { points: pts, isNew: false };
  journal[species.id] = {
    name: species.name,
    commonName: species.commonName,
    group: species.group,
    firstSeen: new Date().toISOString(),
    place: placeName,
    points: pts,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(journal)); } catch { /* full */ }
  return { points: pts, isNew: true };
}

export function placeProgress(placeName: string): PlaceProgress {
  const journal = readJournal();
  let species = 0;
  let points = 0;
  for (const entry of Object.values(journal)) {
    if (entry.place === placeName) {
      species++;
      points += entry.points;
    }
  }
  const stars = STAR_THRESHOLDS.filter((t) => species >= t).length;
  return { species, points, stars };
}

export function totalStats(): { species: number; points: number; places: number } {
  const journal = readJournal();
  const entries = Object.values(journal);
  const places = new Set(entries.map((e) => e.place));
  return {
    species: entries.length,
    points: entries.reduce((sum, e) => sum + e.points, 0),
    places: places.size,
  };
}
