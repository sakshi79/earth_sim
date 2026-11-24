// DOM for a visited place: back to the globe, title and HUD, time of day, camera hints, touch
// controls and credits. Dynamic text always goes through textContent.
import { placeProgress } from '../data/journal.ts';
import { formatLatLon } from '../format.ts';
import type { CameraMode } from '../player/cameraRig.ts';
import type { ExplorationHud, PlayerStatus } from '../player/Exploration.ts';
import type { Input } from '../player/input.ts';
import { TouchControls } from './touchControls.ts';

export interface LocationInfo {
  title: string;
  subtitle: string;
  credits: readonly string[];
  /** Local solar time when the scene opened. */
  solarHours: number;
}

export interface LocationUiHandlers {
  onBack: () => void;
  onTimeChange: (hours: number) => void;
}

const HINTS: Record<CameraMode, string> = {
  follow: 'WASD move · Shift run · Space jump / rise · C dive · E observe wildlife · drag to look · scroll to zoom · V documentary · G globe',
  documentary: 'Auto camera · V scout · G globe',
  scout: 'WASD fly · Space / C up and down · Shift fast · drag to look · click the ground, then R to move the player · V follow · G globe',
};
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class LocationUi implements ExplorationHud {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly status: HTMLElement;
  private readonly breath: HTMLElement;
  private readonly breathFill: HTMLElement;
  private readonly cameraChip: HTMLElement;
  private readonly edge: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly clock: HTMLOutputElement;
  private readonly progress: HTMLElement;
  private readonly credits: HTMLElement;
  private readonly touch: TouchControls;
  private solarNow = 12;
  private placeName = '';

  constructor(root: HTMLElement, handlers: LocationUiHandlers) {
    this.root = root;
    root.replaceChildren();

    // Top left: back, place title, player HUD.
    const topbar = el('header', 'topbar');
    const back = el('button', 'button panel back', '◀ Globe');
    back.type = 'button';
    back.title = 'Back to the globe (G)';
    back.addEventListener('click', () => handlers.onBack());
    const heading = el('div', 'place-heading');
    this.title = el('h1');
    this.subtitle = el('p');
    this.status = el('p', 'player-status');
    this.cameraChip = el('span', 'chip');
    this.breath = el('div', 'breath');
    this.breath.setAttribute('role', 'meter');
    this.breath.setAttribute('aria-label', 'Breath');
    this.breathFill = el('div', 'breath-fill');
    this.breath.append(el('span', '', 'Breath'), this.breathFill);
    this.breath.hidden = true;
    this.progress = el('p', 'place-progress');
    heading.append(this.title, this.subtitle, this.status, this.progress, this.breath);
    topbar.append(back, heading);

    // Top right: time of day.
    const time = el('div', 'time panel');
    const label = el('label');
    label.textContent = 'Time ';
    this.clock = el('output');
    label.append(this.clock);
    this.slider = el('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = '24';
    this.slider.step = '0.25';
    this.slider.setAttribute('aria-label', 'Time of day (local solar time)');
    this.slider.addEventListener('input', () => {
      const hours = Number(this.slider.value);
      this.showClock(hours);
      handlers.onTimeChange(hours);
    });
    this.slider.addEventListener('change', () => this.slider.blur()); // hand the keys back to the player
    const now = el('button', 'button small', 'Now');
    now.type = 'button';
    now.addEventListener('click', () => {
      this.slider.value = String(this.solarNow);
      this.showClock(this.solarNow);
      handlers.onTimeChange(this.solarNow);
      now.blur();
    });
    const row = el('div', 'time-row');
    row.append(this.slider, now);
    time.append(label, row);

    this.edge = el('p', 'edge-note', 'You have reached the edge of this area.');
    this.edge.hidden = true;

    // Bottom: hints (keyboard) or touch controls.
    this.hint = el('p', 'hint');
    const touchRoot = el('div');
    this.touch = new TouchControls(touchRoot);
    const bottom = el('div', 'bottom');
    bottom.append(this.cameraChip, this.hint, touchRoot);

    this.credits = el('footer', 'credits');
    root.append(topbar, time, this.edge, bottom, this.credits);

    document.addEventListener('keydown', (event) => {
      if (root.hidden || (event.target instanceof HTMLInputElement && event.target.type !== 'range')) return;
      if (event.key === 'g' || event.key === 'G') handlers.onBack();
    });
  }

  show(info: LocationInfo): void {
    this.placeName = info.title;
    this.title.textContent = info.title;
    this.subtitle.textContent = info.subtitle;
    this.credits.textContent = info.credits.join(' · ');
    this.solarNow = Math.round(info.solarHours * 4) / 4;
    this.slider.value = String(this.solarNow);
    this.showClock(this.solarNow);
    this.status.textContent = '';
    this.breath.hidden = true;
    this.edge.hidden = true;
    this.updateProgress();
    this.setCameraMode('follow');
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.touch.attach(null);
  }

  /** Connects the on-screen controls to the player's input. */
  attachInput(input: Input | null): void {
    this.touch.attach(input);
  }

  setStatus(s: PlayerStatus): void {
    const facing = COMPASS[Math.round(s.facing / 45) % 8];
    this.status.textContent = `${s.activity} · ${s.level} · ${formatLatLon(s.lat, s.lon, 4)} · facing ${facing}`;
    this.breath.hidden = s.breath === null;
    if (s.breath !== null) this.breathFill.style.width = `${Math.round(s.breath * 100)}%`;
    this.edge.hidden = !s.atEdge;
    this.updateProgress();
  }

  setCameraMode(mode: CameraMode): void {
    const names: Record<CameraMode, string> = { follow: 'Follow camera', documentary: 'Documentary camera', scout: 'Scout camera' };
    this.cameraChip.textContent = names[mode];
    this.hint.textContent = HINTS[mode];
    if (mode === 'follow') this.touch.setMoveHereAvailable(false);
  }

  setMoveHereAvailable(available: boolean): void {
    this.touch.setMoveHereAvailable(available);
  }

  private updateProgress(): void {
    const p = placeProgress(this.placeName);
    const stars = Array.from({ length: 3 }, (_, i) =>
      `<span class="${i < p.stars ? 'star' : 'star-empty'}">★</span>`).join('');
    this.progress.innerHTML = `${stars} ${p.species} species · ${p.points} pts`;
  }

  private showClock(hours: number): void {
    const h = Math.floor(hours) % 24;
    const m = Math.round((hours - Math.floor(hours)) * 60);
    this.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
