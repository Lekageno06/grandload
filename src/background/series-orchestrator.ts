import { GrandloadError } from '../core/errors';
import { getAdapter } from '../core/registry';
import {
  acquireSeriesTemporaryTabLock,
  getJobs,
  getPrefs,
  readStorage,
  releaseSeriesTemporaryTabLock,
  STORAGE_KEYS,
  updateJobs,
  writeStorage,
} from '../core/storage';
import type { ChapterRef, Job, PageRef } from '../core/types';
import type { MessagePayloadMap, MessageResponse } from '../core/messaging';
import { sanitizeDownloadFolder, validateDownloadFolder } from '../shared/url-utils';
import { validateDestinationTemplate } from '../destinations/template';
import {
  cancelChapterJob,
  isTerminal,
  requeueFailedJob,
  runChapterJob,
  updateJob,
} from './orchestrator';

export type SeriesJobParams = {
  seriesId: string;
  seriesTitle: string;
  sourceUrl: string;
  adapterId: string;
  packagerId: 'cbz' | 'zip' | 'folder';
  requestDelayMs: number;
  downloadFolder: string;
  destinationTemplate?: string;
  destinationMode?: 'browser' | 'custom-folder' | 'ask-each-time';
  chapters: ChapterRef[];
  currentChildId?: string;
  currentTabId?: number;
  currentChildProgress?: { done: number; total: number };
  retryChildId?: string;
  rateLimitRetries?: number;
  runnerToken?: string;
};

type SeriesChapterParams = {
  parentId: string;
  seriesId: string;
  seriesTitle: string;
  sourceUrl: string;
  adapterId: string;
  packagerId: 'cbz' | 'zip' | 'folder';
  chapter: ChapterRef;
  temporaryTabId?: number;
  pages?: PageRef[];
  options?: Record<string, unknown>;
  requestDelayMs: number;
  downloadFolder: string;
  destinationTemplate?: string;
  destinationMode?: 'browser' | 'custom-folder' | 'ask-each-time';
};

