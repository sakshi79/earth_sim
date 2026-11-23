// Grass, shrubs, rocks, trees and coral around the player, as instanced low-poly models.
// Placement rules live in scatter.ts; here they become geometry, re-filled as the player moves.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash2, kindsFor, plantChance, type PlaceContext, type PlantKind, type Site } from './scatter.ts';

export interface SiteSampler {
  /** Site info at local metres, or null outside the loaded area. */
  site(x: number, z: number): Site | null;
}

interface Part {
  geometry: THREE.BufferGeometry;
  /** Tinted from the satellite colour under the plant, or a fixed colour. */
  color: 'imagery' | 'rock' | 'coral' | number;
}

interface LayerSpec {
  kind: PlantKind;
  /** Placement grid spacing and reach, metres. */
  cell: number;
  radius: number;
  capacity: number;
  scale: [number, number];
  castShadow: boolean;
}

const LAYERS: readonly LayerSpec[] = [
  { kind: 'grass', cell: 0.9, radius: 55, capacity: 12_000, scale: [0.7, 1.4], castShadow: false },
  { kind: 'shrub', cell: 4, radius: 220, capacity: 4_000, scale: [0.6, 1.5], castShadow: true },
  { kind: 'rock', cell: 5, radius: 260, capacity: 3_500, scale: [0.4, 1.8], castShadow: true },
  { kind: 'coral', cell: 2.2, radius: 110, capacity: 4_000, scale: [0.5, 1.6], castShadow: false },
  { kind: 'broadleaf', cell: 9, radius: 1100, capacity: 8_000, scale: [0.7, 1.3], castShadow: true },
  { kind: 'conifer', cell: 8, radius: 1100, capacity: 8_000, scale: [0.7, 1.4], castShadow: true },
  { kind: 'acacia', cell: 14, radius: 1100, capacity: 3_000, scale: [0.7, 1.2], castShadow: true },
  { kind: 'palm', cell: 10, radius: 1000, capacity: 4_000, scale: [0.8, 1.2], castShadow: true },
  { kind: 'cactus', cell: 10, radius: 900, capacity: 3_000, scale: [0.6, 1.3], castShadow: true },
];

const CORAL_COLORS = [0xff7f7f, 0xff9f43, 0xb57edc, 0xffd166, 0x4ecdc4, 0xf78fb3].map((c) => new THREE.Color(c));

interface Layer {
  spec: LayerSpec;
  seed: number;
  meshes: Array<{ mesh: THREE.InstancedMesh; color: Part['color'] }>;
  /** Grid offsets within the radius, nearest first. */
  offsets: Int16Array;
  center: { x: number; z: number } | null;
}

export class Vegetation {
  readonly group = new THREE.Group();
  private readonly place: PlaceContext;
  private readonly sampler: SiteSampler;
  private readonly layers: Layer[] = [];

