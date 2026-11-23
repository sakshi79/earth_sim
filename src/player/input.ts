// Player input from keyboard, mouse and touch, read once per frame by player/Exploration.ts.

const CLICK_MOVE_PX = 6;
const CLICK_MAX_MS = 400;

export class Input {
  /** Set by the on-screen controls (ui/touchControls.ts). */
  readonly touch = { x: 0, y: 0, run: false, up: false, down: false };

  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragX = 0;
  private dragY = 0;
  private zoom = 1;
  private pinch = 0;
  private press: { x: number; y: number; time: number } | null = null;
  private click: { x: number; y: number } | null = null;
  private readonly cleanup: Array<() => void> = [];

  constructor(canvas: HTMLElement) {
    const listen = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, handler: (e: WindowEventMap[K]) => void, options?: AddEventListenerOptions): void => {
      target.addEventListener(type, handler as EventListener, options);
      this.cleanup.push(() => target.removeEventListener(type, handler as EventListener, options));
    };

    listen(window, 'keydown', (e) => {
      if (isTyping(e.target)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    listen(window, 'keyup', (e) => this.keys.delete(e.code));
    listen(window, 'blur', () => this.keys.clear());

    listen(canvas, 'pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.press = this.pointers.size === 1 ? { x: e.clientX, y: e.clientY, time: performance.now() } : null;
      this.pinch = this.pointers.size === 2 ? this.spread() : 0;
    });
    listen(canvas, 'pointermove', (e) => {
      const last = this.pointers.get(e.pointerId);
      if (!last) return;
      if (this.pointers.size === 1) {
        this.dragX += e.clientX - last.x;
        this.dragY += e.clientY - last.y;
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const spread = this.spread();
        if (this.pinch > 0 && spread > 0) this.zoom *= this.pinch / spread;
        this.pinch = spread;
      }
    });
    const release = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = 0;
      const press = this.press;
      if (!press || e.type !== 'pointerup' || this.pointers.size > 0) return;
      this.press = null;
      const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
      if (moved <= CLICK_MOVE_PX && performance.now() - press.time <= CLICK_MAX_MS) {
        const rect = canvas.getBoundingClientRect();
        this.click = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }
    };
    listen(canvas, 'pointerup', release);
    listen(canvas, 'pointercancel', release);
    listen(
      canvas,
      'wheel',
      (e) => {
        e.preventDefault();
        const pixels = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        this.zoom *= Math.exp(pixels * 0.0012);
      },
      { passive: false },
    );
  }

  /** Movement stick: x right, y forward, each −1…1. */
  move(): { x: number; y: number } {
    if (this.touch.x !== 0 || this.touch.y !== 0) return { x: this.touch.x, y: this.touch.y };
    const axis = (plus: string[], minus: string[]): number =>
      (plus.some((k) => this.keys.has(k)) ? 1 : 0) - (minus.some((k) => this.keys.has(k)) ? 1 : 0);
    return { x: axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']), y: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) };
  }

  run(): boolean {
    return this.touch.run || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Jump on land, rise in water, climb in the scout camera. */
  up(): boolean {
    return this.touch.up || this.keys.has('Space');
  }

  /** Dive in water, descend in the scout camera. */
  down(): boolean {
    return this.touch.down || this.keys.has('KeyC');
  }

  /** True once per key press (KeyboardEvent.code, or an action pressed on screen). */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Lets on-screen buttons trigger the same one-shot actions as keys. */
  trigger(code: string): void {
    this.pressed.add(code);
  }

  takeDrag(): { dx: number; dy: number } {
    const drag = { dx: this.dragX, dy: this.dragY };
    this.dragX = this.dragY = 0;
    return drag;
  }

  /** Multiplicative zoom since the last call (>1 = zoom out). */
  takeZoom(): number {
    const zoom = this.zoom;
    this.zoom = 1;
    return zoom;
  }

  /** A click or tap on the scene since the last call, in canvas pixels. */
  takeClick(): { x: number; y: number } | null {
    const click = this.click;
    this.click = null;
    return click;
  }

  endFrame(): void {
    this.pressed.clear();
  }

  dispose(): void {
    for (const undo of this.cleanup.splice(0)) undo();
  }

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'button')
  );
}
