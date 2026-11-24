import { readJournal } from './journal.ts';

export interface Badge {
  id: string;
  name: string;
  description: string;
  earned: boolean;
}

interface BadgeDef {
  id: string;
  name: string;
  description: string;
  check: (journal: ReturnType<typeof readJournal>) => boolean;
}

const DEFINITIONS: BadgeDef[] = [
  { id: 'first-find', name: 'First Find', description: 'Observe your first species',
    check: (j) => Object.keys(j).length >= 1 },
  { id: 'keen-eye', name: 'Keen Eye', description: 'Observe 10 species',
    check: (j) => Object.keys(j).length >= 10 },
  { id: 'naturalist', name: 'Naturalist', description: 'Observe 25 species',
    check: (j) => Object.keys(j).length >= 25 },
  { id: 'encyclopedist', name: 'Encyclopedist', description: 'Observe 50 species',
    check: (j) => Object.keys(j).length >= 50 },
  { id: 'bird-watcher', name: 'Bird Watcher', description: 'Observe 5 bird species',
    check: (j) => Object.values(j).filter((e) => e.group === 'bird').length >= 5 },
  { id: 'marine-biologist', name: 'Marine Biologist', description: 'Observe 5 fish species',
    check: (j) => Object.values(j).filter((e) => e.group === 'fish').length >= 5 },
  { id: 'globetrotter', name: 'Globetrotter', description: 'Find species at 3 different places',
    check: (j) => new Set(Object.values(j).map((e) => e.place)).size >= 3 },
  { id: 'world-explorer', name: 'World Explorer', description: 'Find species at 10 different places',
    check: (j) => new Set(Object.values(j).map((e) => e.place)).size >= 10 },
  { id: 'rare-find', name: 'Rare Find', description: 'Observe a species worth 10+ points',
    check: (j) => Object.values(j).some((e) => e.points >= 10) },
  { id: 'legendary', name: 'Legendary', description: 'Observe a species worth 25 points',
    check: (j) => Object.values(j).some((e) => e.points >= 25) },
];

export function checkBadges(): Badge[] {
  const journal = readJournal();
  return DEFINITIONS.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    earned: d.check(journal),
  }));
}

export function newlyEarned(): Badge[] {
  try {
    const key = 'earth-sim-badges-seen';
    const seen: string[] = JSON.parse(localStorage.getItem(key) ?? '[]');
    const all = checkBadges();
    const fresh = all.filter((b) => b.earned && !seen.includes(b.id));
    if (fresh.length > 0) {
      localStorage.setItem(key, JSON.stringify(all.filter((b) => b.earned).map((b) => b.id)));
    }
    return fresh;
  } catch { return []; }
}
