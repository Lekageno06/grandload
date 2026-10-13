import { h } from '../dom';
import { icon } from '../icons';

export type GalleryItem = {
  id: string;
  url: string;
  label: string;
  ext: string;
  width?: number;
  height?: number;
  selected?: boolean;
  provenance?: string;
};

export type GalleryFilterState = {
  search: string;
  provenance: string;
  sort: 'page' | 'name' | 'width' | 'height';
  descending: boolean;
};

export function getVirtualWindow(
  total: number,
  start: number,
  size = 120,
): { start: number; end: number } {
  const safeTotal = Math.max(0, total);
  const safeStart = Math.min(Math.max(0, start), safeTotal);
  return { start: safeStart, end: Math.min(safeTotal, safeStart + Math.max(1, size)) };
}

function filteredItems(items: readonly GalleryItem[], state: GalleryFilterState): GalleryItem[] {
  const query = state.search.trim().toLowerCase();
  const result = items.filter(
    (item) =>
      (!query || `${item.label} ${item.url}`.toLowerCase().includes(query)) &&
      (!state.provenance || item.provenance === state.provenance),
  );
  return result.sort((left, right) => {
    const values =
      state.sort === 'name'
        ? left.label.localeCompare(right.label)
        : state.sort === 'width'
          ? (left.width ?? 0) - (right.width ?? 0)
          : state.sort === 'height'
            ? (left.height ?? 0) - (right.height ?? 0)
            : Number(left.id) - Number(right.id);
    return state.descending ? -values : values;
  });
}

export class ImageGallery {
  readonly element: HTMLElement;
  private readonly grid: HTMLElement;
  private items: GalleryItem[];
  private state: GalleryFilterState = {
    search: '',
    provenance: '',
    sort: 'page',
    descending: false,
  };
  private windowStart = 0;
  private readonly windowSize = 120;
  private observer?: IntersectionObserver;
  private readonly pendingImages: HTMLImageElement[] = [];
  private activeLoads = 0;
  private readonly onSelectionChange: ((items: GalleryItem[]) => void) | undefined;

  constructor(
    items: readonly GalleryItem[],
    options: { onSelectionChange?: (items: GalleryItem[]) => void } = {},
  ) {
    this.items = [...items];
    this.onSelectionChange = options.onSelectionChange;
    this.element = h('section', {
      className: 'ui-image-gallery',
      'aria-label': 'Galerie d’images',
    });
    this.grid = h('div', { className: 'ui-grid ui-image-gallery__grid' });
    this.element.append(this.grid);
    this.element.addEventListener('scroll', () => {
      if (this.items.length <= 300) return;
      const next = Math.floor(this.element.scrollTop / 240) * 6;
      if (next !== this.windowStart) {
        this.windowStart = next;
        this.render();
      }
    });
    this.render();
  }

  setItems(items: readonly GalleryItem[]): void {
    this.items = [...items];
    this.windowStart = 0;
    this.render();
  }
  setFilters(state: Partial<GalleryFilterState>): void {
    this.state = { ...this.state, ...state };
    this.windowStart = 0;
    this.render();
  }
  get filtered(): GalleryItem[] {
    return filteredItems(this.items, this.state);
  }

  private render(): void {
    this.observer?.disconnect();
    this.pendingImages.length = 0;
    const filtered = this.filtered;
    const virtualized = filtered.length > 300;
    const window = virtualized
      ? getVirtualWindow(filtered.length, this.windowStart, this.windowSize)
      : { start: 0, end: filtered.length };
    this.element.dataset.virtualized = String(virtualized);
    this.grid.replaceChildren();
    if (virtualized && window.start > 0) {
      const spacer = h('div', { className: 'ui-image-gallery__spacer' });
      spacer.style.height = `${window.start * 240}px`;
      this.grid.append(spacer);
    }
    for (const item of filtered.slice(window.start, window.end)) this.grid.append(this.card(item));
    if (virtualized && window.end < filtered.length) {
      const spacer = h('div', { className: 'ui-image-gallery__spacer' });
      spacer.style.height = `${(filtered.length - window.end) * 240}px`;
      this.grid.append(spacer);
    }
    this.observeImages();
  }

  private card(item: GalleryItem): HTMLElement {
    const card = h('article', { className: 'ui-gallery-card', 'data-item-id': item.id });
    const check = h('button', {
      className: 'ui-gallery-card__check',
      type: 'button',
      'aria-label': `Sélectionner ${item.label}`,
      'aria-pressed': String(item.selected !== false),
      'data-selected': String(item.selected !== false),
    });
    check.append(icon('check'));
    check.addEventListener('click', () => {
      item.selected = item.selected === false;
      check.setAttribute('aria-pressed', String(item.selected));
      check.dataset.selected = String(item.selected);
      this.onSelectionChange?.(this.items.filter((entry) => entry.selected !== false));
    });
    const image = h('img', {
      className: 'ui-gallery-card__image',
      alt: item.label,
      loading: 'lazy',
      'data-src': item.url,
    });
    image.addEventListener('error', () => {
      image.dataset.preview = 'failed';
      image.alt = 'Aperçu indisponible';
    });
    const body = h(
      'div',
      { className: 'ui-gallery-card__body' },
      h('strong', {}, item.label),
      h(
        'small',
        { className: 'ui-muted' },
        `${item.width ?? '?'} × ${item.height ?? '?'} · ${item.ext.toUpperCase()}`,
      ),
      item.provenance
        ? h('span', { className: 'ui-badge ui-badge--neutral' }, `Provenance : ${item.provenance}`)
        : null,
    );
    card.append(check, image, body);
    return card;
  }

