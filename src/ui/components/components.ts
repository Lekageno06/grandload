import { h } from '../dom.js';
import { icon } from '../icons.js';

export function button(label: string, variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary'): HTMLButtonElement { return h('button', { className: `ui-button ui-button--${variant}`, type: 'button' }, label); }
export function iconButton(name: Parameters<typeof icon>[0], label: string): HTMLButtonElement { const b = h('button', { className: 'ui-icon-button', type: 'button', title: label, 'aria-label': label }); b.append(icon(name)); return b; }
export function badge(label: string, tone = ''): HTMLSpanElement { return h('span', { className: `ui-badge ${tone ? `ui-badge--${tone}` : ''}` }, label); }
export function tabs(labels: string[]): HTMLElement {
  const nav = h('div', { className: 'ui-tabs', role: 'tablist' });
  const indicator = h('span', { className: 'ui-tabs__indicator', 'aria-hidden': 'true' });
  nav.append(indicator);
  labels.forEach((label, index) => {
    const tab = h('button', { className: 'ui-tab', role: 'tab', 'aria-selected': index === 0 ? 'true' : 'false', type: 'button', tabIndex: index === 0 ? 0 : -1 }, label);
    tab.addEventListener('click', () => selectTab(nav, tab));
    tab.addEventListener('keydown', (event) => moveTab(event, nav, tab));
    nav.append(tab);
  });
  requestAnimationFrame(() => positionIndicator(nav));
  return nav;
}

function selectTab(nav: HTMLElement, selected: HTMLElement): void {
  for (const tab of nav.querySelectorAll<HTMLElement>('.ui-tab')) { const active = tab === selected; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }
  positionIndicator(nav);
}

function positionIndicator(nav: HTMLElement): void {
  const selected = nav.querySelector<HTMLElement>('.ui-tab[aria-selected="true"]');
  const indicator = nav.querySelector<HTMLElement>('.ui-tabs__indicator');
  if (selected && indicator) { indicator.style.width = `${selected.offsetWidth}px`; indicator.style.transform = `translateX(${selected.offsetLeft}px)`; }
}

function moveTab(event: KeyboardEvent, nav: HTMLElement, current: HTMLElement): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const tabs = [...nav.querySelectorAll<HTMLElement>('.ui-tab')];
  const index = tabs.indexOf(current); const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
  if (next) { selectTab(nav, next); next.focus(); }
}
export function galleryCard(url: string, name: string, meta: string, selected: boolean): HTMLElement { const card = h('article', { className: 'ui-gallery-card' }); const check = h('span', { className: 'ui-gallery-card__check', 'data-selected': String(selected), 'aria-hidden': 'true' }); check.append(icon('check')); card.append(check, h('img', { src: url, alt: name, loading: 'lazy' }), h('div', { className: 'ui-gallery-card__body' }, h('strong', {}, name), h('small', { className: 'ui-muted' }, meta))); return card; }
export function emptyState(message: string): HTMLElement { const section = h('div', { className: 'ui-empty' }); section.append(icon('image'), h('p', {}, message)); return section; }
