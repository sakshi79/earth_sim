// Where the sun is directly overhead at a given moment (the subsolar point).
// Low-precision solar ephemeris (accurate to roughly 0.1°), plenty for lighting.
import { normalizeLon, type LatLon } from './sphere.ts';

const DEG = Math.PI / 180;

export function subsolarPoint(date: Date): LatLon {
  const days = date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545.0; // days since J2000.0
  const meanAnomaly = (357.529 + 0.98560028 * days) * DEG;
  const meanLongitude = 280.459 + 0.98564736 * days;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439 - 0.00000036 * days) * DEG;

  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  );
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const gmstHours = (((18.697374558 + 24.06570982441908 * days) % 24) + 24) % 24;

  return {
    lat: declination / DEG,
    lon: normalizeLon(rightAscension / DEG - gmstHours * 15),
  };
}
