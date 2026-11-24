import * as THREE from 'three';
import type { OverpassRoad } from '../data/overpass.ts';
import type { TerrainWindow } from './terrainWindow.ts';
import { latLonToLocal } from './terrainWindow.ts';

const ROAD_COLORS: Record<string, number> = {
  motorway: 0xe8d44d,
  trunk: 0xe8d44d,
  primary: 0xf0e6c0,
  secondary: 0xf0e6c0,
  tertiary: 0xddd5c0,
  residential: 0xcccccc,
  service: 0xaaaaaa,
  track: 0xb09070,
  path: 0xc4a882,
  footway: 0xc4a882,
  cycleway: 0x8888dd,
};

const ROAD_WIDTH: Record<string, number> = {
  motorway: 6,
  trunk: 5,
  primary: 4.5,
  secondary: 4,
  tertiary: 3.5,
  residential: 3,
  service: 2.5,
  track: 2,
  path: 1.5,
  footway: 1.5,
  cycleway: 2,
};

/** Roads and paths drawn as flat ribbons on the terrain. */
export class Roads {
  readonly group = new THREE.Group();

  constructor(
    roads: OverpassRoad[],
    w: TerrainWindow,
    heightAt: (x: number, z: number) => number,
  ) {
    const batches = new Map<string, { positions: number[]; indices: number[]; vertCount: number }>();

    for (const road of roads) {
      if (road.geometry.length < 2) continue;
      const type = normalizeType(road.highway);
      const halfW = (ROAD_WIDTH[type] ?? 2.5) / 2;

      let batch = batches.get(type);
      if (!batch) {
        batch = { positions: [], indices: [], vertCount: 0 };
        batches.set(type, batch);
      }

      const points: THREE.Vector3[] = [];
      for (const node of road.geometry) {
        const { x, z } = latLonToLocal(w, node.lat, node.lon);
        const y = heightAt(x, z) + 0.15;
        points.push(new THREE.Vector3(x, y, z));
      }

      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const nx = (-dz / len) * halfW;
        const nz = (dx / len) * halfW;

        const v = batch.vertCount;
        batch.positions.push(
          a.x - nx, a.y, a.z - nz,
          a.x + nx, a.y, a.z + nz,
          b.x - nx, b.y, b.z - nz,
          b.x + nx, b.y, b.z + nz,
        );
        batch.indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
        batch.vertCount += 4;
      }
    }

    for (const [type, batch] of batches) {
      if (batch.vertCount === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
      geometry.setIndex(batch.indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: ROAD_COLORS[type] ?? 0xbbbbbb,
          roughness: 0.95,
          metalness: 0,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
          side: THREE.DoubleSide,
        }),
      );
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.group.removeFromParent();
  }
}

function normalizeType(highway: string): string {
  if (highway.endsWith('_link')) return highway.slice(0, -5);
  if (highway === 'unclassified' || highway === 'living_street') return 'residential';
  if (highway === 'bridleway' || highway === 'steps') return 'path';
  return highway;
}
