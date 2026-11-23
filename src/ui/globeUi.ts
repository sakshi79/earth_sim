// DOM for the globe screen: search, featured places, the place preview, hover readout, credits.
// Dynamic text always goes through textContent, never innerHTML.
import type { SearchHit } from '../data/nominatim.ts';
import type { Place, PlaceGroup } from '../places.ts';

export interface PreviewData {
  title: string;
  subtitle?: string;
  coords: string;
  elevation: string;
  landscape: string;
}

export interface GlobeUiHandlers {
  onSearch: (query: string) => void;
  onSearchResult: (hit: SearchHit) => void;
  onFeatured: (place: Place) => void;
  onClosePreview: () => void;
  onCopyLink: () => void;
  onReset: () => void;
  onVisit: () => void;
}

export class GlobeUi {
  private readonly status: HTMLElement;
  private readonly hover: HTMLElement;
  private readonly credits: HTMLElement;
  private readonly results: HTMLUListElement;
  private readonly searchInput: HTMLInputElement;
  private readonly preview: HTMLElement;
  private readonly previewTitle: HTMLElement;
  private readonly previewSubtitle: HTMLElement;
  private readonly previewCoords: HTMLElement;
  private readonly previewElevation: HTMLElement;
  private readonly previewLandscape: HTMLElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly visitButton: HTMLButtonElement;

  constructor(root: HTMLElement, places: readonly Place[], handlers: GlobeUiHandlers) {
    root.replaceChildren();

    // Top bar: title and search.
    const topbar = el('header', 'topbar');
    const brand = el('h1', 'brand', 'Earth Sim');
    const form = el('form', 'search panel');
    form.setAttribute('role', 'search');
    this.searchInput = el('input');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Search a place…';
    this.searchInput.setAttribute('aria-label', 'Search a place');
    this.searchInput.autocomplete = 'off';
    const searchButton = el('button', 'button', 'Search');
    searchButton.type = 'submit';
    form.append(this.searchInput, searchButton);
    this.results = el('ul', 'results panel');
    this.results.hidden = true;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = this.searchInput.value.trim();
      if (query) handlers.onSearch(query);
    });
    const searchBox = el('div', 'search-box');
    searchBox.append(form, this.results);
    const reset = el('button', 'button reset panel', '⟲ Reset');
    reset.type = 'button';
    reset.title = 'Reset the view';
    reset.setAttribute('aria-label', 'Reset the view');
    reset.addEventListener('click', () => {
      this.clearSearch();
      handlers.onReset();
    });
    topbar.append(brand, searchBox, reset);

    // Featured places, grouped. Open by default on wide screens.
    const featured = el('details', 'featured panel');
    featured.open = window.matchMedia('(min-width: 900px)').matches;
    featured.append(el('summary', '', 'Featured places'));
    const groups = new Map<PlaceGroup, Place[]>();
    for (const place of places) groups.set(place.group, [...(groups.get(place.group) ?? []), place]);
    for (const [group, members] of groups) {
      featured.append(el('h3', '', group));
      const list = el('ul');
      for (const place of members) {
        const button = el('button', 'place');
        button.type = 'button';
        button.append(el('span', 'place-name', place.name), el('span', 'place-region', place.region));
        button.addEventListener('click', () => {
          handlers.onFeatured(place);
          if (!window.matchMedia('(min-width: 900px)').matches) featured.open = false;
        });
        const item = el('li');
        item.append(button);
        list.append(item);
      }
      featured.append(list);
    }

    // Preview of the picked place.
    this.preview = el('section', 'preview panel');
    this.preview.hidden = true;
    this.preview.setAttribute('aria-live', 'polite');
    const close = el('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => handlers.onClosePreview());
    this.previewTitle = el('h2');
    this.previewSubtitle = el('p', 'subtitle');
    const facts = el('dl');
    this.previewCoords = el('dd');
    this.previewElevation = el('dd');
    this.previewLandscape = el('dd');
    facts.append(
      el('dt', '', 'Coordinates'), this.previewCoords,
      el('dt', '', 'Elevation'), this.previewElevation,
      el('dt', '', 'Likely'), this.previewLandscape,
    );
    const actions = el('div', 'actions');
    this.visitButton = el('button', 'button primary', 'Visit');
    this.visitButton.type = 'button';
    this.visitButton.addEventListener('click', () => handlers.onVisit());
    this.copyButton = el('button', 'button', 'Copy link');
    this.copyButton.type = 'button';
    this.copyButton.addEventListener('click', () => handlers.onCopyLink());
    actions.append(this.visitButton, this.copyButton);
    this.preview.append(close, this.previewTitle, this.previewSubtitle, facts, actions);

    this.hover = el('p', 'hover');
    this.status = el('p', 'status');
    this.status.setAttribute('role', 'status');
    this.credits = el('footer', 'credits');

    const bottom = el('div', 'bottom');
    bottom.append(this.preview, this.hover);
    root.append(topbar, featured, this.status, bottom, this.credits);

    this.searchHandler = handlers.onSearchResult;
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!this.results.hidden) this.results.hidden = true;
      else if (!this.preview.hidden) handlers.onClosePreview();
    });
  }

  private readonly searchHandler: (hit: SearchHit) => void;

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  setHover(text: string | null): void {
    this.hover.textContent = text ?? '';
  }

  setCredits(lines: readonly string[]): void {
    this.credits.textContent = lines.join(' · ');
  }

  clearSearch(): void {
    this.searchInput.value = '';
    this.results.hidden = true;
  }

  showSearching(): void {
    this.renderResults([el('li', 'note', 'Searching…')]);
  }

  showSearchMessage(text: string): void {
    this.renderResults([el('li', 'note', text)]);
  }

  showSearchResults(hits: readonly SearchHit[]): void {
    if (hits.length === 0) {
      this.showSearchMessage('No places found.');
      return;
    }
    this.renderResults(
      hits.map((hit) => {
        const button = el('button', 'place', hit.label);
        button.type = 'button';
        button.addEventListener('click', () => {
          this.results.hidden = true;
          this.searchHandler(hit);
        });
        const item = el('li');
        item.append(button);
        return item;
      }),
    );
  }

  showPreview(data: PreviewData): void {
    this.setPreviewTitle(data.title, data.subtitle);
    this.previewCoords.textContent = data.coords;
    this.previewElevation.textContent = data.elevation;
    this.previewLandscape.textContent = data.landscape;
    this.copyButton.textContent = 'Copy link';
    this.preview.hidden = false;
  }

  setPreviewTitle(title: string, subtitle?: string): void {
    this.previewTitle.textContent = title;
    this.previewSubtitle.textContent = subtitle ?? '';
    this.previewSubtitle.hidden = !subtitle;
  }

  hidePreview(): void {
    this.preview.hidden = true;
  }

  currentTitle(): string {
    return this.previewTitle.textContent ?? '';
  }

  setVisitBusy(busy: boolean): void {
    this.visitButton.disabled = busy;
    this.visitButton.textContent = busy ? 'Loading…' : 'Visit';
  }

  flashCopied(ok: boolean): void {
    this.copyButton.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => {
      this.copyButton.textContent = 'Copy link';
    }, 1500);
  }

  private renderResults(items: HTMLElement[]): void {
    this.results.replaceChildren(...items);
    this.results.hidden = false;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
