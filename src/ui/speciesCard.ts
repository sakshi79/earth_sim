import { newlyEarned } from '../data/badges.ts';
import type { NearbySpecies } from '../data/inaturalist.ts';
import { fetchSpeciesSummary } from '../data/inaturalist.ts';
import { recordObservation } from '../data/journal.ts';
import { showToast } from './toast.ts';

const SHOW_DURATION = 6000;

export class SpeciesCard {
  private readonly root: HTMLElement;
  private timer = 0;
  private placeName = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'species-card';
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  setPlace(name: string): void { this.placeName = name; }

  show(species: NearbySpecies): void {
    clearTimeout(this.timer);
    const { points, isNew } = recordObservation(species, this.placeName);
    const conservation = species.conservation
      ? `<span class="conservation">${esc(species.conservation)}</span>`
      : '';
    const photoHtml = species.photoUrl
      ? `<img class="species-photo" src="${esc(species.photoUrl)}" alt="${esc(species.commonName)}">`
      : '';
    const attribution = species.photoAttribution
      ? `<p class="photo-attr">${esc(species.photoAttribution)}</p>`
      : '';
    const badge = isNew ? '<span class="new-badge">NEW</span> ' : '';
    const pointsHtml = `<span class="points">+${points} pt${points > 1 ? 's' : ''}</span>`;

    this.root.innerHTML =
      `<div class="species-card-inner">` +
      photoHtml +
      `<div class="species-info">` +
      `<h3>${badge}${esc(species.commonName)} ${pointsHtml}</h3>` +
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

    for (const badge of newlyEarned()) {
      showToast(`Badge: ${badge.name} — ${badge.description}`, 'badge-toast');
    }
  }

  hide(): void {
    this.root.hidden = true;
    clearTimeout(this.timer);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, s.lastIndexOf(' ', max)) + '...';
}