type HistoryEntry = { number: number; label: string; url: string; completedAt: number };

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function publish(job: Job): void {
  chrome.runtime.sendMessage(
    {
      type: 'JOB_UPDATE',
      payload: {
        jobId: job.id,
        state: job.state,
        progress: job.progress,
        ...(job.error ? { error: job.error } : {}),
        ...(job.warning ? { warning: job.warning } : {}),
      },
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
}

function seriesParams(value: Record<string, unknown>): SeriesJobParams {
  if (
    typeof value.seriesId !== 'string' ||
    typeof value.seriesTitle !== 'string' ||
    typeof value.sourceUrl !== 'string' ||
    typeof value.adapterId !== 'string' ||
    (value.packagerId !== 'cbz' && value.packagerId !== 'zip' && value.packagerId !== 'folder') ||
    !Array.isArray(value.chapters) ||
    value.chapters.length === 0
  ) {
    throw new GrandloadError('ADAPTER_STRUCTURE', 'Les paramètres de la série sont invalides.');
  }

  const chapters = value.chapters.filter(
    (item): item is ChapterRef =>
      typeof item === 'object' &&
      item !== null &&
      'number' in item &&
      typeof item.number === 'number' &&
      'label' in item &&
      typeof item.label === 'string' &&
      'url' in item &&
      typeof item.url === 'string',
  );
  if (chapters.length !== value.chapters.length) {
    throw new GrandloadError(
      'ADAPTER_STRUCTURE',
      'La liste des chapitres contient une entrée invalide.',
    );
  }

  const requestedFolder = value.downloadFolder;
  if (requestedFolder !== undefined && typeof requestedFolder !== 'string') {
    throw new GrandloadError('INVALID_URL', 'Le dossier de destination doit être un nom relatif.');
  }
  const downloadFolder = typeof requestedFolder === 'string' ? requestedFolder : 'Grandload';
  const folderValidation = validateDownloadFolder(downloadFolder);
  if (!folderValidation.valid) {
    throw new GrandloadError('INVALID_URL', folderValidation.error ?? 'Dossier de destination invalide.');
  }
  if (value.destinationTemplate !== undefined && typeof value.destinationTemplate !== 'string') {
    throw new GrandloadError('INVALID_URL', 'Le gabarit de destination est invalide.');
  }
  if (typeof value.destinationTemplate === 'string') {
    const templateValidation = validateDestinationTemplate(value.destinationTemplate);
    if (!templateValidation.valid) {
      throw new GrandloadError('INVALID_URL', templateValidation.error ?? 'Gabarit invalide.');
    }
  }
  if (
    value.destinationMode !== undefined &&
    value.destinationMode !== 'browser' &&
    value.destinationMode !== 'custom-folder' &&
    value.destinationMode !== 'ask-each-time'
  ) {
    throw new GrandloadError('INVALID_URL', 'Mode de destination invalide.');
  }

  return {
    seriesId: value.seriesId,
    seriesTitle: value.seriesTitle,
    sourceUrl: value.sourceUrl,
    adapterId: value.adapterId,
    packagerId: value.packagerId,
    requestDelayMs:
      typeof value.requestDelayMs === 'number' && value.requestDelayMs >= 0
        ? value.requestDelayMs
        : 1500,
    downloadFolder: sanitizeDownloadFolder(downloadFolder),
    ...(typeof value.destinationTemplate === 'string'
      ? { destinationTemplate: value.destinationTemplate }
      : {}),
    destinationMode:
      value.destinationMode === 'custom-folder' || value.destinationMode === 'ask-each-time'
        ? value.destinationMode
        : 'browser',
    chapters: [...chapters].sort((left, right) => left.number - right.number),
  };
}

export async function createSeriesJob(
  value: Record<string, unknown>,
  options: { startProcessing?: boolean } = {},
): Promise<{ jobId: string }> {
  const params = seriesParams(value);
  const now = Date.now();
  const parentId = makeId('series');
  const children: Job[] = params.chapters.map((chapter) => ({
    id: makeId('chapter'),
    kind: 'chapter',
    state: 'queued',
    params: {
      parentId,
      seriesId: params.seriesId,
      seriesTitle: params.seriesTitle,
      sourceUrl: params.sourceUrl,
      adapterId: params.adapterId,
      packagerId: params.packagerId,
      chapter,
      requestDelayMs: params.requestDelayMs,
      downloadFolder: params.downloadFolder,
      ...(params.destinationTemplate ? { destinationTemplate: params.destinationTemplate } : {}),
      destinationMode: params.destinationMode ?? 'browser',
      options: {},
    } satisfies SeriesChapterParams,
    progress: { done: 0, total: 0 },
    createdAt: now,
  }));
  const parent: Job = {
    id: parentId,
    kind: 'series',
    state: 'queued',
    params: { ...params },
    children: children.map((child) => child.id),
    progress: { done: 0, total: children.length },
    createdAt: now,
  };

  await updateJobs((jobs) => ({
    ...jobs,
    [parent.id]: parent,
    ...Object.fromEntries(children.map((child) => [child.id, child])),
  }));
  publish(parent);
  for (const child of children) publish(child);
  if (options.startProcessing !== false) {
    void runSeriesJob(parent.id).catch((error: unknown) => {
      console.error('Le job série n’a pas pu démarrer.', error);
    });
  }
  return { jobId: parent.id };
}

export function getRateLimitBackoffMs(retryIndex: number): number {
  return Math.min(60_000, 2000 * 2 ** Math.max(0, retryIndex));
}

export async function waitForRateLimitBackoff(
  retryIndex: number,
  sleep: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise((resolve) => globalThis.setTimeout(resolve, delayMs)),
): Promise<number> {
  const delayMs = getRateLimitBackoffMs(retryIndex);
  await sleep(delayMs);
  return delayMs;
}

export async function backoffAndPauseSeriesForRateLimit(
  parentId: string,
  childId: string,
  sleep?: (delayMs: number) => Promise<void>,
): Promise<number> {
  const parent = (await getJobs())[parentId];
  if (!parent || parent.state === 'cancelled' || isTerminal(parent.state)) return 0;
  const retries =
    typeof parent.params.rateLimitRetries === 'number' ? parent.params.rateLimitRetries : 0;
  const delayMs = await waitForRateLimitBackoff(retries, sleep);
  const latestParent = (await getJobs())[parentId];
  if (!latestParent || latestParent.state === 'cancelled' || isTerminal(latestParent.state)) {
    return delayMs;
  }
  await requeueFailedJob(childId);
  await updateJob(parentId, (current) => ({
    ...current,
    state: 'paused',
    params: {
      ...current.params,
      retryChildId: childId,
      rateLimitRetries: retries + 1,
    },
  }));
  return delayMs;
}

export async function restartTerminalSeriesJob(parentId: string): Promise<Job | undefined> {
  let restarted: Job | undefined;
  const jobs = await updateJobs((currentJobs) => {
    const current = currentJobs[parentId];
    if (
      !current ||
      current.kind !== 'series' ||
      (current.state !== 'done' && current.state !== 'failed')
    ) {
      return currentJobs;
    }
    const children = (current.children ?? [])
      .map((childId) => currentJobs[childId])
      .filter((child): child is Job => Boolean(child));
    const completed = children.filter(
      (child) => isTerminal(child.state) && child.state !== 'failed',
    ).length;
    const next = {
      ...current,
      state: 'running' as const,
      progress: { done: completed, total: current.children?.length ?? 0 },
    };
    delete next.error;
    restarted = next;
    return { ...currentJobs, [parentId]: next };
  });
  const saved = jobs[parentId];
  if (saved) publish(saved);
  return restarted;
}

async function failStaleSeriesJob(parent: Job): Promise<void> {
  const jobs = await getJobs();
  for (const childId of parent.children ?? []) {
    const child = jobs[childId];
    if (!child || child.state === 'done' || child.state === 'failed' || child.state === 'ignored') {
      continue;
    }
    const tabId = child.params.temporaryTabId;
    if (typeof tabId === 'number') await closeTab(tabId);
    const downloadId = child.params.downloadId;
    if (typeof downloadId === 'number') chrome.downloads.cancel(downloadId, () => undefined);
    if (child.state === 'running') {
      chrome.runtime.sendMessage({ type: 'CANCEL_ARCHIVE', payload: { jobId: child.id } }, () => {
        void chrome.runtime.lastError;
      });
    }
    await updateJob(child.id, (current) => ({
      ...current,
      state: 'failed',
      error: { code: 'UNKNOWN', message: 'Interrompu (relance annulée)' },
    }));
    const blobUrls = Array.isArray(child.params.blobUrls)
      ? child.params.blobUrls.filter((url): url is string => typeof url === 'string')
      : [];
    if (blobUrls.length > 0) {
      chrome.runtime.sendMessage({ type: 'REVOKE_BLOBS', payload: { blobUrls } }, () => {
        void chrome.runtime.lastError;
      });
    }
  }
  const parentTabId = parent.params.currentTabId;
  if (typeof parentTabId === 'number') {
    await closeTab(parentTabId);
  }
  await updateJob(parent.id, (current) => ({
    ...current,
    state: 'failed',
    error: { code: 'UNKNOWN', message: 'Interrompu (relance annulée)' },
  }));
  await releaseSeriesTemporaryTabLock(parent.id);
}

export async function withTemporaryTab<T>(
  create: () => Promise<number>,
  read: (tabId: number) => Promise<T>,
  close: (tabId: number) => Promise<void>,
): Promise<T> {
  let tabId: number | undefined;
  try {
    tabId = await create();
    return await read(tabId);
  } finally {
    if (tabId !== undefined) {
      await close(tabId);
    }
  }
}

function createInactiveTab(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error || typeof tab?.id !== 'number') {
        reject(
          new GrandloadError('FETCH_FAILED', error?.message ?? 'Impossible d’ouvrir le chapitre.'),
        );
        return;
      }
      resolve(tab.id);
    });
  });
}

