import type { Job } from './types';
import { GrandloadError } from './errors';

export type StorageAreaName = 'local' | 'session';

export type AcquisitionStrategy = 'auto' | 'live-dom' | 'html-parse';
export type ThemePreference = 'auto' | 'light' | 'dark';

export interface Prefs {
  theme: ThemePreference;
  format: 'zip' | 'cbz' | 'folder';
  concurrency: number;
  requestDelayMs: number;
  modulesEnabled: Record<string, boolean>;
  autoOpenDownloads: boolean;
  /** Active/désactive les pré-exclusions automatiques (RG-106). */
  autoExclude: boolean;
  /** Sous-dossier de téléchargement personnalisé (par défaut Grandload) (RG-704). */
  downloadFolder: string;
  /** Stratégie d'acquisition : 'auto' (défaut) / 'live-dom' (toujours onglet inactif) / 'html-parse' (toujours sans onglet) (RG-205). */
  acquisitionStrategy: AcquisitionStrategy;
}

/** Exclusions mémorisées par site (RG-107). Stockées dans exclusions:<adapterId>. */
export interface ExclusionMemory {
  /** Exclure automatiquement la dernière planche. */
  lastPage: boolean;
  /** Motifs d'URL à exclure (sous-chaînes). */
  urlPatterns: string[];
}

export const DEFAULT_EXCLUSION_MEMORY: ExclusionMemory = {
  lastPage: false,
  urlPatterns: [],
};

export interface RuntimeState {
  offscreenOpen: boolean;
  activeTabId?: number;
}

const JOB_STATES: readonly Job['state'][] = [
  'queued',
  'running',
  'paused',
  'done',
  'failed',
  'ignored',
  'cancelled',
];

export function migrateJobsRecord(
  input: Record<string, unknown>,
  now = Date.now(),
): { jobs: Record<string, Job>; migrated: number; purged: number } {
  const jobs: Record<string, Job> = {};
  let migrated = 0;
  let purged = 0;

  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'object' || value === null) {
      purged += 1;
      continue;
    }
    const candidate = value as Partial<Job>;
    if (
      typeof candidate.id !== 'string' ||
      candidate.id !== key ||
      (candidate.kind !== 'chapter' && candidate.kind !== 'series' && candidate.kind !== 'links') ||
      !JOB_STATES.includes(candidate.state as Job['state']) ||
      typeof candidate.params !== 'object' ||
      candidate.params === null
    ) {
      purged += 1;
      continue;
    }
    const progress = candidate.progress;
    const normalizedProgress =
      progress && Number.isFinite(progress.done) && Number.isFinite(progress.total)
        ? { done: Math.max(0, progress.done), total: Math.max(0, progress.total) }
        : { done: 0, total: 0 };
    const normalized: Job = {
      ...candidate,
      progress: normalizedProgress,
      createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : now,
    } as Job;
    if (
      normalized.createdAt !== candidate.createdAt ||
      !progress ||
      normalizedProgress.done !== progress.done ||
      normalizedProgress.total !== progress.total
    ) {
      migrated += 1;
    }
    jobs[key] = normalized;
  }

  return { jobs, migrated, purged };
}

export const STORAGE_KEYS = {
  runtime: 'runtime',
  jobs: 'jobs',
  prefs: 'prefs',
  history: (seriesId: string): string => `history:${seriesId}`,
  exclusions: (adapterId: string): string => `exclusions:${adapterId}`,
  requestedDownloadNames: 'requestedDownloadNames',
  seriesTemporaryTabLock: 'seriesTemporaryTabLock',
} as const;

export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  format: 'cbz',
  concurrency: 1,
  requestDelayMs: 1500,
  modulesEnabled: {},
  autoOpenDownloads: false,
  autoExclude: true,
  downloadFolder: 'Grandload',
  acquisitionStrategy: 'auto',
};

type StorageAreaLike = {
  get: (
    key: string | string[] | Record<string, unknown>,
    callback: (items: Record<string, unknown>) => void,
  ) => void;
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

export async function readStorage<T>(
  areaName: StorageAreaName,
  key: string,
): Promise<T | undefined> {
  const area = getStorageArea(areaName);

  if (!area) {
    return undefined;
  }

  return await new Promise<T | undefined>((resolve, reject) => {
    area.get(key, (items: Record<string, unknown>) => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
        reject(
          new GrandloadError(
            'STORAGE_READ_FAILED',
            chrome.runtime.lastError.message ?? 'Échec de la lecture du stockage.',
          ),
        );
        return;
      }

      const value = items[key] as T | undefined;
      resolve(value);
    });
  });
}

