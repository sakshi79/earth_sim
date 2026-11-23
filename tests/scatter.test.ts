import { describe, expect, it } from 'vitest';
import { hash2, plantChance, treelineM, type PlaceContext, type Site } from '../src/world/scatter.ts';

const GREEN_CANOPY: [number, number, number] = [32, 46, 14]; // Appalachian forest sample
const SAVANNA: [number, number, number] = [95, 74, 48]; // Serengeti sample
const SAND: [number, number, number] = [201, 171, 123]; // Sahara sample
const SNOW: [number, number, number] = [240, 242, 245];

const site = (over: Partial<Site> = {}): Site => ({ height: 300, slope: 0.1, water: false, rgb: GREEN_CANOPY, ...over });
const temperate: PlaceContext = { landscape: 'temperate forest', lat: 37, lon: -81 };
const serengeti: PlaceContext = { landscape: 'grassland', lat: -2.45, lon: 34.83 };
const reef: PlaceContext = { landscape: 'coast', lat: -23.44, lon: 151.9 };

describe('plantChance', () => {
  it('grows trees under green canopy, not on bright bare ground', () => {
    expect(plantChance('broadleaf', site(), temperate)).toBeGreaterThan(0.2);
    expect(plantChance('broadleaf', site({ rgb: SAND }), temperate)).toBe(0);
  });

  it('grows savanna grass and acacias in the tropics only', () => {
    expect(plantChance('grass', site({ rgb: SAVANNA }), serengeti)).toBeGreaterThan(0.5);
    expect(plantChance('acacia', site({ rgb: SAVANNA }), serengeti)).toBeGreaterThan(0);
    expect(plantChance('acacia', site({ rgb: SAVANNA }), { ...serengeti, lat: 45 })).toBe(0);
  });

  it('keeps trees below the treeline and off steep slopes', () => {
    expect(treelineM(46)).toBeCloseTo(2080, 0);
    expect(plantChance('conifer', site({ height: 2500 }), { landscape: 'mountain', lat: 46, lon: 7.6 })).toBe(0);
    expect(plantChance('broadleaf', site({ slope: 0.9 }), temperate)).toBe(0);
    expect(plantChance('rock', site({ slope: 0.9 }), temperate)).toBeGreaterThan(plantChance('rock', site(), temperate));
  });

  it('puts nothing but rocks on snow', () => {
    expect(plantChance('grass', site({ rgb: SNOW }), temperate)).toBe(0);
    expect(plantChance('rock', site({ rgb: SNOW }), temperate)).toBeGreaterThan(0);
  });

  it('grows coral on shallow, warm sea floor only, and nothing else in the water', () => {
    expect(plantChance('coral', site({ water: true, height: -5 }), reef)).toBeGreaterThan(0.3);
    expect(plantChance('coral', site({ water: true, height: -40 }), reef)).toBe(0);
    expect(plantChance('coral', site({ water: true, height: -5 }), { ...reef, lat: 50 })).toBe(0);
    expect(plantChance('grass', site({ water: true, height: -5 }), reef)).toBe(0);
  });

  it('keeps cacti in the Americas', () => {
    const desert = (lon: number): PlaceContext => ({ landscape: 'desert', lat: 32, lon });
    expect(plantChance('cactus', site({ rgb: SAVANNA }), desert(-111))).toBeGreaterThan(0);
    expect(plantChance('cactus', site({ rgb: SAVANNA }), desert(10))).toBe(0);
  });
});

describe('hash2', () => {
  it('is deterministic and spread over [0, 1)', () => {
    expect(hash2(3, -7, 1)).toBe(hash2(3, -7, 1));
    expect(hash2(3, -7, 1)).not.toBe(hash2(3, -7, 2));
    const values = Array.from({ length: 10_000 }, (_, k) => hash2(k % 100, Math.floor(k / 100), 5));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(mean).toBeCloseTo(0.5, 1);
  });
});
