# Earth Sim: spec

Draft v0.5 · 2026-11-22 · **[OPEN]** = needs sign-off (section 13)

## 1. What it is

A browser-based 3D Earth. Spin a globe, pick any place and travel there. You play as a character filmed by a third-person camera: walk real terrain under real satellite imagery, swim and dive in real seas, and meet species actually recorded there. It's a game: every place has goals, species to collect, and activities such as climbing and diving. It is a non-commercial project, run as a static site on GitHub Pages with no backend.

## 2. Scope

**MVP**
- Globe with real day/night; pick a place by click, search or a featured list.
- Local scene about 15 km across, built from real elevation (including the sea floor) and satellite imagery.
- Player character with walk, run, jump, swim and dive; Follow, Documentary and Scout cameras.
- Vegetation and mood that match the landscape type.
- Real nearby species as interactive creatures and plants; finding them fills a collection journal, with rarer species worth more.
- Goals at every place, and two activities: climbing and diving, with stamina, oxygen, failing and retrying, and best times. Progress is saved in the browser.
- Sound effects and feedback for actions and discoveries.
- Auto-deploy to GitHub Pages; no secrets.

**Not in MVP:** 3D terrain on the globe itself, buildings and roads, live weather, accounts, leaderboards, multiplayer, VR, realistic animal models, scientific precision (rules of thumb are labelled as such).

## 3. Flow and controls

Globe → pick → preview (name, coordinates, elevation, likely landscape) → Visit → fly-down while loading → local scene → G returns to the globe. Deep links: `#/visit/lat,lon`.

| Context | Controls |
|---|---|
| Globe | drag rotate · wheel/pinch zoom · click pick · double-click visit · search on Enter |
| Player | WASD move (relative to camera) · Shift run · Space jump / rise · C dive · E observe · mouse or right-drag orbits camera · wheel zoom |
| Scout camera | WASD · Space/C up/down · drag look · click ground + R sends the player there · click a species to observe |
| Anywhere | V switch camera · J journal · T time of day · G globe · Esc menu |

Phones and tablets: an on-screen thumbstick to move, drag to turn the camera, buttons for jump, run, rise/dive and observe, and tap a species to observe it. Keyboard and mouse remain the main way to develop and test.

## 4. Architecture

- Vite + TypeScript + three.js, plain DOM UI. `three-slippy-map-globe` for zoomable globe imagery (D1).
- No backend: bundled assets plus public services the browser can read directly. Only Esri needs a key, and it is public by design and locked to our site (D3).
- The terrain code avoids browser-only APIs (image decoding sits behind an interface), so the build scripts can run it in Node.
- Vitest for unit tests, Playwright for smoke tests.

```
src/
  main.ts       state machine: globe ↔ location
  config.ts     source URLs, budgets, feature flags
  data/         source adapters, cache, rate-limited request queue
  geo/          tile maths, sun position, coarse elevation lookup
  globe/        globe view, shaders, picking
  world/        terrain, water, sky, landscape types, vegetation
  player/       character, animation, movement, camera rig
  wildlife/     species, creature types, behaviours
  activities/   activity registry, climbing, diving, goals and scoring
  audio/        sound effects
  ui/           HUD, panels, species card, journal, settings, credits
scripts/build-globe-assets.mjs   one-off download of globe textures
scripts/prebuild-places.mjs      ready-made terrain for featured places
```

The local scene uses metres, centred on the chosen point, Y up, built from Web Mercator map tiles. Places beyond ±85° latitude can't be visited.

## 5. Data sources

Browser access (CORS) verified 2026-11-22. All keyless except Esri and Cesium (D3, D10). Endpoints live in `config.ts`.

| Data | Source | Licence / limits |
|---|---|---|
| Elevation and sea floor | AWS Terrain Tiles (Terrarium) | Open data; credit sources |
| Imagery, live | Esri World Imagery via ArcGIS Location Platform, key locked to our site | Esri terms; "Powered by Esri" + source credit; 2M tiles/month free |
| Imagery, pre-built places and fallback | EOX Sentinel-2 cloudless 2025 | CC BY-NC-SA 4.0: non-commercial re-hosting allowed, and files made from it carry the same licence; ~10 m/px |
| 3D buildings | Cesium OSM Buildings (3D Tiles), via free Cesium ion token | CC BY 4.0 / ODbL; ~1.1B buildings globally |
| Roads and POIs | Overpass API (OpenStreetMap) | ODbL; ≤ 2 concurrent; keyless |
| Species and photos | iNaturalist API v1 | ≤ 1 req/s; each photo's licence and credit shown |
| Species descriptions | Wikipedia REST summary | CC BY-SA |
| Place names, search | Nominatim (OpenStreetMap) | ≤ 1 req/s, no search-as-you-type; ODbL |
| Globe textures (bundled) | NASA Blue Marble and Black Marble (GIBS) | NASA; credit |
| Coarse global elevation (bundled) | Terrain Tiles z3, reprojected | as above |
| Player model (bundled) | Quaternius Universal Animation Library mannequin, trimmed to 11 animations (2.7 MB) | CC0 |