function closeTab(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.remove(tabId, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = globalThis.setTimeout(
      () => finish(new Error('Délai de chargement du chapitre dépassé.')),
      60_000,
    );
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (updatedTabId: number, changeInfo: { status?: string }): void => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    const onRemoved = (removedTabId: number): void => {
      if (removedTabId === tabId) finish(new Error('L’onglet temporaire du chapitre a été fermé.'));
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;
      if (error || !tab) {
        finish(new Error(error?.message ?? 'L’onglet temporaire du chapitre n’existe plus.'));
      } else if (tab.status === 'complete') {
        finish();
      }
    });
  });
}

function injectContentReader(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message ?? 'Injection du lecteur impossible.'));
      else resolve();
    });
  });
}

function readPagesFromTab(tabId: number, adapterId: string): Promise<PageRef[]> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'READ_CHAPTER_PAGES', payload: { adapterId } },
      (response: unknown) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message ?? 'Le lecteur du chapitre ne répond pas.'));
          return;
        }
        if (typeof response !== 'object' || response === null || !('ok' in response)) {
          reject(new Error('Réponse invalide du lecteur du chapitre.'));
          return;
        }
        const typed = response as MessageResponse<PageRef[]>;
        if (!typed.ok) {
          reject(
            new GrandloadError(
              typed.error.code === 'ADAPTER_STRUCTURE' ? 'ADAPTER_STRUCTURE' : 'FETCH_FAILED',
              typed.error.message,
            ),
          );
          return;
        }
        resolve(typed.data);
      },
    );
  });
}

