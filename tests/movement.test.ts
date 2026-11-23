import { describe, expect, it } from 'vitest';
import {
  EDGE_MARGIN,
  FLOAT_DEPTH,
  RUN_SPEED,
  SEA_LEVEL,
  spawnState,
  stepPlayer,
  turnToward,
  WALK_SPEED,
  type MoveInput,
  type WorldQuery,
} from '../src/player/movement.ts';

const bounds = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
const flat: WorldQuery = { heightAt: () => 100, waterAt: () => false, bounds };
const north = { x: 0, z: -1 }; // camera looking north (−z)
const still: MoveInput = { x: 0, y: 0, run: false, up: false, down: false, forward: north };
const forward = (over: Partial<MoveInput> = {}): MoveInput => ({ ...still, y: 1, ...over });

function run(world: WorldQuery, input: MoveInput, seconds: number, state = spawnState(0, 0, world)) {
  for (let t = 0; t < seconds; t += 1 / 60) stepPlayer(state, input, 1 / 60, world);
  return state;
}

describe('walking and running', () => {
  it('walks forward relative to the camera at walking speed', () => {
    const s = run(flat, forward(), 2);
    expect(s.z).toBeCloseTo(-2 * WALK_SPEED, 1);
    expect(s.x).toBeCloseTo(0, 6);
    expect(s.y).toBe(100);
    expect(s.speed).toBeCloseTo(WALK_SPEED, 6);
  });

  it('runs at running speed and strafes right of the camera', () => {
    expect(run(flat, forward({ run: true }), 1).z).toBeCloseTo(-RUN_SPEED, 1);
    expect(run(flat, { ...still, x: 1 }, 1).x).toBeCloseTo(WALK_SPEED, 1); // east when facing north
  });

  it('turns to face the direction of travel', () => {
    const s = run(flat, forward(), 1);
    expect(Math.sin(s.heading)).toBeCloseTo(0, 3);
    expect(Math.cos(s.heading)).toBeCloseTo(-1, 3); // facing −z
  });

  it('cannot walk up slopes steeper than 35°, but can walk up gentle ones', () => {
    const steep: WorldQuery = { ...flat, heightAt: (_x, z) => -z * 1.0 }; // 45° rising northward
    expect(run(steep, forward(), 2).z).toBeCloseTo(0, 3);
    const gentle: WorldQuery = { ...flat, heightAt: (_x, z) => -z * 0.3 }; // ~17°
    const s = run(gentle, forward(), 2);
    expect(s.z).toBeCloseTo(-2 * WALK_SPEED, 1);
    expect(s.y).toBeCloseTo(-s.z * 0.3, 6);
  });

  it('stops at the soft boundary', () => {
    const small: WorldQuery = { ...flat, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 } };
    const s = run(small, forward({ run: true }), 5);
    expect(s.z).toBe(-50 + EDGE_MARGIN);
    expect(s.atEdge).toBe(true);
  });
});

describe('jumping and falling', () => {
  it('jumps about a metre and lands again', () => {
    const s = spawnState(0, 0, flat);
    let peak = s.y;
    stepPlayer(s, { ...still, up: true }, 1 / 60, flat);
    expect(s.mode).toBe('air');
    for (let i = 0; i < 120; i++) {
      stepPlayer(s, still, 1 / 60, flat);
      peak = Math.max(peak, s.y);
    }
    expect(peak - 100).toBeGreaterThan(0.8);
    expect(peak - 100).toBeLessThan(1.0);
    expect(s.mode).toBe('ground');
    expect(s.y).toBe(100);
  });

  it('falls off a ledge instead of snapping down', () => {
    const ledge: WorldQuery = { ...flat, heightAt: (_x, z) => (z < -1 ? 90 : 100) };
    const s = spawnState(0, 0, ledge);
    for (let i = 0; i < 60 && s.mode !== 'air'; i++) stepPlayer(s, forward(), 1 / 60, ledge);
    expect(s.mode).toBe('air');
    run(ledge, still, 2, s);
    expect(s.mode).toBe('ground');
    expect(s.y).toBe(90);
  });
});

describe('swimming and diving', () => {
  // Beach at z ≥ 0 rising gently; the sea floor shelves to 10 m deep further north.
  const coast: WorldQuery = {
    heightAt: (_x, z) => (z >= 0 ? z * 0.05 : Math.max(-10, z * 0.5)),
    waterAt: (_x, z) => z < 0,
    bounds,
  };

  it('starts swimming at the surface in deep water', () => {
    const s = spawnState(0, -100, coast);
    expect(s.mode).toBe('swim');
    expect(s.y).toBe(SEA_LEVEL - FLOAT_DEPTH);
  });

  it('wades in, then swims once deeper than chest height', () => {
    const s = spawnState(0, 5, coast);
    run(coast, forward(), 8, s);
    expect(s.mode).toBe('swim');
  });

  it('dives with breath running down, and rises back to the surface', () => {
    const s = spawnState(0, -100, coast);
    run(coast, { ...still, down: true }, 5, s);
    expect(s.y).toBeCloseTo(SEA_LEVEL - FLOAT_DEPTH - 5, 1);
    expect(s.underwater).toBe(true);
    expect(s.breath).toBeLessThan(1);
    run(coast, { ...still, up: true }, 6, s);
    expect(s.y).toBe(SEA_LEVEL - FLOAT_DEPTH);
    expect(s.underwater).toBe(false);
  });

  it('stays above the sea floor when diving', () => {
    const s = run(coast, { ...still, down: true }, 30, spawnState(0, -100, coast));
    expect(s.y).toBeCloseTo(-10 + 0.3, 6);
  });

  it('walks out of the water onto the beach', () => {
    const s = spawnState(0, -3, coast);
    run(coast, { ...still, y: -1 }, 12, s); // back = south, toward the beach
    expect(s.mode).toBe('ground');
    expect(s.z).toBeGreaterThan(0);
  });
});

describe('turnToward', () => {
  it('turns the short way round', () => {
    expect(turnToward(3, -3, 1)).toBeCloseTo(3 + (2 * Math.PI - 6), 6);
    expect(turnToward(0, 0.5, 1)).toBe(0.5);
    expect(turnToward(0, 2, 1)).toBe(1);
  });
});
