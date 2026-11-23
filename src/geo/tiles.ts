// Web Mercator tile maths, shared by the browser and the Node build scripts.
// Keep this file free of imports and of non-erasable TypeScript so Node can run it directly.

export const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
/** Web Mercator stops here; tiles do not exist beyond ±this latitude. */
export const MAX_MERCATOR_LAT = 85.0511287798066;
export const TILE_SIZE = 256;

/** Fractional tile coordinates of a point at zoom z. Latitude is clamped to the Mercator range. */
export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const latRad = (clamped * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Longitude/latitude of a (fractional) tile coordinate at zoom z. */
export function tileToLonLat(x: number, y: number, z: number): { lon: number; lat: number } {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lon, lat };
}

/** Wraps a tile column index into [0, 2^z), so tiles across the antimeridian resolve. */
export function wrapTileX(x: number, z: number): number {
  const n = 2 ** z;
  return ((x % n) + n) % n;
}

/** Ground metres per pixel of a 256 px tile at a latitude and zoom. */
export function groundResolution(lat: number, z: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (2 ** z * TILE_SIZE);
}

/** Whether a latitude can be visited (has map tiles). */
export function isVisitable(lat: number): boolean {
  return Math.abs(lat) <= MAX_MERCATOR_LAT;
}

/** Elevation in metres from a Terrarium-encoded pixel (AWS Terrain Tiles). */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Terrarium encoding of an elevation in metres, clamped to the encodable range. */
export function encodeTerrarium(metres: number): [number, number, number] {
  const v = Math.min(65535 + 255 / 256, Math.max(0, metres + 32768));
  const whole = Math.floor(v);
  return [Math.floor(whole / 256), whole % 256, Math.floor((v - whole) * 256)];
}