Every request goes through an adapter with caching, per-host rate limits and graceful failure.

## 6. Features

**Globe.** Real-sun day/night with city lights, atmosphere glow, ocean glint. The bundled Blue Marble shows from afar; tiled imagery fades in when zoomed close, capped at z15. Hovering shows elevation without network calls; clicking looks up the place name.

**Loading a place.** 3×3 z13 elevation tiles (~15 km, ~19 m per sample; z12 beyond ±60° so the area stays over 10 km) and z14 imagery (36 tiles, ~10 m/px; z15 on High quality). Elevation is required; imagery and species may fail without blocking the visit. Ready in under 8 s on a first visit, under 2 s cached.

**Pre-built featured places.** At build time, `scripts/prebuild-places.mjs` runs the same terrain code in Node for each featured place. It writes a ready-made height grid, sea mask, single imagery texture, landscape type and species snapshot to `public/places/<id>/`, about 1–1.5 MB per place. Each place's files load only when it's visited, with a target of under 2 s, and live data replaces the species snapshot once it arrives. The pre-built texture is Sentinel-2 2025, which allows non-commercial re-hosting, so the scene appears instantly. Sharp Esri imagery then streams in and replaces it within a second or two.

**Terrain, sky, water.** 384×384 mesh at true scale, with optional height exaggeration ×1–3. A detail texture blends in near the camera. Physical sky from the place's real sun position, with a time-of-day slider. Sea at 0 m only where low ground connects to the open ocean, so below-sea-level land like the Dead Sea basin doesn't flood; ground under 3 m that the imagery shows as water also counts (reef flats in coarse data). Underwater fog and tint. Inland lakes come later.

**Landscape type.** Rule-based, from latitude, elevation, relief, slope, water fraction and imagery colour. Types: ocean/reef, ice, mountain, valley/canyon, coast, desert, rainforest, boreal forest, temperate forest, tundra, grassland. First match wins; thresholds tuned in M4 against the featured places. Drives vegetation, sky tint and which activities are offered.

**Vegetation.** Instanced low-poly trees, palms, cacti, shrubs, grass and rocks; coral underwater. Placed deterministically where the imagery is green, limited by slope and treeline. Each kind has its own cell size, radius and capacity (e.g. grass 12k within 55 m, trees 3–8k within ~1 km). Colours are tinted from the satellite imagery. Sun shadows on vegetation that casts them (trees, shrubs, rocks). The player collides with rocks and tree trunks (push-out).

**Buildings.** Real 3D buildings from Cesium OSM Buildings (3D Tiles), streamed when a Cesium ion token is configured. LOD1 extruded boxes with heights, covering ~1.1B buildings worldwide. Buildings cast and receive shadows. Without a token, the scene loads normally without buildings.

**Roads and POI labels.** OSM roads from Overpass API, drawn as flat ribbons on the terrain, styled by type (motorway, residential, path, etc.). Named points of interest (peaks, viewpoints, villages, landmarks) float as text labels above the terrain. Both load in the background after the terrain is ready; failures are silent.

**Wildlife.**
- Top 40 iNaturalist species within 15 km (30 km on water), widened up to 100 km if sparse.
- Each group gets its own model and behaviour: birds fly and take off, mammals wander and flee, fish school, insects flutter, plants and fungi stay put with a marker.
- Creatures are tinted from the species photo; at most 60 are animated.
- The species list is real; positions are illustrative, and the UI says so.

**Observing.** Face a species in range (10 m for small ones, 60 m for large ones through binoculars) and press E, or click it in Scout. The player plays an observe animation, the camera frames them with the species, and the species card opens: photo and credit, names, conservation status, local count, Wikipedia extract and links. The journal records it in `localStorage`.

**Player.**
- Model: a CC0 rigged low-poly human.
- Animations: idle, walk, run, jump, fall, swim, dive, observe, climb.
- Speeds: walk 1.4 m/s, run 5 m/s, swim and dive 1 m/s.
- Movement: follows the ground height directly (no physics engine), with a 35° maximum slope. Swims in deep water, with a breath gauge that has no effect until the diving activity. A soft boundary stops the player at the area's edge.

