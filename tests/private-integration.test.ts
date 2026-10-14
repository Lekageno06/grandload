import { describe, expect, it } from 'vitest';

import { hentaiOriginesAdapter } from '../src/adapters/private/hentai-origines';
import { hentaiScantradAdapter } from '../src/adapters/private/hentai-scantrad';
import { adaptersReady } from '../src/adapters';
import { getAdapter, registerAdapter } from '../src/core/registry';
import { resolvePageContext } from '../src/background/page-context';
import seriesDownloadModule from '../src/modules/series-download';

describe('intégration des profils privés', () => {
  it.each([
    ['hentai-origines', hentaiOriginesAdapter, 'https://hentai-origines.com/manga/the-father-in-law-fucks-them-all/'],
    ['hentai-scantrad', hentaiScantradAdapter, 'https://hentai-scantrad.org/manga/example/'],
  ])('classifie %s comme série et rend le module série applicable', (_id, adapter, url) => {
    const context = { url, kind: adapter.classify(new URL(url)), adapterId: adapter.id, tabId: 1 };
    expect(context.kind).toBe('series');
    expect(seriesDownloadModule.canHandle(context)).toBe(true);
  });

  it('classifie exactement le chapitre hentai-origines comme chapitre', () => {
    const url = 'https://hentai-origines.com/manga/the-father-in-law-fucks-them-all/chapitre-59/';
    expect(hentaiOriginesAdapter.matches(new URL(url))).toBe(true);
    expect(hentaiOriginesAdapter.classify(new URL(url))).toBe('chapter');
  });

  it('simule un réveil froid et attend le registre privé avant PAGE_CONTEXT', async () => {
    const ready = new Promise<void>((resolve) => setTimeout(() => {
      registerAdapter(hentaiOriginesAdapter);
      resolve();
    }, 0));
    const series = await resolvePageContext(1, 'https://hentai-origines.com/manga/the-father-in-law-fucks-them-all/', ready);
    const chapter = await resolvePageContext(1, 'https://hentai-origines.com/manga/the-father-in-law-fucks-them-all/chapitre-59/');
    expect(series).toMatchObject({ kind: 'series', adapterId: 'hentai-origines' });
    expect(chapter).toMatchObject({ kind: 'chapter', adapterId: 'hentai-origines' });
    expect(series.serviceWorkerDiagnostics?.registryReady).toBe(true);
    expect(series.serviceWorkerDiagnostics?.selected).toBe('hentai-origines');
    expect(series.serviceWorkerDiagnostics?.matches).toEqual([
      { id: 'mangas-origines', matched: false },
      { id: 'hentai-origines', matched: true },
      { id: 'generic', matched: true },
    ]);
    expect(getAdapter(new URL(series.url))?.id).toBe(series.adapterId);
    expect(getAdapter(new URL(chapter.url))?.id).toBe(chapter.adapterId);
  });

  it('le build public reste générique sans erreur', async () => {
    await adaptersReady;
    expect(hentaiOriginesAdapter.id).not.toBe('generic');
    expect(seriesDownloadModule.canHandle({
      url: 'https://hentai-origines.com/manga/the-father-in-law-fucks-them-all/',
      kind: 'other', adapterId: 'generic', tabId: 1,
    })).toBe(false);
  });
});