  constructor(place: PlaceContext, sampler: SiteSampler) {
    this.place = place;
    this.sampler = sampler;
    const kinds = new Set(kindsFor(place.landscape));
    LAYERS.filter((spec) => kinds.has(spec.kind)).forEach((spec, index) => {
      const meshes = buildParts(spec.kind).map((part) => {
        const material = new THREE.MeshStandardMaterial({
          vertexColors: true,
          flatShading: spec.kind !== 'grass',
          roughness: 0.9,
          metalness: 0,
          side: spec.kind === 'grass' ? THREE.DoubleSide : THREE.FrontSide,
        });
        const mesh = new THREE.InstancedMesh(part.geometry, material, spec.capacity);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(spec.capacity * 3), 3);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = spec.castShadow;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        return { mesh, color: part.color };
      });
      this.layers.push({ spec, seed: 1013 * (index + 1), meshes, offsets: sortedOffsets(spec), center: null });
    });
  }

  /** Re-fills any layer whose centre is more than a quarter of its reach from `x, z`. */
  update(x: number, z: number): void {
    for (const layer of this.layers) {
      const c = layer.center;
      if (!c || Math.hypot(x - c.x, z - c.z) > layer.spec.radius * 0.25) this.fill(layer, x, z);
    }
  }

  dispose(): void {
    for (const layer of this.layers) {
      for (const { mesh } of layer.meshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.dispose();
      }
    }
    this.group.removeFromParent();
  }

  private fill(layer: Layer, x: number, z: number): void {
    const { spec, seed, offsets, meshes } = layer;
    layer.center = { x, z };
    const ci = Math.floor(x / spec.cell);
    const cj = Math.floor(z / spec.cell);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    let count = 0;
    for (let k = 0; k < offsets.length && count < spec.capacity; k += 2) {
      const i = ci + offsets[k];
      const j = cj + offsets[k + 1];
      const px = (i + hash2(i, j, seed + 1)) * spec.cell;
      const pz = (j + hash2(i, j, seed + 2)) * spec.cell;
      const site = this.sampler.site(px, pz);
      if (!site || hash2(i, j, seed + 3) >= plantChance(spec.kind, site, this.place)) continue;
      const s = THREE.MathUtils.lerp(spec.scale[0], spec.scale[1], hash2(i, j, seed + 4));
      rotation.setFromAxisAngle(up, hash2(i, j, seed + 5) * Math.PI * 2);
      position.set(px, site.height - 0.05 * s, pz);
      scale.set(s, s * (0.85 + 0.3 * hash2(i, j, seed + 6)), s);
      matrix.compose(position, rotation, scale);
      const shade = 0.88 + 0.24 * hash2(i, j, seed + 7);
      for (const { mesh, color: mode } of meshes) {
        mesh.setMatrixAt(count, matrix);
        if (mode === 'imagery') imageryTint(color, site.rgb, spec.kind).multiplyScalar(shade);
        else if (mode === 'rock') imageryTint(color, site.rgb, 'rock').lerp(ROCK_GREY, 0.6).multiplyScalar(shade);
        else if (mode === 'coral') color.copy(CORAL_COLORS[Math.floor(hash2(i, j, seed + 8) * CORAL_COLORS.length)]);
        else color.set(mode).multiplyScalar(shade);
        mesh.setColorAt(count, color);
      }
      count++;
    }
    for (const { mesh } of meshes) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

const ROCK_GREY = new THREE.Color(0x8c8780);

/** Plant colour from the satellite colour underneath: brighter than seen from orbit, a little greener. */
function imageryTint(target: THREE.Color, rgb: readonly [number, number, number], kind: PlantKind): THREE.Color {
  target.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
  const boost = kind === 'grass' ? 1.7 : kind === 'rock' ? 1.3 : 1.45;
  target.multiplyScalar(boost);
  if (kind !== 'rock') target.lerp(new THREE.Color(0x4f7a2a), 0.25);
  return target;
}

function sortedOffsets(spec: LayerSpec): Int16Array {
  const reach = Math.ceil(spec.radius / spec.cell);
  const cells: Array<[number, number, number]> = [];
  for (let dj = -reach; dj <= reach; dj++) {
    for (let di = -reach; di <= reach; di++) {
      const d = Math.hypot(di, dj) * spec.cell;
      if (d <= spec.radius) cells.push([di, dj, d]);
    }
  }
  cells.sort((a, b) => a[2] - b[2]);
  const out = new Int16Array(cells.length * 2);
  cells.forEach(([di, dj], k) => {
    out[k * 2] = di;
    out[k * 2 + 1] = dj;
  });
  return out;
}

// --- Low-poly models (metres, base at y = 0). Vertex colours carry the light/dark shading. ---

function buildParts(kind: PlantKind): Part[] {
  switch (kind) {
    case 'grass':
      return [{ geometry: grassTuft(), color: 'imagery' }];
    case 'shrub':
      return [{ geometry: shaded(new THREE.IcosahedronGeometry(0.7, 0).scale(1, 0.75, 1).translate(0, 0.45, 0), 0.75, 1.05), color: 'imagery' }];
    case 'rock':
      return [{ geometry: rock(), color: 'rock' }];
    case 'broadleaf':
      return [
        { geometry: trunk(2.6, 0.2), color: 0x5b4630 },
        {
          geometry: merge([
            new THREE.IcosahedronGeometry(1.6, 0).translate(0, 3.6, 0),
            new THREE.IcosahedronGeometry(1.1, 0).translate(0.7, 4.3, 0.3),
            new THREE.IcosahedronGeometry(1.0, 0).translate(-0.6, 4.0, -0.4),
          ], 0.7, 1.05),
          color: 'imagery',
        },
      ];
    case 'conifer':
      return [
        { geometry: trunk(1.6, 0.18), color: 0x4a3826 },
        {
          geometry: merge([
            new THREE.ConeGeometry(1.5, 2.6, 7).translate(0, 2.4, 0),
            new THREE.ConeGeometry(1.1, 2.2, 7).translate(0, 3.7, 0),
            new THREE.ConeGeometry(0.7, 1.8, 7).translate(0, 4.9, 0),
          ], 0.6, 0.95),
          color: 'imagery',
        },
      ];
    case 'acacia':
      return [
        { geometry: trunk(3.2, 0.2).rotateZ(0.08), color: 0x5b4630 },
        // The trunk leans (rotateZ 0.08), so its top is ~0.26 m toward −x.
        { geometry: shaded(new THREE.CylinderGeometry(2.6, 1.8, 0.7, 8).translate(-0.26, 3.6, 0), 0.75, 1.05), color: 'imagery' },
      ];
    case 'palm':
      return [
        { geometry: trunk(5, 0.17).rotateZ(0.12), color: 0x7a6248 },
        { geometry: palmFronds(), color: 0x4f8a35 },
      ];
    case 'cactus':
      return [{ geometry: cactus(), color: 0x5f7d3a }];
    case 'coral':
      return [{ geometry: coral(), color: 'coral' }];
  }
}

function trunk(height: number, radius: number): THREE.BufferGeometry {
  return shaded(new THREE.CylinderGeometry(radius * 0.65, radius, height, 6).translate(0, height / 2, 0), 0.8, 1);
}

function grassTuft(): THREE.BufferGeometry {
  const positions: number[] = [];
  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const angle = (b / blades) * Math.PI * 2 + b * 0.7;
    const lean = 0.12 + (b % 3) * 0.05;
    const height = 0.35 + (b % 4) * 0.08;
    const cx = Math.cos(angle);
    const cz = Math.sin(angle);
    const px = -cz * 0.035;
    const pz = cx * 0.035;
    const ox = cx * 0.05;
    const oz = cz * 0.05;
    positions.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, ox + cx * lean, height, oz + cz * lean);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  // Darker at the root, lighter at the tip.
  const colors: number[] = [];
  for (let v = 0; v < positions.length / 3; v++) {
    const tip = v % 3 === 2;
    colors.push(...(tip ? [1.1, 1.1, 1.0] : [0.55, 0.55, 0.5]));
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function rock(): THREE.BufferGeometry {
  const geometry = new THREE.DodecahedronGeometry(0.5, 0);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const jitter = 0.8 + 0.4 * hash2(i, 7, 3);
    p.setXYZ(i, p.getX(i) * jitter, p.getY(i) * jitter * 0.6 + 0.12, p.getZ(i) * jitter);
  }
  geometry.computeVertexNormals();
  return shaded(geometry, 0.8, 1.05);
}

function palmFronds(): THREE.BufferGeometry {
  const fronds: THREE.BufferGeometry[] = [];
  for (let f = 0; f < 7; f++) {
    const frond = new THREE.BoxGeometry(2.4, 0.05, 0.45).translate(1.2, 0, 0).rotateZ(-0.45).rotateY((f / 7) * Math.PI * 2);
    fronds.push(frond.translate(-0.6, 4.95, 0)); // over the top of the leaning trunk
  }
  return merge(fronds, 0.75, 1.05);
}

function cactus(): THREE.BufferGeometry {
  return merge([
    new THREE.CylinderGeometry(0.25, 0.28, 2.6, 8).translate(0, 1.3, 0),
    new THREE.CylinderGeometry(0.15, 0.15, 0.5, 6).rotateZ(Math.PI / 2).translate(0.45, 1.3, 0),
    new THREE.CylinderGeometry(0.16, 0.16, 0.9, 6).translate(0.68, 1.7, 0),
    new THREE.CylinderGeometry(0.15, 0.15, 0.4, 6).rotateZ(Math.PI / 2).translate(-0.4, 1.0, 0),
    new THREE.CylinderGeometry(0.15, 0.15, 0.7, 6).translate(-0.58, 1.3, 0),
  ], 0.8, 1.05);
}

function coral(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const r = 0.15 + 0.1 * (k % 2);
    parts.push(new THREE.ConeGeometry(0.08, 0.5 + 0.15 * (k % 3), 5).translate(Math.cos(a) * r, 0.25, Math.sin(a) * r));
  }
  parts.push(new THREE.IcosahedronGeometry(0.22, 0).translate(0, 0.12, 0));
  return merge(parts, 0.75, 1.05);
}

/** Merges parts (dropping uvs so attributes match) and adds bottom-to-top shading. */
function merge(parts: THREE.BufferGeometry[], dark: number, light: number): THREE.BufferGeometry {
  const prepared = parts.map((g) => {
    const geometry = g.index ? g.toNonIndexed() : g;
    geometry.deleteAttribute('uv');
    return geometry;
  });
  return shaded(mergeGeometries(prepared) as THREE.BufferGeometry, dark, light);
}

/** Vertex colours from `dark` at the lowest point to `light` at the highest. */
function shaded(geometry: THREE.BufferGeometry, dark: number, light: number): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g.attributes.uv) g.deleteAttribute('uv');
  g.computeBoundingBox();
  const { min, max } = g.boundingBox as THREE.Box3;
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - min.y) / Math.max(1e-6, max.y - min.y);
    colors.fill(dark + (light - dark) * t, i * 3, i * 3 + 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}
