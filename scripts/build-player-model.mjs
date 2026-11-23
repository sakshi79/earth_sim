// Builds public/models/player.glb from Quaternius' Universal Animation Library (CC0):
// keeps only the animations the game uses, resamples and quantises them, and prunes the rest.
//
// Source: https://opengameart.org/content/universal-animation-library (Standard pack, CC0 1.0).
// Download the zip, extract "Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb",
// then run: npm run build-player-model -- <path to that .glb>
import { mkdir } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/** Animations the player uses (see src/player/Player.ts). */
const KEEP = [
  'Idle_Loop',
  'Walk_Loop',
  'Jog_Fwd_Loop',
  'Sprint_Loop',
  'Jump_Start',
  'Jump_Loop',
  'Jump_Land',
  'Swim_Fwd_Loop',
  'Swim_Idle_Loop',
  'Crouch_Idle_Loop',
  'Interact',
];

const source = process.argv[2];
if (!source) {
  console.error('Usage: npm run build-player-model -- <AnimationLibrary_Godot_Standard.glb>');
  process.exit(1);
}

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const document = await io.read(source);
const root = document.getRoot();
for (const animation of root.listAnimations()) {
  if (!KEEP.includes(animation.getName())) animation.dispose();
}
const kept = root.listAnimations().map((a) => a.getName());
const missing = KEEP.filter((name) => !kept.includes(name));
if (missing.length) throw new Error(`Missing animations: ${missing.join(', ')}`);

const scene = root.getDefaultScene() ?? root.listScenes()[0];
const { min, max } = getBounds(scene);
// meshopt quantises and compresses geometry and animation; three.js decodes it with MeshoptDecoder.
await document.transform(resample(), prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await mkdir(new URL('../public/models/', import.meta.url), { recursive: true });
const out = new URL('../public/models/player.glb', import.meta.url);
await io.write(out.pathname, document);
console.log(`player.glb: ${kept.length} animations; bounds y ${min[1].toFixed(2)}…${max[1].toFixed(2)} m`);
