import { beforeEach, describe, expect, it } from 'vitest';

import {
  consumeRequestedDownloadName,
  DEFAULT_PREFS,
  getJobs,
  migrateJobsRecord,
  getPrefs,
  readStorage,
  setJobs,
  setPrefs,
  setRequestedDownloadName,
  updateJobs,
  writeStorage,
} from '../src/core/storage';
import type { Job } from '../src/core/types';

type ChromeStorageMock = {
  storage: {
    local: {
      get: (
        key: string | string[] | Record<string, unknown>,
        callback: (items: Record<string, unknown>) => void,
      ) => void;
      set: (items: Record<string, unknown>, callback?: () => void) => void;
    };
    session: {
      get: (
        key: string | string[] | Record<string, unknown>,
        callback: (items: Record<string, unknown>) => void,
      ) => void;
      set: (items: Record<string, unknown>, callback?: () => void) => void;
    };
  };
};

describe('storage', () => {
  it('migre et purge les anciens jobs avant lecture', () => {
    const result = migrateJobsRecord(
      {
        valid: {
          id: 'valid',
          kind: 'chapter',
          state: 'done',
          params: {},
          progress: { done: 2, total: 2 },
        },
        invalid: { id: 'invalid', state: 'obsolete' },
      },
      123,
    );

    expect(result.migrated).toBe(1);
    expect(result.purged).toBe(1);
    expect(result.jobs.valid?.createdAt).toBe(123);
    expect(result.jobs.invalid).toBeUndefined();
  });

  it('utilise le thème sombre par défaut', async () => {
    const { getPrefs } = await import('../src/core/storage');
    expect((await getPrefs()).theme).toBe('dark');
  });

  beforeEach(() => {
    const store = new Map<string, unknown>();
    const chromeMock: ChromeStorageMock = {
      storage: {
        local: {
          get: (key, callback) => {
            const keys = Array.isArray(key)
              ? key
              : typeof key === 'string'
                ? [key]
                : Object.keys(key);
            const result: Record<string, unknown> = {};

            for (const item of keys) {
              if (store.has(item)) {
                result[item] = store.get(item);
              }
            }

            callback(result);
          },
          set: (items, callback) => {
            for (const [key, value] of Object.entries(items)) {
              store.set(key, value);
            }

            callback?.();
          },
        },
        session: {
          get: (key, callback) => {
            const keys = Array.isArray(key)
              ? key
              : typeof key === 'string'
                ? [key]
                : Object.keys(key);
            const result: Record<string, unknown> = {};

            for (const item of keys) {
              if (store.has(item)) {
                result[item] = store.get(item);
              }
            }

            callback(result);
          },
          set: (items, callback) => {
            for (const [key, value] of Object.entries(items)) {
              store.set(key, value);
            }

            callback?.();
          },
        },
      },
    };

    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: chromeMock,
    });
  });

  it('returns the default prefs when the storage is empty', async () => {
    await expect(getPrefs()).resolves.toEqual(DEFAULT_PREFS);
    const prefs = await getPrefs();
    expect(prefs.autoExclude).toBe(true);
    expect(prefs.downloadFolder).toBe('Grandload');
    expect(prefs.acquisitionStrategy).toBe('auto');
    expect(prefs.modulesEnabled).toEqual({});
  });

  it('merges and persists updated prefs', async () => {
    const prefs = await setPrefs({
      format: 'zip',
      concurrency: 3,
      autoExclude: false,
      downloadFolder: 'MonManga',
      acquisitionStrategy: 'live-dom',
      modulesEnabled: { 'generic-scan': false },
    });

    expect(prefs.format).toBe('zip');
    expect(prefs.concurrency).toBe(3);
    expect(prefs.autoExclude).toBe(false);
    expect(prefs.downloadFolder).toBe('MonManga');
    expect(prefs.acquisitionStrategy).toBe('live-dom');
    expect(prefs.modulesEnabled['generic-scan']).toBe(false);

    await expect(getPrefs()).resolves.toMatchObject({
      format: 'zip',
      concurrency: 3,
      autoExclude: false,
      downloadFolder: 'MonManga',
      acquisitionStrategy: 'live-dom',
      modulesEnabled: { 'generic-scan': false },
    });
  });

  it('validates and rejects malicious or invalid download folders (RG-32)', async () => {
    const { validateDownloadFolder } = await import('../src/shared/url-utils');

    // Cas valides
    expect(validateDownloadFolder('Grandload').valid).toBe(true);
    expect(validateDownloadFolder('Mangas-2024').valid).toBe(true);
    expect(validateDownloadFolder('Overgeared Season 1').valid).toBe(true);

    // Cas refusés (RG-32)
    // 1. Vide
    expect(validateDownloadFolder('').valid).toBe(false);
    expect(validateDownloadFolder('   ').valid).toBe(false);

    // 2. Traversée de répertoire (..)
    const dotDot = validateDownloadFolder('../Downloads');
    expect(dotDot.valid).toBe(false);
    expect(dotDot.error).toContain('..');

    // 3. Chemin absolu
    const slash = validateDownloadFolder('/etc/passwd');
    expect(slash.valid).toBe(false);
    expect(slash.error).toContain('absolus');

    const winDrive = validateDownloadFolder('C:\\Downloads');
    expect(winDrive.valid).toBe(false);
    expect(winDrive.error).toContain('absolus');

    // 4. Caractères interdits (\ / : * ? " < > |)
    const invalidChar = validateDownloadFolder('manga/chapitre');
    expect(invalidChar.valid).toBe(false);
    expect(invalidChar.error).toContain('interdits');

    const colonChar = validateDownloadFolder('manga:test');
    expect(colonChar.valid).toBe(false);

    // 5. Plus de 150 caractères
    const tooLong = validateDownloadFolder('a'.repeat(151));
    expect(tooLong.valid).toBe(false);
    expect(tooLong.error).toContain('150 caractères');
  });

  it('persists and retrieves exclusions memory per adapter (RG-107)', async () => {
    const { getExclusions, setExclusions } = await import('../src/core/storage');

    const defaultExcl = await getExclusions('mangas-origines');
    expect(defaultExcl.lastPage).toBe(false);
    expect(defaultExcl.urlPatterns).toEqual([]);

    await setExclusions('mangas-origines', {
      lastPage: true,
      urlPatterns: ['discord_join', 'banner_promo'],
    });

    const updated = await getExclusions('mangas-origines');
    expect(updated.lastPage).toBe(true);
    expect(updated.urlPatterns).toEqual(['discord_join', 'banner_promo']);

    // Autre adaptateur indépendant
    const genericExcl = await getExclusions('generic');
    expect(genericExcl.lastPage).toBe(false);
  });

  it('provides a message when Chrome omits the storage error detail', async () => {
    const storageArea = {
      get: (_key: string, callback: (items: Record<string, unknown>) => void) => callback({}),
      set: (_items: Record<string, unknown>, callback?: () => void) => callback?.(),
    };
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: { lastError: {} },
        storage: { local: storageArea, session: storageArea },
      },
    });

    await expect(readStorage('local', 'missing')).rejects.toMatchObject({
      code: 'STORAGE_READ_FAILED',
      message: 'Échec de la lecture du stockage.',
    });
    await expect(writeStorage('local', 'key', 'value')).rejects.toMatchObject({
      code: 'STORAGE_WRITE_FAILED',
      message: 'Échec de l’écriture du stockage.',
    });
  });

  it('persists and consumes requested filenames in session storage', async () => {
    await setRequestedDownloadName('blob:chapter-image', 'Grandload/Test.cbz');

    await expect(consumeRequestedDownloadName('blob:chapter-image')).resolves.toBe(
      'Grandload/Test.cbz',
    );
    await expect(consumeRequestedDownloadName('blob:chapter-image')).resolves.toBeUndefined();
  });

  it('serializes concurrent job updates without dropping either update', async () => {
    const makeJob = (id: string): Job => ({
      id,
      kind: 'chapter',
      state: 'queued',
      params: {},
      progress: { done: 0, total: 1 },
      createdAt: 1,
    });
    await setJobs({});

    await Promise.all([
      updateJobs((jobs) => ({ ...jobs, first: makeJob('first') })),
      updateJobs((jobs) => ({ ...jobs, second: makeJob('second') })),
    ]);

    await expect(getJobs()).resolves.toHaveProperty('first');
    await expect(getJobs()).resolves.toHaveProperty('second');
  });
});
