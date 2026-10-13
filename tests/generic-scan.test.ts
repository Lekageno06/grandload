import { describe, expect, it } from 'vitest';

import { classifyResource } from '../src/modules/generic-scan/classify';
import { exportCsv } from '../src/modules/generic-scan/exports';
import { filterScanItems } from '../src/modules/generic-scan/filters';
import { readPageAssets } from '../src/content/dom-reader';
import {
  archiveWarning,
  estimateArchiveBytes,
  getScanStateMessage,
} from '../src/modules/generic-scan/state';
import { genericAdapter } from '../src/adapters/generic';
import type { ScanItem } from '../src/modules/generic-scan/types';
import { JSDOM } from 'jsdom';
import { dedupeUrls, getBestSrcsetCandidate, normalizeUrl } from '../src/shared/url-utils';

describe('états du scan générique', () => {
  it('couvre l’attente, le chargement, les résultats, l’absence, l’erreur et l’autorisation', () => {
    expect(getScanStateMessage('idle')).toBe('Aucun scan lancé.');
    expect(getScanStateMessage('loading')).toBe('Scan en cours…');
    expect(getScanStateMessage('results', 3)).toBe('3 ressource(s) détectée(s).');
    expect(getScanStateMessage('empty')).toBe('Aucun résultat.');
    expect(getScanStateMessage('error')).toBe('Erreur pendant le scan.');
    expect(getScanStateMessage('permission')).toContain('Autorisation requise');
  });

  it('avertit au-delà de 50 fichiers ou 300 Mo estimés', () => {
    const items: ScanItem[] = Array.from({ length: 51 }, (_, index) => ({
      id: String(index),
      url: `https://example.test/${index}.jpg`,
      type: 'image',
      ext: 'jpg',
      label: String(index),
      source: 'img',
    }));
    expect(archiveWarning(items)).toContain('50');
    const large: ScanItem = { ...items[0]!, width: 10000, height: 10000 };
    expect(estimateArchiveBytes([large])).toBe(400000000);
    expect(archiveWarning([large])).toContain('300');
  });
});

