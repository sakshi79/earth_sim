import { describe, expect, it } from 'vitest';
import {
  decodeTerrarium,
  encodeTerrarium,
  groundResolution,
  isVisitable,
  lonLatToTile,
  MAX_MERCATOR_LAT,
  tileToLonLat,
  wrapTileX,
} from '../src/geo/tiles.ts';

describe('lonLatToTile', () => {
  it('puts (0, 0) at the centre of the world', () => {
    expect(lonLatToTile(0, 0, 0)).toEqual({ x: 0.5, y: 0.5 });
    expect(lonLatToTile(0, 0, 4)).toEqual({ x: 8, y: 8 });
  });

  it('maps the edges of the Mercator square', () => {
    expect(lonLatToTile(-180, 0, 3).x).toBe(0);
    expect(lonLatToTile(180, 0, 3).x).toBe(8);
    expect(lonLatToTile(0, MAX_MERCATOR_LAT, 3).y).toBeCloseTo(0, 9);
    expect(lonLatToTile(0, -MAX_MERCATOR_LAT, 3).y).toBeCloseTo(8, 9);
  });

  it('clamps latitudes beyond the Mercator limit', () => {
    expect(lonLatToTile(0, 90, 2).y).toBeCloseTo(0, 9);
    expect(lonLatToTile(0, -90, 2).y).toBeCloseTo(4, 9);
  });

  it('finds the known z15 tile for Yosemite Valley', () => {
    const { x, y } = lonLatToTile(-119.5936, 37.7456, 15);
    expect([Math.floor(x), Math.floor(y)]).toEqual([5498, 12668]);
  });

  it('round-trips through tileToLonLat', () => {
    for (const [lon, lat] of [[86.925, 27.988], [-112.108, 36.062], [151.915, -23.442], [-51, 69.2]]) {
      const { x, y } = lonLatToTile(lon, lat, 13);
      const back = tileToLonLat(x, y, 13);
      expect(back.lon).toBeCloseTo(lon, 9);
      expect(back.lat).toBeCloseTo(lat, 9);
    }
  });
});

describe('wrapTileX', () => {
  it('wraps columns across the antimeridian', () => {
    expect(wrapTileX(-1, 3)).toBe(7);
    expect(wrapTileX(8, 3)).toBe(0);
    expect(wrapTileX(5, 3)).toBe(5);
  });
});

describe('groundResolution', () => {
  it('matches the standard Web Mercator resolution at the equator', () => {
    expect(groundResolution(0, 0)).toBeCloseTo(156543.03, 1);
    expect(groundResolution(0, 13)).toBeCloseTo(19.109, 2);
  });

  it('shrinks with the cosine of latitude', () => {
    expect(groundResolution(60, 13)).toBeCloseTo(groundResolution(0, 13) / 2, 6);
  });
});

describe('isVisitable', () => {
  it('allows the Mercator range only', () => {
    expect(isVisitable(83.6)).toBe(true);
    expect(isVisitable(-85)).toBe(true);
    expect(isVisitable(-89.9)).toBe(false);
  });
});

describe('Terrarium encoding', () => {
  it('decodes the reference values', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(0, 0, 0)).toBe(-32768);
    expect(decodeTerrarium(162, 144, 0)).toBe(8848);
  });

  it('round-trips elevations, including the sea floor', () => {
    for (const metres of [0, 8848, -10994, 1214.5, -0.25]) {
      expect(decodeTerrarium(...encodeTerrarium(metres))).toBeCloseTo(metres, 2);
    }
  });

  it('clamps out-of-range values', () => {
    expect(encodeTerrarium(-40000)).toEqual([0, 0, 0]);
    expect(encodeTerrarium(40000)[0]).toBe(255);
  });
});
