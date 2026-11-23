// Builds the bundled globe textures in public/textures/. Run once with `npm run globe-assets`;
// the outputs are committed, so the live site never calls these services.
//   earth_day.jpg    NASA Blue Marble (shaded relief + bathymetry), 4096×2048 equirectangular
//   earth_night.jpg  NASA VIIRS Black Marble, 4096×2048 equirectangular
//   earth_elev.png   Terrain Tiles z3 reprojected to 1024×512 equirectangular, Terrarium-encoded metres
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { decodeTerrarium, encodeTerrarium, lonLatToTile, TILE_SIZE } from '../src/geo/tiles.ts';

const OUT_DIR = new URL('../public/textures/', import.meta.url);
const USER_AGENT = 'earth-sim-asset-builder';
const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
// z3 cells average ~20 km of ground, so finer steps are false precision and only bloat the PNG.
const ELEVATION_STEP_M = 10;

async function fetchBuffer(url, expectedType, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // GIBS reports WMS errors as XML with status 200, so check the type too.
      if (!type.startsWith(expectedType)) throw new Error(`expected ${expectedType}, got ${type}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${url}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

function gibsUrl(layer, width, height) {
  const params = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: layer, STYLES: '',
    CRS: 'EPSG:4326', BBOX: '-90,-180,90,180', WIDTH: String(width), HEIGHT: String(height),
    FORMAT: 'image/jpeg',
  });
  return `${GIBS_WMS}?${params}`;
}

async function buildGibsImage(fileName, layer) {
  const buffer = await fetchBuffer(gibsUrl(layer, 4096, 2048), 'image/jpeg');
  await writeFile(new URL(fileName, OUT_DIR), buffer);
  console.log(`${fileName}: ${(buffer.length / 1e6).toFixed(2)} MB`);
}

async function buildElevation(fileName) {
  const zoom = 3;
  const tilesPerSide = 2 ** zoom;
  const mosaicSize = tilesPerSide * TILE_SIZE; // 2048 px of Web Mercator
  const heights = new Float32Array(mosaicSize * mosaicSize);

  const jobs = [];
  for (let ty = 0; ty < tilesPerSide; ty++) {
    for (let tx = 0; tx < tilesPerSide; tx++) jobs.push([tx, ty]);
  }
  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const [tx, ty] = job;
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
      const png = PNG.sync.read(await fetchBuffer(url, 'image/png'));
      for (let py = 0; py < TILE_SIZE; py++) {
        for (let px = 0; px < TILE_SIZE; px++) {
          const i = (py * TILE_SIZE + px) * 4;
          const h = decodeTerrarium(png.data[i], png.data[i + 1], png.data[i + 2]);
          heights[(ty * TILE_SIZE + py) * mosaicSize + tx * TILE_SIZE + px] = h;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  // Bilinear sample of the Mercator mosaic at fractional pixel coordinates (x wraps, y clamps).
  const sample = (mx, my) => {
    const fx = mx - 0.5;
    const fy = Math.min(mosaicSize - 1, Math.max(0, my - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = fx - x0;
    const ay = fy - y0;
    const wrap = (x) => ((x % mosaicSize) + mosaicSize) % mosaicSize;
    const y1 = Math.min(mosaicSize - 1, y0 + 1);
    const at = (x, y) => heights[y * mosaicSize + wrap(x)];
    const top = at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax;
    const bottom = at(x0, y1) * (1 - ax) + at(x0 + 1, y1) * ax;
    return top * (1 - ay) + bottom * ay;
  };

  // Reproject to equirectangular, averaging 2×2 samples per pixel.
  // Rows beyond Mercator's ±85.05° reuse the edge row.
  const width = 1024;
  const height = 512;
  const out = new PNG({ width, height });
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let metres = 0;
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const lat = 90 - ((j + sy) * 180) / height;
        const lon = -180 + ((i + sx) * 360) / width;
        const { x, y } = lonLatToTile(lon, lat, zoom);
        metres += sample(x * TILE_SIZE, y * TILE_SIZE) / 4;
      }
      const [r, g, b] = encodeTerrarium(Math.round(metres / ELEVATION_STEP_M) * ELEVATION_STEP_M);
      const o = (j * width + i) * 4;
      out.data[o] = r;
      out.data[o + 1] = g;
      out.data[o + 2] = b;
      out.data[o + 3] = 255;
    }
  }
  const buffer = PNG.sync.write(out, { colorType: 2 });
  await writeFile(new URL(fileName, OUT_DIR), buffer);
  console.log(`${fileName}: ${(buffer.length / 1e6).toFixed(2)} MB`);
}

await mkdir(OUT_DIR, { recursive: true });
await buildGibsImage('earth_day.jpg', 'BlueMarble_ShadedRelief_Bathymetry');
await buildGibsImage('earth_night.jpg', 'VIIRS_Black_Marble');
await buildElevation('earth_elev.png');
