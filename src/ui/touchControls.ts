// On-screen controls for phones and tablets: a thumbstick on the left, action buttons on the right.
// They feed the same Input the keyboard does. Shown on touch screens only (see style.css).
import type { Input } from '../player/input.ts';

export class TouchControls {
  private readonly moveHere: HTMLButtonElement;
  private input: Input | null = null;

  constructor(root: HTMLElement) {
    root.classList.add('touch');

    const stick = el('div', 'stick');
    const knob = el('div', 'knob');
    stick.append(knob);
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      stick.setPointerCapture(e.pointerId);
      this.steer(stick, knob, e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (stick.hasPointerCapture(e.pointerId)) this.steer(stick, knob, e);
    });
    const release = (): void => {
      knob.style.transform = '';
      if (this.input) this.input.touch.x = this.input.touch.y = 0;
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);

    const buttons = el('div', 'actions');
    const hold = (label: string, title: string, flag: 'up' | 'down'): HTMLButtonElement => {
      const button = el('button', 'touch-button', label);
      button.type = 'button';
      button.setAttribute('aria-label', title);
      const set = (on: boolean) => (e: PointerEvent): void => {
        e.preventDefault();
        if (this.input) this.input.touch[flag] = on;
        button.classList.toggle('held', on);
      };
      button.addEventListener('pointerdown', set(true));
      button.addEventListener('pointerup', set(false));
      button.addEventListener('pointercancel', set(false));
      button.addEventListener('pointerleave', set(false));
      return button;
    };
    const tap = (label: string, title: string, action: () => void): HTMLButtonElement => {
      const button = el('button', 'touch-button', label);
      button.type = 'button';
      button.setAttribute('aria-label', title);
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        action();
      });
      return button;
    };
    const run = tap('Run', 'Run on or off', () => {
      if (!this.input) return;
      this.input.touch.run = !this.input.touch.run;
      run.classList.toggle('held', this.input.touch.run);
      run.setAttribute('aria-pressed', String(this.input.touch.run));
    });
    this.moveHere = tap('Move here', 'Move the player to the marked spot', () => this.input?.trigger('KeyR'));
    this.moveHere.hidden = true;
    buttons.append(
      hold('▲', 'Jump, or rise in water', 'up'),
      hold('▼', 'Dive', 'down'),
      run,
      tap('Cam', 'Switch camera', () => this.input?.trigger('KeyV')),
      this.moveHere,
    );
    root.replaceChildren(stick, buttons);
  }

  attach(input: Input | null): void {
    this.input = input;
    this.setMoveHereAvailable(false);
  }

  setMoveHereAvailable(available: boolean): void {
    this.moveHere.hidden = !available;
  }

  private steer(stick: HTMLElement, knob: HTMLElement, e: PointerEvent): void {
    const rect = stick.getBoundingClientRect();
    const radius = rect.width / 2;
    let dx = (e.clientX - (rect.left + radius)) / radius;
    let dy = (e.clientY - (rect.top + radius)) / radius;
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
    if (this.input) {
      this.input.touch.x = dx;
      this.input.touch.y = -dy; // screen up = forward
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