async function readChapterInTemporaryTab(parent: Job, child: Job): Promise<PageRef[]> {
  const params = child.params as unknown as SeriesChapterParams;
  const lockAcquired = await acquireTabLockForParent(parent.id);
  if (!lockAcquired) {
    throw new GrandloadError(
      'UNKNOWN',
      'Un autre chapitre série utilise déjà l’onglet temporaire.',
    );
  }

  try {
    return await withTemporaryTab(
      () => createInactiveTab(params.chapter.url),
      async (tabId) => {
        await updateJob(child.id, (current) => ({
          ...current,
          params: { ...current.params, temporaryTabId: tabId },
        }));
        await updateJob(parent.id, (current) => ({
          ...current,
          params: { ...current.params, currentTabId: tabId },
        }));
        await waitForTabComplete(tabId);
        await injectContentReader(tabId);
        return await readPagesFromTab(tabId, params.adapterId);
      },
      async (tabId) => {
        await closeTab(tabId);
        await updateJob(child.id, (current) => {
          const childParams = { ...current.params };
          delete childParams.temporaryTabId;
          return { ...current, params: childParams };
        });
        await updateJob(parent.id, (current) => {
          const parentParams = { ...current.params };
          delete parentParams.currentTabId;
          return { ...current, params: parentParams };
        });
      },
    );
  } finally {
    await releaseSeriesTemporaryTabLock(parent.id);
  }
}

async function acquireTabLockForParent(parentId: string): Promise<boolean> {
  for (;;) {
    const parent = (await getJobs())[parentId];
    if (!parent || parent.state !== 'running') {
      return false;
    }
    const acquired = await acquireSeriesTemporaryTabLock(parentId);
    if (acquired) return true;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
  }
}

export async function readSeriesHistory(seriesId: string): Promise<Record<string, HistoryEntry>> {
  return (
    (await readStorage<Record<string, HistoryEntry>>('local', STORAGE_KEYS.history(seriesId))) ?? {}
  );
}

export async function markChapterDownloaded(seriesId: string, chapter: ChapterRef): Promise<void> {
  const key = STORAGE_KEYS.history(seriesId);
  const history = await readSeriesHistory(seriesId);
  history[chapter.url] = {
    number: chapter.number,
    label: chapter.label,
    url: chapter.url,
    completedAt: Date.now(),
  };
  await writeStorage('local', key, history);
}

function isRateLimited(job: Job): boolean {
  return /HTTP\s+(429|503)/iu.test(job.error?.message ?? '');
}

async function updateParentProgress(parentId: string): Promise<void> {
  const jobs = await getJobs();
  const parent = jobs[parentId];
  if (!parent) return;
  const children = (parent.children ?? [])
    .map((childId) => jobs[childId])
    .filter((job): job is Job => Boolean(job));
  const completed = children.filter((child) => isTerminal(child.state)).length;
  await updateJob(parentId, (current) => ({
    ...current,
    progress: { done: completed, total: current.children?.length ?? 0 },
  }));
}

function createArchiveMeta(parent: Job, chapter: ChapterRef): Record<string, unknown> {
  const params = parent.params as unknown as SeriesJobParams;
  return {
    series: params.seriesTitle,
    chapter,
    pageCount: 0,
    sourceUrl: chapter.url,
  };
}