  private observeImages(): void {
    const images = [
      ...this.grid.querySelectorAll<HTMLImageElement>('.ui-gallery-card__image[data-src]'),
    ];
    const load = (image: HTMLImageElement): void => {
      this.pendingImages.push(image);
      this.loadNext();
    };
    if (typeof IntersectionObserver === 'undefined') {
      images.slice(0, 6).forEach(load);
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        entries
          .filter((entry) => entry.isIntersecting)
          .forEach((entry) => {
            const image = entry.target as HTMLImageElement;
            this.observer?.unobserve(image);
            load(image);
          });
      },
      { rootMargin: '240px' },
    );
    images.forEach((image) => this.observer?.observe(image));
  }

  private loadNext(): void {
    while (this.activeLoads < 6 && this.pendingImages.length > 0) {
      const image = this.pendingImages.shift();
      if (!image || image.dataset.loaded) continue;
      this.activeLoads += 1;
      image.dataset.loaded = 'true';
      image.addEventListener(
        'load',
        () => {
          this.activeLoads -= 1;
          this.loadNext();
        },
        { once: true },
      );
      image.addEventListener(
        'error',
        () => {
          this.activeLoads -= 1;
          this.loadNext();
        },
        { once: true },
      );
      image.src = image.dataset.src ?? '';
    }
  }
}

export class ImageToolbar {
  readonly element: HTMLElement;
  constructor(onChange: (state: Partial<GalleryFilterState>) => void) {
    const search = h('input', {
      className: 'ui-input',
      type: 'search',
      placeholder: 'Rechercher une URL ou un nom',
      'aria-label': 'Rechercher',
    });
    const provenance = h(
      'select',
      { className: 'ui-select', 'aria-label': 'Filtrer par provenance' },
      h('option', { value: '' }, 'Toutes les provenances'),
      h('option', { value: 'header' }, 'En-tête'),
      h('option', { value: 'footer' }, 'Pied de page'),
      h('option', { value: 'navigation' }, 'Navigation'),
      h('option', { value: 'main' }, 'Contenu principal'),
    );
    const sort = h(
      'select',
      { className: 'ui-select', 'aria-label': 'Trier' },
      h('option', { value: 'page' }, 'Ordre de la page'),
      h('option', { value: 'name' }, 'Nom'),
      h('option', { value: 'width' }, 'Largeur'),
      h('option', { value: 'height' }, 'Hauteur'),
    );
    const size = h('input', {
      type: 'range',
      min: '120',
      max: '260',
      value: '160',
      'aria-label': 'Taille des vignettes',
    });
    const update = (): void =>
      onChange({
        search: search.value,
        provenance: provenance.value,
        sort: sort.value as GalleryFilterState['sort'],
      });
    search.addEventListener('input', update);
    provenance.addEventListener('change', update);
    sort.addEventListener('change', update);
    size.addEventListener('input', () =>
      document.documentElement.style.setProperty('--gallery-min', `${size.value}px`),
    );
    this.element = h(
      'div',
      { className: 'ui-image-toolbar' },
      h('label', { className: 'ui-field' }, h('span', {}, 'Recherche'), search),
      h('label', { className: 'ui-field' }, h('span', {}, 'Provenance'), provenance),
      h('label', { className: 'ui-field' }, h('span', {}, 'Tri'), sort),
      h('label', { className: 'ui-field ui-image-toolbar__size' }, h('span', {}, 'Taille'), size),
    );
  }
}

export function selectionBar(
  selected: number,
  estimatedSize: string,
  onDownload: () => void,
): HTMLElement {
  const bar = h(
    'div',
    { className: 'ui-actions ui-selection-bar' },
    h('span', {}, `${selected} sélectionnée${selected > 1 ? 's' : ''} · ${estimatedSize}`),
    h('button', { className: 'ui-button ui-button--primary', type: 'button' }, 'Télécharger'),
  );
  bar.querySelector('button')?.addEventListener('click', onDownload);
  return bar;
}

export function lightbox(item: GalleryItem, onClose: () => void): HTMLElement {
  const dialog = h('dialog', { className: 'ui-lightbox' });
  const close = h('button', {
    className: 'ui-icon-button',
    type: 'button',
    'aria-label': 'Fermer',
  });
  close.append(icon('close'));
  close.addEventListener('click', onClose);
  dialog.append(
    h('div', { className: 'ui-lightbox__toolbar' }, close),
    h('img', { src: item.url, alt: item.label }),
  );
  return dialog;
}
