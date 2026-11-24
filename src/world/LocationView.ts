import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { waterness } from '../data/globeMaps.ts';
import { fetchNearbySpecies } from '../data/inaturalist.ts';
import { queryRoads, queryPOIs } from '../data/overpass.ts';
import type { LandscapeType } from '../geo/landscape.ts';
import type { WorldQuery } from '../player/movement.ts';
import { Buildings, buildingsAvailable } from './buildings.ts';
import { CreatureSystem } from './creatures.ts';
import type { PlaceData } from './loadPlace.ts';
import { POILabels } from './pois.ts';
import { Roads } from './roads.ts';
import type { Site } from './scatter.ts';
import { Vegetation } from './vegetation.ts';
import {
  atSolarTime,
  localToPixel,
  pixelToLocal,
  sampleGrid,
  seaMask,
  solarHours,
  sunDirectionLocal,
  vertexHeights,
  windowBounds,
  windowPixelToLatLon,
} from './terrainWindow.ts';

/** Terrain grid cells per side (385² ≈ 148k vertices). */
const SEGMENTS = 384;
/** The sky box must sit inside the camera's far plane. */
const SKY_SCALE = 20_000;
const FAR_PLANE = 60_000;
const APRON_SIZE = 400_000;
const UNDERWATER_COLOR = new THREE.Color(0x0b4a5c);
/** Vertical field of view on landscape screens, in degrees. */
const BASE_FOV = 55;

export interface LocationOptions {
  /** The coarse global map shows ocean nearby; enables the sea. */
  oceanNearby: boolean;
  /** The real moment to start from; the time-of-day control changes the hour. */
  date?: Date;
  /** Vertical exaggeration of the terrain (1 = true scale). */
  exaggeration?: number;
  /** Coarse landscape type, which decides what grows here. */
  landscape?: LandscapeType | null;
}

/**
 * The 3D scene of a visited place: real terrain and imagery at true scale (1 unit = 1 m;
 * x east, y up, z south, origin at the chosen point), sea, sky and sun for the local time.
 * The camera is driven from outside through `onFrame` (see player/Exploration.ts).
 */
export class LocationView {
  /** Local solar time at the place when the scene opened, in hours. */
  readonly solarHoursNow: number;
  readonly hasSea: boolean;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Ground height, open sea and bounds, for the player and cameras. */
  readonly world: WorldQuery;
  /** Called every frame before rendering, with the step in seconds. */
  onFrame: ((dt: number) => void) | null = null;

  /** Pushes a point out of solid vegetation (rocks, tree trunks). */
  pushOutOfVegetation(x: number, z: number, radius: number): { x: number; z: number } {
    return this.vegetation.pushOut(x, z, radius);
  }
  get creatures(): CreatureSystem | null { return this._creatures; }
  /** Where the action is (the player): vegetation and sun shadows centre here. */
  readonly focus = new THREE.Vector3();

  private readonly container: HTMLElement;
  private readonly data: PlaceData;
  private readonly date: Date;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly mask: Uint8Array;
  private readonly vegetation: Vegetation;
  private buildings: Buildings | null = null;
  private roads: Roads | null = null;
  private poiLabels: POILabels | null = null;
  private _creatures: CreatureSystem | null = null;
  private readonly imageryPixels: { data: Uint8ClampedArray; size: number } | null;
  private readonly sunDirection = new THREE.Vector3(0, 1, 0);
  private underwater = false;
  private lastFrameMs: number | null = null;
  private readonly sky = new Sky();
  private readonly envSky = new Sky();
  private readonly envScene = new THREE.Scene();
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envDirty = true;
  private lastEnvMs = -Infinity;
  private readonly sunLight = new THREE.DirectionalLight(0xffffff, 3);
  private readonly skyLight = new THREE.HemisphereLight(0x9db4d6, 0x3a3226, 0.4);
  private readonly fog = new THREE.Fog(0xb8cbe0, 1000, 10000);
  private readonly underwaterFog = new THREE.Fog(0x0b4a5c, 1, 45);
  private readonly grid: Float32Array;
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private readonly halfSize: number;
  private readonly resizeObserver: ResizeObserver;
  private daylight = 1;

