import { icon } from '../src/ui/icons';
import {
  ImageGallery,
  ImageToolbar,
  lightbox,
  selectionBar,
  type GalleryItem,
} from '../src/ui/components/gallery';

const root = document.documentElement;
for (const target of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  target.replaceChildren(icon(target.dataset.icon as Parameters<typeof icon>[0]));
}

for (const nav of document.querySelectorAll<HTMLElement>('.ui-tabs')) {
  const indicator = document.createElement('span');
  indicator.className = 'ui-tabs__indicator';
  indicator.setAttribute('aria-hidden', 'true');
  nav.prepend(indicator);
  const tabs = [...nav.querySelectorAll<HTMLButtonElement>('.ui-tab')];
  const position = (selected: HTMLButtonElement) => {
    indicator.style.width = `${selected.offsetWidth}px`;
    indicator.style.transform = `translateX(${selected.offsetLeft}px)`;
  };
  const select = (selected: HTMLButtonElement) => {
    tabs.forEach((tab) => {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    position(selected);
  };
  tabs.forEach((tab, index) => {
    tab.tabIndex = index === 0 ? 0 : -1;
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next =
        tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      if (next) {
        select(next);
        next.focus();
      }
    });
  });
  const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0];
  if (selected) requestAnimationFrame(() => position(selected));
}

document.querySelector('#theme')?.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
});
document.querySelector('#dark-theme')?.addEventListener('click', () => {
  root.dataset.theme = 'dark';
});
document.querySelector('#light-theme')?.addEventListener('click', () => {
  root.dataset.theme = 'light';
});

const images: GalleryItem[] = Array.from({ length: 24 }, (_, index) => ({
  id: String(index + 1),
  url:
    index === 7
      ? 'invalid-preview://image'
      : `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><rect width="480" height="360" fill="hsl(${220 + index * 18} 45% 28%)"/><circle cx="${100 + index * 12}" cy="120" r="72" fill="hsl(${35 + index * 12} 80% 68% / .8)"/><path d="M0 280 150 150l90 85 80-65 160 110v80H0Z" fill="hsl(${160 + index * 8} 45% 42%)"/></svg>`)}`,
  label: `planche-${String(index + 1).padStart(3, '0')}.jpg`,
  ext: 'jpg',
  width: 1200 + index * 80,
  height: 1800 + index * 50,
  selected: index < 4,
  provenance: index % 5 === 0 ? 'header' : 'main',
}));
const gallery = document.querySelector('#gallery');
if (gallery) {
  const toolbar = new ImageToolbar((state) => galleryView.setFilters(state));
  gallery.parentElement?.insertBefore(toolbar.element, gallery);
  const galleryView = new ImageGallery(images, {
    onSelectionChange: (selected) => {
      selection.textContent = `${selected.length} sélectionnées`;
    },
  });
  gallery.replaceWith(galleryView.element);
  const selection = document.createElement('strong');
  selection.className = 'ui-stat';
  selection.textContent = '4 sélectionnées';
  const bar = selectionBar(4, '8,4 Mo estimés', () => alert('Feuille de téléchargement fictive'));
  bar
    .querySelector('span')
    ?.replaceChildren(selection, document.createTextNode(' · 8,4 Mo estimés'));
  galleryView.element.after(bar);
  const twoThousand = document.createElement('button');
  twoThousand.className = 'ui-button ui-button--secondary';
  twoThousand.type = 'button';
  twoThousand.textContent = 'Tester 2 000 vignettes';
  twoThousand.addEventListener('click', () =>
    galleryView.setItems(
      Array.from({ length: 2000 }, (_, index) => ({
        ...images[index % images.length]!,
        id: String(index + 1),
        label: `planche-${index + 1}.jpg`,
      })),
    ),
  );
  toolbar.element.append(twoThousand);
  const lightboxButton = document.createElement('button');
  lightboxButton.className = 'ui-button ui-button--ghost';
  lightboxButton.type = 'button';
  lightboxButton.textContent = 'Ouvrir la lightbox';
  lightboxButton.addEventListener('click', () => {
    const dialog = lightbox(images[0]!, () => dialog.close());
    document.body.append(dialog);
    dialog.showModal();
  });
  toolbar.element.append(lightboxButton);
}
