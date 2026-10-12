import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getJobs, setJobs } from '../src/core/storage';
import type { Job } from '../src/core/types';
import {
  detectDownloadFilenameWarning,
  isStaleRunningJob,
  protectTerminalJobUpdate,
  recoverRunningJobs,
} from '../src/background/orchestrator';

type Message = { type?: string; payload?: unknown };

const oldJob: Job = {
  id: 'old-chapter',
  kind: 'chapter',
  state: 'running',
  params: { blobUrls: ['blob:stale-archive'] },
  progress: { done: 3, total: 10 },
  createdAt: Date.now() - 11 * 60 * 1000,
};

let store: Map<string, unknown>;
let sentMessages: Message[];
let chromeMock: {
  runtime: {
    id: string;
    lastError?: undefined;
    sendMessage: (message: unknown, callback?: (response: unknown) => void) => void;
  };
  storage: {
    local: {
      get: (key: string, callback: (items: Record<string, unknown>) => void) => void;
      set: (items: Record<string, unknown>, callback?: () => void) => void;
    };
    session: {
      get: (key: string, callback: (items: Record<string, unknown>) => void) => void;
      set: (items: Record<string, unknown>, callback?: () => void) => void;
    };
  };
  downloads: {
    cancel: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
  };
};

function createStorageArea(): typeof chromeMock.storage.local {
  return {
    get: (key, callback) => callback(store.has(key) ? { [key]: store.get(key) } : {}),
    set: (items, callback) => {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
      callback?.();
    },
  };
}

describe('chapter job orchestration', () => {
  beforeEach(() => {
    store = new Map<string, unknown>();
    sentMessages = [];
    const storageArea = createStorageArea();
    chromeMock = {
      runtime: {
        id: 'grandload-id',
        sendMessage: (message, callback) => {
          sentMessages.push(message as Message);
          callback?.({ ok: true, data: { ok: true } });
        },
      },
      storage: { local: storageArea, session: storageArea },
      downloads: {
        cancel: vi.fn((_downloadId: number, callback?: () => void) => callback?.()),
        search: vi.fn((_query: unknown, callback: (items: unknown[]) => void) => callback([])),
      },
    };
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: chromeMock });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'chrome');
  });

  it('detects and records a filename changed by another extension', () => {
    expect(
      detectDownloadFilenameWarning('Grandload/Series/Series - Chapitre 012.cbz', {
        filename: 'C:\\Downloads\\Grandload\\Series\\Series - Chapitre 012.zip',
        mime: 'application/zip',
        byExtensionName: 'Other downloader',
      }),
    ).toEqual({
      requested: 'Grandload/Series/Series - Chapitre 012.cbz',
      actual: 'C:\\Downloads\\Grandload\\Series\\Series - Chapitre 012.zip',
    });
  });

  it('does not report a warning when Chrome returns the requested relative path', () => {
    expect(
      detectDownloadFilenameWarning('Grandload/Series/chapter.cbz', {
        filename: 'C:\\Downloads\\Grandload\\Series\\chapter.cbz',
        mime: 'application/octet-stream',
        byExtensionName: '',
      }),
    ).toBeUndefined();
  });

  it('protects terminal state and progress while allowing a terminal warning', () => {
    const completed: Job = {
      ...oldJob,
      state: 'done',
      progress: { done: 10, total: 10 },
    };
    const staleProgress = protectTerminalJobUpdate(completed, {
      ...completed,
      state: 'running',
      progress: { done: 2, total: 10 },
    });
    expect(staleProgress).toEqual(completed);

    const withWarning = protectTerminalJobUpdate(completed, {
      ...completed,
      progress: { done: 2, total: 10 },
      warning: { requested: 'requested.cbz', actual: 'actual.zip' },
    });
    expect(withWarning.state).toBe('done');
    expect(withWarning.progress).toEqual(completed.progress);
    expect(withWarning.warning).toEqual({ requested: 'requested.cbz', actual: 'actual.zip' });
  });

  it('marks a running job older than ten minutes failed and revokes its blobs without retrying', async () => {
    expect(isStaleRunningJob(oldJob)).toBe(true);
    await setJobs({ [oldJob.id]: oldJob });

    await recoverRunningJobs();

    const recovered = (await getJobs())[oldJob.id];
    expect(recovered?.state).toBe('failed');
    expect(recovered?.error?.message).toBe('Interrompu (relance annulée)');
    expect(sentMessages.map((message) => message.type)).toContain('REVOKE_BLOBS');
    expect(sentMessages.map((message) => message.type)).not.toContain('BUILD_ARCHIVE');
    expect(chromeMock.downloads.search).not.toHaveBeenCalled();
  });
});
