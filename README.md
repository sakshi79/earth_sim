# Earth Sim

A browser-based 3D Earth game: pick any place on the globe, explore it as a player, collect the species recorded there, climb and dive. Static site, no backend. See [docs/SPEC.md](docs/SPEC.md) for the full plan.

## Run locally

Requires Node.js 22.18 or newer.

```sh
npm install
npm run dev        # http://localhost:5173, also reachable from phones on the same network
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Type check + production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run globe-assets` | Rebuild `public/textures/` from NASA GIBS and Terrain Tiles (rarely needed; outputs are committed) |
| `npm run build-places [id ...]` | Rebuild the pre-built featured places in `public/places/` (outputs are committed) |
| `npm run build-player-model -- <glb>` | Rebuild `public/models/player.glb` from the Quaternius library (see `public/models/README.md`) |

## Controls (in a place)

WASD or arrows move · Shift run · Space jump (rise in water) · C dive · drag to look · scroll to zoom · V switch between the Follow and Scout cameras · in Scout, click the ground then R to move the player there · G back to the globe. Phones and tablets get an on-screen thumbstick and buttons.

Optional: copy `.env.example` to `.env.local` and set `VITE_ESRI_API_KEY` for sharp Esri imagery (from M1 on).

## Deploy to GitHub Pages

1. Push to a GitHub repository with the default branch `main`.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Optional: add the Esri key as a repository variable named `ESRI_API_KEY` (**Settings → Secrets and variables → Actions → Variables**). It's public by design; restrict it to the site's domain in ArcGIS Location Platform.

Every push to `main` then runs tests, builds and publishes. Any repository name works.

## Credits

- Globe imagery: NASA Blue Marble and Black Marble, via NASA GIBS.
- Elevation: AWS Terrain Tiles (SRTM, GMTED, ETOPO1 and other sources).
- Player character and animations: Universal Animation Library by Quaternius (CC0).
- Built with [three.js](https://threejs.org) (MIT).

- Place names and search: © OpenStreetMap contributors, via Nominatim.
- Satellite imagery: EOxCloudless 2025 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2025), CC BY-NC-SA 4.0. The pre-built imagery in `public/places/` carries the same licence (see its README). Esri World Imagery is used live when a key is configured.

Later milestones add iNaturalist and Wikipedia; their credits are listed in the app.

This is a non-commercial project.
