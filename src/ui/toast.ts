const DURATION = 4000;

let container: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (container) return container;
  container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

export function showToast(text: string, className = ''): void {
  const el = document.createElement('div');
  el.className = `toast ${className}`.trim();
  el.textContent = text;
  getContainer().appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    el.addEventListener('animationend', () => el.remove());
  }, DURATION);
}