  constructor(container: HTMLElement, data: PlaceData, options: LocationOptions) {
    this.container = container;
    this.data = data;
    this.date = options.date ?? new Date();
    const w = data.window;
    this.halfSize = w.sizeMetres / 2;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.45;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 1, FAR_PLANE);
    this.scene.fog = this.fog;

    // Sea first: shallow sea floor is pushed at least 2 m under the surface so the two never
    // coincide (some reefs, like Heron Island, are flat 0 m in the elevation data).
    const water = options.oceanNearby ? waterPixels(data.imagery, w.sizePx) : null;
    const mask = seaMask(data.heights, w.sizePx, w.sizePx, options.oceanNearby, (i) => water?.[i] === 1);
    this.mask = mask;
    this.hasSea = mask.includes(1);
    const heights = this.hasSea ? data.heights.map((h, i) => (mask[i] ? Math.min(h, -2) : h)) : data.heights;

    // Terrain.
    const exaggeration = options.exaggeration ?? 1;
    this.grid = vertexHeights(heights, w.sizePx, SEGMENTS).map((h) => h * exaggeration);
    const nw = pixelToLocal(w, 0, 0);
    const se = pixelToLocal(w, w.sizePx, w.sizePx);
    this.bounds = { minX: nw.x, maxX: se.x, minZ: nw.z, maxZ: se.z };
    this.world = {
      heightAt: (x, z) => this.heightAt(x, z),
      waterAt: (x, z) => this.waterAt(x, z),
      bounds: this.bounds,
    };
    const apronY = this.hasSea ? -2 : edgeMinimum(this.grid, SEGMENTS + 1) - 30;
    this.scene.add(this.createTerrain(apronY));
    this.scene.add(this.createApron(apronY));
    if (this.hasSea) this.scene.add(this.createSea(mask));

    // Grass, rocks and trees, placed where the imagery shows them and tinted to match it.
    this.imageryPixels = readPixels(data.imagery);
    this.vegetation = new Vegetation(
      { landscape: options.landscape ?? null, lat: w.lat, lon: w.lon },
      { site: (x, z) => this.siteAt(x, z) },
    );
    this.scene.add(this.vegetation.group);

    // Buildings (Cesium OSM Buildings via 3D Tiles), roads, and POI labels load in the background.
    if (buildingsAvailable()) {
      this.buildings = new Buildings(w.lat, w.lon, this.camera, this.renderer);
      this.scene.add(this.buildings.group);
    }
    const bounds = windowBounds(w);
    this.loadOverpassData(bounds, w);
    this.loadWildlife(w.lat, w.lon);

