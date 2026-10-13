import { icon } from '../src/ui/icons';

const root = document.documentElement;
for (const target of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  target.replaceChildren(icon(target.dataset.icon as Parameters<typeof icon>[0]));
}

for (const nav of document.querySelectorAll<HTMLElement>('.ui-tabs')) {
  const indicator = document.createElement('span'); indicator.className = 'ui-tabs__indicator'; indicator.setAttribute('aria-hidden', 'true'); nav.prepend(indicator);
  const tabs = [...nav.querySelectorAll<HTMLButtonElement>('.ui-tab')];
  const position = (selected: HTMLButtonElement) => { indicator.style.width = `${selected.offsetWidth}px`; indicator.style.transform = `translateX(${selected.offsetLeft}px)`; };
  const select = (selected: HTMLButtonElement) => { tabs.forEach((tab) => { const active = tab === selected; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }); position(selected); };
  tabs.forEach((tab, index) => { tab.tabIndex = index === 0 ? 0 : -1; tab.addEventListener('click', () => select(tab)); tab.addEventListener('keydown', (event) => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; if (next) { select(next); next.focus(); } }); });
  const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0]; if (selected) requestAnimationFrame(() => position(selected));
}

document.querySelector('#theme')?.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
});
document.querySelector('#dark-theme')?.addEventListener('click', () => { root.dataset.theme = 'dark'; });
document.querySelector('#light-theme')?.addEventListener('click', () => { root.dataset.theme = 'light'; });

const images = Array.from({ length: 8 }, (_, index) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><rect width="480" height="360" fill="hsl(${220 + index * 18} 45% 28%)"/><circle cx="${100 + index * 30}" cy="120" r="72" fill="hsl(${35 + index * 12} 80% 68% / .8)"/><path d="M0 280 150 150l90 85 80-65 160 110v80H0Z" fill="hsl(${160 + index * 8} 45% 42%)"/><text x="24" y="330" fill="white" font-family="sans-serif" font-size="22">Fausse planche ${index + 1}</text></svg>`)}`);
const gallery = document.querySelector('#gallery');
if (gallery) {
  for (const [index, src] of images.entries()) {
    const card = document.createElement('article'); card.className = 'ui-gallery-card';
    const check = document.createElement('button'); check.className = 'ui-gallery-card__check'; check.type = 'button'; check.setAttribute('aria-label', `Sélectionner la planche ${index + 1}`); check.dataset.selected = String(index < 4); check.append(icon('check'));
    const image = document.createElement('img'); image.src = index === 7 ? 'invalid-preview://image' : src; image.alt = `Image fictive ${index + 1}`; image.loading = 'lazy';
    image.addEventListener('error', () => { image.dataset.preview = 'failed'; image.alt = 'Aperçu indisponible'; });
    const body = document.createElement('div'); body.className = 'ui-gallery-card__body';
    const name = document.createElement('strong'); name.textContent = `planche-${String(index + 1).padStart(3, '0')}.jpg`;
    const meta = document.createElement('small'); meta.className = 'ui-muted'; meta.textContent = `${1200 + index * 80} × ${1800 + index * 50} · JPG`;
    body.append(name, meta);
    if (index === 5) { const badge = document.createElement('span'); badge.className = 'ui-badge ui-badge--warning'; badge.textContent = 'Miniature probable'; body.append(badge); }
    if (index === 7) { const badge = document.createElement('span'); badge.className = 'ui-badge ui-badge--danger'; badge.textContent = 'Aperçu indisponible'; body.append(badge); }
    card.append(check, image, body); gallery.append(card);
  }
}
