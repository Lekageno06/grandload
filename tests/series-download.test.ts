import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

import {
  acquireSeriesTemporaryTabLock,
  getJobs,
  releaseSeriesTemporaryTabLock,
  setJobs,
} from '../src/core/storage';
import { getModule, registerAdapter } from '../src/core/registry';
import '../src/modules';
import type { ChapterRef, Job, PageRef, SiteAdapter } from '../src/core/types';
import { requeueFailedJob } from '../src/background/orchestrator';
import {
  backoffAndPauseSeriesForRateLimit,
  chooseAcquisitionStrategy,
  createSeriesJob,
  getRateLimitBackoffMs,
  handleSeriesJobControl,
  markChapterDownloaded,
  readSeriesHistory,
  recoverSeriesJobs,
  restartTerminalSeriesJob,
  runSeriesJob,
  waitForRateLimitBackoff,
  withTemporaryTab,
} from '../src/background/series-orchestrator';
import {
  selectChaptersInRange,
  selectUndownloadedChapters,
  requiresSeriesConfirmation,
} from '../src/modules/series-download';

const seriesId = 'mangas-origines.fr/oeuvre/overgeared';
const chapters: ChapterRef[] = [
  {
    number: 130,
    label: 'Chapitre 130',
    url: 'https://mangas-origines.fr/oeuvre/overgeared/chapitre-130/',
  },
  {
    number: 129.5,
    label: 'Chapitre 129.5',
    url: 'https://mangas-origines.fr/oeuvre/overgeared/chapitre-129-5/',
  },
  {
    number: 129,
    label: 'Chapitre 129',
    url: 'https://mangas-origines.fr/oeuvre/overgeared/chapitre-129/',
  },
];

let storage: Map<string, unknown>;

function makeHtmlAdapter(id: string): SiteAdapter {
  return {
    id,
    acquisition: 'html-parse',
    matches: (url) => url.hostname === 'example.test',
    classify: () => 'chapter',
    readSeries: () => ({ title: 'Test', chapters: [] }),
    countChapterPageElements: (doc) => doc.querySelectorAll('img.chapter-page').length,
    readChapterPages: (doc): PageRef[] =>
      Array.from(doc.querySelectorAll<HTMLImageElement>('img.chapter-page')).flatMap((image, index) => {
        const rawUrl = image.getAttribute('src')?.trim();
        if (!rawUrl) return [];
        const url = new URL(rawUrl, doc.baseURI).toString();
        return [{ index: index + 1, url, ext: new URL(url).pathname.split('.').at(-1) ?? '' }];
      }),
  };
}

function storageArea(): {
  get: (key: string, callback: (items: Record<string, unknown>) => void) => void;
  set: (items: Record<string, unknown>, callback?: () => void) => void;
} {
  return {
    get: (key, callback) => callback(storage.has(key) ? { [key]: storage.get(key) } : {}),
    set: (items, callback) => {
      Object.entries(items).forEach(([key, value]) => storage.set(key, value));
      callback?.();
    },
  };
}

function installChromeMock(): void {
  const area = storageArea();
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        id: 'grandload-test',
        sendMessage: (_message: unknown, callback?: (response: unknown) => void) => {
          callback?.({ ok: true, data: { ok: true } });
        },
      },
      storage: { local: area, session: area },
    },
  });
}

function parentJob(
  children: string[],
  createdAt = Date.now(),
  state: Job['state'] = 'queued',
): Job {
  return {
    id: 'series-parent',
    kind: 'series',
    state,
    params: { seriesId, seriesTitle: 'Overgeared', requestDelayMs: 1500 },
    children,
    progress: { done: 0, total: children.length },
    createdAt,
  };
}

function childJob(id: string, parentId: string, state: Job['state'] = 'queued'): Job {
  return {
    id,
    kind: 'chapter',
    state,
    params: {
      parentId,
      seriesId,
      seriesTitle: 'Overgeared',
      sourceUrl: 'https://mangas-origines.fr/oeuvre/overgeared/',
      adapterId: 'mangas-origines',
      packagerId: 'cbz',
      chapter: chapters[0],
      requestDelayMs: 1500,
    },
    progress: { done: 0, total: 1 },
    createdAt: Date.now(),
  };
}

