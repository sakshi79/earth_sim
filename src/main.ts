import './style.css';
import { assets, assetUrl, credits, liveImagery } from './config.ts';
import { loadGlobeMaps, type GlobeMaps } from './data/globeMaps.ts';
import { reverseGeocode, searchPlaces } from './data/nominatim.ts';
import { formatElevation, formatLatLon } from './format.ts';
import { guessLandscape, landscapeLabels, type LandscapeType } from './geo/landscape.ts';
import { oceanName } from './geo/oceans.ts';
import { GlobeView, type GlobeHit } from './globe/GlobeView.ts';
import { featuredPlaces, type Place } from './places.ts';
import { formatVisitHash, parseVisitHash } from './router.ts';
import { GlobeUi } from './ui/globeUi.ts';

const app = document.getElementById('app') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLElement;

function hasWebGL2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

interface SelectOptions {
  place?: Place;
  label?: string;
  /** Camera altitude to fly to, in globe radii. */
  altitude?: number;
}

async function boot(): Promise<void> {
  let maps: GlobeMaps | null = null;
  let selection = 0; // ignores place-name answers for earlier picks
  let selected: { lat: number; lon: number } | null = null;
  let tilesVisible = false;

  const ui = new GlobeUi(overlay, featuredPlaces, {
    onSearch: (query) => void runSearch(query),
    onSearchResult: (hit) => select(hit.lat, hit.lon, { label: hit.label, altitude: 0.8 }),
    onFeatured: (place) => select(place.lat, place.lon, { place, altitude: 0.8 }),
    onClosePreview: () => closePreview(),
    onCopyLink: () => {
      if (!selected) return;
      // The address only carries a place when shared, so a plain reload returns to the spinning globe.
      const { origin, pathname, search } = window.location;
      const link = `${origin}${pathname}${search}${formatVisitHash(selected.lat, selected.lon)}`;
      navigator.clipboard?.writeText(link).then(
        () => ui.flashCopied(true),
        () => ui.flashCopied(false),
      );
    },
  });
  const updateCredits = (): void => ui.setCredits(tilesVisible ? [liveImagery.credit, ...credits] : credits);
  updateCredits();

  if (!hasWebGL2()) {
    ui.setStatus('Earth Sim needs WebGL 2, which this browser or device does not support.');
    return;
  }

  const globe = new GlobeView(app, liveImagery.url, {
    onHover: (hit) => ui.setHover(hit ? hoverText(hit) : null),
    onPick: (hit) => select(hit.lat, hit.lon, { place: hit.place }),
    onDoublePick: (hit) => select(hit.lat, hit.lon, { place: hit.place, altitude: Math.max(0.001, globe.altitude() * 0.3) }),
    onTilesVisibleChange: (visible) => {
      tilesVisible = visible;
      updateCredits();
    },
  });
  globe.setPlaces(featuredPlaces);
  globe.start();

  function landscapeAt(lat: number, lon: number): LandscapeType | null {
    if (!maps) return null;
    return guessLandscape({ lat, elevation: maps.elevationAt(lat, lon), rgb: maps.colorAt(lat, lon) });
  }

  function hoverText(hit: GlobeHit): string {
    const parts = [formatLatLon(hit.lat, hit.lon, 2)];
    if (hit.place) parts.unshift(hit.place.name);
    if (maps) parts.push(formatElevation(maps.elevationAt(hit.lat, hit.lon)));
    return parts.join(' · ');
  }

  function select(lat: number, lon: number, options: SelectOptions = {}): void {
    const token = ++selection;
    selected = { lat, lon };
    globe.select(lat, lon, options.altitude);
    const landscape = landscapeAt(lat, lon);
    ui.showPreview({
      title: options.place?.name ?? options.label ?? 'Finding the name…',
      subtitle: options.place?.region,
      coords: formatLatLon(lat, lon),
      elevation: maps ? formatElevation(maps.elevationAt(lat, lon)) : '…',
      landscape: landscape ? landscapeLabels[landscape] : '…',
    });
    if (options.place || options.label) return;

    const fallback = landscape === 'ocean' || landscape === 'coast' ? oceanName(lat, lon) : formatLatLon(lat, lon);
    reverseGeocode(lat, lon).then(
      (name) => {
        if (token === selection) ui.setPreviewTitle(name ?? fallback);
      },
      () => {
        if (token === selection) ui.setPreviewTitle(fallback);
      },
    );
  }

  function closePreview(): void {
    selection++;
    selected = null;
    ui.hidePreview();
    globe.clearSelection();
    // Drop a shared-link place from the address, so reloading returns to the spinning globe.
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  async function runSearch(query: string): Promise<void> {
    ui.showSearching();
    try {
      ui.showSearchResults(await searchPlaces(query));
    } catch {
      ui.showSearchMessage('Search is unavailable right now. Try again in a moment.');
    }
  }

  function openFromHash(): void {
    const target = parseVisitHash(window.location.hash);
    if (!target) return;
    const place = featuredPlaces.find((p) => Math.abs(p.lat - target.lat) < 1e-4 && Math.abs(p.lon - target.lon) < 1e-4);
    select(target.lat, target.lon, { place, altitude: 0.8 });
  }

  ui.setStatus('Loading Earth…');
  const textures = globe.loadTextures(assetUrl(assets.earthDay), assetUrl(assets.earthNight)).then(
    () => ui.setStatus(''),
    (error: unknown) => {
      console.error(error);
      ui.setStatus('Could not load the Earth textures. Check the connection and reload.');
    },
  );
  try {
    maps = await loadGlobeMaps(assetUrl(assets.earthElevation), assetUrl(assets.earthDay));
    globe.setOceanMask(maps.waterMask());
  } catch (error) {
    console.error('Globe maps unavailable; elevation and landscape guesses are off.', error);
  }
  await textures;
  openFromHash();
  window.addEventListener('hashchange', openFromHash);
}

void boot();
