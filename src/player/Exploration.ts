import * as THREE from 'three';
import { SpeciesCard } from '../ui/speciesCard.ts';
import type { LocationView } from '../world/LocationView.ts';
import { CameraRig, type CameraMode } from './cameraRig.ts';
import { Input } from './input.ts';
import { SEA_LEVEL, spawnState, stepPlayer, type MoveInput, type PlayerState } from './movement.ts';
import { Player } from './Player.ts';

/** What the place screen shows about the player (implemented by ui/locationUi.ts). */
export interface ExplorationHud {
  setStatus(status: PlayerStatus): void;
  setCameraMode(mode: CameraMode): void;
  setMoveHereAvailable(available: boolean): void;
}

export interface PlayerStatus {
  activity: string;
  /** Ground elevation, or depth when diving. */
  level: string;
  lat: number;
  lon: number;
  /** Compass heading of the camera, degrees clockwise from north. */
  facing: number;
  /** 0–1 while underwater, otherwise null. */
  breath: number | null;
  atEdge: boolean;
}

const HUD_INTERVAL = 0.2;
const OBSERVE_SECONDS = 1.5;
const IDLE: Omit<MoveInput, 'forward'> = { x: 0, y: 0, run: false, up: false, down: false };

/** The player exploring a place: input → movement → animation and cameras, every frame. */
export class Exploration {
  readonly input: Input;
  private readonly view: LocationView;
  private readonly hud: ExplorationHud;
  private readonly player: Player;
  private readonly state: PlayerState;
  private readonly rig: CameraRig;
  private readonly marker: THREE.Mesh;
  private readonly speciesCard: SpeciesCard;
  private observeLeft = 0;
  private hudLeft = 0;

  private constructor(view: LocationView, hud: ExplorationHud, player: Player, placeName: string) {
    this.view = view;
    this.hud = hud;
    this.player = player;
    this.state = spawnState(0, 0, view.world);
    view.focus.set(this.state.x, this.state.y, this.state.z);
    this.rig = new CameraRig(view.camera, view.world, view.hasSea, this.state);
    this.input = new Input(view.domElement);
    this.marker = createMarker();
    this.speciesCard = new SpeciesCard(view.domElement.parentElement!);
    this.speciesCard.setPlace(placeName);
    view.scene.add(player.object, this.marker);
    hud.setCameraMode(this.rig.mode);
    view.onFrame = (dt) => this.frame(dt);
  }

  static async start(view: LocationView, hud: ExplorationHud, placeName = ''): Promise<Exploration> {
    return new Exploration(view, hud, await Player.create(), placeName);
  }

  dispose(): void {
    this.view.onFrame = null;
    this.input.dispose();
    this.player.dispose();
    this.speciesCard.hide();
    this.marker.removeFromParent();
  }

  private frame(dt: number): void {
    const input = this.input;
    const camera0 = this.view.camera.position;
    const drag = input.takeDrag();
    this.rig.orbit(drag.dx, drag.dy);
    this.rig.zoom(input.takeZoom());
    if (input.wasPressed('KeyV')) this.hud.setCameraMode(this.rig.toggle(this.state));
    if (input.wasPressed('KeyE') && this.state.mode === 'ground') {
      this.observeLeft = OBSERVE_SECONDS;
      this.tryObserveCreature();
    }
    this.observeLeft = Math.max(0, this.observeLeft - dt);

    const move = input.move();
    if (this.rig.mode === 'follow') {
      const controls = this.observeLeft > 0 ? IDLE : { ...move, run: input.run(), up: input.up(), down: input.down() };
      stepPlayer(this.state, { ...controls, forward: this.rig.forward() }, dt, this.view.world);
      this.applyVegetationCollision();
      this.rig.updateFollow(dt, this.state);
    } else if (this.rig.mode === 'documentary') {
      stepPlayer(this.state, { ...IDLE, forward: this.rig.forward() }, dt, this.view.world);
      this.applyVegetationCollision();
      this.rig.updateDocumentary(dt, this.state);
    } else {
      stepPlayer(this.state, { ...IDLE, forward: this.rig.forward() }, dt, this.view.world);
      this.applyVegetationCollision();
      this.rig.updateScout(dt, { ...move, up: input.up(), down: input.down(), fast: input.run() });
      this.handleScoutClicks();
    }
    input.takeClick(); // clicks only matter in the scout camera

    this.player.update(dt, this.state, this.observeLeft > 0);
    // Vegetation and sun shadows centre on the player (on the scout camera's ground point when flying).
    if (this.rig.mode === 'scout') this.view.focus.set(camera0.x, this.view.world.heightAt(camera0.x, camera0.z), camera0.z);
    else this.view.focus.set(this.state.x, this.state.y, this.state.z);
    const camera = this.view.camera.position;
    this.view.setUnderwater(camera.y < SEA_LEVEL && this.view.world.waterAt(camera.x, camera.z));

    this.hudLeft -= dt;
    if (this.hudLeft <= 0) {
      this.hudLeft = HUD_INTERVAL;
      this.hud.setStatus(this.status());
    }
    input.endFrame();
  }

  private tryObserveCreature(): void {
    const creatures = this.view.creatures;
    if (!creatures) return;
    const hit = creatures.nearest(this.state.x, this.state.z, 15);
    if (hit) this.speciesCard.show(hit.species);
  }

  private applyVegetationCollision(): void {
    if (this.state.mode === 'swim') return;
    const pushed = this.view.pushOutOfVegetation(this.state.x, this.state.z, 0.3);
    if (pushed.x !== this.state.x || pushed.z !== this.state.z) {
      this.state.x = pushed.x;
      this.state.z = pushed.z;
      this.state.y = this.view.world.heightAt(pushed.x, pushed.z);
    }
  }

  /** In the scout camera, a click marks a spot; R (or "Move here") sends the player there. */
  private handleScoutClicks(): void {
    const click = this.input.takeClick();
    if (click) {
      const canvas = this.view.domElement;
      const point = this.rig.groundPoint(click.x, click.y, canvas.clientWidth, canvas.clientHeight);
      if (point) {
        this.marker.position.copy(point).setY(point.y + 0.3);
        this.marker.visible = true;
        this.hud.setMoveHereAvailable(true);
      }
    }
    if (this.input.wasPressed('KeyR') && this.marker.visible) {
      const heading = this.state.heading;
      Object.assign(this.state, spawnState(this.marker.position.x, this.marker.position.z, this.view.world), { heading });
      this.marker.visible = false;
      this.hud.setMoveHereAvailable(false);
    }
  }

  private status(): PlayerStatus {
    const s = this.state;
    const ground = this.view.world.heightAt(s.x, s.z);
    const { lat, lon } = this.view.latLonAt(s.x, s.z);
    let activity: string;
    if (s.mode === 'swim') activity = s.underwater ? 'Diving' : 'Swimming';
    else if (s.mode === 'air') activity = 'Jumping';
    else if (this.observeLeft > 0) activity = 'Observing';
    else activity = s.speed < 0.15 ? 'Standing' : s.speed < 3 ? 'Walking' : 'Running';
    const depth = SEA_LEVEL - (s.y + 1.6);
    return {
      activity,
      level: s.underwater ? `Depth ${depth.toFixed(1)} m` : s.mode === 'swim' ? 'Sea level' : `${Math.round(ground).toLocaleString('en')} m`,
      lat,
      lon,
      facing: this.rig.headingDegrees(),
      breath: s.underwater ? s.breath : null,
      atEdge: s.atEdge,
    };
  }
}

function createMarker(): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthTest: false }),
  );
  marker.renderOrder = 5;
  marker.visible = false;
  return marker;
}
