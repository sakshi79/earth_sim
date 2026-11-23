import './style.css';
import { assets, assetUrl, credits, liveImagery } from './config.ts';
import { loadGlobeMaps, type GlobeMaps } from './data/globeMaps.ts';
import { reverseGeocode, searchPlaces } from './data/nominatim.ts';
import { formatElevation, formatLatLon } from './format.ts';
import { guessLandscape, landscapeLabels, type LandscapeType } from './geo/landscape.ts';
import { oceanName } from './geo/oceans.ts';
import { isVisitable } from './geo/tiles.ts';
import { GlobeView, type GlobeHit } from './globe/GlobeView.ts';
import { featuredPlaces, type Place } from './places.ts';
import { formatVisitHash, parseVisitHash } from './router.ts';
import { Exploration } from './player/Exploration.ts';
import { preloadPlayer } from './player/Player.ts';
import { GlobeUi } from './ui/globeUi.ts';
import { LocationUi } from './ui/locationUi.ts';
import { loadPlace, TerrainUnavailableError, type LoadProgress } from './world/loadPlace.ts';
import { LocationView } from './world/LocationView.ts';
import { nearOcean, terrainWindow } from './world/terrainWindow.ts';

const app = document.getElementById('app') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLElement;
const world = document.getElementById('world') as HTMLElement;
const worldUi = document.getElementById('world-ui') as HTMLElement;
const fadeLayer = document.getElementById('fade') as HTMLElement;

const ELEVATION_CREDIT = 'Elevation: AWS Terrain Tiles (SRTM, GMTED, ETOPO1 and others)';
/** Camera altitude for the dive toward a place before it opens (globe radii; ~25 km). */
const DIVE_ALTITUDE = 0.004;

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

interface Selection {
  lat: number;
  lon: number;
  place?: Place;
  landscape: LandscapeType | null;
}

/** Fades the whole screen to black (true) or back (false). */
function fade(toBlack: boolean): Promise<void> {
  fadeLayer.classList.toggle('on', toBlack);
  return new Promise((resolve) => setTimeout(resolve, 380));
}

function progressText(p: LoadProgress): string {
  return p.stage === 'terrain' ? `Loading terrain… ${p.done}/${p.total}` : `Loading imagery… ${p.done}/${p.total}`;
}

async function boot(): Promise<void> {
  if (!hasWebGL2()) {
    const noop = (): void => {};
    const ui = new GlobeUi(overlay, featuredPlaces, {
      onSearch: noop, onSearchResult: noop, onFeatured: noop, onClosePreview: noop,
      onCopyLink: noop, onReset: noop, onVisit: noop,
    });
    ui.setCredits(credits);
    ui.setStatus('Earth Sim needs WebGL 2, which this browser or device does not support.');
    return;
  }

  // The UI is created first, but every handler below runs only after `globe` exists (same tick).
  let maps: GlobeMaps | null = null;
  let selection = 0; // ignores place-name answers for earlier picks
  let selected: Selection | null = null;
  let tilesVisible = false;
  let state: 'globe' | 'loading' | 'location' = 'globe';
  let location: LocationView | null = null;
  let exploration: Exploration | null = null;

  const ui = new GlobeUi(overlay, featuredPlaces, {
    onSearch: (query) => void runSearch(query),
    onSearchResult: (hit) => select(hit.lat, hit.lon, { label: hit.label, altitude: 0.8 }),
    onFeatured: (place) => select(place.lat, place.lon, { place, altitude: 0.8 }),
    onClosePreview: () => closePreview(),
    onReset: () => {
      closePreview();
      globe.resetView();
    },
    onVisit: () => void visit(),
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
  const locationUi = new LocationUi(worldUi, {
    onBack: () => void backToGlobe(),
    onTimeChange: (hours) => location?.setSolarHours(hours),
  });
  const updateCredits = (): void => ui.setCredits(tilesVisible ? [liveImagery.credit, ...credits] : credits);
  updateCredits();

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
    if (state !== 'globe') return;
    const token = ++selection;
    const landscape = landscapeAt(lat, lon);
    selected = { lat, lon, place: options.place, landscape };
    globe.select(lat, lon, options.altitude);
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

  /** Dives toward the selected place while its data loads, then fades into the 3D scene. */
  async function visit(): Promise<void> {
    const target = selected;
    if (state !== 'globe' || !target) return;
    if (!isVisitable(target.lat)) {
      ui.setStatus('Places this close to the poles can’t be visited yet: the map tiles stop at ±85°.');
      setTimeout(() => ui.setStatus(''), 5000);
      return;
    }
    state = 'loading';
    ui.setVisitBusy(true);
    const shown = ui.currentTitle();
    const title = shown && shown !== 'Finding the name…' ? shown : formatLatLon(target.lat, target.lon);
    globe.select(target.lat, target.lon, DIVE_ALTITUDE);
    preloadPlayer().catch(() => {}); // fetch the player model alongside the terrain
    try {
      const [data] = await Promise.all([
        loadPlace(target.lat, target.lon, {
          placeId: target.place?.id,
          onProgress: (p) => ui.setStatus(progressText(p)),
        }),
        globe.whenSettled(),
      ]);
      const oceanNearby = maps ? nearOcean(terrainWindow(target.lat, target.lon), maps.elevationAt) : false;
      await fade(true);
      globe.pause();
      app.hidden = overlay.hidden = true;
      world.hidden = false;
      location = new LocationView(world, data, { oceanNearby });
      location.start();
      const landscape = target.landscape ? landscapeLabels[target.landscape] : null;
      locationUi.show({
        title,
        subtitle: [landscape && `Likely ${landscape.toLowerCase()}`, formatLatLon(target.lat, target.lon)]
          .filter(Boolean)
          .join(' · '),
        credits: [
          ...(data.imageryCredit ? [data.imageryCredit] : []),
          ELEVATION_CREDIT,
          'Place names © OpenStreetMap contributors',
        ],
        solarHours: location.solarHoursNow,
      });
      exploration = await Exploration.start(location, locationUi);
      locationUi.attachInput(exploration.input);
      ui.setStatus('');
      state = 'location';
      await fade(false);
    } catch (error) {
      console.error(error);
      state = 'globe';
      ui.setStatus(
        error instanceof TerrainUnavailableError
          ? 'Elevation data is unavailable for this place right now. Try again in a moment.'
          : 'Could not open this place. Try again in a moment.',
      );
      setTimeout(() => ui.setStatus(''), 6000);
    } finally {
      ui.setVisitBusy(false);
    }
  }

  async function backToGlobe(): Promise<void> {
    if (state !== 'location') return;
    state = 'loading';
    await fade(true);
    exploration?.dispose();
    exploration = null;
    location?.dispose();
    location = null;
    locationUi.hide();
    world.hidden = true;
    app.hidden = overlay.hidden = false;
    globe.start();
    if (selected) globe.select(selected.lat, selected.lon, 0.05); // rise back above the place
    state = 'globe';
    await fade(false);
  }

  function openFromHash(): void {
    const target = parseVisitHash(window.location.hash);
    if (!target || state !== 'globe') return;
    const place = featuredPlaces.find((p) => Math.abs(p.lat - target.lat) < 1e-4 && Math.abs(p.lon - target.lon) < 1e-4);
    select(target.lat, target.lon, { place, altitude: 0.8 });
    void visit();
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
