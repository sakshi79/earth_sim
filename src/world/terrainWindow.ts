// The square of map tiles that becomes a place's 3D scene, and the maths around it.
// Shared by the browser and the Node prebuild script: erasable TypeScript, no browser APIs.
import { latLonToVector, type Vec3 } from '../geo/sphere.ts';
import { subsolarPoint } from '../geo/sun.ts';
import { groundResolution, lonLatToTile, TILE_SIZE, tileToLonLat, wrapTileX } from '../geo/tiles.ts';

/** Tiles per side of the window. */
export const WINDOW_TILES = 3;

/** z13 (~15 km across at the equator); z12 beyond ±60° so high-latitude places don't shrink below ~10 km. */
export function terrainZoomFor(lat: number): number {
  return Math.abs(lat) > 60 ? 12 : 13;
}

export interface TerrainWindow {
  /** The chosen point: the local origin. */
  lat: number;
  lon: number;
  zoom: number;
  tiles: number;
  /** Top-left tile (x unwrapped; wrap it when fetching). */
  x0: number;
  y0: number;
  /** The chosen point inside the window, in pixels from the top-left corner. */
  originPx: { x: number; y: number };
  sizePx: number;
  metresPerPixel: number;
  sizeMetres: number;
}

export interface WindowTile {
  z: number;
  x: number;
  y: number;
  col: number;
  row: number;
}

/** A tiles × tiles window at `zoom`, placed so the point is within half a tile of the centre. */
export function terrainWindow(lat: number, lon: number, zoom = terrainZoomFor(lat), tiles = WINDOW_TILES): TerrainWindow {
  const { x, y } = lonLatToTile(lon, lat, zoom);
  const n = 2 ** zoom;
  const x0 = Math.round(x - tiles / 2);
  const y0 = Math.min(n - tiles, Math.max(0, Math.round(y - tiles / 2)));
  const metresPerPixel = groundResolution(lat, zoom);
  return {
    lat,
    lon,
    zoom,
    tiles,
    x0,
    y0,
    originPx: { x: (x - x0) * TILE_SIZE, y: (y - y0) * TILE_SIZE },
    sizePx: tiles * TILE_SIZE,
    metresPerPixel,
    sizeMetres: tiles * TILE_SIZE * metresPerPixel,
  };
}

/** The tiles covering the window at `zoom` (≥ the window's), row by row from the top-left. */
export function windowTiles(w: TerrainWindow, zoom = w.zoom): WindowTile[] {
  const scale = 2 ** (zoom - w.zoom);
  const count = w.tiles * scale;
  const result: WindowTile[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      result.push({ z: zoom, x: wrapTileX(w.x0 * scale + col, zoom), y: w.y0 * scale + row, col, row });
    }
  }
  return result;
}

/** Latitude/longitude of a window pixel position (edges, not centres). */
export function windowPixelToLatLon(w: TerrainWindow, px: number, py: number): { lat: number; lon: number } {
  const { lat, lon } = tileToLonLat(w.x0 + px / TILE_SIZE, w.y0 + py / TILE_SIZE, w.zoom);
  return { lat, lon };
}

/** Local metres (x east, z south) of a window pixel position. */
export function pixelToLocal(w: TerrainWindow, px: number, py: number): { x: number; z: number } {
  return { x: (px - w.originPx.x) * w.metresPerPixel, z: (py - w.originPx.y) * w.metresPerPixel };
}

/** Window pixel position of local metres. */
export function localToPixel(w: TerrainWindow, x: number, z: number): { px: number; py: number } {
  return { px: x / w.metresPerPixel + w.originPx.x, py: z / w.metresPerPixel + w.originPx.y };
}

/** Bilinear sample of a row-major grid at fractional cell coordinates, clamped to the edges. */
export function sampleGrid(grid: ArrayLike<number>, width: number, height: number, gx: number, gy: number): number {
  const x = Math.min(width - 1, Math.max(0, gx));
  const y = Math.min(height - 1, Math.max(0, gy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const ax = x - x0;
  const ay = y - y0;
  const top = grid[y0 * width + x0] * (1 - ax) + grid[y0 * width + x1] * ax;
  const bottom = grid[y1 * width + x0] * (1 - ax) + grid[y1 * width + x1] * ax;
  return top * (1 - ay) + bottom * ay;
}

/**
 * Vertex heights for a (segments + 1)² terrain grid spanning the window edge to edge,
 * sampled from the per-pixel heights (pixel centres at k + 0.5).
 */
export function vertexHeights(heights: ArrayLike<number>, sizePx: number, segments: number): Float32Array {
  const out = new Float32Array((segments + 1) ** 2);
  for (let j = 0; j <= segments; j++) {
    for (let i = 0; i <= segments; i++) {
      const u = (i / segments) * sizePx - 0.5;
      const v = (j / segments) * sizePx - 0.5;
      out[j * (segments + 1) + i] = sampleGrid(heights, sizePx, sizePx, u, v);
    }
  }
  return out;
}

/** Cells this low count as sea when the imagery shows water there (reef flats in coarse data). */
export const SHALLOW_WATER_MAX_M = 3;

/**
 * Open sea: cells at or below 0 m — or below SHALLOW_WATER_MAX_M where `looksLikeWater` says so —
 * connected to the window edge. Inland basins below sea level (Dead Sea, Death Valley) stay dry,
 * and nothing is sea unless the coarse map shows ocean nearby.
 */
export function seaMask(
  heights: ArrayLike<number>,
  width: number,
  height: number,
  oceanNearby: boolean,
  looksLikeWater: (index: number) => boolean = () => false,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (!oceanNearby) return mask;
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const visit = (i: number): void => {
    if (mask[i] === 0 && (heights[i] <= 0 || (heights[i] <= SHALLOW_WATER_MAX_M && looksLikeWater(i)))) {
      mask[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < width * (height - 1)) visit(i + width);
  }
  return mask;
}

/** Whether the coarse global map shows ocean anywhere across the window (nine sample points). */
export function nearOcean(w: TerrainWindow, coarseElevationAt: (lat: number, lon: number) => number): boolean {
  for (const fy of [0, 0.5, 1]) {
    for (const fx of [0, 0.5, 1]) {
      const { lat, lon } = windowPixelToLatLon(w, fx * w.sizePx, fy * w.sizePx);
      if (coarseElevationAt(lat, lon) < -20) return true;
    }
  }
  return false;
}

/** Unit vector toward the sun in the local frame (x east, y up, z south). */
export function sunDirectionLocal(lat: number, lon: number, date: Date): Vec3 {
  const up = latLonToVector(lat, lon);
  // East = north pole × up; north = up × east (globe convention: +Y is the north pole).
  const east = normalize({ x: up.z, y: 0, z: -up.x });
  const north = cross(up, east);
  const s = subsolarPoint(date);
  const sun = latLonToVector(s.lat, s.lon);
  return { x: dot(sun, east), y: dot(sun, up), z: -dot(sun, north) };
}

/** The moment at a place's local solar time on the same UTC day as `date`. */
export function atSolarTime(date: Date, lon: number, hours: number): Date {
  const utcHours = hours - lon / 15;
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return new Date(midnight + utcHours * 3_600_000);
}

/** Local solar time (hours, 0–24) at a longitude. Ignores the equation of time (±16 min). */
export function solarHours(date: Date, lon: number): number {
  const utc = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return (((utc + lon / 15) % 24) + 24) % 24;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
