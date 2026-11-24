// Data sources, bundled assets and credits. Browser access (CORS) for every runtime
// source was verified on 2026-11-22; see docs/SPEC.md section 5.

/** ArcGIS Location Platform key, public by design and restricted to the site's domain. */
// `?.` keeps this module loadable in Node (build scripts), where Vite's import.meta.env is absent.
export const ESRI_API_KEY: string = import.meta.env?.VITE_ESRI_API_KEY ?? '';

/** Cesium ion access token for OSM Buildings (free tier, public-facing like the Esri key). */
export const CESIUM_ION_TOKEN: string = import.meta.env?.VITE_CESIUM_ION_TOKEN ?? '';
/** Cesium ion asset ID for the OSM Buildings tileset. */
export const CESIUM_OSM_BUILDINGS_ID = 96188;

export type TileUrl = (z: number, x: number, y: number) => string;

export const sources = {
  terrarium: ((z, x, y) =>
    `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`) satisfies TileUrl,
  /** Live imagery through ArcGIS Location Platform (needs the key). */
  esriImagery: ((z, x, y) =>
    `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?token=${encodeURIComponent(ESRI_API_KEY)}`) satisfies TileUrl,
  /** Pre-built places and fallback imagery (CC BY-NC-SA 4.0, non-commercial). */
  sentinel2: ((z, x, y) =>
    `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/${z}/${y}/${x}.jpg`) satisfies TileUrl,
  inaturalist: 'https://api.inaturalist.org/v1',
  wikipediaSummary: (title: string) =>
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
  nominatim: 'https://nominatim.openstreetmap.org',
  overpass: 'https://overpass-api.de/api/interpreter',
} as const;

/** The imagery used for zoomed-in globe tiles: Esri when a key is configured, otherwise Sentinel-2. */
export const liveImagery: { url: TileUrl; credit: string } = ESRI_API_KEY
  ? {
      url: sources.esriImagery,
      credit: 'Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community · Powered by Esri',
    }
  : {
      url: sources.sentinel2,
      credit: 'Imagery: EOxCloudless 2025 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2025), CC BY-NC-SA 4.0',
    };

/** Bundled files in public/, resolved against the page so any Pages sub-path works. */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

export const assets = {
  earthDay: 'textures/earth_day.jpg',
  earthNight: 'textures/earth_night.jpg',
  earthElevation: 'textures/earth_elev.png',
} as const;

export const credits: readonly string[] = [
  'Globe: NASA Blue Marble and Black Marble (GIBS)',
  'Elevation: AWS Terrain Tiles (SRTM, GMTED, ETOPO1 and others)',
  'Place names © OpenStreetMap contributors (Nominatim)',
];
