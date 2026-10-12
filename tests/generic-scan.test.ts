import { describe, expect, it } from 'vitest';

import { classifyResource } from '../src/modules/generic-scan/classify';
import { exportCsv } from '../src/modules/generic-scan/exports';
import { filterScanItems } from '../src/modules/generic-scan/filters';
import type { ScanItem } from '../src/modules/generic-scan/types';
import { dedupeUrls, getBestSrcsetCandidate, normalizeUrl } from '../src/shared/url-utils';

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
    const { sanitizeDownloadFolder, validateDownloadFolder } = await import('../src/shared/url-utils');

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
