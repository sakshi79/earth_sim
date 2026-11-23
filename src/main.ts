import './style.css';
import { assets, assetUrl, credits } from './config.ts';
import { GlobeView } from './globe/GlobeView.ts';

const app = document.getElementById('app') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLElement;

function hasWebGL2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function renderOverlay(): HTMLElement {
  overlay.innerHTML = `
    <header class="brand">
      <h1>Earth Sim</h1>
      <p>Drag to spin · scroll or pinch to zoom</p>
    </header>
    <p class="status" role="status"></p>
    <footer class="credits"></footer>`;
  const footer = overlay.querySelector('.credits') as HTMLElement;
  footer.textContent = credits.join(' · ');
  return overlay.querySelector('.status') as HTMLElement;
}

async function boot(): Promise<void> {
  const status = renderOverlay();
  if (!hasWebGL2()) {
    status.textContent = 'Earth Sim needs WebGL 2, which this browser or device does not support.';
    return;
  }
  const globe = new GlobeView(app);
  globe.start();
  status.textContent = 'Loading Earth…';
  try {
    await globe.load(assetUrl(assets.earthDay));
    status.textContent = '';
  } catch (error) {
    console.error(error);
    status.textContent = 'Could not load the Earth texture. Check the connection and reload.';
  }
}

void boot();
