// What grows where around the player: deterministic, data-driven placement rules for grass,
// shrubs, rocks, trees and coral. Pure and Node-safe (unit-tested); the 3D side is vegetation.ts.
import type { LandscapeType } from '../geo/landscape.ts';

export type PlantKind = 'grass' | 'shrub' | 'rock' | 'broadleaf' | 'conifer' | 'acacia' | 'palm' | 'cactus' | 'coral';

/** What the scatter knows about a spot. */
export interface Site {
  /** Ground (or sea floor) height in metres. */
  height: number;
  /** Rise over run of the ground (0 = flat, 1 = 45°). */
  slope: number;
  /** Over open sea. */
  water: boolean;
  /** Satellite imagery colour at the spot, 0–255. */
  rgb: readonly [number, number, number];
}

export interface PlaceContext {
  landscape: LandscapeType | null;
  lat: number;
  lon: number;
}

/** How densely each kind grows (chance per placement cell) in each landscape, before local rules. */
const DENSITY: Record<LandscapeType, Partial<Record<PlantKind, number>>> = {
  ocean: { grass: 0.5, shrub: 0.25, rock: 0.15, broadleaf: 0.25, palm: 0.35, conifer: 0.1, coral: 0.6 },
  coast: { grass: 0.5, shrub: 0.25, rock: 0.15, broadleaf: 0.25, palm: 0.35, conifer: 0.1, coral: 0.6 },
  desert: { grass: 0.08, shrub: 0.12, rock: 0.25, cactus: 0.03, acacia: 0.01 },
  grassland: { grass: 0.9, shrub: 0.15, rock: 0.06, acacia: 0.02, broadleaf: 0.015 },
  rainforest: { grass: 0.3, shrub: 0.4, broadleaf: 0.55, palm: 0.08, rock: 0.02 },
  'temperate forest': { grass: 0.6, shrub: 0.25, broadleaf: 0.35, conifer: 0.25, rock: 0.05 },
  'boreal forest': { grass: 0.4, shrub: 0.2, conifer: 0.6, rock: 0.08 },
  tundra: { grass: 0.6, shrub: 0.1, rock: 0.2 },
  mountain: { grass: 0.35, shrub: 0.1, rock: 0.35, conifer: 0.3, broadleaf: 0.05 },
  ice: { rock: 0.05 },
};

const TREES: readonly PlantKind[] = ['broadleaf', 'conifer', 'acacia', 'palm', 'cactus'];

/** The kinds that can grow at all in a landscape. */
export function kindsFor(landscape: LandscapeType | null): PlantKind[] {
  return Object.keys(DENSITY[landscape ?? 'grassland']) as PlantKind[];
}

/** Altitude above which trees stop growing: ~3,900 m in the tropics, falling toward the poles. */
export function treelineM(lat: number): number {
  return 3900 - Math.max(0, Math.abs(lat) - 20) * 70;
}

/** Chance (0–1) that a placement cell at this site holds a plant of this kind. */
export function plantChance(kind: PlantKind, site: Site, place: PlaceContext): number {
  const base = DENSITY[place.landscape ?? 'grassland'][kind] ?? 0;
  if (base === 0) return 0;
  const absLat = Math.abs(place.lat);
  const tropical = absLat < 25;

  // Coral: shallow, sunlit sea floor in warm water only.
  if (kind === 'coral') {
    const depth = -site.height;
    return site.water && absLat < 32 && depth > 0.5 && depth < 25 ? base * (1 - depth / 25) : 0;
  }
  if (site.water || site.height < 0.2) return 0;

  // Regional fit.
  if ((kind === 'palm' || kind === 'acacia') && !tropical) return 0;
  if (kind === 'palm' && site.height > 60) return 0; // palms by the coast and in the lowland tropics
  if (kind === 'cactus' && !(place.lon > -170 && place.lon < -30)) return 0; // cacti are American
  if (kind === 'conifer' && tropical && place.landscape !== 'mountain') return 0;

  const [r, g, b] = site.rgb;
  const brightness = (r + g + b) / 3;
  const max = Math.max(r, g, b);
  const saturation = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
  const greenness = g + r === 0 ? 0 : (g - r) / (g + r);
  const snow = brightness > 200 && saturation < 0.12;
  if (snow) return kind === 'rock' ? base * 0.5 : 0;

  // Altitude.
  const treeline = treelineM(place.lat);
  if (TREES.includes(kind) && site.height > treeline) return 0;
  if (kind === 'shrub' && site.height > treeline + 300) return 0;
  if (kind === 'grass' && site.height > treeline + 800) return 0;

  // Slope: plants give way to bare rock on steep ground.
  const steep = smoothstep(0.7, 1.2, site.slope);
  if (kind === 'rock') return Math.min(1, base * (0.5 + 1.5 * site.slope));
  if (TREES.includes(kind) && site.slope > 0.7) return 0;

  // What the satellite sees: dark green means canopy, bright bare ground means sand or rock.
  const canopy = smoothstep(-0.06, 0.08, greenness) * (1 - smoothstep(90, 150, brightness));
  const vegetated = (1 - smoothstep(150, 205, brightness)) * (greenness > -0.2 ? 1 : 0.3);
  let fit: number;
  if (kind === 'grass') fit = vegetated;
  else if (kind === 'shrub') fit = 0.5 * vegetated + 0.5 * canopy;
  else if (kind === 'acacia' || kind === 'cactus') fit = vegetated; // savanna and desert trees stand on bare ground
  else fit = canopy;
  return base * fit * (1 - steep);
}

/** Deterministic pseudo-random number in [0, 1) for an integer cell and seed. */
export function hash2(i: number, j: number, seed: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
