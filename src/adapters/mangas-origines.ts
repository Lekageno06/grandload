import { getFileExtension, normalizeUrl } from '../shared/url-utils';
import type { SiteAdapter } from './types';

function getChapterNumberFromUrl(url: string): number | null {
  let pathname: string;

  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  const match = pathname.match(/^\/oeuvre\/[^/]+\/chapitre-(\d+)(?:-(\d+))?\/?$/iu);
  if (!match) {
    return null;
  }

  const major = Number(match[1]);
  const minor = match[2] ? Number(`0.${match[2]}`) : 0;
  const number = major + minor;
  return Number.isFinite(number) ? number : null;
}

function normalizeChapterLabel(value: string): string {
  return value
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\s+Ch\.\s*\d+(?:[.-]\d+)?\s*$/iu, '')
    .trim();
}

function cleanWorkTitle(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().replace(/^Lire\s+/iu, '').replace(/\s+(?:Scan\s+FR|Scan)\s*$/iu, '').replace(/\s*-\s*Mangas?\s+Origines\s*$/iu, '').trim();
}

function readWorkTitle(doc: Document): string {
  const candidates = [
    doc.querySelector('.ori-lec-titre')?.textContent,
    doc.querySelector('[itemprop="name"]')?.textContent,
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content'),
  ];
  const title = candidates.map((value) => (value ? cleanWorkTitle(value) : '')).find((value) => value && !/chapitre\s+\d/iu.test(value));
  return title || cleanWorkTitle(doc.title) || 'Série';
}

function collectChapters(
  anchors: HTMLAnchorElement[],
  base: string,
): Map<string, { number: number; labels: string[]; url: string }> {
  const chapters = new Map<string, { number: number; labels: string[]; url: string }>();

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href');
    if (!href) {
      continue;
    }

    const normalized = normalizeUrl(href.trim(), base);
    if (!normalized) {
      continue;
    }

    const number = getChapterNumberFromUrl(normalized);
    if (number === null) {
      continue;
    }

    const chapter = chapters.get(normalized) ?? { number, labels: [], url: normalized };
    chapter.labels.push(normalizeChapterLabel(anchor.textContent ?? ''));
    chapters.set(normalized, chapter);
  }

  return chapters;
}

function getReaderImages(doc: Document): HTMLImageElement[] {
  const preciseMatches = Array.from(
    doc.querySelectorAll<HTMLImageElement>(
      '.ori-lec-scene .reading-content .page-break img.wp-manga-chapter-img',
    ),
  );
  return preciseMatches.length > 0
    ? preciseMatches
    : Array.from(doc.querySelectorAll<HTMLImageElement>('img.wp-manga-chapter-img'));
}

function buildImageSources(image: HTMLImageElement): string[] {
  const sourceValues = [
    image.getAttribute('src'),
    image.getAttribute('data-src'),
    image.getAttribute('data-lazy-src'),
    image.getAttribute('data-original'),
    image.getAttribute('data-srcset') ?? '',
    image.getAttribute('srcset') ?? '',
  ];

  const urls: string[] = [];

  for (const value of sourceValues) {
    if (!value) {
      continue;
    }

    if (value.includes(',')) {
      const candidates = value.split(',');
      for (const candidate of candidates) {
        const maybeUrl = candidate.trim().split(/\s+/u)[0];
        if (maybeUrl) {
          urls.push(maybeUrl);
        }
      }
      continue;
    }

    urls.push(value);
  }

  return urls
    .map((rawUrl) => {
      const base =
        image.ownerDocument?.baseURI && !/^about:blank$/i.test(image.ownerDocument.baseURI)
          ? image.ownerDocument.baseURI
          : 'https://mangas-origines.fr';
      return normalizeUrl(rawUrl, base);
    })
    .filter((value): value is string => value !== null);
}

const mangasOriginesAdapter: SiteAdapter = {
  id: 'mangas-origines',
  acquisition: 'live-dom',
  countChapterPageElements: (doc) => getReaderImages(doc).length,
  matches: (url) => url.hostname.toLowerCase() === 'mangas-origines.fr',
  excludePatterns: [
    /(?:banner|banniere|discord|logo|avatar|credit|recrutement|promo)/iu,
  ],
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
    if (/^\/oeuvre\/[^/]+\/chapitre-\d+(?:-\d+)?\/?$/u.test(pathname)) {
      return 'chapter';
    }

    if (/\/oeuvre\/[^/]+\/?$/.test(pathname)) {
      return 'series';
    }

    return 'other';
  },
  readSeries: (doc) => {
    const base =
      doc.baseURI && !/^about:blank$/i.test(doc.baseURI)
        ? doc.baseURI
        : 'https://mangas-origines.fr';
    const rowAnchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.ori-chl-row a[href]'));
    const rowChapters = collectChapters(rowAnchors, base);
    const chapters =
      rowChapters.size > 0
        ? rowChapters
        : collectChapters(Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]')), base);

    return {
      title: readWorkTitle(doc),
      chapters: Array.from(chapters.values())
        .map(({ number, labels, url }) => ({
          number,
          label: labels.find((label) => /^Chapitre\b/u.test(label)) || `Chapitre ${number}`,
          url,
        }))
        .sort((left, right) => left.number - right.number),
    };
  },
  readChapterMeta: (doc, url) => {
    const number = getChapterNumberFromUrl(url) ?? 0;
    return { series: readWorkTitle(doc), number, label: `Chapitre ${number}` };
  },
  readChapterPages: (doc) => {
    const pages = getReaderImages(doc)
      .map((image, index) => {
        const sources = buildImageSources(image);
        if (sources.length === 0) {
          return null;
        }

        const url = sources[0];
        if (!url) {
          return null;
        }

        return {
          index,
          url,
          ext: getFileExtension(url),
          width: Number.parseInt(image.getAttribute('width') ?? '', 10) || image.naturalWidth || 0,
          height:
            Number.parseInt(image.getAttribute('height') ?? '', 10) || image.naturalHeight || 0,
        };
      })
      .filter((page): page is NonNullable<typeof page> => page !== null);

    return pages.map((page, index) => ({ ...page, index: index + 1 }));
  },
  prepareChapter: async (doc) => {
    const { autoScrollUntilStable } = await import('../content/scroll-loader');
    const windowRef = doc.defaultView;
    const count = await autoScrollUntilStable({
      document: doc,
      ...(windowRef ? { windowRef } : {}),
      pageCountProvider: () => {
        return getReaderImages(doc).length;
      },
      scrollStep: 700,
      maxScrolls: 10,
      stabilizationWindow: 2,
      delayMs: 250,
    });

    if (count === 0) {
      throw new Error('Aucune image détectée dans le chapitre.');
    }
  },
};

export { getChapterNumberFromUrl, mangasOriginesAdapter };
