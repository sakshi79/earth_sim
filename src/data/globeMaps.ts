// Coarse whole-Earth lookups from the bundled textures: elevation (Terrarium-encoded PNG, 1024×512)
// and the colour of the NASA day image (2048×1024). No network calls after load.
import { decodeTerrarium } from '../geo/tiles.ts';

export const ELEVATION_WIDTH = 1024;
export const ELEVATION_HEIGHT = 512;
export const COLOR_WIDTH = 2048;
export const COLOR_HEIGHT = 1024;

export interface GlobeMaps {
  elevationAt(lat: number, lon: number): number;
  colorAt(lat: number, lon: number): [number, number, number];
  /** Greyscale mask from the day image, white over water, for the ocean glint. */
  waterMask(): ImageData;
}

/** How much a day-image pixel looks like water (0–1): blue clearly above red, not greener than blue. */
export function waterness(r: number, g: number, b: number): number {
  if (b + 10 < g) return 0;
  return Math.min(1, Math.max(0, (b - r - 5) / 20));
}

function equirectIndex(lat: number, lon: number, width: number, height: number): number {
  const i = ((Math.floor(((lon + 180) / 360) * width) % width) + width) % width;
  const j = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)));
  return j * width + i;
}

/** Builds lookups from raw RGBA pixel data at ELEVATION_* and COLOR_* sizes. */
export function createGlobeMaps(elevationRgba: ArrayLike<number>, colorRgba: ArrayLike<number>): GlobeMaps {
  const elevation = new Float32Array(ELEVATION_WIDTH * ELEVATION_HEIGHT);
  for (let i = 0; i < elevation.length; i++) {
    elevation[i] = decodeTerrarium(elevationRgba[i * 4], elevationRgba[i * 4 + 1], elevationRgba[i * 4 + 2]);
  }
  return {
    elevationAt: (lat, lon) => elevation[equirectIndex(lat, lon, ELEVATION_WIDTH, ELEVATION_HEIGHT)],
    colorAt: (lat, lon) => {
      const k = equirectIndex(lat, lon, COLOR_WIDTH, COLOR_HEIGHT) * 4;
      return [colorRgba[k], colorRgba[k + 1], colorRgba[k + 2]];
    },
    waterMask: () => {
      const mask = new ImageData(COLOR_WIDTH, COLOR_HEIGHT);
      for (let k = 0; k < mask.data.length; k += 4) {
        const v = Math.round(255 * waterness(colorRgba[k], colorRgba[k + 1], colorRgba[k + 2]));
        mask.data[k] = mask.data[k + 1] = mask.data[k + 2] = v;
        mask.data[k + 3] = 255;
      }
      return mask;
    },
  };
}

export async function loadGlobeMaps(elevationUrl: string, dayUrl: string): Promise<GlobeMaps> {
  const [elevation, color] = await Promise.all([
    readPixels(elevationUrl, ELEVATION_WIDTH, ELEVATION_HEIGHT),
    readPixels(dayUrl, COLOR_WIDTH, COLOR_HEIGHT),
  ]);
  return createGlobeMaps(elevation, color);
}

/** Decodes an image to RGBA at the given size without colour conversion. */
async function readPixels(url: string, width: number, height: number): Promise<Uint8ClampedArray> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: 'medium',
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D canvas unavailable');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, width, height).data;
}