export async function writeStorage<T>(
  areaName: StorageAreaName,
  key: string,
  value: T,
): Promise<void> {
  const area = getStorageArea(areaName);

  if (!area) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    area.set({ [key]: value }, () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
        reject(
          new GrandloadError(
            'STORAGE_WRITE_FAILED',
            chrome.runtime.lastError.message ?? 'Échec de l’écriture du stockage.',
          ),
        );
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

let jobsQueue: Promise<void> = Promise.resolve();

function serializeJobs<T>(operation: () => Promise<T>): Promise<T> {
  const result = jobsQueue.then(operation, operation);
  jobsQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function getJobs(): Promise<Record<string, Job>> {
  return serializeJobs(async () => {
    const raw = (await readStorage<Record<string, unknown>>('local', STORAGE_KEYS.jobs)) ?? {};
    const result = migrateJobsRecord(raw);
    if (result.migrated > 0 || result.purged > 0) {
      await writeStorage('local', STORAGE_KEYS.jobs, result.jobs);
    }
    return result.jobs;
  });
}

export function setJobs(jobs: Record<string, Job>): Promise<void> {
  return serializeJobs(() => writeStorage('local', STORAGE_KEYS.jobs, jobs));
}

export function updateJobs(
  update: (jobs: Record<string, Job>) => Record<string, Job>,
): Promise<Record<string, Job>> {
  return serializeJobs(async () => {
    const jobs = (await readStorage<Record<string, Job>>('local', STORAGE_KEYS.jobs)) ?? {};
    const updated = update(jobs);
    await writeStorage('local', STORAGE_KEYS.jobs, updated);
    return updated;
  });
}

let requestedNamesQueue: Promise<void> = Promise.resolve();

function serializeRequestedNames<T>(operation: () => Promise<T>): Promise<T> {
  const result = requestedNamesQueue.then(operation, operation);
  requestedNamesQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function setRequestedDownloadName(blobUrl: string, filename: string): Promise<void> {
  return serializeRequestedNames(async () => {
    const names =
      (await readStorage<Record<string, string>>('session', STORAGE_KEYS.requestedDownloadNames)) ??
      {};
    names[blobUrl] = filename;
    await writeStorage('session', STORAGE_KEYS.requestedDownloadNames, names);
  });
}

export function consumeRequestedDownloadName(blobUrl: string): Promise<string | undefined> {
  return serializeRequestedNames(async () => {
    const names =
      (await readStorage<Record<string, string>>('session', STORAGE_KEYS.requestedDownloadNames)) ??
      {};
    const filename = names[blobUrl];
    if (filename) {
      delete names[blobUrl];
      await writeStorage('session', STORAGE_KEYS.requestedDownloadNames, names);
    }
    return filename;
  });
}

export function removeRequestedDownloadName(blobUrl: string): Promise<void> {
  return serializeRequestedNames(async () => {
    const names =
      (await readStorage<Record<string, string>>('session', STORAGE_KEYS.requestedDownloadNames)) ??
      {};
    delete names[blobUrl];
    await writeStorage('session', STORAGE_KEYS.requestedDownloadNames, names);
  });
}

export function acquireSeriesTemporaryTabLock(jobId: string): Promise<boolean> {
  return serializeRequestedNames(async () => {
    const lock = await readStorage<{ jobId: string }>(
      'session',
      STORAGE_KEYS.seriesTemporaryTabLock,
    );
    if (lock?.jobId && lock.jobId !== jobId) {
      return false;
    }
    await writeStorage('session', STORAGE_KEYS.seriesTemporaryTabLock, { jobId });
    return true;
  });
}

export function releaseSeriesTemporaryTabLock(jobId: string): Promise<void> {
  return serializeRequestedNames(async () => {
    const lock = await readStorage<{ jobId: string }>(
      'session',
      STORAGE_KEYS.seriesTemporaryTabLock,
    );
    if (lock?.jobId === jobId) {
      await writeStorage('session', STORAGE_KEYS.seriesTemporaryTabLock, { jobId: '' });
    }
  });
}

export async function getRuntimeState(): Promise<RuntimeState> {
  return (
    (await readStorage<RuntimeState>('session', STORAGE_KEYS.runtime)) ?? { offscreenOpen: false }
  );
}

export async function setRuntimeState(state: RuntimeState): Promise<void> {
  await writeStorage('session', STORAGE_KEYS.runtime, state);
}

export async function getExclusions(adapterId: string): Promise<ExclusionMemory> {
  const stored = await readStorage<Partial<ExclusionMemory>>(
    'local',
    STORAGE_KEYS.exclusions(adapterId),
  );
  return {
    ...DEFAULT_EXCLUSION_MEMORY,
    ...stored,
    urlPatterns: stored?.urlPatterns ? [...stored.urlPatterns] : [],
  };
}

export async function setExclusions(
  adapterId: string,
  updates: Partial<ExclusionMemory>,
): Promise<ExclusionMemory> {
  const current = await getExclusions(adapterId);
  const next: ExclusionMemory = {
    ...current,
    ...updates,
    urlPatterns: updates.urlPatterns !== undefined ? [...updates.urlPatterns] : current.urlPatterns,
  };
  await writeStorage('local', STORAGE_KEYS.exclusions(adapterId), next);
  return next;
}
