import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import SlippyMapGlobe from 'three-slippy-map-globe';
import type { TileUrl } from '../config.ts';
import { latLonToVector, vectorToLatLon, type LatLon } from '../geo/sphere.ts';
import { subsolarPoint } from '../geo/sun.ts';
import type { Place } from '../places.ts';
import { createPin, createPlaceMarkers, placePin } from './markers.ts';
import { createNightLightsMaterial } from './shaders.ts';

/** Vertical field of view on landscape screens, in degrees. */
const BASE_FOV = 40;
/** Seconds per full turn of the Earth's visual spin (real Earth: 86,164 s). */
const SPIN_PERIOD_S = 120;
/** Camera altitudes in globe radii (1 radius ≈ 6,371 km). 0.0004 ≈ 2.5 km, where tiles reach z15. */
const MIN_ALTITUDE = 0.0004;
const MAX_ALTITUDE = 7;
const START_ALTITUDE = 2.4;
/** Below this altitude, satellite tiles replace the bundled image (from zoom level 5). */
const TILE_ALTITUDE = 0.3;
const MAX_TILE_LEVEL = 15;
const CLICK_MOVE_PX = 6;
const CLICK_MAX_MS = 500;
const DOUBLE_CLICK_MS = 350;
const MARKER_HIT_PX = 14;

export interface GlobeHit extends LatLon {
  place?: Place;
}

export interface GlobeEvents {
  onHover?: (hit: GlobeHit | null) => void;
  onPick?: (hit: GlobeHit) => void;
  onDoublePick?: (hit: GlobeHit) => void;
  onTilesVisibleChange?: (visible: boolean) => void;
}

interface Flight {
  from: THREE.Vector3;
  rotation: THREE.Quaternion;
  angle: number;
  fromAlt: number;
  toAlt: number;
  elapsed: number;
  duration: number;
}

/**
 * The globe screen: NASA imagery with real-sun day/night and city lights, zoomable satellite tiles,
 * featured-place markers, picking and camera flights. The Earth spins slowly until a place is picked.
 */
