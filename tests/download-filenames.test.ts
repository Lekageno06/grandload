import { describe, expect, it, vi } from 'vitest';

import { suggestRequestedDownloadName } from '../src/background/download-filenames';

describe('requested download filenames', () => {
  it('suggests the persisted name with uniquify for this extension', async () => {
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { id: 'grandload-id' } },
    });
    const suggest = vi.fn();
    const consumeName = vi.fn(async () => 'Grandload/Series/Series - Chapitre 012.cbz');

    await suggestRequestedDownloadName(
      { byExtensionId: 'grandload-id', url: 'blob:archive' },
      suggest,
      consumeName,
    );

    expect(consumeName).toHaveBeenCalledWith('blob:archive');
    expect(suggest).toHaveBeenCalledWith({
      filename: 'Grandload/Series/Series - Chapitre 012.cbz',
      conflictAction: 'uniquify',
    });
  });

  it.each([
    ['other-extension', 'blob:any', undefined],
    ['grandload-id', 'blob:missing', undefined],
  ])(
    'always calls suggest without a filename when no matching name exists',
    async (byExtensionId, url) => {
      Object.defineProperty(globalThis, 'chrome', {
        configurable: true,
        value: { runtime: { id: 'grandload-id' } },
      });
      const suggest = vi.fn();

      await suggestRequestedDownloadName({ byExtensionId, url }, suggest, async () => undefined);

      expect(suggest).toHaveBeenCalledOnce();
      expect(suggest).toHaveBeenCalledWith();
    },
  );
});
