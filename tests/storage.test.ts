import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_PREFS, getPrefs, readStorage, setPrefs, writeStorage } from '../src/core/storage';

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
  });

  it('merges and persists updated prefs', async () => {
    const prefs = await setPrefs({ format: 'zip', concurrency: 3 });

    expect(prefs.format).toBe('zip');
    expect(prefs.concurrency).toBe(3);
    await expect(getPrefs()).resolves.toMatchObject({
      format: 'zip',
      concurrency: 3,
    });
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
});