export class GlobeView {
  private readonly container: HTMLElement;
  private readonly events: GlobeEvents;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  /** Spins about +Y. Everything fixed to the surface (and the sun) lives in here. */
  private readonly globe = new THREE.Group();
  private readonly earth: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhongMaterial>;
  private nightLights: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2.6);
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0.06);
  private readonly tiles: SlippyMapGlobe;
  private readonly pin = createPin();
  private markers: THREE.Points | null = null;
  private places: readonly Place[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly raycaster = new THREE.Raycaster();
  private readonly listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions?]> = [];

  private targetAltitude = START_ALTITUDE;
  private flight: Flight | null = null;
  private spinPaused = false;
  private dragging = false;
  private lastFrameMs: number | null = null;
  private lastSunUpdateMs = -Infinity;
  private lastPovUpdateMs = 0;
  private tilesVisible = false;
  private hoverAt: { x: number; y: number } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private press: { x: number; y: number; time: number } | null = null;
  private lastClick: { x: number; y: number; time: number } | null = null;

  constructor(container: HTMLElement, imageryUrl: TileUrl, events: GlobeEvents = {}) {
    this.container = container;
    this.events = events;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.01, 100);
    this.scene.add(this.camera);

    // three.js spheres put longitude 0 on +X; turn them so it sits on +Z like everything else.
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 192, 96),
      new THREE.MeshPhongMaterial({
        color: 0x1b2a3a,
        specular: 0x000000,
        shininess: 18,
        // Pushed back slightly so zoom tiles at the same radius always draw on top.
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 4,
      }),
    );
    this.earth.rotation.y = -Math.PI / 2;
    this.globe.add(this.earth);

    // The sun is a child of the globe, so day and night stay fixed to geography while it spins.
    this.globe.add(this.sun);
    this.scene.add(this.ambient);
    this.updateSun(0);

    this.tiles = new SlippyMapGlobe(1, {
      tileUrl: (x, y, level) => imageryUrl(level, x, y),
      minLevel: 5,
      maxLevel: MAX_TILE_LEVEL,
    });
    this.tiles.visible = false;
    this.globe.add(this.tiles);
    this.globe.add(this.pin);
    this.scene.add(this.globe);
    this.scene.add(createStars(3000, 40));

    // Start looking at the day side, with the evening terminator near the right-hand edge.
    const s = subsolarPoint(new Date());
    const start = latLonToVector(THREE.MathUtils.clamp(s.lat + 10, -50, 50), s.lon + 35);
    this.camera.position.set(start.x, start.y, start.z).setLength(1 + START_ALTITUDE);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.enableZoom = false; // zoom is handled here, scaled by altitude
    this.controls.addEventListener('start', () => {
      this.dragging = true;
    });
    this.controls.addEventListener('end', () => {
      this.dragging = false;
    });
    this.bindInput();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Loads the day texture (applied as soon as it arrives) and the night-lights texture. */
  async loadTextures(dayUrl: string, nightUrl: string): Promise<void> {
    const loader = new THREE.TextureLoader();
    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const day = loader.loadAsync(dayUrl).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = maxAnisotropy;
      this.earth.material.map = texture;
      this.earth.material.color.set(0xffffff);
      this.earth.material.needsUpdate = true;
    });
    const night = loader.loadAsync(nightUrl).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = maxAnisotropy;
      this.nightLights = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), createNightLightsMaterial(texture));
      this.nightLights.rotation.y = -Math.PI / 2;
      this.nightLights.renderOrder = 2;
      this.globe.add(this.nightLights);
    });
    await Promise.all([day, night]);
  }

  /** Water mask (white = sea) that makes the sun glint on oceans only. */
  setOceanMask(mask: ImageData): void {
    const canvas = document.createElement('canvas');
    canvas.width = mask.width;
    canvas.height = mask.height;
    canvas.getContext('2d')?.putImageData(mask, 0, 0);
    this.earth.material.specularMap = new THREE.CanvasTexture(canvas);
    // A tight, subtle glint: bright enough to read as water, not a white blob.
    this.earth.material.specular.set(0x26323f);
    this.earth.material.shininess = 80;
    this.earth.material.needsUpdate = true;
  }

  setPlaces(places: readonly Place[]): void {
    if (this.markers) this.globe.remove(this.markers);
    this.places = places;
    this.markers = createPlaceMarkers(places);
    this.globe.add(this.markers);
  }

  /**
   * Pins a place, stops the spin and flies there.
   * `altitude` in globe radii; omitted keeps the current height (within a comfortable range).
   */
  select(lat: number, lon: number, altitude?: number): void {
    placePin(this.pin, lat, lon);
    this.spinPaused = true;
    this.flyTo(lat, lon, altitude ?? THREE.MathUtils.clamp(this.altitude(), 0.02, 1.6));
  }

  clearSelection(): void {
    this.pin.visible = false;
    this.spinPaused = false;
  }

  altitude(): number {
    return this.camera.position.length() - 1;
  }

  start(): void {
    this.renderer.setAnimationLoop((timeMs: number) => this.frame(timeMs));
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    for (const [target, type, listener, options] of this.listeners) target.removeEventListener(type, listener, options);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private flyTo(lat: number, lon: number, altitude: number): void {
    this.globe.updateMatrixWorld();
    const local = latLonToVector(lat, lon);
    const to = this.globe.localToWorld(new THREE.Vector3(local.x, local.y, local.z)).normalize();
    const from = this.camera.position.clone().normalize();
    const fromAlt = this.altitude();
    const toAlt = THREE.MathUtils.clamp(altitude, MIN_ALTITUDE, MAX_ALTITUDE);
    const angle = from.angleTo(to);
    const duration = this.reducedMotion.matches
      ? 0
      : THREE.MathUtils.clamp(0.6 + angle * 0.6 + Math.abs(Math.log(toAlt / fromAlt)) * 0.12, 0.6, 2.6);
    this.flight = {
      from,
      rotation: new THREE.Quaternion().setFromUnitVectors(from, to),
      angle,
      fromAlt,
      toAlt,
      elapsed: 0,
      duration,
    };
    this.controls.enabled = false;
  }

  private frame(timeMs: number): void {
    // Clamp the step so returning to a background tab doesn't jump the animation.
    const dt = this.lastFrameMs === null ? 0 : Math.min(0.1, (timeMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = timeMs;
    this.updateSun(timeMs);

    const altitude = this.updateCameraHeight(dt);
    if (!this.flight && !this.spinPaused && !this.dragging && !this.reducedMotion.matches) {
      // Full speed from far away, slowing to a stop as the camera comes close.
      const factor = THREE.MathUtils.smoothstep(altitude, 0.6, 1.6);
      this.globe.rotation.y += ((dt * 2 * Math.PI) / SPIN_PERIOD_S) * factor;
    }
    // Drag speed follows altitude, so close-up views pan by about the ground in view.
    this.controls.rotateSpeed = THREE.MathUtils.clamp(altitude * 0.15, 0.00003, 0.5);
    if (!this.flight) this.controls.update();

    // Clip planes follow altitude so close-ups keep depth precision.
    this.camera.near = THREE.MathUtils.clamp(altitude * 0.3, 0.00002, 0.5);
    this.camera.far = 1 + altitude + 60;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.globe.updateMatrixWorld();

    this.updateTiles(altitude, timeMs);
    // Close up, night would be pitch black: brighten like moonlight, and fade the city-lights
    // layer, which is too coarse (~10 km per pixel) to look right over sharp tiles.
    const closeness = 1 - THREE.MathUtils.smoothstep(altitude, 0.01, 0.3);
    this.ambient.intensity = 0.06 + 0.5 * closeness;
    if (this.nightLights) {
      const uniforms = this.nightLights.material.uniforms;
      this.sun.getWorldPosition(uniforms.sunDirection.value).normalize();
      uniforms.nightIntensity.value = 1.6 * THREE.MathUtils.smoothstep(altitude, 0.005, 0.1);
    }
    if (this.pin.visible) this.pin.scale.setScalar(altitude * 0.02);
    if (this.hoverAt) {
      this.events.onHover?.(this.pick(this.hoverAt.x, this.hoverAt.y));
      this.hoverAt = null;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Advances a flight, or eases the camera toward the zoom target. Returns the altitude. */
  private updateCameraHeight(dt: number): number {
    const f = this.flight;
    if (f) {
      f.elapsed += dt;
      const t = f.duration === 0 ? 1 : Math.min(1, f.elapsed / f.duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; // ease in-out cubic
      const direction = f.from.clone().applyQuaternion(new THREE.Quaternion().slerp(f.rotation, e));
      // Interpolate height logarithmically, rising a little on long flights.
      const altitude =
        Math.exp(THREE.MathUtils.lerp(Math.log(f.fromAlt), Math.log(f.toAlt), e)) + Math.sin(Math.PI * e) * f.angle * 0.4;
      this.camera.position.copy(direction).multiplyScalar(1 + altitude);
      this.camera.lookAt(0, 0, 0);
      if (t >= 1) {
        this.flight = null;
        this.targetAltitude = f.toAlt;
        this.controls.enabled = true;
      }
    } else {
      const current = this.altitude();
      const k = 1 - Math.exp(-dt * 10);
      const next = Math.exp(THREE.MathUtils.lerp(Math.log(current), Math.log(this.targetAltitude), k));
      this.camera.position.setLength(1 + next);
    }
    return this.altitude();
  }

  private updateTiles(altitude: number, timeMs: number): void {
    const visible = altitude < TILE_ALTITUDE;
    if (visible !== this.tilesVisible) {
      this.tilesVisible = visible;
      this.tiles.visible = visible;
      this.tiles.updatePov(this.camera); // when hiding, this drops the detailed levels
      this.lastPovUpdateMs = timeMs;
      this.events.onTilesVisibleChange?.(visible);
    } else if (visible && timeMs - this.lastPovUpdateMs > 150) {
      this.tiles.updatePov(this.camera);
      this.lastPovUpdateMs = timeMs;
    }
  }

  /** Re-aims the sun at the real subsolar point once a minute. */
  private updateSun(timeMs: number): void {
    if (timeMs - this.lastSunUpdateMs < 60_000) return;
    this.lastSunUpdateMs = timeMs;
    const s = subsolarPoint(new Date());
    const v = latLonToVector(s.lat, s.lon, 5);
    this.sun.position.set(v.x, v.y, v.z);
  }

  /** What is under a screen point: a featured-place marker, a point on the globe, or nothing. */
  private pick(clientX: number, clientY: number): GlobeHit | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (this.markers) {
      const cameraPosition = this.camera.position;
      for (const place of this.places) {
        const local = latLonToVector(place.lat, place.lon);
        const world = this.globe.localToWorld(new THREE.Vector3(local.x, local.y, local.z));
        if (world.dot(cameraPosition) <= 1) continue; // behind the globe
        const screen = world.project(this.camera);
        const sx = ((screen.x + 1) / 2) * rect.width;
        const sy = ((1 - screen.y) / 2) * rect.height;
        if (Math.hypot(sx - x, sy - y) <= MARKER_HIT_PX) return { lat: place.lat, lon: place.lon, place };
      }
    }

    const ndc = new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const b = origin.dot(direction);
    const disc = b * b - (origin.lengthSq() - 1);
    if (disc < 0) return null;
    const point = origin.clone().addScaledVector(direction, -b - Math.sqrt(disc));
    return vectorToLatLon(this.globe.worldToLocal(point));
  }

  private bindInput(): void {
    const canvas = this.renderer.domElement;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ): void => {
      canvas.addEventListener(type, handler, options);
      this.listeners.push([canvas, type, handler as EventListener, options]);
    };

    on('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) this.press = { x: e.clientX, y: e.clientY, time: performance.now() };
      if (this.pointers.size === 2) {
        this.press = null;
        this.pinchDistance = this.pointerSpread();
      }
    });
    on('pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const spread = this.pointerSpread();
        if (this.pinchDistance > 0 && spread > 0) this.zoomBy(this.pinchDistance / spread);
        this.pinchDistance = spread;
      } else if (e.pointerType === 'mouse' && e.buttons === 0) {
        this.hoverAt = { x: e.clientX, y: e.clientY };
      }
    });
    const release = (e: PointerEvent): void => {
      const press = this.press;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDistance = 0;
      if (!press || this.pointers.size > 0) return;
      this.press = null;
      const now = performance.now();
      const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
      if (e.type !== 'pointerup' || moved > CLICK_MOVE_PX || now - press.time > CLICK_MAX_MS) return;
      const hit = this.pick(e.clientX, e.clientY);
      if (!hit) return;
      const last = this.lastClick;
      const isDouble = last !== null && now - last.time < DOUBLE_CLICK_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 20;
      this.lastClick = isDouble ? null : { x: e.clientX, y: e.clientY, time: now };
      if (isDouble) this.events.onDoublePick?.(hit);
      else this.events.onPick?.(hit);
    };
    on('pointerup', release);
    on('pointercancel', release);
    on('pointerleave', () => this.events.onHover?.(null));
    on(
      'wheel',
      (e) => {
        e.preventDefault();
        const pixels = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        this.zoomBy(Math.exp(pixels * 0.0015));
      },
      { passive: false },
    );
  }

  private zoomBy(factor: number): void {
    if (this.flight) return;
    this.targetAltitude = THREE.MathUtils.clamp(this.targetAltitude * factor, MIN_ALTITUDE, MAX_ALTITUDE);
  }

  private pointerSpread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Keep the horizontal field of view on portrait screens, so the globe fits phones.
    this.camera.fov =
      aspect >= 1
        ? BASE_FOV
        : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) / aspect));
    this.camera.updateProjectionMatrix();
  }
}

function createStars(count: number, radius: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.randomDirection().multiplyScalar(radius);
    v.toArray(positions, i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false });
  return new THREE.Points(geometry, material);
}
