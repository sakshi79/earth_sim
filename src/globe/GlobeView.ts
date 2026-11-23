import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EARTH_RADIUS = 1;
/** Vertical field of view on landscape screens, in degrees. */
const BASE_FOV = 40;

/**
 * The globe screen. M0: a textured, slowly spinning Earth with orbit controls.
 * M1 adds real-sun day/night, atmosphere, tiled zoom imagery and picking.
 */
export class GlobeView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly earth: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private readonly resizeObserver: ResizeObserver;
  private readonly container: HTMLElement;

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
    this.scene.add(this.earth);
    this.scene.add(createStars(3000, 40));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.3;
    this.controls.maxDistance = 8;
    this.controls.rotateSpeed = 0.5;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
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
    this.renderer.setAnimationLoop(() => {
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
