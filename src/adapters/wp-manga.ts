import { GrandloadError } from '../core/errors';
import type { ChapterMeta, PageKind, PageRef, SiteAdapter } from '../core/types';
import type { SeriesInfo } from '../core/types';
import { getFileExtension, normalizeUrl } from '../shared/url-utils';

export type WpMangaAdapterConfig = {
  id: string;
  hosts: readonly string[];
  baseUrl: string;
  pathPrefix: '/manga' | '/oeuvre';
  seriesSelector: string;
  readerSelector: string;
  titleSuffix: RegExp;
  extraOrigins?: (url: URL) => string[];
};

function chapterNumber(url: string, pathPrefix: string): number | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const escapedPrefix = pathPrefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = pathname.match(new RegExp(`^${escapedPrefix}/[^/]+/chapitre-(\\d+)(?:-(\\d+))?/?$`, 'iu'));
  if (!match) return null;
  const number = Number(match[1]) + (match[2] ? Number(`0.${match[2]}`) : 0);
  return Number.isFinite(number) ? number : null;
}

function cleanTitle(value: string, suffix: RegExp): string {
  return value
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^Lire\s+/iu, '')
    .replace(suffix, '')
    .replace(/\s+(?:Scan\s+FR|Scan)\s*$/iu, '')
    .trim();
}

function workTitle(doc: Document, suffix: RegExp): string {
  const candidates = [
    doc.querySelector('.ori-lec-titre')?.textContent,
    doc.querySelector('[itemprop="name"]')?.textContent,
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content'),
  ];
  const title = candidates
    .map((value) => (value ? cleanTitle(value, suffix) : ''))
    .find((value) => value && !/chapitre\s+\d/iu.test(value));
  return title || cleanTitle(doc.title, suffix) || 'Série';
}

function collectChapterAnchors(doc: Document, config: WpMangaAdapterConfig): HTMLAnchorElement[] {
  const scoped = Array.from(doc.querySelectorAll<HTMLAnchorElement>(`${config.seriesSelector} a[href]`));
  return scoped.length > 0 ? scoped : Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'));
}

function imageSources(image: HTMLImageElement, baseUrl: string): string[] {
  const values = [image.getAttribute('src'), image.getAttribute('data-src')];
  const urls: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) urls.push(trimmed);
  }
  for (const value of [image.getAttribute('data-srcset'), image.getAttribute('srcset')]) {
    if (!value) continue;
    const candidate = value
      .split(',')
      .map((entry) => entry.trim().split(/\s+/u)[0] ?? '')
      .find(Boolean);
    if (candidate) urls.push(candidate);
  }
  return urls
    .map((url) => normalizeUrl(url.trim(), baseUrl))
    .filter((url): url is string => Boolean(url));
}

export function createWpMangaAdapter(config: WpMangaAdapterConfig): SiteAdapter {
  const matchesHost = (hostname: string): boolean => {
    const normalized = hostname.toLowerCase().replace(/^www\./u, '');
    return config.hosts.some((host) => host.replace(/^www\./u, '').toLowerCase() === normalized);
  };
  const classify = (url: URL): PageKind => {
    const path = url.pathname.toLowerCase();
    if (chapterNumber(url.toString(), config.pathPrefix) !== null) return 'chapter';
    if (new RegExp(`^${config.pathPrefix}/[^/]+/?$`, 'iu').test(path)) return 'series';
    return 'other';
  };

  return {
    id: config.id,
    acquisition: 'live-dom',
    matches: (url) => matchesHost(url.hostname),
    classify,
    ...(config.extraOrigins ? { origins: config.extraOrigins } : {}),
    readSeries: (doc): SeriesInfo => {
      const base = doc.baseURI && !/^about:blank$/iu.test(doc.baseURI) ? doc.baseURI : config.baseUrl;
      const chapters = new Map<string, ChapterMeta>();
      for (const anchor of collectChapterAnchors(doc, config)) {
        const href = anchor.getAttribute('href')?.trim();
        if (!href) continue;
        const url = normalizeUrl(href, base);
        const number = url ? chapterNumber(url, config.pathPrefix) : null;
        if (!url || number === null) continue;
        chapters.set(url.split('#')[0] ?? url, { series: workTitle(doc, config.titleSuffix), number, label: `Chapitre ${number}`, });
      }
      return {
        title: workTitle(doc, config.titleSuffix),
        chapters: Array.from(chapters.values())
          .map(({ number, label, series: _series }, index) => ({ number, label, url: Array.from(chapters.keys())[index] ?? '' }))
          .sort((left, right) => left.number - right.number),
      };
    },
    readChapterMeta: (doc, url) => {
      const number = chapterNumber(url, config.pathPrefix) ?? 0;
      return { series: workTitle(doc, config.titleSuffix), number, label: `Chapitre ${number}` };
    },
    readChapterPages: (doc): PageRef[] => {
      const images = Array.from(doc.querySelectorAll<HTMLImageElement>(config.readerSelector));
      if (images.length === 0) {
        throw new GrandloadError('ADAPTER_STRUCTURE', 'Confirme l’âge ou connecte-toi sur le site, puis relance l’analyse.');
      }
      return images.flatMap((image, index) => {
        const url = imageSources(image, doc.baseURI && !/^about:blank$/iu.test(doc.baseURI) ? doc.baseURI : config.baseUrl)[0];
        if (!url) return [];
        return [{ index: index + 1, url, ext: getFileExtension(url), width: Number(image.getAttribute('width')) || image.naturalWidth || 0, height: Number(image.getAttribute('height')) || image.naturalHeight || 0 }];
      });
    },
    countChapterPageElements: (doc) => doc.querySelectorAll(config.readerSelector).length,
    prepareChapter: async (doc) => {
      const { autoScrollUntilStable } = await import('../content/scroll-loader');
      const windowRef = doc.defaultView;
      const count = await autoScrollUntilStable({ document: doc, ...(windowRef ? { windowRef } : {}), pageCountProvider: () => doc.querySelectorAll(config.readerSelector).length, scrollStep: 700, maxScrolls: 10, stabilizationWindow: 2, delayMs: 250 });
      if (count === 0) throw new GrandloadError('ADAPTER_STRUCTURE', 'Confirme l’âge ou connecte-toi sur le site, puis relance l’analyse.');
    },
  };
}