export async function readChapterPagesHtmlParse(url: string, adapterId: string): Promise<PageRef[]> {
  const adapter = getAdapter(adapterId);
  if (!adapter) {
    throw new GrandloadError('UNKNOWN', 'Adaptateur non trouvé.');
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new GrandloadError('FETCH_FAILED', `Échec du chargement du chapitre : HTTP ${response.status}`);
  }

  const html = await response.text();
  if (typeof DOMParser === 'undefined') {
    throw new GrandloadError('UNKNOWN', 'DOMParser non disponible dans cet environnement.');
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Fixe doc.baseURI pour la résolution des URL relatives
  const baseElem = doc.createElement('base');
  baseElem.href = url;
  doc.head?.appendChild(baseElem);

  const pages = adapter.readChapterPages(doc);
  const expectedPageCount = adapter.countChapterPageElements?.(doc);
  const validPages = pages.filter((page) => page.url && page.url.trim().length > 0 && !/^about:blank$/i.test(page.url));
  if (
    validPages.length === 0 ||
    validPages.length < pages.length ||
    (expectedPageCount !== undefined && validPages.length < expectedPageCount)
  ) {
    return [];
  }

  return validPages;
}

export function chooseAcquisitionStrategy(
  adapterStrategy: 'live-dom' | 'html-parse',
  userStrategy: 'auto' | 'live-dom' | 'html-parse',
): 'live-dom' | 'html-parse' {
  return adapterStrategy === 'html-parse' && userStrategy !== 'live-dom'
    ? 'html-parse'
    : 'live-dom';
}

export async function readChapterPagesForSeries(
  parent: Job,
  child: Job,
): Promise<{ pages: PageRef[]; strategyUsed: 'html-parse' | 'live-dom' }> {
  const childParams = child.params as unknown as SeriesChapterParams;
  const adapter = getAdapter(childParams.adapterId);
  if (!adapter) {
    throw new GrandloadError('ADAPTER_STRUCTURE', `Adaptateur introuvable : ${childParams.adapterId}`);
  }
  const prefs = await getPrefs();
  const userStrategy = prefs.acquisitionStrategy || 'auto';
  const selectedStrategy = chooseAcquisitionStrategy(adapter.acquisition, userStrategy);
  const shouldTryHtmlParse = selectedStrategy === 'html-parse';

  if (userStrategy === 'html-parse' && adapter.acquisition === 'live-dom') {
    console.info(
      `[Grandload] Chapitre ${childParams.chapter.number} : l’adaptateur impose live-dom; html-parse ignoré.`,
    );
  }

  if (shouldTryHtmlParse) {
    try {
      const pages = await readChapterPagesHtmlParse(childParams.chapter.url, childParams.adapterId);
      // Règle 2 : repli si 0 planche ou images sans URL
      if (pages.length > 0) {
        console.info(`[Grandload] Chapitre ${childParams.chapter.number} acquis via html-parse (sans onglet)`);
        return { pages, strategyUsed: 'html-parse' };
      }
      console.info(`[Grandload] Chapitre ${childParams.chapter.number} : html-parse n'a retourné aucune planche valide, repli automatique sur live-dom.`);
    } catch (error) {
      console.info(`[Grandload] Chapitre ${childParams.chapter.number} : html-parse a échoué (${error instanceof Error ? error.message : String(error)}), repli automatique sur live-dom.`);
    }
  }

  // Repli automatique ou stratégie par défaut sur live-dom
  const pages = await readChapterInTemporaryTab(parent, child);
  console.info(`[Grandload] Chapitre ${childParams.chapter.number} acquis via live-dom (onglet inactif)`);
  return { pages, strategyUsed: 'live-dom' };
}

async function processSeriesChild(parentId: string, childId: string): Promise<void> {
  let jobs = await getJobs();
  let parent = jobs[parentId];
  let child = jobs[childId];
  if (!parent || !child || child.state !== 'queued') return;

  const seriesParams = parent.params as unknown as SeriesJobParams;
  const childParams = child.params as unknown as SeriesChapterParams;
  await updateJob(parentId, (current) => ({
    ...current,
    params: {
      ...current.params,
      currentChildId: childId,
      currentChildProgress: { done: 0, total: 0 },
    },
  }));

  let pages = childParams.pages;
  if (!pages || pages.length === 0) {
    await updateJob(childId, (current) => ({
      ...current,
      state: 'running',
      progress: { done: 0, total: 1 },
    }));
    let strategyUsed: 'html-parse' | 'live-dom' = 'live-dom';
    try {
      const acquisitionResult = await readChapterPagesForSeries(parent, child);
      pages = acquisitionResult.pages;
      strategyUsed = acquisitionResult.strategyUsed;
    } catch (error) {
      const latestParent = (await getJobs())[parentId];
      if (latestParent?.state === 'cancelled') return;
      if (latestParent?.state === 'paused') {
        await updateJob(childId, (current) => ({
          ...current,
          state: 'queued',
          progress: { done: 0, total: 0 },
        }));
        return;
      }
      const message = error instanceof Error ? error.message : 'Lecture du chapitre impossible.';
      const ignored = message.includes('Aucune image détectée');
      await updateJob(childId, (current) => ({
        ...current,
        state: ignored ? 'ignored' : 'failed',
        error: {
          code: ignored ? 'ADAPTER_STRUCTURE' : 'FETCH_FAILED',
          message: ignored
            ? 'Aucune planche détectée (publication en cours ou chapitre vide).'
            : message,
        },
      }));
      return;
    }

    let extractedPages = pages;
    if (!extractedPages || extractedPages.length === 0) {
      await updateJob(childId, (current) => ({
        ...current,
        state: 'ignored',
        error: {
          code: 'ADAPTER_STRUCTURE',
          message: 'Aucune planche détectée (publication en cours ou chapitre vide).',
        },
      }));
      return;
    }

    await updateJob(childId, (current) => ({
      ...current,
      params: {
        ...current.params,
        strategyUsed,
      },
    }));

    pages = extractedPages;

    jobs = await getJobs();
    parent = jobs[parentId];
    child = jobs[childId];
    if (!parent || !child || parent.state === 'cancelled') return;
    if (parent.state === 'paused') {
      await updateJob(childId, (current) => ({
        ...current,
        state: 'queued',
        params: { ...current.params, pages: extractedPages },
        progress: { done: 0, total: extractedPages.length },
      }));
      return;
    }

    const chapter = childParams.chapter;
    const archiveParams = {
      ...child.params,
      pages: extractedPages,
      packagerId: seriesParams.packagerId,
      meta: createArchiveMeta(parent, chapter),
      options: {
        downloadFolder: seriesParams.downloadFolder,
        ...(seriesParams.destinationTemplate
          ? { destinationTemplate: seriesParams.destinationTemplate }
          : {}),
        destinationMode: seriesParams.destinationMode,
      },
    };
    await updateJob(childId, (current) => ({
      ...current,
      state: 'queued',
      params: archiveParams,
      progress: { done: 0, total: extractedPages.length },
    }));
  }

  await runChapterJob(childId);
  const result = (await getJobs())[childId];
  if (result?.state === 'done') {
    const chapter = childParams.chapter;
    await markChapterDownloaded(seriesParams.seriesId, chapter);
  }
}

export async function runSeriesJob(parentId: string): Promise<void> {
  const token = makeId('runner');
  let acquired = false;
  const claimed = await updateJob(parentId, (parent) => {
    if (parent.state !== 'queued' && parent.state !== 'running') return parent;
    if (typeof parent.params.runnerToken === 'string') return parent;
    acquired = true;
    return {
      ...parent,
      state: 'running',
      params: { ...parent.params, runnerToken: token },
    };
  });
  if (!acquired || claimed?.params.runnerToken !== token) return;

  try {
    const initial = (await getJobs())[parentId];
    if (!initial) return;
    for (const childId of initial.children ?? []) {
      const currentParent = (await getJobs())[parentId];
      if (
        !currentParent ||
        currentParent.state === 'cancelled' ||
        currentParent.state === 'paused'
      ) {
        return;
      }
      const child = (await getJobs())[childId];
      if (!child || child.state !== 'queued') continue;

      await processSeriesChild(parentId, childId);
      let afterChild = await getJobs();
      const completedChild = afterChild[childId];
      const parentAfterChild = afterChild[parentId];
      if (!parentAfterChild || parentAfterChild.state === 'cancelled') return;
      if (completedChild?.state === 'needs-permission') {
        await updateJob(parentId, (current) => ({
          ...current,
          state: 'needs-permission',
          ...(completedChild.error ? { error: completedChild.error } : {}),
        }));
        return;
      }

      if (completedChild && isRateLimited(completedChild)) {
        await backoffAndPauseSeriesForRateLimit(parentId, childId);
        return;
      }

      await updateParentProgress(parentId);
      const latestParent = (await getJobs())[parentId];
      if (!latestParent || latestParent.state === 'paused' || latestParent.state === 'cancelled')
        return;
      const hasRemaining = (latestParent.children ?? []).some(
        (id) => (afterChild[id]?.state ?? 'done') === 'queued',
      );
      if (hasRemaining) {
        const delayMs = (latestParent.params as unknown as SeriesJobParams).requestDelayMs;
        await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
      }
      if (completedChild?.state === 'done') {
        await updateJob(parentId, (current) => ({
          ...current,
          params: { ...current.params, rateLimitRetries: 0 },
        }));
      }
    }

    const jobs = await getJobs();
    const parent = jobs[parentId];
    if (!parent || parent.state === 'cancelled' || parent.state === 'paused') return;
    const children = (parent.children ?? [])
      .map((id) => jobs[id])
      .filter((job): job is Job => Boolean(job));
    const failed = children.filter((child) => child.state === 'failed').length;
    const finished = children.filter((child) => isTerminal(child.state)).length;
    await updateJob(parentId, (current) => ({
      ...current,
      state: failed > 0 && failed === children.length ? 'failed' : 'done',
      progress: { done: finished, total: children.length },
      params: {
        ...current.params,
        summary: {
          succeeded: children.filter((child) => child.state === 'done').length,
          failed,
          ignored: children.filter((child) => child.state === 'ignored').length,
        },
      },
    }));
  } catch (error) {
    const normalized = error instanceof Error ? error.message : 'Échec du traitement de la série.';
    await updateJob(parentId, (parent) => ({
      ...parent,
      state: 'failed',
      error: { code: 'UNKNOWN', message: normalized },
    }));
  } finally {
    await updateJob(parentId, (parent) => {
      if (parent.params.runnerToken !== token) return parent;
      const params = { ...parent.params };
      delete params.runnerToken;
      return { ...parent, params };
    });
  }
}

export async function handleSeriesJobControl(
  payload: MessagePayloadMap['JOB_CONTROL'],
): Promise<{ handled: boolean; ok: boolean }> {
  const jobs = await getJobs();
  const parent = jobs[payload.jobId];
  if (!parent || parent.kind !== 'series') return { handled: false, ok: false };

  if (payload.action === 'pause') {
    if (parent.state !== 'running' && parent.state !== 'queued')
      return { handled: true, ok: false };
    await updateJob(parent.id, (current) => ({ ...current, state: 'paused' }));
    return { handled: true, ok: true };
  }

  if (payload.action === 'resume') {
    if (parent.state !== 'paused' && parent.state !== 'needs-permission') return { handled: true, ok: false };
    if (Date.now() - parent.createdAt > 10 * 60 * 1000) {
      await failStaleSeriesJob(parent);
      return { handled: true, ok: false };
    }
    const retryChildId = parent.params.retryChildId;
    if (typeof retryChildId === 'string') {
      await requeueFailedJob(retryChildId);
    }
    await updateJob(parent.id, (current) => {
      const params = { ...current.params };
      delete params.retryChildId;
      return { ...current, state: 'running', params };
    });
    void runSeriesJob(parent.id);
    return { handled: true, ok: true };
  }

  if (payload.action === 'retry') {
    const failedChildren = (parent.children ?? [])
      .map((id) => jobs[id])
      .filter((child): child is Job => child?.state === 'failed');
    if (failedChildren.length === 0 || (parent.state !== 'done' && parent.state !== 'failed')) {
      return { handled: true, ok: false };
    }
    for (const child of failedChildren) {
      await requeueFailedJob(child.id);
    }
    const restarted = await restartTerminalSeriesJob(parent.id);
    if (!restarted) return { handled: true, ok: false };
    void runSeriesJob(parent.id);
    return { handled: true, ok: true };
  }

  if (payload.action === 'cancel') {
    if (isTerminal(parent.state)) return { handled: true, ok: false };
    await updateJob(parent.id, (current) => ({ ...current, state: 'cancelled' }));
    const currentChildId = parent.params.currentChildId;
    if (typeof currentChildId === 'string') {
      await cancelChapterJob(currentChildId);
    }
    const tabId = parent.params.currentTabId;
    if (typeof tabId === 'number') await closeTab(tabId);
    for (const childId of parent.children ?? []) {
      const child = (await getJobs())[childId];
      if (child && !isTerminal(child.state)) {
        if (child.state === 'running') await cancelChapterJob(childId);
        else await updateJob(childId, (current) => ({ ...current, state: 'cancelled' }));
      }
    }
    await releaseSeriesTemporaryTabLock(parent.id);
    return { handled: true, ok: true };
  }

  return { handled: true, ok: false };
}

export async function recoverSeriesJobs(): Promise<void> {
  const jobs = await getJobs();
  const parents = Object.values(jobs).filter(
    (job) => job.kind === 'series' && (job.state === 'running' || job.state === 'queued'),
  );
  for (const parent of parents) {
    if (Date.now() - parent.createdAt > 10 * 60 * 1000) {
      await failStaleSeriesJob(parent);
      continue;
    }

    for (const childId of parent.children ?? []) {
      const child = jobs[childId];
      if (!child || child.state !== 'running') continue;
      const tabId = child.params.temporaryTabId;
      if (typeof tabId === 'number') await closeTab(tabId);
      const downloadId = child.params.downloadId;
      if (typeof downloadId === 'number') {
        const download = await new Promise<chrome.downloads.DownloadItem | undefined>((resolve) => {
          chrome.downloads.search({ id: downloadId }, (items) => resolve(items[0]));
        });
        if (download?.state === 'complete' && child.params.packagerId !== 'folder') {
          const chapter = child.params.chapter;
          await updateJob(child.id, (current) => ({
            ...current,
            state: 'done',
            progress: { done: current.progress.total, total: current.progress.total },
          }));
          if (
            typeof chapter === 'object' &&
            chapter !== null &&
            'number' in chapter &&
            typeof chapter.number === 'number' &&
            'label' in chapter &&
            typeof chapter.label === 'string' &&
            'url' in chapter &&
            typeof chapter.url === 'string' &&
            typeof child.params.seriesId === 'string'
          ) {
            await markChapterDownloaded(child.params.seriesId, chapter as ChapterRef);
          }
          const completedBlobUrls = Array.isArray(child.params.blobUrls)
            ? child.params.blobUrls.filter((url): url is string => typeof url === 'string')
            : [];
          if (completedBlobUrls.length > 0) {
            chrome.runtime.sendMessage(
              { type: 'REVOKE_BLOBS', payload: { blobUrls: completedBlobUrls } },
              () => {
                void chrome.runtime.lastError;
              },
            );
          }
          continue;
        }
        chrome.downloads.cancel(downloadId, () => undefined);
      }
      const blobUrls = Array.isArray(child.params.blobUrls)
        ? child.params.blobUrls.filter((url): url is string => typeof url === 'string')
        : [];
      if (blobUrls.length > 0) {
        chrome.runtime.sendMessage({ type: 'REVOKE_BLOBS', payload: { blobUrls } }, () => {
          void chrome.runtime.lastError;
        });
      }
      try {
        chrome.runtime.sendMessage({ type: 'CANCEL_ARCHIVE', payload: { jobId: child.id } }, () => {
          void chrome.runtime.lastError;
        });
      } catch {
        // Le document offscreen peut ne pas exister après le réveil.
      }
      await updateJob(child.id, (current) => {
        const params = { ...current.params };
        delete params.temporaryTabId;
        delete params.downloadId;
        delete params.blobUrls;
        const requeued = {
          ...current,
          state: 'queued' as const,
          params,
          progress: { done: 0, total: current.progress.total },
        };
        delete requeued.error;
        return requeued;
      });
    }
    await releaseSeriesTemporaryTabLock(parent.id);
    const parentTabId = parent.params.currentTabId;
    if (typeof parentTabId === 'number') await closeTab(parentTabId);
    await updateJob(parent.id, (current) => {
      const params = { ...current.params };
      delete params.runnerToken;
      delete params.currentTabId;
      delete params.currentChildProgress;
      return { ...current, state: 'queued', params };
    });
    void runSeriesJob(parent.id).catch((error: unknown) => {
      console.error('Impossible de reprendre la série.', error);
    });
  }
}