**Cameras.**
- Follow (default): over the shoulder, 2–15 m, orbitable, swings back behind the player.
- Documentary: an automatic camera operator cutting between establishing, tracking, low-angle, underwater and observe shots every 6–12 s.
- Scout: a free camera for surveying, which can send the player to a clicked spot.
- All three keep the player in view, stay above ground and stay off the water surface.

**HUD and settings.** HUD: place, landscape, elevation or depth, coordinates, compass, camera, player state, species found, time. Settings: quality, imagery source, exaggeration, mouse, reduced motion. A credits page lists every source.

**Goals and collection.**
- Each place offers goals such as "find 10 species", "reach the summit" or "finish a dive". Completing them earns stars.
- Every species found adds points to the journal. Rarer species are worth more, with rarity based on how few iNaturalist observations they have locally.
- Badges for milestones, for example the first species of each group, or every featured place visited.
- Progress (journal, stars, badges, best times) is saved in `localStorage`. Leaderboards come later and need a backend.

**Activities.** A registry of `Activity { eligible(context), start(world) }`.
- **Climbing (MVP):** offered where relief exceeds 800 m. It starts well below the highest point in the area, and the goal is to reach it. Stamina drains on steep ground and comes back while resting. Slopes over 35° need climbing moves. Running out of stamina sends the player back to the last checkpoint. Timed, with best times kept.
- **Diving (MVP):** offered where water is deeper than 5 m. An oxygen tank and a depth limit, and a checklist of local marine species to find. Surface before the oxygen runs out, or restart the dive.
- **Trekking (later):** OSM trails or waypoints, with species to spot along the route.

**Sound and feedback.** Footsteps that change with the surface, water and wind sounds, generic calls for each creature group, and cues for discoveries and goals. Small effects such as splashes and dust. Sounds come from CC0 packs.

## 7. Featured places

Coordinates to be checked in M1.

| Type | Places (lat, lon) |
|---|---|
| Desert | Erg Chebbi (31.15, −3.97) · Deadvlei (−24.76, 15.29) |
| Mountain | Everest (27.988, 86.925) · Matterhorn (45.976, 7.659) · Kīlauea (19.41, −155.28) |
| Valley | Yosemite (37.746, −119.594) · Grand Canyon (36.062, −112.108) |
| Ocean | Heron Island reef (−23.442, 151.915) · Monterey Bay kelp (36.62, −121.90) |
| Forest / savanna | Reserva Ducke, Amazon (−2.93, −59.97) · Serengeti (−2.45, 34.83) |
| Polar | Ilulissat (69.2, −51.0) |

## 8. Requirements

- 60 fps on a mid-range GPU at Medium, ≥ 30 fps on integrated GPUs at Low. JS under 1 MB gzipped; bundled textures and model under 10 MB (pre-built places are extra, loaded only on visit).
- Desktop Chrome, Edge, Firefox and Safari; mobile Chrome and Safari at Low quality. WebGL 2 required.
- Any source can fail without breaking the app: no imagery → tinted terrain; no species → "unavailable"; no names → coordinates; no elevation → visit refused with a reason.
- No accounts, analytics or location prompts; `localStorage` holds only settings, the journal and progress.
- Keyboard accessible, WCAG AA text contrast, reduced-motion option.

## 9. Hosting

- GitHub Pages, deployed by GitHub Actions on each push to `main`. Vite `base: './'`, so any repo name works. No secrets: the Esri key is public by design and locked to our site.
- Local: `npm run dev`; `npm run build && npm run preview` for the production build.
- If we later need API keys, a proxy or cache, saved data, multiplayer or server features: put a Cloudflare Worker in front of just those calls (a config change), or move to Cloudflare Pages + Workers, Netlify or Vercel.

## 10. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Setup | Scaffold, tests, Pages workflow, globe assets, Esri account and site-locked key; spinning globe live |
| M1 | Globe | Day/night, atmosphere, tiled zoom, picking, search, featured list, preview, deep links, reset |
| M2 | Terrain | Tiles → mesh + imagery, sky, sea, fly-down loading, back to globe; featured places pre-built |
| M3 | Player and camera | Animated character; walk/run/jump/swim/dive; keyboard/mouse and touch controls; Follow and Scout; HUD; time slider; vegetation and ground detail (pulled from M4); sun shadows; vegetation collision |
| M4 | Landscapes and infrastructure | Classifier tuned; 3D buildings (Cesium OSM Buildings); roads and POI labels (Overpass); remaining vegetation polish |
| M5 | Wildlife and collection | Creatures ✓, observing ✓, species card ✓, collection journal ✓; remaining: rarity points, place goals and stars, badges, Documentary camera |
| M6 | Activities | Climbing and diving with stamina, oxygen, checkpoints, failing and retrying, best times; sound and feedback effects |
| M7 | Launch | Settings, performance (including phones at Low quality), error states, credits, smoke tests, public release |
| M8+ | Later | Trekking, character choice, first-person photo view, photo mode and clip recording, sharper imagery near the player, ambient audio, weather, fully stylised look, Google Photorealistic 3D Tiles (D11) |
| Later | Accounts and sync | Journal and progress saved across devices and safe from cleared browser data; leaderboards; shared saved trips; multiplayer. Needs a backend (section 9). A higher priority now that the focus is game-like. |
| Later | Server-side terrain prep | Pre-built terrain for any place a player picks, not only featured places, so slow devices load faster everywhere. Needs a server with a cache (section 9). |

