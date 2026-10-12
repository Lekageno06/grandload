import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFS } from '../src/core/storage';
import type { GrandloadModule, PageContext } from '../src/core/types';
import { getVisibleModules } from '../src/popup/module-visibility';

const context: PageContext = {
  url: 'https://mangas-origines.fr/oeuvre/overgeared/',
  kind: 'series',
  adapterId: 'mangas-origines',
  tabId: 1,
};

function testModule(id: string, canHandle: (ctx: PageContext) => boolean): GrandloadModule {
  return {
    id,
    title: id,
    priority: 1,
    canHandle,
    mountPopup: () => undefined,
  };
}

describe('popup module visibility', () => {
  it('keeps Preferences available and refreshes disabled modules after preferences change', () => {
    const preferences = testModule('preferences', () => false);
    const genericScan = testModule('generic-scan', () => true);
    const seriesDownload = testModule('series-download', (page) => page.kind === 'series');
    const modules = [preferences, genericScan, seriesDownload];
    const disabledPrefs = {
      ...DEFAULT_PREFS,
      modulesEnabled: { 'generic-scan': false, 'series-download': false },
    };

    expect(getVisibleModules(modules, context, disabledPrefs).map((module) => module.id)).toEqual([
      'preferences',
    ]);
    expect(
      getVisibleModules(modules, context, {
        ...disabledPrefs,
        modulesEnabled: { ...disabledPrefs.modulesEnabled, 'series-download': true },
      }).map((module) => module.id),
    ).toEqual(['preferences', 'series-download']);
  });
});