    // Sky and light.
    for (const sky of [this.sky, this.envSky]) {
      const u = sky.material.uniforms;
      u.turbidity.value = 4;
      u.rayleigh.value = 1.6;
      u.mieCoefficient.value = 0.005;
      u.mieDirectionalG.value = 0.8;
      u.cloudCoverage.value = 0.35;
    }
    this.sky.scale.setScalar(SKY_SCALE);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.envSky.scale.setScalar(50); // inside the PMREM cube camera's far plane
    this.envScene.add(this.envSky);
    this.scene.add(this.sunLight, this.sunLight.target, this.skyLight);
    // Sun shadows in a box around the player, so they stay sharp where it matters.
    const shadow = this.sunLight.shadow;
    this.sunLight.castShadow = true;
    shadow.mapSize.set(2048, 2048);
    const half = 45;
    Object.assign(shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 900 });
    shadow.camera.updateProjectionMatrix();
    shadow.bias = -0.0004;
    shadow.normalBias = 0.05;
    shadow.radius = 3;

    // A wide opening view from the south until a camera rig takes over.
    const groundHere = this.surfaceAt(0, 0);
    const distance = THREE.MathUtils.clamp(this.halfSize * 0.45, 600, 5000);
    this.camera.position.set(0, groundHere + distance * Math.sin(0.6), distance * Math.cos(0.6));
    this.camera.lookAt(0, groundHere, 0);

    this.solarHoursNow = solarHours(this.date, w.lon);
    this.setSolarHours(this.solarHoursNow);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Latitude/longitude of local coordinates. */
  latLonAt(x: number, z: number): { lat: number; lon: number } {
    const { px, py } = localToPixel(this.data.window, x, z);
    return windowPixelToLatLon(this.data.window, px, py);
  }

  /** Whether a point (local metres) is over open sea. */
  waterAt(x: number, z: number): boolean {
    if (!this.hasSea) return false;
    const w = this.data.window;
    const { px, py } = localToPixel(w, x, z);
    const i = Math.floor(px);
    const j = Math.floor(py);
    if (i < 0 || j < 0 || i >= w.sizePx || j >= w.sizePx) return false;
    return this.mask[j * w.sizePx + i] === 1;
  }

  /** Dense blue-green fog while the camera is under the sea surface. */
  setUnderwater(underwater: boolean): void {
    this.underwater = underwater;
  }

  /** Terrain height in metres at local coordinates (x east, z south). */
  heightAt(x: number, z: number): number {
    const w = this.data.window;
    const { px, py } = localToPixel(w, x, z);
    const n = SEGMENTS + 1;
    return sampleGrid(this.grid, n, n, (px / w.sizePx) * SEGMENTS, (py / w.sizePx) * SEGMENTS);
  }

  /** Moves the sun to a local solar time (hours, 0–24) on the day the scene opened. */
  setSolarHours(hours: number): void {
    const w = this.data.window;
    const s = sunDirectionLocal(w.lat, w.lon, atSolarTime(this.date, w.lon, hours));
    const sun = new THREE.Vector3(s.x, s.y, s.z);
    this.sky.material.uniforms.sunPosition.value.copy(sun);
    this.envSky.material.uniforms.sunPosition.value.copy(sun);
    this.sunDirection.copy(sun);

    const day = THREE.MathUtils.smoothstep(s.y, -0.05, 0.25);
    const twilight = THREE.MathUtils.smoothstep(s.y, -0.18, 0.02);
    this.daylight = day;
    // Sun against sky light at about 3–4 : 1, like a clear day, so shadows read clearly.
    this.sunLight.intensity = 4 * THREE.MathUtils.smoothstep(s.y, -0.02, 0.2);
    this.sunLight.color.setRGB(1, 0.72 + 0.28 * day, 0.5 + 0.5 * day);
    // A moonlight floor keeps night scenes readable.
    this.skyLight.intensity = 0.1 + 0.2 * twilight;
    this.skyLight.color.set(day > 0.5 ? 0x9db4d6 : 0x5d6f99);
    this.fog.color
      .set(0x0a1020)
      .lerp(new THREE.Color(0xc99372), twilight)
      .lerp(new THREE.Color(0xb8cbe0), day);
    this.envDirty = true;
  }

  start(): void {
    this.renderer.setAnimationLoop((timeMs: number) => this.frame(timeMs));
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.onFrame = null;
    this.resizeObserver.disconnect();
    this.buildings?.dispose();
    this.roads?.dispose();
    this.poiLabels?.dispose();
    this._creatures?.dispose();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    });
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private loadOverpassData(
    bounds: { south: number; west: number; north: number; east: number },
    w: import('./terrainWindow.ts').TerrainWindow,
  ): void {
    const heightAt = (x: number, z: number) => this.heightAt(x, z);
    queryRoads(bounds.south, bounds.west, bounds.north, bounds.east)
      .then((roads) => {
        this.roads = new Roads(roads, w, heightAt);
        this.scene.add(this.roads.group);
      })
      .catch((e) => console.warn('Roads unavailable:', e));
    queryPOIs(bounds.south, bounds.west, bounds.north, bounds.east)
      .then((pois) => {
        this.poiLabels = new POILabels(pois, w, heightAt);
        this.scene.add(this.poiLabels.group);
      })
      .catch((e) => console.warn('POI labels unavailable:', e));
  }

  private loadWildlife(lat: number, lon: number): void {
    fetchNearbySpecies(lat, lon, { aquatic: this.hasSea })
      .then((species) => {
        this._creatures = new CreatureSystem(species, this.world);
        this.scene.add(this._creatures.group);
      })
      .catch((e) => console.warn('Wildlife unavailable:', e));
  }

  private frame(timeMs: number): void {
    const dt = this.lastFrameMs === null ? 0 : Math.min(0.1, (timeMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = timeMs;
    this.onFrame?.(dt);
    this.vegetation.update(this.focus.x, this.focus.z);
    this.buildings?.update();
    this.poiLabels?.update(this.camera.position);
    this._creatures?.update(dt, this.focus.x, this.focus.z);
    // The sun's shadow box follows the player.
    this.sunLight.target.position.copy(this.focus);
    this.sunLight.position.copy(this.focus).addScaledVector(this.sunDirection, 400);

    const camera = this.camera.position;
    const height = Math.max(0, camera.y - this.surfaceAt(camera.x, camera.z));
    if (this.underwater) {
      // Water swallows light within tens of metres.
      this.scene.fog = this.underwaterFog;
      this.underwaterFog.color.copy(UNDERWATER_COLOR).multiplyScalar(0.25 + 0.75 * this.daylight);
    } else {
      // Fog hides the edge of the area at eye level, but thins out when looking down from high up.
      this.scene.fog = this.fog;
      this.fog.near = Math.max(this.halfSize * 0.6, height * 1.5);
      this.fog.far = Math.max(this.halfSize * 1.6, height * 4);
    }
    this.camera.near = THREE.MathUtils.clamp(height * 0.02, 0.1, 50);
    this.camera.updateProjectionMatrix();

    this.sky.material.uniforms.time.value = timeMs / 1000;
    if (this.envDirty && timeMs - this.lastEnvMs > 250) this.updateEnvironment(timeMs);
    this.renderer.render(this.scene, this.camera);
  }

  /** Lights the scene with the sky itself (image-based lighting), re-rendered when the sun moves. */
  private updateEnvironment(timeMs: number): void {
    this.envDirty = false;
    this.lastEnvMs = timeMs;
    const target = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    this.envTarget?.dispose();
    this.envTarget = target;
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = 0.08 + 0.27 * this.daylight;
  }

  /** What the vegetation scatter needs to know about a spot, or null outside the area. */
  private siteAt(x: number, z: number): Site | null {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    if (x < minX || x > maxX || z < minZ || z > maxZ) return null;
    const height = this.heightAt(x, z);
    const slope = Math.hypot(this.heightAt(x + 2, z) - this.heightAt(x - 2, z), this.heightAt(x, z + 2) - this.heightAt(x, z - 2)) / 4;
    let rgb: [number, number, number] = [110, 110, 90];
    if (this.imageryPixels) {
      const { px, py } = localToPixel(this.data.window, x, z);
      const scale = this.imageryPixels.size / this.data.window.sizePx;
      const i = Math.min(this.imageryPixels.size - 1, Math.max(0, Math.floor(px * scale)));
      const j = Math.min(this.imageryPixels.size - 1, Math.max(0, Math.floor(py * scale)));
      const k = (j * this.imageryPixels.size + i) * 4;
      const d = this.imageryPixels.data;
      rgb = [d[k], d[k + 1], d[k + 2]];
    }
    return { height, slope, water: this.waterAt(x, z), rgb };
  }

  /** Height of whatever the camera could hit: the ground, or the sea surface over water. */
  private surfaceAt(x: number, z: number): number {
    const h = this.heightAt(x, z);
    return this.hasSea ? Math.max(h, 0) : h;
  }

  private createTerrain(skirtY: number): THREE.Mesh {
    const w = this.data.window;
    const n = SEGMENTS + 1;
    // The grid, plus a skirt ring of 4·SEGMENTS vertices dropped to the apron so edges never show sky.
    const ring = 4 * SEGMENTS;
    const positions = new Float32Array((n * n + ring) * 3);
    const uvs = new Float32Array((n * n + ring) * 2);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const { x, z } = pixelToLocal(w, (i / SEGMENTS) * w.sizePx, (j / SEGMENTS) * w.sizePx);
        positions.set([x, this.grid[k], z], k * 3);
        uvs.set([i / SEGMENTS, 1 - j / SEGMENTS], k * 2);
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < SEGMENTS; j++) {
      for (let i = 0; i < SEGMENTS; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices.push(a, c, b, b, c, d); // counter-clockwise seen from above
      }
    }
    // Edge vertices clockwise around the boundary (seen from above), each with a dropped copy.
    const edge: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) edge.push(i); // north edge, west → east
    for (let j = 0; j < SEGMENTS; j++) edge.push(j * n + SEGMENTS); // east edge, north → south
    for (let i = SEGMENTS; i > 0; i--) edge.push(SEGMENTS * n + i); // south edge, east → west
    for (let j = SEGMENTS; j > 0; j--) edge.push(j * n); // west edge, south → north
    edge.forEach((top, e) => {
      const k = n * n + e;
      positions.set([positions[top * 3], skirtY, positions[top * 3 + 2]], k * 3);
      uvs.set([uvs[top * 2], uvs[top * 2 + 1]], k * 2);
    });
    for (let e = 0; e < ring; e++) {
      const top0 = edge[e];
      const top1 = edge[(e + 1) % ring];
      const bottom0 = n * n + e;
      const bottom1 = n * n + ((e + 1) % ring);
      indices.push(top0, top1, bottom0, top1, bottom1, bottom0); // outward-facing walls
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, color: 0x8a8573 });
    if (this.data.imagery) {
      const texture = new THREE.CanvasTexture(this.data.imagery);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      material.map = texture;
      material.color.set(0xffffff);
    }
    addGroundDetail(material, createDetailTexture(this.renderer.capabilities.getMaxAnisotropy()));
    const terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true;
    return terrain;
  }

  /** A wide ground (or sea) plane around the area, fading into the fog. */
  private createApron(y: number): THREE.Mesh {
    const color = this.hasSea ? new THREE.Color(0x0d3550) : averageColor(this.data.imagery);
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(APRON_SIZE, APRON_SIZE).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color, roughness: this.hasSea ? 0.3 : 1, metalness: 0 }),
    );
    apron.position.y = y;
    return apron;
  }

  /** Sea surface at 0 m, visible only where the sea mask says there is open sea. */
  private createSea(mask: Uint8Array): THREE.Mesh {
    const w = this.data.window;
    const size = w.sizePx;
    // DataTexture rows run from the bottom (south) up; the mask runs from the top (north) down.
    const data = new Uint8Array(size * size * 4);
    for (let row = 0; row < size; row++) {
      const source = (size - 1 - row) * size;
      for (let col = 0; col < size; col++) {
        const v = mask[source + col] * 255;
        data.set([v, v, v, 255], (row * size + col) * 4);
      }
    }
    const alpha = new THREE.DataTexture(data, size, size);
    alpha.magFilter = THREE.LinearFilter;
    alpha.minFilter = THREE.LinearMipmapLinearFilter;
    alpha.generateMipmaps = true;
    alpha.needsUpdate = true;

    const center = pixelToLocal(w, size / 2, size / 2);
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(w.sizeMetres, w.sizeMetres).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0x0b3a57,
        roughness: 0.08,
        metalness: 0,
        transparent: true,
        opacity: 0.85,
        alphaMap: alpha,
        side: THREE.DoubleSide, // seen from below when diving
      }),
    );
    sea.position.set(center.x, 0, center.z);
    return sea;
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.aspect = aspect;
    // On portrait screens keep at least a 60° horizontal view, so the player doesn't fill a phone.
    const minHorizontal = THREE.MathUtils.degToRad(60);
    const vertical = 2 * Math.atan(Math.tan(minHorizontal / 2) / aspect);
    this.camera.fov = Math.min(95, Math.max(BASE_FOV, THREE.MathUtils.radToDeg(vertical)));
    this.camera.updateProjectionMatrix();
  }
}

