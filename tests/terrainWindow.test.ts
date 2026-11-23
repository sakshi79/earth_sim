import { describe, expect, it } from 'vitest';
import { subsolarPoint } from '../src/geo/sun.ts';
import { groundResolution } from '../src/geo/tiles.ts';
import {
  atSolarTime,
  localToPixel,
  nearOcean,
  pixelToLocal,
  sampleGrid,
  seaMask,
  solarHours,
  sunDirectionLocal,
  terrainWindow,
  terrainZoomFor,
  vertexHeights,
  windowTiles,
} from '../src/world/terrainWindow.ts';

describe('terrainWindow', () => {
  it('keeps the point within half a tile of the window centre', () => {
    for (const [lat, lon] of [[37.746, -119.594], [27.988, 86.925], [-23.442, 151.915], [69.2, -51]]) {
      const w = terrainWindow(lat, lon);
      expect(Math.abs(w.originPx.x - w.sizePx / 2)).toBeLessThanOrEqual(128);
      expect(Math.abs(w.originPx.y - w.sizePx / 2)).toBeLessThanOrEqual(128);
      expect(w.sizePx).toBe(768);
    }
  });

  it('is about 15 km across mid-latitude and uses z12 beyond ±60°', () => {
    expect(terrainWindow(0, 0).sizeMetres).toBeCloseTo(14_676, -1);
    expect(terrainZoomFor(69.2)).toBe(12);
    expect(terrainWindow(69.2, -51).sizeMetres).toBeGreaterThan(10_000);
  });

  it('lists imagery tiles one zoom finer, wrapping across the antimeridian', () => {
    const w = terrainWindow(0, 179.99);
    const tiles = windowTiles(w, w.zoom + 1);
    expect(tiles).toHaveLength(36);
    expect(tiles.every((t) => t.x >= 0 && t.x < 2 ** (w.zoom + 1))).toBe(true);
    expect(tiles.some((t) => t.x === 0)).toBe(true); // wrapped past 180°
  });

  it('converts between pixels and local metres', () => {
    const w = terrainWindow(36.062, -112.108);
    expect(pixelToLocal(w, w.originPx.x, w.originPx.y)).toEqual({ x: 0, z: 0 });
    const { x, z } = pixelToLocal(w, w.originPx.x + 10, w.originPx.y - 20);
    expect(x).toBeCloseTo(10 * groundResolution(36.062, w.zoom), 6);
    expect(z).toBeLessThan(0); // north is −z
    const back = localToPixel(w, x, z);
    expect(back.px).toBeCloseTo(w.originPx.x + 10, 9);
    expect(back.py).toBeCloseTo(w.originPx.y - 20, 9);
  });
});

describe('grid sampling', () => {
  const grid = [0, 10, 20, 30]; // 2 × 2

  it('interpolates bilinearly and clamps at the edges', () => {
    expect(sampleGrid(grid, 2, 2, 0.5, 0.5)).toBe(15);
    expect(sampleGrid(grid, 2, 2, -5, -5)).toBe(0);
    expect(sampleGrid(grid, 2, 2, 9, 9)).toBe(30);
  });

  it('builds vertex heights spanning the window edge to edge', () => {
    const heights = new Float32Array(16).fill(7);
    const v = vertexHeights(heights, 4, 2);
    expect(v).toHaveLength(9);
    expect([...v].every((h) => h === 7)).toBe(true);
  });
});

describe('seaMask', () => {
  // 5 × 5: a sea channel along the left edge, and an enclosed basin below sea level in the middle.
  const H = 9;
  const heights = [
    -5, H, H, H, H,
    -5, -1, H, H, H,
    -5, H, -30, H, H,
    -5, H, H, H, H,
    -5, H, H, H, H,
  ];

  it('floods only below-sea-level cells connected to the edge', () => {
    const mask = seaMask(heights, 5, 5, true);
    expect(mask[0]).toBe(1);
    expect(mask[6]).toBe(1); // joined to the channel
    expect(mask[12]).toBe(0); // enclosed basin (a Dead Sea) stays dry
    expect(mask[1]).toBe(0);
  });

  it('also floods low cells the imagery shows as water (reef flats), but not dry low land', () => {
    const reef = [-1, 2, 2, 2, 9, 9, 9, 9, 9];
    const water = new Set([1, 2]); // cell 3 is low but looks like land (the island beach)
    const mask = seaMask(reef, 3, 3, true, (i) => water.has(i));
    expect([...mask.slice(0, 4)]).toEqual([1, 1, 1, 0]);
  });

  it('floods nothing when the coarse map shows no ocean nearby', () => {
    expect([...seaMask(heights, 5, 5, false)].every((m) => m === 0)).toBe(true);
  });

  it('checks the coarse map across the window for ocean', () => {
    const w = terrainWindow(-23.442, 151.915);
    expect(nearOcean(w, () => -50)).toBe(true);
    expect(nearOcean(w, () => 300)).toBe(false);
  });
});

describe('sun in the local frame', () => {
  const date = new Date('2024-03-20T12:00:00Z'); // equinox: the sun is near the equator
  const s = subsolarPoint(date);

  it('is overhead at the subsolar point and below the horizon at the antipode', () => {
    expect(sunDirectionLocal(s.lat, s.lon, date).y).toBeGreaterThan(0.9999);
    expect(sunDirectionLocal(-s.lat, s.lon + 180, date).y).toBeLessThan(-0.9999);
  });

  it('rises in the east and sets in the west', () => {
    expect(sunDirectionLocal(0, s.lon - 90, date).x).toBeGreaterThan(0.999); // 6 a.m.: due east
    expect(sunDirectionLocal(0, s.lon + 90, date).x).toBeLessThan(-0.999); // 6 p.m.: due west
  });

  it('is in the south at noon in the northern hemisphere', () => {
    const noon = sunDirectionLocal(45, s.lon, date);
    expect(noon.z).toBeGreaterThan(0.6); // +z is south
    expect(noon.y).toBeCloseTo(Math.cos(((45 - s.lat) * Math.PI) / 180), 6);
  });

  it('converts solar time both ways', () => {
    const date = atSolarTime(new Date('2026-11-22T00:00:00Z'), -112.1, 14.5);
    expect(solarHours(date, -112.1)).toBeCloseTo(14.5, 6);
  });
});
