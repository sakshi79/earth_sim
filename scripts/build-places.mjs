// Pre-builds the featured places into public/places/<id>/ so they load fast from our own site:
//   place.json   window metadata (checked against terrainWindow() at runtime)
//   terrain.png  the stitched Terrarium elevation window (768×768)
//   imagery.jpg  stitched EOxCloudless 2025 imagery one zoom finer (1536×1536), CC BY-NC-SA 4.0
// Run with `npm run build-places [id ...]`. Outputs are committed; re-run to refresh them.
import { mkdir, writeFile } from 'node:fs/promises';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { sources } from '../src/config.ts';
import { TILE_SIZE } from '../src/geo/tiles.ts';
import { featuredPlaces } from '../src/places.ts';
import { terrainWindow, windowTiles } from '../src/world/terrainWindow.ts';

const OUT_DIR = new URL('../public/places/', import.meta.url);
const USER_AGENT = 'earth-sim-place-builder';
const JPEG_QUALITY = 82;

async function fetchBuffer(url, expectedType, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = response.headers.get('content-type') ?? '';
      if (!type.startsWith(expectedType)) throw new Error(`expected ${expectedType}, got ${type}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${url}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function forEachLimited(items, limit, task) {
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) await task(items[next++]);
  }));
}

/** Copies a tile's RGBA pixels into a larger RGBA buffer at (col, row) in tile units. */
function blit(target, targetSize, tilePixels, col, row) {
  for (let y = 0; y < TILE_SIZE; y++) {
    const from = y * TILE_SIZE * 4;
    const to = ((row * TILE_SIZE + y) * targetSize + col * TILE_SIZE) * 4;
    target.set(tilePixels.subarray(from, from + TILE_SIZE * 4), to);
  }
}

async function buildTerrain(window) {
  const size = window.sizePx;
  const out = new PNG({ width: size, height: size });
  await forEachLimited(windowTiles(window), 4, async (tile) => {
    const png = PNG.sync.read(await fetchBuffer(sources.terrarium(tile.z, tile.x, tile.y), 'image/png'));
    blit(out.data, size, png.data, tile.col, tile.row);
  });
  return PNG.sync.write(out, { colorType: 2 });
}

async function buildImagery(window) {
  const size = window.sizePx * 2;
  const rgba = new Uint8Array(size * size * 4).fill(255);
  let missing = 0;
  await forEachLimited(windowTiles(window, window.zoom + 1), 4, async (tile) => {
    try {
      const buffer = await fetchBuffer(sources.sentinel2(tile.z, tile.x, tile.y), 'image/jpeg');
      const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
      blit(rgba, size, decoded.data, tile.col, tile.row);
    } catch (error) {
      missing++;
      console.warn(`  imagery tile missing: ${error.message}`);
    }
  });
  return { jpeg: jpeg.encode({ data: rgba, width: size, height: size }, JPEG_QUALITY).data, missing };
}

const wanted = new Set(process.argv.slice(2));
const places = featuredPlaces.filter((p) => wanted.size === 0 || wanted.has(p.id));
await mkdir(OUT_DIR, { recursive: true });
for (const place of places) {
  const window = terrainWindow(place.lat, place.lon);
  const dir = new URL(`${place.id}/`, OUT_DIR);
  await mkdir(dir, { recursive: true });
  const terrain = await buildTerrain(window);
  const imagery = await buildImagery(window);
  const meta = {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lon: place.lon,
    zoom: window.zoom,
    tiles: window.tiles,
    x0: window.x0,
    y0: window.y0,
    imageryZoom: window.zoom + 1,
    imagery: 'EOxCloudless 2025 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2025), CC BY-NC-SA 4.0',
    elevation: 'AWS Terrain Tiles (SRTM, GMTED, ETOPO1 and others)',
  };
  await writeFile(new URL('terrain.png', dir), terrain);
  await writeFile(new URL('imagery.jpg', dir), imagery.jpeg);
  await writeFile(new URL('place.json', dir), `${JSON.stringify(meta, null, 2)}\n`);
  const mb = (bytes) => (bytes / 1e6).toFixed(2);
  console.log(
    `${place.id.padEnd(14)} terrain ${mb(terrain.length)} MB · imagery ${mb(imagery.jpeg.length)} MB` +
      (imagery.missing ? ` · ${imagery.missing} imagery tiles missing` : ''),
  );
}
