import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { assetUrl } from '../config.ts';
import { RUN_SPEED, WALK_SPEED, type PlayerState } from './movement.ts';

/** Animations kept by scripts/build-player-model.mjs. */
type ClipName =
  | 'Idle_Loop'
  | 'Walk_Loop'
  | 'Jog_Fwd_Loop'
  | 'Jump_Loop'
  | 'Swim_Fwd_Loop'
  | 'Swim_Idle_Loop'
  | 'Crouch_Idle_Loop';

/** Outfit colours: a bright jacket that reads against any landscape, dark joints. */
const BODY_COLOR = 0xe07a3f;
const JOINT_COLOR = 0x2b2f36;
const FADE_SECONDS = 0.2;

interface Template {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

let template: Promise<Template> | null = null;

/** Starts loading the player model (cached across visits). Safe to call early. */
export function preloadPlayer(): Promise<Template> {
  if (!template) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    template = loader.loadAsync(assetUrl('models/player.glb')).then((gltf) => {
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.frustumCulled = false; // skinned bounds don't follow the animation
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.color.set(material.name === 'M_Joints' ? JOINT_COLOR : BODY_COLOR);
            material.roughness = 0.75;
            material.metalness = 0;
          }
        }
      });
      return { scene: gltf.scene, animations: gltf.animations };
    });
    template.catch(() => {
      template = null; // allow a retry on the next visit
    });
  }
  return template;
}

/**
 * The player character: Quaternius' Universal Animation Library mannequin (CC0), animated from the
 * movement state. Falls back to a simple capsule figure if the model can't be loaded.
 */
export class Player {
  readonly object = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer | null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;

  private constructor(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.object.add(model);
    this.mixer = clips.length ? new THREE.AnimationMixer(model) : null;
    for (const clip of clips) this.actions.set(clip.name, this.mixer!.clipAction(clip));
  }

  static async create(): Promise<Player> {
    try {
      const { scene, animations } = await preloadPlayer();
      return new Player(cloneSkinned(scene), animations);
    } catch (error) {
      console.error('Player model unavailable; using a simple figure.', error);
      return new Player(createFallbackFigure(), []);
    }
  }

  update(dt: number, s: PlayerState, observing: boolean): void {
    this.object.position.set(s.x, s.y, s.z);
    this.object.rotation.y = s.heading;

    if (s.mode === 'swim') this.play(s.speed > 0.15 ? 'Swim_Fwd_Loop' : 'Swim_Idle_Loop');
    else if (s.mode === 'air') this.play('Jump_Loop', 0.1);
    else if (observing) this.play('Crouch_Idle_Loop');
    else if (s.speed < 0.15) this.play('Idle_Loop');
    else if (s.speed < (WALK_SPEED + RUN_SPEED) / 2) this.play('Walk_Loop', FADE_SECONDS, clamp(s.speed / WALK_SPEED, 0.6, 1.6));
    else this.play('Jog_Fwd_Loop', FADE_SECONDS, clamp(s.speed / 4, 0.8, 1.5));

    this.mixer?.update(dt);
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.object.removeFromParent();
  }

  private play(name: ClipName, fade = FADE_SECONDS, timeScale = 1): void {
    const action = this.actions.get(name);
    if (!action) return;
    action.timeScale = timeScale;
    if (this.current === action) return;
    action.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = action;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function createFallbackFigure(): THREE.Object3D {
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 6, 12), new THREE.MeshStandardMaterial({ color: BODY_COLOR }));
  body.position.y = 0.83;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshStandardMaterial({ color: JOINT_COLOR }));
  head.position.y = 1.62;
  const figure = new THREE.Group();
  figure.add(body, head);
  return figure;
}