describe('series download', () => {
  beforeEach(() => {
    storage = new Map<string, unknown>();
    installChromeMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, 'chrome');
  });

  it('sorts by chapter number and selects an inclusive numeric range', () => {
    expect(selectChaptersInRange(chapters, 129, 130).map((chapter) => chapter.number)).toEqual([
      129, 129.5, 130,
    ]);
    expect(selectChaptersInRange(chapters, 130, 129.5).map((chapter) => chapter.number)).toEqual([
      129.5, 130,
    ]);
  });

  it('selects chapters missing from the completed history', () => {
    const downloaded = new Set([chapters[1]?.url ?? '']);
    expect(
      selectUndownloadedChapters(chapters, downloaded).map((chapter) => chapter.number),
    ).toEqual([130, 129]);
  });

  it('requires explicit confirmation only when more than 20 chapters are selected', () => {
    expect(requiresSeriesConfirmation(20)).toBe(false);
    expect(requiresSeriesConfirmation(21)).toBe(true);
  });

  it('registers the series module for series page contexts', () => {
    const module = getModule('series-download');
    expect(module).toBeDefined();
    expect(
      module?.canHandle({
        url: 'https://mangas-origines.fr/oeuvre/overgeared/',
        kind: 'series',
        adapterId: 'mangas-origines',
        tabId: 1,
      }),
    ).toBe(true);
  });

  it('allows only one persisted temporary-tab lock at a time', async () => {
    await expect(acquireSeriesTemporaryTabLock('series-a')).resolves.toBe(true);
    await expect(acquireSeriesTemporaryTabLock('series-b')).resolves.toBe(false);
    await releaseSeriesTemporaryTabLock('series-a');
    await expect(acquireSeriesTemporaryTabLock('series-b')).resolves.toBe(true);
  });

  it('creates the parent and every child queued before starting processing', async () => {
    const result = await createSeriesJob(
      {
        seriesId,
        seriesTitle: 'Overgeared',
        sourceUrl: 'https://mangas-origines.fr/oeuvre/overgeared/',
        adapterId: 'mangas-origines',
        packagerId: 'cbz',
        chapters,
        requestDelayMs: 1500,
      },
      { startProcessing: false },
    );

    const jobs = await getJobs();
    const parent = jobs[result.jobId];
    expect(parent?.kind).toBe('series');
    expect(parent?.state).toBe('queued');
    expect(parent?.children).toHaveLength(3);
    const children = (parent?.children ?? []).map((id) => jobs[id]);
    expect(children.every((job) => job?.state === 'queued')).toBe(true);
    expect((parent?.params.chapters as ChapterRef[]).map((chapter) => chapter.number)).toEqual([
      129, 129.5, 130,
    ]);
  });

  it('records and reads completed chapters in the series history', async () => {
    const chapter = chapters[1];
    if (!chapter) throw new Error('Chapitre de test absent.');
    await markChapterDownloaded(seriesId, chapter);

    await expect(readSeriesHistory(seriesId)).resolves.toMatchObject({
      [chapter.url]: { number: 129.5, label: 'Chapitre 129.5', url: chapter.url },
    });
  });

  it('always closes a temporary tab when reading rejects', async () => {
    const close = vi.fn(async () => undefined);
    const read = vi.fn(async () => {
      throw new Error('tab closed');
    });

    await expect(withTemporaryTab(async () => 42, read, close)).rejects.toThrow('tab closed');
    expect(close).toHaveBeenCalledWith(42);
  });

  it('uses exponential 429/503 backoff with a 60-second ceiling', async () => {
    expect(getRateLimitBackoffMs(0)).toBe(2000);
    expect(getRateLimitBackoffMs(1)).toBe(4000);
    expect(getRateLimitBackoffMs(2)).toBe(8000);
    expect(getRateLimitBackoffMs(8)).toBe(60_000);

    vi.useFakeTimers();
    const sleep = (delay: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, delay));
    let settled = false;
    const promise = waitForRateLimitBackoff(2, sleep).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(7999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe(8000);
  });

  it('chooses html-parse only when the adapter supports it and prefs allow it', () => {
    expect(chooseAcquisitionStrategy('live-dom', 'html-parse')).toBe('live-dom');
    expect(chooseAcquisitionStrategy('live-dom', 'auto')).toBe('live-dom');
    expect(chooseAcquisitionStrategy('html-parse', 'live-dom')).toBe('live-dom');
    expect(chooseAcquisitionStrategy('html-parse', 'auto')).toBe('html-parse');
    expect(chooseAcquisitionStrategy('html-parse', 'html-parse')).toBe('html-parse');
  });

  it('waits with a fake clock, requeues a rate-limited chapter, then pauses its parent', async () => {
    const child = childJob('rate-limited-child', 'series-parent', 'failed');
    child.error = { code: 'FETCH_FAILED', message: 'Échec HTTP 429 pour image.webp' };
    const parent = parentJob([child.id], Date.now(), 'running');
    await setJobs({ [parent.id]: parent, [child.id]: child });
    vi.useFakeTimers();
    let settled = false;
    const backoff = backoffAndPauseSeriesForRateLimit(parent.id, child.id).then((delay) => {
      settled = true;
      return delay;
    });
    for (let tick = 0; tick < 8 && vi.getTimerCount() === 0; tick += 1) {
      await Promise.resolve();
    }
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(backoff).resolves.toBe(2000);

    const jobs = await getJobs();
    expect(jobs[parent.id]?.state).toBe('paused');
    expect(jobs[parent.id]?.params.retryChildId).toBe(child.id);
    expect(jobs[child.id]?.state).toBe('queued');
    expect(jobs[child.id]?.error).toBeUndefined();
  });

  it('pauses, resumes, and cancels the parent queue and its queued children', async () => {
    const child = childJob('chapter-child', 'series-parent');
    const nextChild = childJob('next-chapter-child', 'series-parent');
    const parent = parentJob([child.id, nextChild.id]);
    parent.state = 'paused';
    parent.params = { ...parent.params, runnerToken: 'active-worker' };
    await setJobs({ [parent.id]: parent, [child.id]: child, [nextChild.id]: nextChild });

    await expect(handleSeriesJobControl({ jobId: parent.id, action: 'resume' })).resolves.toEqual({
      handled: true,
      ok: true,
    });
    expect((await getJobs())[parent.id]?.state).toBe('running');

    await expect(handleSeriesJobControl({ jobId: parent.id, action: 'pause' })).resolves.toEqual({
      handled: true,
      ok: true,
    });
    expect((await getJobs())[parent.id]?.state).toBe('paused');

    await expect(handleSeriesJobControl({ jobId: parent.id, action: 'cancel' })).resolves.toEqual({
      handled: true,
      ok: true,
    });
    const jobs = await getJobs();
    expect(jobs[parent.id]?.state).toBe('cancelled');
    expect(jobs[child.id]?.state).toBe('cancelled');
    expect(jobs[nextChild.id]?.state).toBe('cancelled');
  });

  it('explicitly restarts a terminal parent after failed children are requeued', async () => {
    const completed = childJob('completed-child', 'series-parent', 'done');
    const failed = childJob('failed-retry-child', 'series-parent', 'failed');
    failed.error = { code: 'FETCH_FAILED', message: 'image failed' };
    const parent = parentJob([completed.id, failed.id], Date.now(), 'done');
    parent.progress = { done: 2, total: 2 };
    await setJobs({ [parent.id]: parent, [completed.id]: completed, [failed.id]: failed });

    await requeueFailedJob(failed.id);
    const restarted = await restartTerminalSeriesJob(parent.id);

    expect(restarted?.state).toBe('running');
    expect(restarted?.progress).toEqual({ done: 1, total: 2 });
    expect((await getJobs())[failed.id]?.state).toBe('queued');
  });

  it('continues to the next child after one chapter archive fails', async () => {
    const failedChapter = chapters[0];
    const successfulChapter = chapters[1];
    if (!failedChapter || !successfulChapter) throw new Error('Chapitres de test absents.');
    const failedChild = childJob('failed-chapter', 'series-parent');
    const successfulChild = childJob('successful-chapter', 'series-parent');
    for (const [child, chapter] of [
      [failedChild, failedChapter],
      [successfulChild, successfulChapter],
    ] as const) {
      child.params = {
        ...child.params,
        chapter,
        pages: [{ index: 1, url: `https://cdn.example.com/${chapter.number}.webp`, ext: 'webp' }],
        meta: { series: 'Overgeared', chapter, pageCount: 1, sourceUrl: chapter.url },
      };
      child.progress = { done: 0, total: 1 };
    }
    const parent = parentJob([failedChild.id, successfulChild.id]);
    parent.params = { ...parent.params, requestDelayMs: 0, packagerId: 'cbz' };
    await setJobs({
      [parent.id]: parent,
      [failedChild.id]: failedChild,
      [successfulChild.id]: successfulChild,
    });

    const requestedDownloads: string[] = [];
    let downloadSearchCount = 0;
    const area = storageArea();
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          id: 'grandload-test',
          lastError: undefined,
          getURL: (path: string) => `chrome-extension://grandload-test/${path}`,
          getContexts: async (_query: unknown) => [{}],
          sendMessage: (
            message: { type?: string; payload?: { jobId?: string } },
            callback?: (response: unknown) => void,
          ) => {
            if (message.type === 'BUILD_ARCHIVE' && message.payload?.jobId === failedChild.id) {
              callback?.({ ok: false, error: { code: 'FETCH_FAILED', message: 'Image denied' } });
              return;
            }
            if (message.type === 'BUILD_ARCHIVE') {
              callback?.({
                ok: true,
                data: { kind: 'archive', blobUrl: 'blob:successful', size: 10 },
              });
              return;
            }
            callback?.({ ok: true, data: { ok: true } });
          },
        },
        storage: { local: area, session: area },
        offscreen: {
          createDocument: vi.fn((_options: unknown, callback?: () => void) => callback?.()),
        },
        downloads: {
          download: vi.fn((options: { url: string }, callback: (id: number) => void) => {
            requestedDownloads.push(options.url);
            callback(55);
          }),
          search: vi.fn((_query: unknown, callback: (items: unknown[]) => void) => {
            downloadSearchCount += 1;
            callback([
              {
                id: 55,
                state: 'complete',
                filename: 'C:\\Downloads\\Grandload\\Overgeared\\Overgeared - Chapitre 129.5.cbz',
                mime: 'application/octet-stream',
                byExtensionName: '',
              },
            ]);
          }),
          cancel: vi.fn((_id: number, callback?: () => void) => callback?.()),
          onChanged: {
            addListener: vi.fn(),
            removeListener: vi.fn(),
          },
        },
      },
    });

    await runSeriesJob(parent.id);

    const jobs = await getJobs();
    expect(jobs[failedChild.id]?.state).toBe('failed');
    expect(jobs[successfulChild.id]?.state).toBe('done');
    expect(jobs[parent.id]?.state).toBe('done');
    expect(jobs[parent.id]?.params.summary).toEqual({ succeeded: 1, failed: 1, ignored: 0 });
    expect(requestedDownloads).toEqual(['blob:successful']);
    expect(downloadSearchCount).toBe(2);
  });

  it('refuses to resume a series parent older than ten minutes', async () => {
    const child = childJob('old-child', 'series-parent');
    const parent = parentJob([child.id], Date.now() - 11 * 60 * 1000, 'running');
    await setJobs({ [parent.id]: parent, [child.id]: child });

    await recoverSeriesJobs();

    const jobs = await getJobs();
    expect(jobs[parent.id]?.state).toBe('failed');
    expect(jobs[parent.id]?.error?.message).toBe('Interrompu (relance annulée)');
    expect(jobs[child.id]?.state).toBe('failed');
  });

  describe('Acquisition fallback from raw HTML', () => {
    it.each([
      '<html><body><p>No reader markup</p></body></html>',
      '<html><body><img class="chapter-page"></body></html>',
      '<html><body><img class="chapter-page" src="/one.webp"><img class="chapter-page"></body></html>',
    ])('falls back to live-dom when HTML is empty, has blank images, or is incomplete', async (html) => {
      const adapterId = `html-fixture-${Math.random().toString(16).slice(2)}`;
      registerAdapter(makeHtmlAdapter(adapterId));
      const { readChapterPagesForSeries } = await import('../src/background/series-orchestrator');
      const { setPrefs } = await import('../src/core/storage');
      await setPrefs({ acquisitionStrategy: 'auto' });

      const parent = parentJob(['html-child'], Date.now(), 'running');
      const child = childJob('html-child', parent.id);
      child.params.adapterId = adapterId;
      child.params.chapter = { number: 1, label: 'Chapitre 1', url: 'https://example.test/chapter/1' };
      await setJobs({ [parent.id]: parent, [child.id]: child });

      const originalParser = globalThis.DOMParser;
      globalThis.DOMParser = new JSDOM().window.DOMParser as unknown as typeof DOMParser;
      vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 200 })));
      const originalChrome = globalThis.chrome;
      const tabsCreated = vi.fn((_options: unknown, callback: (tab: { id: number }) => void) => callback({ id: 998 }));
      const tabsRemoved = vi.fn((_tabId: number, callback?: () => void) => callback?.());
      Object.defineProperty(globalThis, 'chrome', {
        configurable: true,
        value: {
          ...originalChrome,
          tabs: {
            create: tabsCreated,
            remove: tabsRemoved,
            onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
            onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
            get: (_tabId: number, callback: (tab: { status: string }) => void) => callback({ status: 'complete' }),
            sendMessage: (_tabId: number, _message: unknown, callback: (response: unknown) => void) =>
              callback({ ok: true, data: [{ index: 1, url: 'https://cdn.example.test/page.webp', ext: 'webp' }] }),
          },
          scripting: { executeScript: (_options: unknown, callback?: () => void) => callback?.() },
        },
      });

      try {
        const result = await readChapterPagesForSeries(parent, child);
        expect(result.strategyUsed).toBe('live-dom');
        expect(result.pages).toHaveLength(1);
        expect(tabsCreated).toHaveBeenCalledOnce();
        expect(tabsRemoved).toHaveBeenCalledWith(998, expect.any(Function));
      } finally {
        globalThis.DOMParser = originalParser;
      }
    });

    it('never fetches raw HTML when mangas-origines declares live-dom, even if prefs force html-parse', async () => {
      await import('../src/adapters');
      const { readChapterPagesForSeries } = await import('../src/background/series-orchestrator');
      const { setPrefs } = await import('../src/core/storage');
      await setPrefs({ acquisitionStrategy: 'html-parse' });
      const parent = parentJob(['manga-child'], Date.now(), 'running');
      const child = childJob('manga-child', parent.id);
      child.params.adapterId = 'mangas-origines';
      await setJobs({ [parent.id]: parent, [child.id]: child });
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const originalChrome = globalThis.chrome;
      Object.defineProperty(globalThis, 'chrome', {
        configurable: true,
        value: {
          ...originalChrome,
          tabs: {
            create: (_options: unknown, callback: (tab: { id: number }) => void) => callback({ id: 997 }),
            remove: (_tabId: number, callback?: () => void) => callback?.(),
            onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
            onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
            get: (_tabId: number, callback: (tab: { status: string }) => void) => callback({ status: 'complete' }),
            sendMessage: (_tabId: number, _message: unknown, callback: (response: unknown) => void) =>
              callback({ ok: true, data: [{ index: 1, url: 'https://cdn.example.test/page.webp', ext: 'webp' }] }),
          },
          scripting: { executeScript: (_options: unknown, callback?: () => void) => callback?.() },
        },
      });
      const originalParser = globalThis.DOMParser;
      globalThis.DOMParser = new JSDOM().window.DOMParser as unknown as typeof DOMParser;
      try {
        const result = await readChapterPagesForSeries(parent, child);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result.strategyUsed).toBe('live-dom');
      } finally {
        globalThis.DOMParser = originalParser;
      }
    });
  });
});