## 11. Testing

- Unit: tile maths, elevation decoding, sun position, landscape rules, placement, sea mask.
- Smoke and manual: every featured place loads cleanly; cameras behave on steep ground and at the water surface; frame time within budget.
- Phones: browser device emulation for layout, plus real phones for performance, opened through the dev server on the local network or the deployed site.
- Playtests: each eligible featured place has a climb or dive that can be completed and is fun (Everest, Matterhorn and Kīlauea climbs; Heron Island and Monterey Bay dives).

## 12. Risks

- Esri down or free tier used up → Sentinel-2 2025 fallback; paid tier if traffic justifies it.
- Provider outages or rate limits → caching, request queue, fallbacks.
- Few species recorded at sea → wider radius; GBIF/OBIS later.
- Wrong landscape type → tune on featured places; label as "likely".
- Weak GPUs → quality levels, texture-size checks.
- Phones run out of memory or GPU power, especially iPhone Safari → Low quality uses smaller textures and fewer plants and creatures; test on real phones.
- Character pack lacks swim, dive or climb animations → check before choosing; mix packs; code-driven poses.
- Camera clips into steep terrain → line-of-sight checks; test on Everest and the Grand Canyon.
- Real terrain makes a climb or dive too easy, too hard or impossible → each activity picks its own start point and checkpoints; tune at each featured place.

## 13. Open decisions

None. The project owner creates and manages the GitHub repository, and any repo name works (`base: './'`).

## 14. Decisions

- **D1 Globe library.** Full globe.gl costs 566 KB gzipped against 135 KB for three.js alone, mostly for unused data-visualisation layers, and it owns the render loop. We use only its tile engine, `three-slippy-map-globe` (+17 KB), and write picking, fly-to, atmosphere and day/night ourselves.
- **D2 Third-person player.** Replaces the first-person view: the user controls a visible character filmed by the Follow, Documentary or Scout camera.
- **D3 Imagery.** Esri live, through a free ArcGIS Location Platform account with a site-locked key: far sharper at walking scale (0.3–1.2 m vs 10 m) and clearly licensed that way. Esri forbids re-hosting its tiles, so pre-built places ship Sentinel-2 2025, with Esri streaming in over it. Sentinel-2 2025 is also the live fallback. Its licence (CC BY-NC-SA 4.0) fits because the project is non-commercial. If the project ever goes commercial, switch to the 2016 edition (CC BY 4.0) or buy an EOX licence. The 2017 edition has gaps.
- **D4 Look.** The MVP uses real terrain and imagery with stylised low-poly creatures, plants and player. A fully stylised look is a later option.
- **D5 Game-like focus.** The MVP gains place goals, a collection journal with rarity points, climbing and diving (M6), and sound effects. This pushes the launch from M6 to M7. Trekking and leaderboards stay later; leaderboards need a backend.
- **D6 Player.** One fixed character in the MVP. A choice of characters and customisation come later.
- **D9 Player model.** Quaternius' Universal Animation Library (CC0): one mannequin with idle, walk, jog, sprint, jump, swim and crouch animations on one rig. It has no climbing animation, so the climbing activity (M6) needs one from another CC0 pack on the same rig, or a code-driven pose.
- **D7 Recording.** Left out of the MVP. Photo mode and clip recording stay on the later list.
- **D8 Phones.** Mobile browsers are supported in the MVP with on-screen touch controls built alongside keyboard and mouse in M3, and phone performance is tuned in M7 at Low quality.
- **D10 3D buildings.** Cesium OSM Buildings via `3d-tiles-renderer` (NASA JPL). Free Cesium ion account provides a public-facing token (like the Esri key). LOD1 boxes, global coverage. Roads and POIs from Overpass API (keyless). Both are optional: buildings need a token; roads/POIs fail silently if the API is unavailable.
- **D11 Google Photorealistic 3D Tiles (later).** Full textured 3D cities via Google Maps Platform. Needs a Google Cloud billing account; first $200/month free. Far higher fidelity than OSM buildings but only in supported cities. Planned as an optional upgrade over Cesium buildings.
