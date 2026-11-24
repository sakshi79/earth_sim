import type { NearbySpecies } from '../data/inaturalist.ts';
import { fetchSpeciesSummary } from '../data/inaturalist.ts';

const SHOW_DURATION = 6000;

export class SpeciesCard {
  private readonly root: HTMLElement;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'species-card';
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  show(species: NearbySpecies): void {
    clearTimeout(this.timer);
    const conservation = species.conservation
      ? `<span class="conservation">${esc(species.conservation)}</span>`
      : '';
    const photoHtml = species.photoUrl
      ? `<img class="species-photo" src="${esc(species.photoUrl)}" alt="${esc(species.commonName)}">`
      : '';
    const attribution = species.photoAttribution
      ? `<p class="photo-attr">${esc(species.photoAttribution)}</p>`
      : '';

    this.root.innerHTML =
      `<div class="species-card-inner">` +
      photoHtml +
      `<div class="species-info">` +
      `<h3>${esc(species.commonName)}</h3>` +
      `<p class="sci-name">${esc(species.name)}</p>` +
      `<p class="group-tag">${esc(species.group)}${conservation}</p>` +
      `<p class="summary">Loading...</p>` +
      attribution +
      `</div></div>`;

    this.root.hidden = false;
    this.timer = window.setTimeout(() => this.hide(), SHOW_DURATION);

    fetchSpeciesSummary(species.name).then((summary) => {
      const el = this.root.querySelector('.summary');
      if (el) el.textContent = summary ? truncate(summary, 200) : 'No description available.';
    });

    this.saveToJournal(species);
  }

  hide(): void {
    this.root.hidden = true;
    clearTimeout(this.timer);
  }

  private saveToJournal(species: NearbySpecies): void {
    try {
      const key = 'earth-sim-journal';
      const journal: Record<number, { name: string; commonName: string; group: string; firstSeen: string }> =
        JSON.parse(localStorage.getItem(key) ?? '{}');
      if (!journal[species.id]) {
        journal[species.id] = {
          name: species.name,
          commonName: species.commonName,
          group: species.group,
          firstSeen: new Date().toISOString(),
        };
        localStorage.setItem(key, JSON.stringify(journal));
      }
    } catch { /* localStorage unavailable */ }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, s.lastIndexOf(' ', max)) + '...';
}