/**
 * Close-up ground grain: the satellite image is ~8 m per pixel, a smooth smear at a person's feet.
 * A tiling greyscale texture at two scales modulates it near the camera and fades out with distance.
 */
function addGroundDetail(material: THREE.MeshStandardMaterial, detail: THREE.Texture): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetailWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDetailWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec3 vDetailWorld;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float detailFade = 1.0 - smoothstep(30.0, 250.0, distance(vDetailWorld, cameraPosition));
        float fine = texture2D(detailMap, vDetailWorld.xz / 1.7).r;
        float coarse = texture2D(detailMap, vDetailWorld.xz / 7.3 + 0.37).r;
        float grain = (fine * 0.6 + coarse * 0.4) * 1.6 + 0.2;
        diffuseColor.rgb *= mix(1.0, grain, 0.6 * detailFade);`,
      );
  };
}

/** Seamless greyscale noise (mean ~0.5): pebbles, soil and blades blurred together. */
function createDetailTexture(anisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  const image = context.createImageData(size, size);
  // Sum of wrapped value-noise octaves, so the texture tiles seamlessly.
  const octave = (cells: number, seed: number) => (x: number, y: number): number => {
    const fx = (x / size) * cells;
    const fy = (y / size) * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const v = (i: number, j: number): number => hashNoise(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed);
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    return (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
  };
  const layers = [octave(8, 1), octave(32, 2), octave(64, 3), octave(128, 4)];
  const weights = [0.35, 0.3, 0.2, 0.15];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = layers.reduce((sum, layer, k) => sum + layer(x, y) * weights[k], 0);
      const v = Math.round(Math.min(1, Math.max(0, (value - 0.5) * 1.8 + 0.5)) * 255);
      const k = (y * size + x) * 4;
      image.data[k] = image.data[k + 1] = image.data[k + 2] = v;
      image.data[k + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  return texture;
}

function hashNoise(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** The imagery's RGBA pixels (square), for colour lookups. */
function readPixels(imagery: HTMLCanvasElement | null): { data: Uint8ClampedArray; size: number } | null {
  if (!imagery) return null;
  const context = imagery.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  return { data: context.getImageData(0, 0, imagery.width, imagery.height).data, size: imagery.width };
}

/** 1 where the imagery looks like water, per terrain pixel (imagery scaled to size × size). */
function waterPixels(imagery: HTMLCanvasElement | null, size: number): Uint8Array | null {
  if (!imagery) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  context.drawImage(imagery, 0, 0, size, size);
  const { data } = context.getImageData(0, 0, size, size);
  const out = new Uint8Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = waterness(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) > 0.5 ? 1 : 0;
  return out;
}

function edgeMinimum(grid: Float32Array, n: number): number {
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    min = Math.min(min, grid[i], grid[(n - 1) * n + i], grid[i * n], grid[i * n + n - 1]);
  }
  return min;
}

function averageColor(imagery: HTMLCanvasElement | null): THREE.Color {
  if (!imagery) return new THREE.Color(0x7d7a6a);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  context.drawImage(imagery, 0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}
