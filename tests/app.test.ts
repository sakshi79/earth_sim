import { describe, expect, it } from 'vitest';
import {
  COLOR_HEIGHT,
  COLOR_WIDTH,
  createGlobeMaps,
  ELEVATION_HEIGHT,
  ELEVATION_WIDTH,
  waterness,
} from '../src/data/globeMaps.ts';
import { placeLabel } from '../src/data/nominatim.ts';
import { formatElevation, formatLatLon } from '../src/format.ts';
import { encodeTerrarium } from '../src/geo/tiles.ts';
import { featuredPlaces } from '../src/places.ts';
import { formatVisitHash, parseVisitHash } from '../src/router.ts';

describe('deep links', () => {
  it('round-trips a place', () => {
    expect(parseVisitHash(formatVisitHash(37.7456, -119.5936))).toEqual({ lat: 37.7456, lon: -119.5936 });
  });

  it('rejects malformed or out-of-range links', () => {
    expect(parseVisitHash('#/visit/abc,1')).toBeNull();
    expect(parseVisitHash('#/visit/95,10')).toBeNull();
    expect(parseVisitHash('#/visit/10,200')).toBeNull();
    expect(parseVisitHash('')).toBeNull();
  });
});

describe('formatting', () => {
  it('formats coordinates with hemispheres', () => {
    expect(formatLatLon(37.7456, -119.5936)).toBe('37.746°N 119.594°W');
    expect(formatLatLon(-23.442, 151.915, 1)).toBe('23.4°S 151.9°E');
  });

  it('formats coarse elevations', () => {
    expect(formatElevation(1214)).toBe('≈ 1,210 m');
    expect(formatElevation(-4183)).toBe('≈ 4,180 m below sea level');
    expect(formatElevation(3)).toBe('≈ sea level');
  });
});

describe('placeLabel', () => {
  it('builds "place, state, country" without repeats', () => {
    expect(
      placeLabel({ name: 'Mariposa County', address: { county: 'Mariposa County', state: 'California', country: 'United States' } }),
    ).toBe('Mariposa County, California, United States');
    expect(placeLabel({ address: { town: 'Rissani', state: 'Drâa-Tafilalet', country: 'Morocco' } })).toBe(
      'Rissani, Drâa-Tafilalet, Morocco',
    );
  });

  it('returns null for open ocean', () => {
    expect(placeLabel({ error: 'Unable to geocode' })).toBeNull();
  });
});

describe('createGlobeMaps', () => {
  it('looks up elevation and colour by latitude and longitude', () => {
    const elevation = new Uint8ClampedArray(ELEVATION_WIDTH * ELEVATION_HEIGHT * 4);
    const color = new Uint8ClampedArray(COLOR_WIDTH * COLOR_HEIGHT * 4);
    // Mark the pixels containing (27.988, 86.925) as 8,848 m and red.
    const pixel = (width: number, height: number): number =>
      (Math.floor(((90 - 27.988) / 180) * height) * width + Math.floor(((86.925 + 180) / 360) * width)) * 4;
    elevation.set([...encodeTerrarium(8848), 255], pixel(ELEVATION_WIDTH, ELEVATION_HEIGHT));
    color.set([255, 0, 0, 255], pixel(COLOR_WIDTH, COLOR_HEIGHT));
    const maps = createGlobeMaps(elevation, color);
    expect(maps.elevationAt(27.988, 86.925)).toBe(8848);
    expect(maps.colorAt(27.988, 86.925)).toEqual([255, 0, 0]);
    expect(maps.elevationAt(0, 0)).toBe(-32768); // untouched pixels decode to the minimum
  });

  it('scores water from day-image colours (real samples)', () => {
    expect(waterness(6, 13, 39)).toBe(1); // open Pacific
    expect(waterness(27, 70, 125)).toBe(1); // Great Barrier Reef shallows
    expect(waterness(201, 171, 123)).toBe(0); // Sahara
    expect(waterness(28, 40, 15)).toBe(0); // Congo rainforest
    expect(waterness(252, 254, 253)).toBe(0); // Greenland ice
  });
});

describe('featured places', () => {
  it('have unique ids and valid coordinates inside the visitable range', () => {
    expect(new Set(featuredPlaces.map((p) => p.id)).size).toBe(featuredPlaces.length);
    for (const place of featuredPlaces) {
      expect(Math.abs(place.lat)).toBeLessThan(85.05);
      expect(Math.abs(place.lon)).toBeLessThanOrEqual(180);
    }
  });
});