describe('url-utils', () => {
  it('accepts only http and https URLs and strips fragments during dedupe', () => {
    expect(normalizeUrl('javascript:alert(1)', 'https://example.com')).toBeNull();
    expect(normalizeUrl('/path/image.png#fragment', 'https://example.com/base/')).toBe(
      'https://example.com/path/image.png',
    );
    expect(
      dedupeUrls(['https://example.com/a#1', 'https://example.com/a', 'https://example.com/b']),
    ).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('keeps the highest resolution candidate in a srcset', () => {
    expect(getBestSrcsetCandidate('a.jpg 1x, b.jpg 2x, c.jpg 3x')).toBe('c.jpg');
  });

  it('rejects unsafe download folder paths and accepts sanitized relative names', async () => {
    const { sanitizeDownloadFolder, validateDownloadFolder } =
      await import('../src/shared/url-utils');

    expect(validateDownloadFolder('Mangas 2026').valid).toBe(true);
    expect(sanitizeDownloadFolder('Mangas 2026')).toBe('Mangas 2026');
    expect(validateDownloadFolder('%2e%2e/Downloads').valid).toBe(false);
    expect(validateDownloadFolder('%2froot').valid).toBe(false);
    expect(validateDownloadFolder('C:\\Downloads').valid).toBe(false);
    expect(validateDownloadFolder('a'.repeat(151)).valid).toBe(false);
    expect(validateDownloadFolder('Manga:Test').valid).toBe(false);
    expect(sanitizeDownloadFolder('../escape')).toBe('Grandload');
  });
});

describe('classification', () => {
  it('classifies by extension and then by tag when needed', () => {
    expect(classifyResource('https://example.com/picture.jpg', 'img')).toBe('image');
    expect(classifyResource('https://example.com/chapitre-129-5.pdf', 'a')).toBe('document');
    expect(classifyResource('https://example.com/stream.m3u8', 'video')).toBe('video');
    expect(classifyResource('https://example.com/page', 'a')).toBe('link');
  });
});

describe('titre générique', () => {
  it('nettoie le titre de document avant de l’utiliser comme nom de série', () => {
    const document = new JSDOM('<title>Lire Série Exemple Scan FR - Mangas Origines</title>', {
      url: 'https://example.test/oeuvre/serie/',
    }).window.document;

    expect(genericAdapter.readSeries(document).title).toBe('Série Exemple');
  });
});

describe('lecture DOM unique et provenance des images', () => {
  it('conserve logo, icône et miniature avec leur provenance', () => {
    const document = new JSDOM(
      `
      <header><img src="/logo.png" alt="Logo"></header>
      <nav><img src="/icon.png" alt="Icône"></nav>
      <main><img src="/cover.jpg" alt="Couverture" width="640" height="960"></main>
    `,
      { url: 'https://example.test/page' },
    ).window.document;
    const images = readPageAssets(document, document.location.href).filter(
      (item) => item.type === 'image',
    );

    expect(images).toHaveLength(3);
    expect(images.map((item) => item.provenance).sort()).toEqual(['header', 'main', 'navigation']);
    expect(images.find((item) => item.label === 'Couverture')).toMatchObject({
      width: 640,
      height: 960,
    });
  });

  it('détecte les sources d’images avancées et garde la meilleure URL', () => {
    const document = new JSDOM(
      `
      <main>
        <img src=" /low.jpg " srcset="/low.jpg 1x, /high.jpg 2x" data-lazy-src="/lazy.jpg">
        <picture><source srcset="/picture-small.webp 1x, /picture-large.webp 2x"></picture>
        <video poster=" /poster.jpg "></video>
        <svg><use href="/sprite.svg#icon"></use></svg>
        <div style="background-image: url('/inline.jpg')"></div>
        <meta property="og:image" content=" /og.jpg ">
        <link rel="icon" href=" /favicon.ico ">
      </main>
      `,
      { url: 'https://example.test/page' },
    ).window.document;

    const images = readPageAssets(document, document.location.href).filter((item) => item.type === 'image');
    expect(images.map((item) => item.url)).toEqual(expect.arrayContaining([
      'https://example.test/high.jpg',
      'https://example.test/picture-large.webp',
      'https://example.test/poster.jpg',
      'https://example.test/sprite.svg',
      'https://example.test/inline.jpg',
      'https://example.test/og.jpg',
      'https://example.test/favicon.ico',
    ]));
    expect(images.find((item) => item.url.endsWith('/favicon.ico'))?.source).toBe('icon');
    expect(images.find((item) => item.url.endsWith('/poster.jpg'))?.source).toBe('poster');
  });
});

describe('filters', () => {
  const items: ScanItem[] = [
    {
      id: 'image-1',
      url: 'https://example.com/img/hero.png',
      type: 'image',
      ext: 'png',
      label: 'Hero',
      source: 'img',
    },
    {
      id: 'image-2',
      url: 'https://example.com/img/cover.jpg',
      type: 'image',
      ext: 'jpg',
      label: 'Cover',
      source: 'img',
    },
    {
      id: 'link-1',
      url: 'https://example.com/about',
      type: 'link',
      ext: '',
      label: 'About',
      source: 'a',
    },
  ];

  it('applies type, extension and text filters cumulatively', () => {
    expect(
      filterScanItems(items, {
        type: 'image',
        extension: 'png',
        text: 'hero',
      }),
    ).toEqual([items[0]]);
  });
});

describe('export', () => {
  it('writes a CSV with escaped quotes and the expected columns', () => {
    const items: ScanItem[] = [
      {
        id: '1',
        url: 'https://example.com/catalog/image.png',
        type: 'image',
        ext: 'png',
        label: 'A "test" image',
        source: 'img',
      },
    ];

    expect(exportCsv(items)).toBe(
      [
        'url,type,ext,source,label',
        'https://example.com/catalog/image.png,image,png,img,"A ""test"" image"',
      ].join('\n'),
    );
  });
});
