import { describe, expect, it } from 'vitest';

import { hentaiOriginesAdapter } from '../src/adapters/private/hentai-origines';
import { hentaiScantradAdapter } from '../src/adapters/private/hentai-scantrad';
import { DEFAULT_PREFS } from '../src/core/storage';
import chapterDownloadModule from '../src/modules/chapter-download';
import seriesDownloadModule from '../src/modules/series-download';
import { getVisibleModules } from '../src/sidepanel/module-visibility';

const adapters = [
  ['hentai-origines', hentaiOriginesAdapter],
  ['hentai-scantrad', hentaiScantradAdapter],
] as const;

describe('visibilité des modules privés', () => {
  it.each(adapters)('%s expose le téléchargement de série et de chapitre', (_id, adapter) => {
    const seriesUrl = `https://${adapter.id === 'hentai-origines' ? 'hentai-origines.com' : 'hentai-scantrad.org'}/manga/example/`;
    const chapterUrl = `${seriesUrl}chapitre-1/`;
    const seriesContext = {
      url: seriesUrl,
      kind: adapter.classify(new URL(seriesUrl)),
      adapterId: adapter.id,
      tabId: 1,
    } as const;
    const chapterContext = {
      url: chapterUrl,
      kind: adapter.classify(new URL(chapterUrl)),
      adapterId: adapter.id,
      tabId: 1,
    } as const;

    expect(seriesContext.kind).toBe('series');
    expect(chapterContext.kind).toBe('chapter');
    expect(getVisibleModules([seriesDownloadModule, chapterDownloadModule], seriesContext, DEFAULT_PREFS))
      .toContain(seriesDownloadModule);
    expect(getVisibleModules([seriesDownloadModule, chapterDownloadModule], chapterContext, DEFAULT_PREFS))
      .toContain(chapterDownloadModule);
  });
});
