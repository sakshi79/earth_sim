// How the player moves over the terrain: walking, running, jumping, falling, swimming and diving.
// A kinematic model on the height grid (no physics engine). Pure and Node-safe, so it is unit-tested.

export const SEA_LEVEL = 0;
export const WALK_SPEED = 1.4;
export const RUN_SPEED = 5;
export const SWIM_SPEED = 1;
export const SWIM_FAST_SPEED = 1.8;
export const DIVE_SPEED = 1;
export const GRAVITY = 9.81;
export const JUMP_SPEED = 4.2;
/** Steepest walkable slope: 35°. Steeper ground blocks walking (climbing comes later). */
export const MAX_GRADE = Math.tan((35 * Math.PI) / 180);
/** Water deeper than chest height means swimming. */
export const SWIM_DEPTH = 1.3;
/** Feet below the surface while floating, so the head stays above water. */
export const FLOAT_DEPTH = 1.2;
/** Seconds of breath underwater, and seconds to recover fully at the surface. */
export const BREATH_SECONDS = 30;
export const BREATH_RECOVERY_SECONDS = 5;
/** Soft boundary: the player stops this far inside the loaded area. */
export const EDGE_MARGIN = 40;
/** A drop bigger than this in one step means falling rather than walking downhill. */
const STEP_DOWN = 0.6;
/** How far ahead the slope is measured. */
const SLOPE_PROBE = 0.6;
const TURN_RATE = 10; // radians per second

