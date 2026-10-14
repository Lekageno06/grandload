import { describe, expect, it } from 'vitest';

import { hentaiOriginesAdapter } from '../src/adapters/private/hentai-origines';
import { hentaiScantradAdapter } from '../src/adapters/private/hentai-scantrad';
import { adaptersReady } from '../src/adapters';
import { listAdapters } from '../src/core/registry';
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

  it('le build public traite ces domaines comme génériques sans lever d’erreur', () => {
    const url = new URL('https://hentai-origines.com/manga/the-father-in-law-fucks-them-all/');
    expect(url.protocol).toMatch(/^https?:$/u);
    expect(hentaiOriginesAdapter.matches(url)).toBe(true);
    expect(hentaiOriginesAdapter.id).not.toBe('generic');
  });

  it('le registre public n’enregistre pas les profils privés', async () => {
    await adaptersReady;
    expect(listAdapters().map((adapter) => adapter.id)).not.toEqual(
      expect.arrayContaining(['hentai-origines', 'hentai-scantrad']),
    );
  });

  it('le contexte public reste générique et le module série n’est pas applicable', async () => {
    await adaptersReady;
    const context = {
      url: 'https://hentai-origines.com/manga/the-father-in-law-fucks-them-all/',
      kind: 'other' as const,
      adapterId: 'generic',
      tabId: 1,
    };
    expect(seriesDownloadModule.canHandle(context)).toBe(false);
  });
});
