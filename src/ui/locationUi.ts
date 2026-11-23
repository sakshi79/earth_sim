// DOM for a visited place: back to the globe, place title, time of day, hints and credits.
// Dynamic text always goes through textContent.

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

export class LocationUi {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly clock: HTMLOutputElement;
  private readonly credits: HTMLElement;
  private solarNow = 12;

  constructor(root: HTMLElement, handlers: LocationUiHandlers) {
    this.root = root;
    root.replaceChildren();

    const topbar = el('header', 'topbar');
    const back = el('button', 'button panel back', '◀ Globe');
    back.type = 'button';
    back.title = 'Back to the globe (G)';
    back.addEventListener('click', () => handlers.onBack());
    const heading = el('div', 'place-heading');
    this.title = el('h1');
    this.subtitle = el('p');
    heading.append(this.title, this.subtitle);
    topbar.append(back, heading);

    const time = el('div', 'time panel');
    const label = el('label');
    label.textContent = 'Time of day ';
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
    const now = el('button', 'button small', 'Now');
    now.type = 'button';
    now.addEventListener('click', () => {
      this.slider.value = String(this.solarNow);
      this.showClock(this.solarNow);
      handlers.onTimeChange(this.solarNow);
    });
    const row = el('div', 'time-row');
    row.append(this.slider, now);
    time.append(label, row);

    const hint = el('p', 'hint', 'Drag to orbit · right-drag to pan · scroll to zoom · G back to globe');
    this.credits = el('footer', 'credits');
    const bottom = el('div', 'bottom');
    bottom.append(time, hint);
    root.append(topbar, bottom, this.credits);

    document.addEventListener('keydown', (event) => {
      if (root.hidden || event.target instanceof HTMLInputElement && event.target.type !== 'range') return;
      if (event.key === 'g' || event.key === 'G') handlers.onBack();
    });
  }

  show(info: LocationInfo): void {
    this.title.textContent = info.title;
    this.subtitle.textContent = info.subtitle;
    this.credits.textContent = info.credits.join(' · ');
    this.solarNow = Math.round(info.solarHours * 4) / 4;
    this.slider.value = String(this.solarNow);
    this.showClock(this.solarNow);
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
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
