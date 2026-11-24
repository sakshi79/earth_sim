// Low-poly creatures placed from iNaturalist data. Each group has a model and behaviour.
import * as THREE from 'three';
import type { NearbySpecies, TaxonGroup } from '../data/inaturalist.ts';
import type { WorldQuery } from '../player/movement.ts';
import { hash2 } from './scatter.ts';

const MAX_CREATURES = 60;
const WANDER_SPEED = 0.6;
const BIRD_SPEED = 3;
const FISH_SPEED = 1.2;
const FLEE_DISTANCE = 12;
const FLEE_SPEED = 4;

interface Creature {
  species: NearbySpecies;
  mesh: THREE.Object3D;
  x: number;
  z: number;
  y: number;
  heading: number;
  targetHeading: number;
  speed: number;
  nextTurn: number;
  fleeing: boolean;
}

/** Manages visible creatures in the scene. */
export class CreatureSystem {
  readonly group = new THREE.Group();
  private readonly creatures: Creature[] = [];
  private readonly world: WorldQuery;
  private elapsed = 0;

  constructor(
    species: NearbySpecies[],
    world: WorldQuery,
  ) {
    this.world = world;
    const animals = species.filter((s) => isAnimal(s.group));
    const placed = placeCreatures(animals, world, MAX_CREATURES);
    for (const c of placed) {
      this.group.add(c.mesh);
      this.creatures.push(c);
    }
  }

  update(dt: number, playerX: number, playerZ: number): void {
    this.elapsed += dt;
    for (const c of this.creatures) {
      const dx = c.x - playerX;
      const dz = c.z - playerZ;
      const distSq = dx * dx + dz * dz;

      // Flee when the player is close.
      if (distSq < FLEE_DISTANCE * FLEE_DISTANCE && isAnimal(c.species.group) && c.species.group !== 'fish') {
        c.fleeing = true;
        c.targetHeading = Math.atan2(dx, dz);
        c.speed = FLEE_SPEED;
      } else if (c.fleeing && distSq > FLEE_DISTANCE * FLEE_DISTANCE * 4) {
        c.fleeing = false;
        c.speed = baseSpeed(c.species.group);
      }

      // Turn toward the target heading.
      if (this.elapsed > c.nextTurn && !c.fleeing) {
        c.targetHeading += (Math.random() - 0.5) * 2;
        c.nextTurn = this.elapsed + 3 + Math.random() * 5;
      }
      const turnRate = c.fleeing ? 6 : 1.5;
      let diff = c.targetHeading - c.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      c.heading += Math.sign(diff) * Math.min(Math.abs(diff), turnRate * dt);

      // Move.
      const moveSpeed = c.speed * dt;
      const nx = c.x + Math.sin(c.heading) * moveSpeed;
      const nz = c.z + Math.cos(c.heading) * moveSpeed;
      const { minX, maxX, minZ, maxZ } = this.world.bounds;
      if (nx > minX + 20 && nx < maxX - 20 && nz > minZ + 20 && nz < maxZ - 20) {
        c.x = nx;
        c.z = nz;
      } else {
        c.targetHeading += Math.PI;
      }

      if (c.species.group === 'bird') {
        c.y = this.world.heightAt(c.x, c.z) + 8 + Math.sin(this.elapsed * 1.5 + c.x) * 2;
      } else if (c.species.group === 'fish') {
        c.y = Math.min(-0.5, this.world.heightAt(c.x, c.z) + 0.5);
      } else {
        c.y = this.world.heightAt(c.x, c.z);
      }

      c.mesh.position.set(c.x, c.y, c.z);
      c.mesh.rotation.y = c.heading;

      // Wing flap for birds.
      if (c.species.group === 'bird') {
        const wing = c.mesh.children[1];
        if (wing) wing.rotation.z = Math.sin(this.elapsed * 8 + c.x * 10) * 0.4;
        const wing2 = c.mesh.children[2];
        if (wing2) wing2.rotation.z = -Math.sin(this.elapsed * 8 + c.x * 10) * 0.4;
      }
    }
  }

  /** The creature nearest to a point, if within `maxDist`. */
  nearest(x: number, z: number, maxDist: number): { creature: Creature; species: NearbySpecies; dist: number } | null {
    let best: Creature | null = null;
    let bestDist = maxDist;
    for (const c of this.creatures) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best ? { creature: best, species: best.species, dist: bestDist } : null;
  }

  dispose(): void {
    for (const c of this.creatures) {
      c.mesh.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    }
    this.group.removeFromParent();
  }
}

