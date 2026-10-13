import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { hentaiOriginesAdapter } from '../src/adapters/private/hentai-origines';
import { hentaiScantradAdapter } from '../src/adapters/private/hentai-scantrad';

function fixture(site: string, name: string): Document {
  const path = fileURLToPath(new URL(`./fixtures/${site}/${name}`, import.meta.url));
  const html = readFileSync(path, 'utf8');
  return new JSDOM(html, { url: site === 'hentai-origines' ? 'https://hentai-origines.com/manga/stop-smoking/' : 'https://hentai-scantrad.org/manga/example/' }).window.document;
}

describe('adaptateurs privés hentai', () => {
  it('lit les 113 chapitres uniques de hentai-origines dans l’ordre croissant', () => {
    const info = hentaiOriginesAdapter.readSeries(fixture('hentai-origines', 'series.html'));
    expect(info.chapters).toHaveLength(113);
    expect(info.chapters[0]?.number).toBe(1);
    expect(info.chapters.at(-1)?.number).toBe(113);
    expect(new Set(info.chapters.map((chapter) => chapter.url)).size).toBe(113);
  });

  it('lit uniquement les 42 planches de la fixture du lecteur hentai-origines', () => {
    const pages = hentaiOriginesAdapter.readChapterPages(fixture('hentai-origines', 'chapter.html'));
    expect(pages).toHaveLength(42);
    expect(pages[0]?.index).toBe(1);
    expect(pages.at(-1)?.index).toBe(42);
  });

  it('lit les 110 chapitres et les 7 planches de hentai-scantrad', () => {
    const info = hentaiScantradAdapter.readSeries(fixture('hentai-scantrad', 'serie.html'));
    const pages = hentaiScantradAdapter.readChapterPages(fixture('hentai-scantrad', 'chapter.html'));
    expect(info.chapters).toHaveLength(110);
    expect(pages).toHaveLength(7);
    expect(pages[0]?.url).not.toMatch(/^\s/u);
    expect(pages[0]?.url).toContain('stockage.hentai-scantrad.org');
    expect(hentaiScantradAdapter.origins?.(new URL('https://hentai-scantrad.org/manga/example/'))).toEqual([
      'https://*.hentai-scantrad.org/*',
    ]);
  });

  it('classe strictement les pages manga et refuse un lecteur absent', () => {
    expect(hentaiOriginesAdapter.classify(new URL('https://hentai-origines.com/manga/foo/'))).toBe('series');
    expect(hentaiOriginesAdapter.classify(new URL('https://hentai-origines.com/manga/foo/chapitre-129-5/'))).toBe('chapter');
    expect(hentaiOriginesAdapter.classify(new URL('https://hentai-origines.com/manga-genre/foo/'))).toBe('other');
    expect(() => hentaiScantradAdapter.readChapterPages(new JSDOM('<main></main>').window.document)).toThrow(/confirme l’âge/iu);
  });

  it('accepte le chapitre 0 et les numéros décimaux dans les URLs', () => {
    const document = new JSDOM('<meta property="og:title" content="Test">').window.document;
    const zero = hentaiOriginesAdapter.readChapterMeta(document, 'https://hentai-origines.com/manga/test/chapitre-0/');
    const decimal = hentaiOriginesAdapter.readChapterMeta(document, 'https://hentai-origines.com/manga/test/chapitre-129-5/');
    expect(zero).toMatchObject({ number: 0, label: 'Chapitre 0' });
    expect(decimal).toMatchObject({ number: 129.5, label: 'Chapitre 129.5' });
  });
});