export interface WorldQuery {
  /** Ground (or sea floor) height in metres. */
  heightAt(x: number, z: number): number;
  /** Whether a point is over open sea. */
  waterAt(x: number, z: number): boolean;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export type Mode = 'ground' | 'air' | 'swim';

export interface PlayerState {
  /** Feet position in local metres (x east, y up, z south). */
  x: number;
  y: number;
  z: number;
  vy: number;
  /** Facing: forward is (sin heading, 0, cos heading). */
  heading: number;
  mode: Mode;
  /** Horizontal speed achieved in the last step (m/s). */
  speed: number;
  /** Head under the water surface. */
  underwater: boolean;
  /** 1 = full breath, 0 = empty. Shown on the HUD; no effect until the diving activity. */
  breath: number;
  /** Pushing against the soft boundary. */
  atEdge: boolean;
}

export interface MoveInput {
  /** Strafe right (+) / left (−), −1…1. */
  x: number;
  /** Forward (+) / back (−), −1…1. */
  y: number;
  run: boolean;
  /** Jump on land; rise in water. */
  up: boolean;
  /** Dive in water. */
  down: boolean;
  /** Horizontal unit vector the camera looks along; movement is relative to it. */
  forward: { x: number; z: number };
}

export function spawnState(x: number, z: number, world: WorldQuery): PlayerState {
  const state: PlayerState = {
    x, y: world.heightAt(x, z), z, vy: 0, heading: Math.PI, mode: 'ground', speed: 0,
    underwater: false, breath: 1, atEdge: false,
  };
  if (isSwimmable(x, z, world)) {
    state.mode = 'swim';
    state.y = SEA_LEVEL - FLOAT_DEPTH;
  }
  return state;
}

function isSwimmable(x: number, z: number, world: WorldQuery): boolean {
  return world.waterAt(x, z) && SEA_LEVEL - world.heightAt(x, z) > SWIM_DEPTH;
}

/** Advances the player by dt seconds. Mutates and returns `s`. */
export function stepPlayer(s: PlayerState, input: MoveInput, dt: number, world: WorldQuery): PlayerState {
  // Desired horizontal direction, relative to the camera.
  const fx = input.forward.x;
  const fz = input.forward.z;
  const rx = -fz; // right = forward turned 90° clockwise seen from above
  const rz = fx;
  let dx = fx * input.y + rx * input.x;
  let dz = fz * input.y + rz * input.x;
  const amount = Math.min(1, Math.hypot(input.x, input.y));
  const length = Math.hypot(dx, dz);
  if (length > 1e-6) {
    dx /= length;
    dz /= length;
  }

  const swimming = s.mode === 'swim';
  const speed = amount * (swimming ? (input.run ? SWIM_FAST_SPEED : SWIM_SPEED) : input.run ? RUN_SPEED : WALK_SPEED);
  if (amount > 0.05) s.heading = turnToward(s.heading, Math.atan2(dx, dz), TURN_RATE * dt);

  // Horizontal move, blocked by slopes steeper than MAX_GRADE when on foot.
  const startX = s.x;
  const startZ = s.z;
  if (speed > 0) {
    const nx = s.x + dx * speed * dt;
    const nz = s.z + dz * speed * dt;
    if (swimming || s.mode === 'air' || walkable(s.x, s.z, nx, nz, world)) {
      s.x = nx;
      s.z = nz;
    } else if (walkable(s.x, s.z, nx, s.z, world)) {
      s.x = nx; // slide along the slope
    } else if (walkable(s.x, s.z, s.x, nz, world)) {
      s.z = nz;
    }
  }

  // Soft boundary.
  const { minX, maxX, minZ, maxZ } = world.bounds;
  const cx = Math.min(maxX - EDGE_MARGIN, Math.max(minX + EDGE_MARGIN, s.x));
  const cz = Math.min(maxZ - EDGE_MARGIN, Math.max(minZ + EDGE_MARGIN, s.z));
  s.atEdge = cx !== s.x || cz !== s.z;
  s.x = cx;
  s.z = cz;
  s.speed = dt > 0 ? Math.hypot(s.x - startX, s.z - startZ) / dt : 0;

  // Vertical.
  const ground = world.heightAt(s.x, s.z);
  if (isSwimmable(s.x, s.z, world)) {
    const surface = SEA_LEVEL - FLOAT_DEPTH;
    if (s.mode !== 'swim') {
      s.mode = 'swim';
      s.vy = 0;
    }
    if (input.down) s.y -= DIVE_SPEED * dt;
    else if (input.up || s.y > surface) s.y += DIVE_SPEED * dt;
    s.y = Math.min(surface, Math.max(ground + 0.3, s.y));
  } else {
    if (s.mode === 'swim') {
      s.mode = 'ground';
      s.y = Math.max(s.y, ground);
    }
    if (s.mode === 'ground') {
      if (input.up) {
        s.mode = 'air';
        s.vy = JUMP_SPEED;
      } else if (s.y - ground > STEP_DOWN) {
        s.mode = 'air'; // walked off a ledge
        s.vy = 0;
      } else {
        s.y = ground;
      }
    }
    if (s.mode === 'air') {
      s.vy -= GRAVITY * dt;
      s.y += s.vy * dt;
      if (s.y <= ground) {
        s.y = ground;
        s.vy = 0;
        s.mode = 'ground';
      }
    }
  }

  // Breath: the head is ~1.6 m above the feet.
  s.underwater = s.mode === 'swim' && s.y + 1.6 < SEA_LEVEL;
  s.breath = s.underwater
    ? Math.max(0, s.breath - dt / BREATH_SECONDS)
    : Math.min(1, s.breath + dt / BREATH_RECOVERY_SECONDS);
  return s;
}

function walkable(x0: number, z0: number, x1: number, z1: number, world: WorldQuery): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const step = Math.hypot(dx, dz);
  if (step < 1e-9) return true;
  const px = x0 + (dx / step) * SLOPE_PROBE;
  const pz = z0 + (dz / step) * SLOPE_PROBE;
  const rise = world.heightAt(px, pz) - world.heightAt(x0, z0);
  return rise / SLOPE_PROBE <= MAX_GRADE;
}

/** Rotates angle `from` toward `to` by at most `maxStep`, the short way round. */
export function turnToward(from: number, to: number, maxStep: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + Math.max(-maxStep, Math.min(maxStep, delta));
}
