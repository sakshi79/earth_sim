// Globe coordinates, shared with three-slippy-map-globe: a sphere centred at the origin,
// north = +Y, longitude 0° on +Z and longitude 90°E on +X. Erasable TypeScript only.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface LatLon {
  lat: number;
  lon: number;
}

const DEG = Math.PI / 180;

export function latLonToVector(lat: number, lon: number, radius = 1): Vec3 {
  const phi = (90 - lat) * DEG;
  const theta = (90 - lon) * DEG;
  return {
    x: radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.sin(theta),
  };
}

export function vectorToLatLon(v: Vec3): LatLon {
  const r = Math.hypot(v.x, v.y, v.z);
  const lat = 90 - Math.acos(Math.max(-1, Math.min(1, v.y / r))) / DEG;
  const lon = normalizeLon(90 - Math.atan2(v.z, v.x) / DEG);
  return { lat, lon };
}

/** Wraps a longitude into [-180, 180). */
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}
