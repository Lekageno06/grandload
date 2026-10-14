import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { hentaiOriginesAdapter } from '../src/adapters/private/hentai-origines';
import { resolvePageContext } from '../src/background/page-context';
import { buildChapterDownloadFilename } from '../src/background/orchestrator';
import { getAdapter, registerAdapter } from '../src/core/registry';

describe('réveil à froid et pipeline Worker des profils privés', () => {
  it('attend l’enregistrement asynchrone puis résout série et chapitre avec le même adaptateur', async () => {
    const ready = new Promise<void>((resolve) => setTimeout(() => {
      registerAdapter(hentaiOriginesAdapter);
      resolve();
    }, 0));
    const seriesUrl = 'https://hentai-origines.com/manga/the-father-in-law-fucks-them-all/';
    const chapterUrl = `${seriesUrl}chapitre-59/`;
    const series = await resolvePageContext(1, seriesUrl, ready);
    const chapter = await resolvePageContext(1, chapterUrl);
    expect(series).toMatchObject({ kind: 'series', adapterId: 'hentai-origines' });
    expect(chapter).toMatchObject({ kind: 'chapter', adapterId: 'hentai-origines' });
    expect(series.serviceWorkerDiagnostics?.registryReady).toBe(true);
    expect(series.serviceWorkerDiagnostics?.selected).toBe('hentai-origines');
    expect(getAdapter(new URL(series.url))?.id).toBe(series.adapterId);
    expect(getAdapter(new URL(chapter.url))?.id).toBe(chapter.adapterId);
  });

  it('utilise les métadonnées du site pour le nommage côté Worker', () => {
    const url = 'https://hentai-origines.com/manga/the-father-in-law-fucks-them-all/chapitre-59/';
    const meta = hentaiOriginesAdapter.readChapterMeta(
      new JSDOM('<meta property="og:title" content="The Father in Law Fucks Them All - Hentai Origines">').window.document,
      url,
    );
    expect(meta).toMatchObject({ series: 'The Father in Law Fucks Them All', number: 59, label: 'Chapitre 59' });
    expect(buildChapterDownloadFilename({
      series: meta.series,
      chapter: { number: meta.number, label: meta.label, url },
      pageCount: 29,
      sourceUrl: url,
    }, '.cbz', 'Grandload', undefined, '')).toBe('The Father in Law Fucks Them All/The Father in Law Fucks Them All - Chapitre 059.cbz');
  });

  it('lit 29 planches page par page dans l’ordre sans toucher aux préférences', () => {
    const pages = Array.from({ length: 29 }, (_, index) =>
      `<div class="page-break no-gaps"><img class="wp-manga-chapter-img" src="/pages/${String(index + 1).padStart(3, '0')}.webp"></div>`,
    ).join('');
    const document = new JSDOM(`<main class="ori-lec-scene"><div class="reading-content">${pages}</div></main>`, {
      url: 'https://hentai-origines.com/manga/example/chapitre-1/',
    }).window.document;
    const result = hentaiOriginesAdapter.readChapterPages(document);
    expect(result).toHaveLength(29);
    expect(result.map((page) => page.index)).toEqual(Array.from({ length: 29 }, (_, index) => index + 1));
  });
});
