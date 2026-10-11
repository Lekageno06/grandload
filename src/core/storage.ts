import type { Job } from './types';
import { GrandloadError } from './errors';

export type StorageAreaName = 'local' | 'session';

export interface Prefs {
  format: 'zip' | 'cbz' | 'folder';
  concurrency: number;
  requestDelayMs: number;
  modulesEnabled: Record<string, boolean>;
  autoOpenDownloads: boolean;
}

export interface RuntimeState {
  offscreenOpen: boolean;
  activeTabId?: number;
}

export const STORAGE_KEYS = {
  runtime: 'runtime',
  jobs: 'jobs',
  prefs: 'prefs',
  history: (seriesId: string): string => `history:${seriesId}`,
  exclusions: (adapterId: string): string => `exclusions:${adapterId}`,
} as const;

export const DEFAULT_PREFS: Prefs = {
  format: 'cbz',
  concurrency: 1,
  requestDelayMs: 1500,
  modulesEnabled: {},
  autoOpenDownloads: false,
};

type StorageAreaLike = {
  get: (key: string | string[] | Record<string, unknown>, callback: (items: Record<string, unknown>) => void) => void;
  set: (items: Record<string, unknown>, callback?: () => void) => void;
};

function getStorageArea(areaName: StorageAreaName): StorageAreaLike | undefined {
  if (typeof chrome === 'undefined' || !chrome.storage) {
    return undefined;
  }

  const area = chrome.storage[areaName];
  if (!area) {
    return undefined;
  }

  return area as StorageAreaLike;
}

export async function readStorage<T>(areaName: StorageAreaName, key: string): Promise<T | undefined> {
  const area = getStorageArea(areaName);

  if (!area) {
    return undefined;
  }

  return await new Promise<T | undefined>((resolve, reject) => {
    area.get(key, (items: Record<string, unknown>) => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
        reject(new GrandloadError('STORAGE_READ_FAILED', chrome.runtime.lastError.message));
        return;
      }

      const value = items[key] as T | undefined;
      resolve(value);
    });
  });
}

export async function writeStorage<T>(areaName: StorageAreaName, key: string, value: T): Promise<void> {
  const area = getStorageArea(areaName);

  if (!area) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    area.set({ [key]: value }, () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
        reject(new GrandloadError('STORAGE_WRITE_FAILED', chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

export async function getPrefs(): Promise<Prefs> {
  const stored = (await readStorage<Partial<Prefs>>('local', STORAGE_KEYS.prefs)) ?? {};

  return {
    ...DEFAULT_PREFS,
    ...stored,
    modulesEnabled: {
      ...DEFAULT_PREFS.modulesEnabled,
      ...(stored.modulesEnabled ?? {}),
    },
  };
}

export async function setPrefs(updates: Partial<Prefs>): Promise<Prefs> {
  const current = await getPrefs();
  const next: Prefs = {
    ...current,
    ...updates,
    modulesEnabled: {
      ...current.modulesEnabled,
      ...(updates.modulesEnabled ?? {}),
    },
  };

  await writeStorage('local', STORAGE_KEYS.prefs, next);
  return next;
}

export async function getJobs(): Promise<Record<string, Job>> {
  return (await readStorage<Record<string, Job>>('local', STORAGE_KEYS.jobs)) ?? {};
}

export async function setJobs(jobs: Record<string, Job>): Promise<void> {
  await writeStorage('local', STORAGE_KEYS.jobs, jobs);
}

export async function getRuntimeState(): Promise<RuntimeState> {
  return (await readStorage<RuntimeState>('session', STORAGE_KEYS.runtime)) ?? { offscreenOpen: false };
}

export async function setRuntimeState(state: RuntimeState): Promise<void> {
  await writeStorage('session', STORAGE_KEYS.runtime, state);
}