function isAnimal(group: TaxonGroup): boolean {
  return group === 'bird' || group === 'mammal' || group === 'reptile' || group === 'amphibian' || group === 'fish' || group === 'insect';
}

function baseSpeed(group: TaxonGroup): number {
  if (group === 'bird') return BIRD_SPEED;
  if (group === 'fish') return FISH_SPEED;
  if (group === 'insect') return 0.3;
  return WANDER_SPEED;
}

function placeCreatures(
  species: NearbySpecies[],
  world: WorldQuery,
  max: number,
): Creature[] {
  const result: Creature[] = [];
  const { minX, maxX, minZ, maxZ } = world.bounds;
  const rangeX = maxX - minX - 100;
  const rangeZ = maxZ - minZ - 100;
  let slot = 0;

  for (const sp of species) {
    if (result.length >= max) break;
    const count = Math.min(5, Math.max(1, Math.ceil(sp.observationCount / 50)));
    for (let i = 0; i < count && result.length < max; i++) {
      const x = minX + 50 + hash2(slot, sp.id, 101) * rangeX;
      const z = minZ + 50 + hash2(slot, sp.id, 102) * rangeZ;
      const height = world.heightAt(x, z);
      const water = world.waterAt(x, z);

      // Fish only in water, land animals only on land.
      if (sp.group === 'fish' && !water) { slot++; continue; }
      if (sp.group !== 'fish' && water) { slot++; continue; }

      const y = sp.group === 'bird' ? height + 8 : sp.group === 'fish' ? Math.min(-0.5, height + 0.5) : height;
      const heading = hash2(slot, sp.id, 103) * Math.PI * 2;
      const mesh = createCreatureMesh(sp);
      mesh.position.set(x, y, z);
      mesh.rotation.y = heading;

      result.push({
        species: sp,
        mesh,
        x, z, y,
        heading,
        targetHeading: heading,
        speed: baseSpeed(sp.group),
        nextTurn: hash2(slot, sp.id, 104) * 5,
        fleeing: false,
      });
      slot++;
    }
  }
  return result;
}

function createCreatureMesh(species: NearbySpecies): THREE.Object3D {
  const color = groupColor(species.group);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
  const group = new THREE.Group();

  switch (species.group) {
    case 'bird': {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 5).rotateX(Math.PI / 2), mat);
      const wingL = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15).translate(0.3, 0, 0), mat);
      wingL.position.set(0, 0.05, 0);
      const wingR = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15).translate(-0.3, 0, 0), mat);
      wingR.position.set(0, 0.05, 0);
      group.add(body, wingL, wingR);
      break;
    }
    case 'mammal': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.7), mat);
      body.position.y = 0.35;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), mat);
      head.position.set(0, 0.5, -0.4);
      const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 4);
      const legs = [[-0.12, 0.15, -0.2], [0.12, 0.15, -0.2], [-0.12, 0.15, 0.2], [0.12, 0.15, 0.2]];
      for (const [lx, ly, lz] of legs) {
        const leg = new THREE.Mesh(legGeo, mat);
        leg.position.set(lx, ly, lz);
        group.add(leg);
      }
      group.add(body, head);
      break;
    }
    case 'fish': {
      const body = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, 0.5, 5).rotateZ(Math.PI / 2).rotateY(Math.PI / 2),
        mat,
      );
      const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15).translate(0, 0, 0.3), mat);
      group.add(body, tail);
      break;
    }
    case 'reptile':
    case 'amphibian': {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.4, 3, 6).rotateX(Math.PI / 2), mat);
      body.position.y = 0.12;
      group.add(body);
      break;
    }
    case 'insect': {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), mat);
      body.position.y = 0.08;
      const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), mat);
      abdomen.position.set(0, 0.08, 0.1);
      group.add(body, abdomen);
      break;
    }
    default: {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), mat);
      marker.position.y = 0.15;
      group.add(marker);
    }
  }

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.castShadow = true;
  });
  return group;
}

function groupColor(group: TaxonGroup): number {
  switch (group) {
    case 'bird': return 0xe85d3a;
    case 'mammal': return 0x8b6b4a;
    case 'fish': return 0x4a9ec4;
    case 'reptile': return 0x6b8e4e;
    case 'amphibian': return 0x5b9b5b;
    case 'insect': return 0xc4a832;
    case 'plant': return 0x3d8b37;
    case 'fungus': return 0xb87333;
    default: return 0x888888;
  }
}
