// Loads everything a place's 3D scene needs: per-pixel heights for the terrain window and one
// stitched imagery canvas. Featured places come pre-built from our own site; anywhere else is
// assembled live from map tiles.
import { assetUrl, liveImagery, sources } from '../config.ts';
import { decodeRgba, fetchBlob, forEachLimited } from '../data/images.ts';
import { decodeTerrarium, TILE_SIZE } from '../geo/tiles.ts';
import { terrainWindow, windowTiles, type TerrainWindow } from './terrainWindow.ts';

export const PREBUILT_IMAGERY_CREDIT =
  'Imagery: EOxCloudless 2025 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2025), CC BY-NC-SA 4.0';

export interface PlaceData {
  window: TerrainWindow;
  /** Metres, row-major from the north-west corner, window.sizePx². */
  heights: Float32Array;
  /** Imagery covering the window exactly, or null if none could be loaded. */
  imagery: HTMLCanvasElement | null;
  imageryCredit: string | null;
  source: 'prebuilt' | 'live';
}

export interface LoadProgress {
  stage: 'terrain' | 'imagery';
  done: number;
  total: number;
}

/** What scripts/prebuild-places.mjs writes to public/places/<id>/place.json. */
export interface PrebuiltPlaceMeta {
  id: string;
  lat: number;
  lon: number;
  zoom: number;
  tiles: number;
  x0: number;
  y0: number;
  imageryZoom: number;
}

export class TerrainUnavailableError extends Error {}

export async function loadPlace(
  lat: number,
  lon: number,
  options: { placeId?: string; onProgress?: (progress: LoadProgress) => void } = {},
): Promise<PlaceData> {
  if (options.placeId) {
    const prebuilt = await loadPrebuilt(options.placeId, options.onProgress).catch(() => null);
    if (prebuilt) return prebuilt;
  }
  return loadLive(lat, lon, options.onProgress);
}

async function loadPrebuilt(id: string, onProgress?: (p: LoadProgress) => void): Promise<PlaceData> {
  const base = assetUrl(`places/${id}/`);
  const response = await fetch(`${base}place.json`);
  if (!response.ok) throw new Error('not pre-built');
  const meta = (await response.json()) as PrebuiltPlaceMeta;
  const window = terrainWindow(meta.lat, meta.lon, meta.zoom, meta.tiles);
  if (window.x0 !== meta.x0 || window.y0 !== meta.y0) throw new Error('pre-built window mismatch');

  onProgress?.({ stage: 'terrain', done: 0, total: 1 });
  const [terrain, imageryBlob] = await Promise.all([
    fetchBlob(`${base}terrain.png`).then((blob) => decodeRgba(blob)),
    fetchBlob(`${base}imagery.jpg`).catch(() => null),
  ]);
  onProgress?.({ stage: 'terrain', done: 1, total: 1 });
  const heights = new Float32Array(window.sizePx * window.sizePx);
  for (let i = 0; i < heights.length; i++) {
    heights[i] = decodeTerrarium(terrain.data[i * 4], terrain.data[i * 4 + 1], terrain.data[i * 4 + 2]);
  }
  const imagery = imageryBlob ? await blobToCanvas(imageryBlob) : null;
  return { window, heights, imagery, imageryCredit: imagery ? PREBUILT_IMAGERY_CREDIT : null, source: 'prebuilt' };
}

async function loadLive(lat: number, lon: number, onProgress?: (p: LoadProgress) => void): Promise<PlaceData> {
  const window = terrainWindow(lat, lon);
  const size = window.sizePx;
  const heights = new Float32Array(size * size);

  const terrainTiles = windowTiles(window);
  let done = 0;
  onProgress?.({ stage: 'terrain', done, total: terrainTiles.length });
  try {
    await forEachLimited(terrainTiles, 6, async (tile) => {
      const { data } = await decodeRgba(await fetchBlob(sources.terrarium(tile.z, tile.x, tile.y)));
      for (let py = 0; py < TILE_SIZE; py++) {
        const row = (tile.row * TILE_SIZE + py) * size + tile.col * TILE_SIZE;
        for (let px = 0; px < TILE_SIZE; px++) {
          const k = (py * TILE_SIZE + px) * 4;
          heights[row + px] = decodeTerrarium(data[k], data[k + 1], data[k + 2]);
        }
      }
      onProgress?.({ stage: 'terrain', done: ++done, total: terrainTiles.length });
    });
  } catch (error) {
    throw new TerrainUnavailableError(`Elevation data could not be loaded (${String(error)}).`);
  }

  // Imagery one zoom finer: twice the pixels per side. Missing tiles leave grey gaps.
  const imageryTiles = windowTiles(window, window.zoom + 1);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * 2;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = '#6b6f66';
  context.fillRect(0, 0, canvas.width, canvas.height);
  let loaded = 0;
  done = 0;
  onProgress?.({ stage: 'imagery', done, total: imageryTiles.length });
  await forEachLimited(imageryTiles, 8, async (tile) => {
    try {
      const bitmap = await createImageBitmap(await fetchBlob(liveImagery.url(tile.z, tile.x, tile.y)));
      context.drawImage(bitmap, tile.col * TILE_SIZE, tile.row * TILE_SIZE);
      bitmap.close();
      loaded++;
    } catch {
      // Leave the gap; the scene still works without this tile.
    }
    onProgress?.({ stage: 'imagery', done: ++done, total: imageryTiles.length });
  });
  const imagery = loaded > 0 ? canvas : null;
  return { window, heights, imagery, imageryCredit: imagery ? liveImagery.credit : null, source: 'live' };
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  (canvas.getContext('2d') as CanvasRenderingContext2D).drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}
