import * as THREE from 'three';
import { SEA_LEVEL, turnToward, type PlayerState, type WorldQuery } from './movement.ts';

export type CameraMode = 'follow' | 'scout' | 'documentary';

const MIN_DISTANCE = 2;
const MAX_DISTANCE = 15;
const DEFAULT_DISTANCE = 4.5;
/** The opening shot starts wide and settles behind the player. */
const ESTABLISHING_DISTANCE = 80;
const MIN_PITCH = -0.2;
const MAX_PITCH = 1.3;
/** Seconds after a manual orbit before the camera swings back behind a moving player. */
const SWING_DELAY = 1.5;
const SCOUT_MIN_HEIGHT = 2;
const SCOUT_MAX_HEIGHT = 2000;

type ShotType = 'establishing' | 'tracking' | 'low' | 'orbit';
const SHOT_DURATION_MIN = 6;
const SHOT_DURATION_MAX = 12;
const SHOT_TYPES: ShotType[] = ['establishing', 'tracking', 'low', 'orbit'];

export interface ScoutInput {
  x: number;
  y: number;
  up: boolean;
  down: boolean;
  fast: boolean;
}

/** Follow (chase) and Scout (free) cameras for the place scene. */
export class CameraRig {
  mode: CameraMode = 'follow';
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: WorldQuery;
  private readonly hasSea: boolean;
  // Follow: the camera sits at `distance` from the player's head, in direction (yaw, pitch).
  private yaw = 0;
  private pitch = 0.32;
  private distance = ESTABLISHING_DISTANCE;
  private targetDistance = DEFAULT_DISTANCE;
  private sinceOrbit = Infinity;
  private settling = true;
  private readonly position = new THREE.Vector3();
  private placed = false;
  // Scout: free look.
  private scoutYaw = 0;
  private scoutPitch = -0.3;
  // Documentary: auto-cutting between shot types.
  private docShot: ShotType = 'establishing';
  private docTimer = 0;
  private docAngle = 0;
  private readonly docPos = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, world: WorldQuery, hasSea: boolean, player: PlayerState) {
    this.camera = camera;
    this.world = world;
    this.hasSea = hasSea;
    this.yaw = player.heading + Math.PI; // behind the player
  }

  /** Horizontal unit vector the camera looks along (movement is relative to it). */
  forward(): { x: number; z: number } {
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    const length = Math.hypot(direction.x, direction.z);
    if (length < 1e-4) return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
    return { x: direction.x / length, z: direction.z / length };
  }

  /** Compass heading the camera faces, in degrees clockwise from north. */
  headingDegrees(): number {
    const f = this.forward();
    return (THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)) + 360) % 360;
  }

  /** Drag in pixels. */
  orbit(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    if (this.mode === 'follow') {
      this.yaw -= dx * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.005, MIN_PITCH, MAX_PITCH);
      this.sinceOrbit = 0;
    } else {
      this.scoutYaw -= dx * 0.004;
      this.scoutPitch = THREE.MathUtils.clamp(this.scoutPitch - dy * 0.004, -1.45, 1.45);
    }
  }

  /** Multiplicative zoom (>1 = farther). Scout ignores it. */
  zoom(factor: number): void {
    if (this.mode === 'follow' && factor !== 1) {
      this.targetDistance = THREE.MathUtils.clamp(this.targetDistance * factor, MIN_DISTANCE, MAX_DISTANCE);
      this.settling = false;
    }
  }

  toggle(player: PlayerState): CameraMode {
    if (this.mode === 'follow') {
      const direction = this.camera.getWorldDirection(new THREE.Vector3());
      this.scoutYaw = Math.atan2(-direction.x, -direction.z);
      this.scoutPitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
      this.mode = 'scout';
    } else {
      // Pick up the chase from wherever the scout camera is, then glide back in.
      const p = this.camera.position;
      this.yaw = Math.atan2(p.x - player.x, p.z - player.z);
      this.distance = Math.min(Math.hypot(p.x - player.x, p.z - player.z, p.y - player.y), ESTABLISHING_DISTANCE);
      this.position.copy(p);
      this.settling = true;
      this.mode = 'follow';
    }
    return this.mode;
  }

  updateFollow(dt: number, player: PlayerState): void {
    const head = new THREE.Vector3(player.x, player.y + (player.mode === 'swim' ? 1.3 : 1.6), player.z);
    this.sinceOrbit += dt;
    if (player.speed > 0.3 && this.sinceOrbit > SWING_DELAY) {
      this.yaw = turnToward(this.yaw, player.heading + Math.PI, dt * 1.4 * Math.min(1, player.speed / 2));
    }
    // Settle slowly from the establishing shot, quickly after that.
    const rate = this.settling ? 1.4 : 8;
    this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-dt * rate));
    if (this.settling && Math.abs(this.distance - this.targetDistance) < 0.3) this.settling = false;

    const horizontal = Math.cos(this.pitch) * this.distance;
    const desired = new THREE.Vector3(
      head.x + Math.sin(this.yaw) * horizontal,
      head.y + Math.sin(this.pitch) * this.distance,
      head.z + Math.cos(this.yaw) * horizontal,
    );
    this.keepLineOfSight(head, desired);
    this.keepOffWaterline(desired, player.underwater);
    desired.y = Math.max(desired.y, this.world.heightAt(desired.x, desired.z) + 0.4);

    if (!this.placed) {
      this.position.copy(desired);
      this.placed = true;
    } else {
      this.position.lerp(desired, 1 - Math.exp(-dt * 10));
    }
    this.position.y = Math.max(this.position.y, this.world.heightAt(this.position.x, this.position.z) + 0.3);
    this.camera.position.copy(this.position);
    this.camera.lookAt(head);
  }

  updateScout(dt: number, input: ScoutInput): void {
    const camera = this.camera;
    camera.rotation.set(this.scoutPitch, this.scoutYaw, 0, 'YXZ');
    const p = camera.position;
    const ground = this.surfaceAt(p.x, p.z);
    const height = Math.max(0, p.y - ground);
    const speed = Math.max(8, height * 0.8) * (input.fast ? 4 : 1);
    const forward = new THREE.Vector3(-Math.sin(this.scoutYaw), 0, -Math.cos(this.scoutYaw));
    const right = new THREE.Vector3(Math.cos(this.scoutYaw), 0, -Math.sin(this.scoutYaw));
    p.addScaledVector(forward, input.y * speed * dt).addScaledVector(right, input.x * speed * dt);
    p.y += ((input.up ? 1 : 0) - (input.down ? 1 : 0)) * speed * dt;
    const { minX, maxX, minZ, maxZ } = this.world.bounds;
    p.x = THREE.MathUtils.clamp(p.x, minX, maxX);
    p.z = THREE.MathUtils.clamp(p.z, minZ, maxZ);
    const floor = this.surfaceAt(p.x, p.z);
    p.y = THREE.MathUtils.clamp(p.y, floor + SCOUT_MIN_HEIGHT, floor + SCOUT_MAX_HEIGHT);
  }

  /** The ground (or sea surface) point under a canvas pixel, or null for the sky. */
  groundPoint(x: number, y: number, width: number, height: number): THREE.Vector3 | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), this.camera);
    const { origin, direction } = raycaster.ray;
    const point = origin.clone();
    let previous = 0;
    let t = 0;
    for (let i = 0; i < 400 && t < 30_000; i++) {
      const gap = point.y - this.surfaceAt(point.x, point.z);
      if (gap <= 0) {
        // Refine between the last two samples.
        let lo = previous;
        let hi = t;
        for (let k = 0; k < 20; k++) {
          const mid = (lo + hi) / 2;
          const p = origin.clone().addScaledVector(direction, mid);
          if (p.y - this.surfaceAt(p.x, p.z) > 0) lo = mid;
          else hi = mid;
        }
        return origin.clone().addScaledVector(direction, hi);
      }
      previous = t;
      t += Math.max(0.5, gap * 0.5);
      point.copy(origin).addScaledVector(direction, t);
    }
    return null;
  }

  /**
   * Keeps terrain out from between the camera and the player's head: first by rising to look over
   * it (keeping the distance), and only if that fails by moving in front of it.
   */
  private keepLineOfSight(head: THREE.Vector3, desired: THREE.Vector3): void {
    const blockedAt = (to: THREE.Vector3): number => {
      const steps = 16;
      const p = new THREE.Vector3();
      for (let i = 1; i <= steps; i++) {
        p.lerpVectors(head, to, i / steps);
        if (this.world.heightAt(p.x, p.z) + 0.3 > p.y) return i / steps;
      }
      return -1;
    };
    const firstBlock = blockedAt(desired);
    if (firstBlock < 0) return;
    const raised = new THREE.Vector3();
    for (let k = 1; k <= 6; k++) {
      raised.copy(desired).setY(desired.y + k * this.distance * 0.3);
      if (blockedAt(raised) < 0) {
        desired.copy(raised);
        return;
      }
    }
    desired.lerpVectors(head, desired, Math.max(0.25, firstBlock - 1 / 16));
  }

  /** Keeps the camera clearly above the sea surface, or clearly below it when diving. */
  private keepOffWaterline(p: THREE.Vector3, underwater: boolean): void {
    if (!this.hasSea || !this.world.waterAt(p.x, p.z)) return;
    if (underwater) p.y = Math.min(p.y, SEA_LEVEL - 0.4);
    else p.y = Math.max(p.y, SEA_LEVEL + 0.4);
  }

  private surfaceAt(x: number, z: number): number {
    const ground = this.world.heightAt(x, z);
    return this.hasSea && this.world.waterAt(x, z) ? Math.max(ground, SEA_LEVEL) : ground;
  }
}
