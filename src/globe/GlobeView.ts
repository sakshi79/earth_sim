import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EARTH_RADIUS = 1;
/** Vertical field of view on landscape screens, in degrees. */
const BASE_FOV = 40;
/** Seconds per full turn of the Earth's visual spin (real Earth: 86,164 s). */
const SPIN_PERIOD_S = 120;

/**
 * The globe screen. M0: a textured Earth spinning slowly on its axis, with orbit controls.
 * M1 adds real-sun day/night, atmosphere, tiled zoom imagery and picking.
 */
export class GlobeView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  /** Spins about its Y axis (north up). Everything attached to the surface goes in here. */
  private readonly globe = new THREE.Group();
  private readonly earth: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private readonly resizeObserver: ResizeObserver;
  private readonly container: HTMLElement;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private dragging = false;
  private lastFrameMs: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.01, 100);
    this.camera.position.set(0, 0.8, 3.4);
    this.scene.add(this.camera);

    // M0 lighting: a key light that follows the camera, so the visible side is always lit.
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-1.5, 1, 1.2);
    this.camera.add(key);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS, 128, 64),
      new THREE.MeshStandardMaterial({ color: 0x1b2a3a, roughness: 0.9, metalness: 0 }),
    );
    this.globe.add(this.earth);
    this.scene.add(this.globe);
    this.scene.add(createStars(3000, 40));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.3;
    this.controls.maxDistance = 8;
    this.controls.rotateSpeed = 0.5;
    // Pause the spin while the user drags, so the surface doesn't slide under the pointer.
    this.controls.addEventListener('start', () => {
      this.dragging = true;
    });
    this.controls.addEventListener('end', () => {
      this.dragging = false;
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Loads the day texture onto the globe. */
  async load(dayTextureUrl: string): Promise<void> {
    const texture = await new THREE.TextureLoader().loadAsync(dayTextureUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.earth.material.map = texture;
    this.earth.material.color.set(0xffffff);
    this.earth.material.needsUpdate = true;
  }

  start(): void {
    this.renderer.setAnimationLoop((timeMs: number) => {
      // Clamp the step so returning to a background tab doesn't jump the spin.
      const dt = this.lastFrameMs === null ? 0 : Math.min(0.1, (timeMs - this.lastFrameMs) / 1000);
      this.lastFrameMs = timeMs;
      if (!this.dragging && !this.reducedMotion.matches) {
        // Positive about +Y is west-to-east, the way the real Earth turns.
        this.globe.rotation.y += (dt * 2 * Math.PI) / SPIN_PERIOD_S;
      }
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Keep the horizontal field of view on portrait screens, so the globe fits phones.
    this.camera.fov =
      aspect >= 1 ? BASE_FOV : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) / aspect));
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
