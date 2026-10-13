import { classifyResource } from '../modules/generic-scan/classify';
import { getBestSrcsetCandidate, getBaseNameFromUrl, normalizeUrl } from '../shared/url-utils';
import type { AssetProvenance, ScanItem, ScanSource } from '../modules/generic-scan/types';

export function getImageProvenance(image: Element): AssetProvenance {
  if (image.closest('header')) return 'header';
  if (image.closest('footer')) return 'footer';
  if (image.closest('nav, [role="navigation"], .main-navigation_wrap, .wrap_branding')) {
    return 'navigation';
  }
  if (image.closest('main, [role="main"]')) return 'main';
  return 'content';
}

function addCandidate(
  items: Map<string, ScanItem>,
  rawUrl: string,
  source: ScanSource,
  pageUrl: string,
  overrideLabel?: string,
  provenance?: AssetProvenance,
  dimensions?: { width?: number; height?: number },
): void {
  const normalized = normalizeUrl(rawUrl, pageUrl);

  if (!normalized) {
    return;
  }

  const ext = (normalized.split('?')[0] ?? normalized).split('/').pop() ?? '';
  const label = (overrideLabel ?? getBaseNameFromUrl(normalized) ?? ext) || 'resource';

  items.set(normalized, {
    id: normalized,
    url: normalized,
    type: classifyResource(normalized, source),
    ext: ext.includes('.') ? (ext.split('.').pop() ?? '') : '',
    label,
    source,
    ...(provenance ? { provenance } : {}),
    ...(dimensions?.width ? { width: dimensions.width } : {}),
    ...(dimensions?.height ? { height: dimensions.height } : {}),
  });
}

function readStyleUrls(node: Element): string[] {
  const matches = new Set<string>();
  const style = node.getAttribute('style') ?? '';
  const regex = /url\((['"]?)(.*?)\1\)/giu;

  for (const match of style.matchAll(regex)) {
    const value = match[2];
    if (value) {
      matches.add(value);
    }
  }

  return Array.from(matches);
}

export function readPageAssets(doc: Document, pageUrl: string): ScanItem[] {
  const items = new Map<string, ScanItem>();

  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href');
    if (!href) {
      continue;
    }

    addCandidate(items, href, 'a', pageUrl, anchor.textContent?.trim() || getBaseNameFromUrl(href));
  }

  for (const img of Array.from(
    doc.querySelectorAll('img[src], img[data-src], img[data-original], img[data-lazy-src]'),
  )) {
    const candidates = [
      img.getAttribute('src'),
      img.getAttribute('data-src'),
      img.getAttribute('data-original'),
      img.getAttribute('data-lazy-src'),
      img.getAttribute('srcset') ? getBestSrcsetCandidate(img.getAttribute('srcset') ?? '') : null,
    ];

    for (const candidate of candidates) {
      if (candidate) {
        addCandidate(
          items,
          candidate,
          'img',
          pageUrl,
          img.getAttribute('alt') || getBaseNameFromUrl(candidate),
          getImageProvenance(img),
          {
            width: Number(img.getAttribute('width')) || (img as HTMLImageElement).naturalWidth,
            height: Number(img.getAttribute('height')) || (img as HTMLImageElement).naturalHeight,
          },
        );
      }
    }
  }

  for (const source of Array.from(
    doc.querySelectorAll(
      'source[src], source[data-src], source[data-srcset], picture source[srcset]',
    ),
  )) {
    const rawSrcset = source.getAttribute('srcset') ?? source.getAttribute('src') ?? '';
    const best = rawSrcset.includes(',') ? getBestSrcsetCandidate(rawSrcset) : rawSrcset;

    if (best) {
      addCandidate(items, best, 'source', pageUrl, getBaseNameFromUrl(best));
    }
  }

  for (const media of Array.from(
    doc.querySelectorAll('video[src], audio[src], video source[src], audio source[src]'),
  )) {
    const sourceUrl = media.getAttribute('src') ?? media.getAttribute('data-src') ?? '';
    if (sourceUrl) {
      addCandidate(
        items,
        sourceUrl,
        media.tagName.toLowerCase() as ScanSource,
        pageUrl,
        getBaseNameFromUrl(sourceUrl),
      );
    }
  }

  for (const link of Array.from(doc.querySelectorAll('link[href]'))) {
    const href = link.getAttribute('href');
    if (href) {
      addCandidate(
        items,
        href,
        'link',
        pageUrl,
        link.getAttribute('rel') || getBaseNameFromUrl(href),
      );
    }
  }

  for (const meta of Array.from(
    doc.querySelectorAll(
      'meta[property="og:image"], meta[property="og:video"], meta[name="twitter:image"]',
    ),
  )) {
    const content = meta.getAttribute('content');
    if (content) {
      addCandidate(items, content, 'meta', pageUrl, 'Meta media');
    }
  }

  for (const iframe of Array.from(doc.querySelectorAll('iframe[src]'))) {
    const src = iframe.getAttribute('src');
    if (src) {
      addCandidate(items, src, 'iframe', pageUrl, 'Iframe');
    }
  }

  for (const node of Array.from(doc.querySelectorAll('[style]'))) {
    for (const styleUrl of readStyleUrls(node)) {
      addCandidate(items, styleUrl, 'style', pageUrl, 'Background image');
    }
  }

  return Array.from(items.values()).sort((left, right) => left.label.localeCompare(right.label));
}
