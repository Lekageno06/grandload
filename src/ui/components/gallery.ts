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
  badge?: string;
  likelyThumbnail?: boolean;
  duplicateCount?: number;
};

export type GalleryFilterState = {
  search: string;
  provenance: string;
  sort: 'page' | 'name' | 'width' | 'height' | 'surface' | 'type';
  descending: boolean;
  minWidth?: number;
  minHeight?: number;
  hideLikelyThumbnails?: boolean;
  hideDuplicates?: boolean;
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

function filteredItems(
  items: readonly GalleryItem[],
  state: GalleryFilterState,
  ordered = false,
): GalleryItem[] {
  const query = state.search.trim().toLowerCase();
  const result = items.filter(
    (item) =>
      (!query || `${item.label} ${item.url}`.toLowerCase().includes(query)) &&
      (!state.provenance || item.provenance === state.provenance) &&
      (!state.minWidth || (item.width ?? 0) >= state.minWidth) &&
      (!state.minHeight || (item.height ?? 0) >= state.minHeight) &&
      (!state.hideLikelyThumbnails || !item.likelyThumbnail) &&
      (!state.hideDuplicates || (item.duplicateCount ?? 1) <= 1),
  );
  if (ordered) return result;
  return result.sort((left, right) => {
    const values =
      state.sort === 'name'
        ? left.label.localeCompare(right.label)
        : state.sort === 'width'
          ? (left.width ?? 0) - (right.width ?? 0)
          : state.sort === 'height'
            ? (left.height ?? 0) - (right.height ?? 0)
            : state.sort === 'surface'
              ? (left.width ?? 0) * (left.height ?? 0) - (right.width ?? 0) * (right.height ?? 0)
              : state.sort === 'type'
                ? left.ext.localeCompare(right.ext)
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
  private readonly onOpen: ((item: GalleryItem) => void) | undefined;
  private readonly ordered: boolean;

  constructor(
    items: readonly GalleryItem[],
    options: {
      onSelectionChange?: (items: GalleryItem[]) => void;
      onOpen?: (item: GalleryItem) => void;
      ordered?: boolean;
    } = {},
  ) {
    this.items = [...items];
    this.onSelectionChange = options.onSelectionChange;
    this.onOpen = options.onOpen;
    this.ordered = options.ordered ?? false;
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
    return filteredItems(this.items, this.state, this.ordered);
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
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.addEventListener('click', () => this.onOpen?.(item));
    image.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.onOpen?.(item);
      }
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
      item.badge ? h('span', { className: 'ui-badge ui-badge--warning' }, item.badge) : null,
      item.duplicateCount && item.duplicateCount > 1
        ? h('span', { className: 'ui-badge ui-badge--neutral' }, `${item.duplicateCount} doublons`)
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
      h('option', { value: 'surface' }, 'Surface'),
      h('option', { value: 'type' }, 'Type'),
    );
    const minWidth = h('input', { className: 'ui-input', type: 'number', min: '0', placeholder: 'Largeur min', 'aria-label': 'Largeur minimale' });
    const minHeight = h('input', { className: 'ui-input', type: 'number', min: '0', placeholder: 'Hauteur min', 'aria-label': 'Hauteur minimale' });
    const hideThumbnails = h('input', { type: 'checkbox', 'aria-label': 'Masquer les miniatures probables' });
    const hideDuplicates = h('input', { type: 'checkbox', 'aria-label': 'Masquer les doublons' });
    const descending = h('input', { type: 'checkbox', 'aria-label': 'Tri décroissant' });
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
        descending: descending.checked,
        minWidth: Number(minWidth.value) || 0,
        minHeight: Number(minHeight.value) || 0,
        hideLikelyThumbnails: hideThumbnails.checked,
        hideDuplicates: hideDuplicates.checked,
      });
    search.addEventListener('input', update);
    provenance.addEventListener('change', update);
    sort.addEventListener('change', update);
    minWidth.addEventListener('input', update);
    minHeight.addEventListener('input', update);
    hideThumbnails.addEventListener('change', update);
    hideDuplicates.addEventListener('change', update);
    descending.addEventListener('change', update);
    size.addEventListener('input', () =>
      document.documentElement.style.setProperty('--gallery-min', `${size.value}px`),
    );
    this.element = h(
      'div',
      { className: 'ui-image-toolbar' },
      h('label', { className: 'ui-field' }, h('span', {}, 'Recherche'), search),
      h('label', { className: 'ui-field' }, h('span', {}, 'Provenance'), provenance),
      h('label', { className: 'ui-field' }, h('span', {}, 'Tri'), sort),
      h('label', { className: 'ui-field' }, h('span', {}, 'Dimensions'), minWidth),
      h('label', { className: 'ui-field' }, h('span', {}, ' '), minHeight),
      h('label', { className: 'ui-field' }, hideThumbnails, h('span', {}, 'Masquer miniatures')),
      h('label', { className: 'ui-field' }, hideDuplicates, h('span', {}, 'Masquer doublons')),
      h('label', { className: 'ui-field' }, descending, h('span', {}, 'Décroissant')),
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
