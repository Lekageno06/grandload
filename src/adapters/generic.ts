import { getFileExtension, normalizeUrl } from '../shared/url-utils';
import type { SiteAdapter } from './types';

function parseChapterNumber(rawText: string): number | null {
  const match = rawText.match(/(\d+)(?:[._-](\d+))?/u);

  if (!match) {
    return null;
  }

  const major = Number.parseFloat(match[1] ?? '0');
  const minor = match[2] ? Number.parseFloat(`0.${match[2]}`) : 0;
  return major + minor;
}

function cleanSeriesTitle(value: string): string {
  return value
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^Lire\s+/iu, '')
    .replace(/\s*-\s*Mangas?\s+Origines\s*$/iu, '')
    .replace(/\s+(?:Scan\s+FR|Scan)\s*$/iu, '')
    .trim();
}

function buildUrlFromAttribute(element: Element, attributes: readonly string[]): string | null {
  for (const attribute of attributes) {
    const value = element.getAttribute(attribute);
    if (value) {
      const base =
        element.ownerDocument?.baseURI && !/^about:blank$/i.test(element.ownerDocument.baseURI)
          ? element.ownerDocument.baseURI
          : 'https://example.invalid';
      const normalized = normalizeUrl(value, base);
      if (normalized) {
        return normalized;
      }

      try {
        return new URL(value, 'https://example.invalid').toString();
      } catch {
        return null;
      }
    }
  }

  return null;
}

function getLargeImageCandidates(doc: Document): HTMLImageElement[] {
  const ignoredSelector =
    'header, footer, nav, aside, svg, script, style, noscript, .ad, .advertisement, .sidebar, .promo';
  const candidates = Array.from(doc.querySelectorAll('img'));

  return candidates.filter((image) => {
    if (image.closest(ignoredSelector)) {
      return false;
    }

    const width = Number.parseInt(image.getAttribute('width') ?? '', 10) || image.naturalWidth || 0;
    const height =
      Number.parseInt(image.getAttribute('height') ?? '', 10) || image.naturalHeight || 0;
    const fallbackArea = width > 0 || height > 0;

    return (
      fallbackArea || image.getAttribute('src') !== null || image.getAttribute('data-src') !== null
    );
  });
}

function chooseDominantContainer(doc: Document): Element | null {
  const containers = new Map<Element, number>();

  for (const image of getLargeImageCandidates(doc)) {
    const container = image.closest(
      'article, main, section, .reader, .chapter, .chapitre, .pages, .page, .manga, .entry-content, .content',
    );
    if (!container) {
      continue;
    }

    const count = containers.get(container) ?? 0;
    containers.set(container, count + 1);
  }

  if (containers.size === 0) {
    return doc.body ?? null;
  }

  const [bestContainer] =
    Array.from(containers.entries()).sort((left, right) => right[1] - left[1])[0] ?? [];
  return bestContainer ?? doc.body ?? null;
}

const genericAdapter: SiteAdapter = {
  id: 'generic',
  acquisition: 'live-dom',
  matches: (url) => /^https?:\/\//i.test(url.toString()),
  excludePatterns: [/(?:banner|banniere|discord|logo|avatar|credit|recrutement|promo)/iu],
  autoExclude: (page) => {
    if (page.width !== undefined && page.width > 0 && page.width < 200) {
      return 'Largeur < 200 px (trop petite)';
    }
    if (/(?:banner|banniere|discord|logo|avatar|credit|recrutement|promo)/iu.test(page.url)) {
      return 'Motif de bannière/promo détecté';
    }
    return null;
  },
  classify: (url) => {
    const pathname = url.pathname.toLowerCase();
    if (
      /\/oeuvre\/[^/]+\/chapitre-[\d-]+\/?$/.test(pathname) ||
      /\/chapter\/[\d.-]+\/?$/.test(pathname)
    ) {
      return 'chapter';
    }

    if (
      /\/oeuvre\/[^/]+\/?$/.test(pathname) ||
      /\/(manga|manhwa|comic|chapters?)\/?$/.test(pathname)
    ) {
      return 'series';
    }

    return 'other';
  },
  readSeries: (doc) => {
    const chapters = new Map<string, { number: number; label: string; url: string }>();

    for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
      const href = anchor.getAttribute('href');
      const sourceUrl = href
        ? normalizeUrl(
            href,
            doc.baseURI && !/^about:blank$/i.test(doc.baseURI)
              ? doc.baseURI
              : 'https://example.invalid',
          )
        : null;
      if (!sourceUrl) {
        continue;
      }

      const number = parseChapterNumber(sourceUrl) ?? parseChapterNumber(anchor.textContent ?? '');
      if (number === null) {
        continue;
      }

      const label = anchor.textContent?.trim() || `Chapitre ${number}`;
      if (!chapters.has(sourceUrl)) {
        chapters.set(sourceUrl, { number, label, url: sourceUrl });
      }
    }

    return {
      title:
        cleanSeriesTitle(doc.querySelector('[itemprop="name"]')?.textContent || doc.title) ||
        'Série',
      chapters: Array.from(chapters.values()).sort((left, right) => left.number - right.number),
    };
  },
  readChapterMeta: (doc, url) => {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/(?:chapitre|chapter)[-/](\d+)(?:[-.]([0-9]+))?/iu);
    const number = match?.[1] ? Number(match[1]) + (match[2] ? Number(`0.${match[2]}`) : 0) : 0;
    const cleaned = (doc.querySelector('[itemprop="name"]')?.textContent || doc.title || 'Série')
      .replace(/\s+/gu, ' ')
      .trim()
      .replace(/^Lire\s+/iu, '')
      .replace(/\s+(?:Scan\s+FR|Scan)\s*$/iu, '')
      .replace(/\s*-\s*Mangas?\s+Origines\s*$/iu, '')
      .trim();
    return { series: cleaned || 'Série', number, label: `Chapitre ${number}` };
  },
  readChapterPages: (doc) => {
    const container = chooseDominantContainer(doc);
    const candidates: HTMLImageElement[] = container
      ? Array.from(container.querySelectorAll('img'))
      : Array.from(doc.querySelectorAll('img'));

    const pages = candidates
      .filter(
        (image) =>
          !image.closest(
            'header, footer, nav, aside, svg, script, style, noscript, .ad, .advertisement, .sidebar, .promo',
          ),
      )
      .map((image) => {
        const sourceUrl =
          buildUrlFromAttribute(image, [
            'src',
            'data-src',
            'data-lazy-src',
            'data-original',
            'srcset',
          ]) ?? '';
        if (!sourceUrl) {
          return null;
        }

        const width =
          Number.parseInt(image.getAttribute('width') ?? '', 10) || image.naturalWidth || 0;
        if (
          width > 0 &&
          width < 300 &&
          !image.closest('.reader, .chapter, .chapitre, .page, .pages')
        ) {
          return null;
        }

        return {
          index: 0,
          url: sourceUrl,
          ext: getFileExtension(sourceUrl),
          width,
          height:
            Number.parseInt(image.getAttribute('height') ?? '', 10) || image.naturalHeight || 0,
        };
      })
      .filter((page): page is NonNullable<typeof page> => page !== null);

    return pages.map((page, index) => ({ ...page, index }));
  },
  countChapterPageElements: (doc) => {
    const container = chooseDominantContainer(doc);
    return (container ?? doc).querySelectorAll('img').length;
  },
};

export { genericAdapter };
