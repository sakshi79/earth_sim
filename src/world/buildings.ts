import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer/three';
import { CesiumIonAuthPlugin, ReorientationPlugin } from '3d-tiles-renderer/three/plugins';
import { CESIUM_ION_TOKEN, CESIUM_OSM_BUILDINGS_ID } from '../config.ts';

/**
 * Cesium OSM Buildings (3D Tiles) positioned in the local scene.
 * The ReorientationPlugin places the tileset so our scene origin matches the
 * chosen lat/lon, with y up / x east / z south — the same frame as the terrain.
 */
export class Buildings {
  readonly group = new THREE.Group();
  private readonly renderer: TilesRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly webGLRenderer: THREE.WebGLRenderer;
  private disposed = false;

  constructor(lat: number, lon: number, camera: THREE.PerspectiveCamera, webGLRenderer: THREE.WebGLRenderer) {
    this.camera = camera;
    this.webGLRenderer = webGLRenderer;

    const tiles = new TilesRenderer();
    tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken: CESIUM_ION_TOKEN, assetId: String(CESIUM_OSM_BUILDINGS_ID) }));
    tiles.registerPlugin(
      new ReorientationPlugin({
        lat: (lat * Math.PI) / 180,
        lon: (lon * Math.PI) / 180,
        height: 0,
        recenter: true,
      }),
    );

    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, webGLRenderer);

    tiles.addEventListener('load-tile-set', () => {
      if (this.disposed) return;
      tiles.forEachLoadedModel((scene) => {
        scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
      });
    });

    this.group.add(tiles.group);
    this.renderer = tiles;
  }

  update(): void {
    if (this.disposed) return;
    this.renderer.setResolutionFromRenderer(this.camera, this.webGLRenderer);
    this.renderer.update();
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
    this.group.removeFromParent();
  }
}

export function buildingsAvailable(): boolean {
  return CESIUM_ION_TOKEN !== '';
}
