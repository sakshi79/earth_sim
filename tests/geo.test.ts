import { describe, expect, it } from 'vitest';
import { oceanName } from '../src/geo/oceans.ts';
import { latLonToVector, normalizeLon, vectorToLatLon } from '../src/geo/sphere.ts';
import { subsolarPoint } from '../src/geo/sun.ts';

describe('sphere convention (matches three-slippy-map-globe)', () => {
  it('puts longitude 0 on +Z, 90°E on +X and the north pole on +Y', () => {
    const zero = latLonToVector(0, 0);
    expect(zero.z).toBeCloseTo(1, 12);
    expect(latLonToVector(0, 90).x).toBeCloseTo(1, 12);
    expect(latLonToVector(90, 0).y).toBeCloseTo(1, 12);
  });

  it('round-trips latitude and longitude', () => {
    for (const [lat, lon] of [[27.988, 86.925], [-23.442, 151.915], [69.2, -51], [-2.93, -59.97], [0, 179.9], [10, -179.9]]) {
      const back = vectorToLatLon(latLonToVector(lat, lon, 3));
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });

  it('normalises longitudes into [-180, 180)', () => {
    expect(normalizeLon(190)).toBeCloseTo(-170, 12);
    expect(normalizeLon(-190)).toBeCloseTo(170, 12);
    expect(normalizeLon(540)).toBeCloseTo(-180, 12);
  });
});

describe('subsolarPoint', () => {
  it('is on the equator at the March 2024 equinox', () => {
    expect(subsolarPoint(new Date('2024-03-20T03:06:00Z')).lat).toBeCloseTo(0, 1);
  });

  it('reaches the tropics at the 2024 solstices', () => {
    expect(subsolarPoint(new Date('2024-06-20T20:51:00Z')).lat).toBeCloseTo(23.44, 1);
    expect(subsolarPoint(new Date('2024-12-21T09:20:00Z')).lat).toBeCloseTo(-23.44, 1);
  });

  it('follows the equation of time (sun 16 minutes early on 3 November)', () => {
    // Solar noon at Greenwich is ~11:43:36 UTC, so at 12:00 UTC the sun is overhead at ~4.1°W.
    expect(subsolarPoint(new Date('2024-11-03T12:00:00Z')).lon).toBeCloseTo(-4.1, 0);
  });
});

describe('oceanName', () => {
  const cases: Array<[number, number, string]> = [
    [0, -150, 'Pacific Ocean'],
    [10, 130, 'Pacific Ocean'],
    [10, 112, 'Pacific Ocean'],
    [30, -40, 'Atlantic Ocean'],
    [-10, -30, 'Atlantic Ocean'],
    [15, -80, 'Atlantic Ocean'],
    [-20, 80, 'Indian Ocean'],
    [-45, 140, 'Indian Ocean'],
    [80, 0, 'Arctic Ocean'],
    [-65, 0, 'Southern Ocean'],
  ];
  it.each(cases)('(%f, %f) is in the %s', (lat, lon, name) => {
    expect(oceanName(lat, lon)).toBe(name);
  });
});
