import { GrandloadError, toGrandloadError } from '../core/errors';
import {
  getJobs,
  removeRequestedDownloadName,
  setRequestedDownloadName,
  updateJobs,
} from '../core/storage';
import type { ArchiveBuildResult, ArchiveMeta, Job, JobState, PageRef } from '../core/types';
import type { MessagePayloadMap, MessageResponse } from '../core/messaging';
import { sanitizeFileName } from '../shared/url-utils';
import { getPackagerMetadata } from '../packagers/metadata';

export type ChapterJobParams = {
  pages: PageRef[];
  packagerId: 'cbz' | 'zip' | 'folder';
  meta: ArchiveMeta;
  options: Record<string, unknown>;
  downloadId?: number;
  blobUrls?: string[];
};

function createJobId(): string {
  return `chapter-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isTerminal(state: JobState): boolean {
  return state === 'done' || state === 'failed' || state === 'cancelled';
}

function publishUpdate(job: Job): void {
  const payload = {
    jobId: job.id,
    state: job.state,
    progress: job.progress,
    ...(job.error ? { error: job.error } : {}),
    ...(job.warning ? { warning: job.warning } : {}),
  };
  chrome.runtime.sendMessage({ type: 'JOB_UPDATE', payload }, () => {
    void chrome.runtime.lastError;
  });
}

async function saveJob(job: Job): Promise<void> {
  const jobs = await updateJobs((currentJobs) => ({ ...currentJobs, [job.id]: job }));
  const savedJob = jobs[job.id];
  if (savedJob) {
    publishUpdate(savedJob);
  }
}

async function updateJob(jobId: string, update: (job: Job) => Job): Promise<Job | undefined> {
  let updatedJob: Job | undefined;
  const jobs = await updateJobs((currentJobs) => {
    const current = currentJobs[jobId];
    if (!current) {
      return currentJobs;
    }
    const candidate = update(current);
    updatedJob = protectTerminalJobUpdate(current, candidate);
    return { ...currentJobs, [jobId]: updatedJob };
  });
  const savedJob = jobs[jobId];
  if (savedJob) {
    publishUpdate(savedJob);
  }
  return updatedJob;
}

export function protectTerminalJobUpdate(current: Job, candidate: Job): Job {
  if (!isTerminal(current.state)) {
    return candidate;
  }
  if (
    candidate.state !== current.state ||
    candidate.progress.done !== current.progress.done ||
    candidate.progress.total !== current.progress.total
  ) {
    return candidate.warning ? { ...current, warning: candidate.warning } : current;
  }
  return candidate;
}

export function isStaleRunningJob(job: Job, now = Date.now()): boolean {
  return job.state === 'running' && now - job.createdAt > 10 * 60 * 1000;
}

export function detectDownloadFilenameWarning(
  requested: string,
  observed: Pick<chrome.downloads.DownloadItem, 'filename' | 'mime' | 'byExtensionName'>,
): Job['warning'] | undefined {
  const actual = observed.filename;
  const normalizedRequested = requested.replace(/\\/gu, '/').toLowerCase();
  const normalizedActual = actual.replace(/\\/gu, '/').toLowerCase();
  if (
    normalizedActual === normalizedRequested ||
    normalizedActual.endsWith(`/${normalizedRequested}`)
  ) {
    return undefined;
  }
  void observed.mime;
  void observed.byExtensionName;
  return { requested, actual };
}

function chapterNumberFromUrl(url: string): number {
  const match = new URL(url).pathname.match(/\/chapitre-(\d+)(?:-(\d+))?\/?$/u);
  if (!match?.[1]) {
    return 0;
  }
  return Number(match[1]) + (match[2] ? Number(`0.${match[2]}`) : 0);
}

export function buildChapterDownloadFilename(meta: ArchiveMeta, extension: string): string {
  const series = sanitizeFileName(meta.series, 'Série');
  const chapterNumber = meta.chapter.number;
  const whole = String(Math.trunc(chapterNumber)).padStart(3, '0');
  const fraction = String(chapterNumber).split('.')[1];
  const number = fraction ? `${whole}.${fraction}` : whole;
  return `Grandload/${series}/${series} - Chapitre ${number}${extension}`;
}

function parseChapterParams(value: Record<string, unknown>): ChapterJobParams {
  if (!Array.isArray(value.pages) || value.pages.length === 0) {
    throw new GrandloadError('ADAPTER_STRUCTURE', 'Aucune planche sélectionnée.');
  }
  if (value.packagerId !== 'cbz' && value.packagerId !== 'zip' && value.packagerId !== 'folder') {
    throw new GrandloadError('REGISTRY_NOT_FOUND', 'Format d’archive invalide.');
  }
  if (typeof value.meta !== 'object' || value.meta === null) {
    throw new GrandloadError('ADAPTER_STRUCTURE', 'Les métadonnées du chapitre sont absentes.');
  }
  const meta = value.meta as ArchiveMeta;
  if (
    typeof meta.series !== 'string' ||
    typeof meta.chapter?.label !== 'string' ||
    typeof meta.chapter?.url !== 'string' ||
    typeof meta.chapter?.number !== 'number' ||
    typeof meta.sourceUrl !== 'string'
  ) {
    throw new GrandloadError('ADAPTER_STRUCTURE', 'Les métadonnées du chapitre sont invalides.');
  }

  return {
    pages: value.pages as PageRef[],
    packagerId: value.packagerId,
    meta,
    options:
      typeof value.options === 'object' && value.options !== null
        ? (value.options as Record<string, unknown>)
        : {},
  };
}

async function ensureOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });
  if (contexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Télécharger les planches et fabriquer les archives du chapitre.',
  });
}

function sendToOffscreen<T extends 'BUILD_ARCHIVE' | 'CANCEL_ARCHIVE' | 'REVOKE_BLOBS'>(
  type: T,
  payload: MessagePayloadMap[T],
): Promise<MessageResponse<T extends 'BUILD_ARCHIVE' ? ArchiveBuildResult : { ok: boolean }>> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response: unknown) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(
          new GrandloadError(
            'RUNTIME_UNAVAILABLE',
            runtimeError.message ?? 'Offscreen indisponible.',
          ),
        );
        return;
      }
      if (typeof response !== 'object' || response === null || !('ok' in response)) {
        reject(
          new GrandloadError('RUNTIME_UNAVAILABLE', 'Réponse invalide de l’offscreen document.'),
        );
        return;
      }
      resolve(
        response as MessageResponse<
          T extends 'BUILD_ARCHIVE' ? ArchiveBuildResult : { ok: boolean }
        >,
      );
    });
  });
}

function getBlobUrls(result: ArchiveBuildResult): string[] {
  return result.kind === 'archive' ? [result.blobUrl] : result.files.map((file) => file.blobUrl);
}

function artifactDownloads(
  result: ArchiveBuildResult,
  meta: ArchiveMeta,
  extension: string,
): Array<{ blobUrl: string; filename: string }> {
  if (result.kind === 'archive') {
    return [{ blobUrl: result.blobUrl, filename: buildChapterDownloadFilename(meta, extension) }];
  }

  const series = sanitizeFileName(meta.series, 'Série');
  const chapterNumber = String(meta.chapter.number);
  return result.files.map((file) => ({
    blobUrl: file.blobUrl,
    filename: `Grandload/${series}/Chapitre ${chapterNumber}/${file.name}`,
  }));
}

function waitForDownload(downloadId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      chrome.downloads.onChanged.removeListener(listener);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const listener = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.id !== downloadId) {
        return;
      }
      if (delta.state?.current === 'complete') {
        finish();
      } else if (delta.error?.current) {
        finish(
          new GrandloadError('FETCH_FAILED', `Téléchargement interrompu : ${delta.error.current}`),
        );
      }
    };

    chrome.downloads.onChanged.addListener(listener);
    chrome.downloads.search({ id: downloadId }, (items) => {
      const item = items[0];
      if (item?.state === 'complete') {
        finish();
      } else if (item?.error) {
        finish(new GrandloadError('FETCH_FAILED', `Téléchargement interrompu : ${item.error}`));
      }
    });
  });
}

async function downloadArtifact(
  jobId: string,
  artifact: { blobUrl: string; filename: string },
): Promise<chrome.downloads.DownloadItem> {
  await setRequestedDownloadName(artifact.blobUrl, artifact.filename);
  let downloadId: number;
  try {
    downloadId = await new Promise<number>((resolve, reject) => {
      chrome.downloads.download(
        { url: artifact.blobUrl, filename: artifact.filename, conflictAction: 'uniquify' },
        (id) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(
              new GrandloadError('FETCH_FAILED', error.message ?? 'Téléchargement impossible.'),
            );
            return;
          }
          resolve(id);
        },
      );
    });
  } catch (error) {
    await removeRequestedDownloadName(artifact.blobUrl);
    throw error;
  }

  try {
    await updateJob(jobId, (job) => ({ ...job, params: { ...job.params, downloadId } }));
    await waitForDownload(downloadId);
    const items = await new Promise<chrome.downloads.DownloadItem[]>((resolve) => {
      chrome.downloads.search({ id: downloadId }, resolve);
    });
    const observed = items[0];
    if (!observed) {
      throw new GrandloadError('FETCH_FAILED', 'Le téléchargement terminé est introuvable.');
    }
    const warning = detectDownloadFilenameWarning(artifact.filename, observed);
    if (warning) {
      await updateJob(jobId, (job) => ({ ...job, warning }));
    }
    return observed;
  } finally {
    await removeRequestedDownloadName(artifact.blobUrl);
  }
}

async function revokeUrls(blobUrls: string[]): Promise<void> {
  if (blobUrls.length === 0) {
    return;
  }
  try {
    await sendToOffscreen('REVOKE_BLOBS', { blobUrls });
  } catch (error) {
    console.error('Échec de révocation des blob URLs.', error);
  }
}

async function runChapterJob(jobId: string): Promise<void> {
  const jobs = await getJobs();
  const queued = jobs[jobId];
  if (!queued || queued.state !== 'queued') {
    return;
  }

  const params = parseChapterParams(queued.params);
  const running: Job = {
    ...queued,
    state: 'running',
    progress: { done: 0, total: params.pages.length },
  };
  await saveJob(running);

  let result: ArchiveBuildResult | undefined;
  try {
    await ensureOffscreenDocument();
    if ((await getJobs())[jobId]?.state === 'cancelled') {
      return;
    }
    const response = await sendToOffscreen('BUILD_ARCHIVE', {
      jobId,
      pages: params.pages,
      packagerId: params.packagerId,
      meta: params.meta,
      options: params.options,
    });
    if (!response.ok) {
      throw new GrandloadError('FETCH_FAILED', response.error.message);
    }
    result = response.data;
    const urls = getBlobUrls(result);
    await updateJob(jobId, (job) => ({ ...job, params: { ...job.params, blobUrls: urls } }));

    const packager = getPackagerMetadata(params.packagerId);
    if (!packager) {
      throw new GrandloadError('REGISTRY_NOT_FOUND', `Packager inconnu : ${params.packagerId}`);
    }

    for (const artifact of artifactDownloads(result, params.meta, packager.extension)) {
      const current = (await getJobs())[jobId];
      if (!current || current.state === 'cancelled') {
        return;
      }
      await downloadArtifact(jobId, artifact);
    }

    await updateJob(jobId, (job) => ({
      ...job,
      state: 'done',
      progress: { done: params.pages.length, total: params.pages.length },
    }));
  } catch (error) {
    const current = (await getJobs())[jobId];
    if (current && !isTerminal(current.state)) {
      const normalized = toGrandloadError(error, 'FETCH_FAILED');
      await updateJob(jobId, (job) => ({
        ...job,
        state: 'failed',
        error: { code: normalized.code, message: normalized.message },
      }));
    }
  } finally {
    const current = (await getJobs())[jobId];
    const persistedUrls = Array.isArray(current?.params.blobUrls)
      ? current.params.blobUrls.filter((url): url is string => typeof url === 'string')
      : [];
    await revokeUrls(result ? getBlobUrls(result) : persistedUrls);
  }
}

export async function createChapterJob(
  paramsValue: Record<string, unknown>,
): Promise<{ jobId: string }> {
  const params = parseChapterParams(paramsValue);
  const job: Job = {
    id: createJobId(),
    kind: 'chapter',
    state: 'queued',
    params: {
      pages: params.pages,
      packagerId: params.packagerId,
      meta: params.meta,
      options: params.options,
    },
    progress: { done: 0, total: params.pages.length },
    createdAt: Date.now(),
  };
  await saveJob(job);
  void runChapterJob(job.id).catch((error: unknown) => {
    console.error('Le job chapitre n’a pas pu démarrer.', error);
  });
  return { jobId: job.id };
}

export async function handleArchiveProgress(
  payload: MessagePayloadMap['ARCHIVE_PROGRESS'],
): Promise<void> {
  await updateJob(payload.jobId, (job) => {
    if (job.state !== 'running') {
      return job;
    }
    return {
      ...job,
      progress: { done: payload.done, total: payload.total },
    };
  });
}

export async function cancelChapterJob(jobId: string): Promise<{ ok: boolean }> {
  const jobs = await getJobs();
  const job = jobs[jobId];
  if (!job || job.kind !== 'chapter' || isTerminal(job.state)) {
    return { ok: false };
  }

  await updateJob(jobId, (current) => ({ ...current, state: 'cancelled' }));
  try {
    await sendToOffscreen('CANCEL_ARCHIVE', { jobId });
  } catch {
    // L’offscreen peut ne pas encore avoir été créé.
  }

  const downloadId = job.params.downloadId;
  if (typeof downloadId === 'number') {
    chrome.downloads.cancel(downloadId, () => {
      if (chrome.runtime.lastError) {
        console.error('Impossible d’annuler le téléchargement.', chrome.runtime.lastError.message);
      }
    });
  }
  return { ok: true };
}

export async function handleJobControl(
  payload: MessagePayloadMap['JOB_CONTROL'],
): Promise<{ ok: boolean }> {
  if (payload.action === 'cancel') {
    return await cancelChapterJob(payload.jobId);
  }
  return { ok: false };
}

export async function recoverRunningJobs(): Promise<void> {
  const jobs = await getJobs();
  const interrupted = Object.values(jobs).filter(
    (job) => job.kind === 'chapter' && job.state === 'running',
  );
  for (const job of interrupted) {
    if (isStaleRunningJob(job)) {
      const downloadId = job.params.downloadId;
      if (typeof downloadId === 'number') {
        chrome.downloads.cancel(downloadId, () => undefined);
      }
      try {
        await sendToOffscreen('CANCEL_ARCHIVE', { jobId: job.id });
      } catch {
        // L’offscreen peut avoir été arrêté avec le Service Worker.
      }
      await updateJob(job.id, (current) => ({
        ...current,
        state: 'failed',
        error: { code: 'UNKNOWN', message: 'Interrompu (relance annulée)' },
      }));
      const staleUrls = Array.isArray(job.params.blobUrls)
        ? job.params.blobUrls.filter((url): url is string => typeof url === 'string')
        : [];
      await revokeUrls(staleUrls);
      continue;
    }
    const downloadId = job.params.downloadId;
    if (typeof downloadId === 'number') {
      const completed = await new Promise<boolean>((resolve) => {
        chrome.downloads.search({ id: downloadId }, (items) =>
          resolve(items[0]?.state === 'complete'),
        );
      });
      if (completed && job.params.packagerId !== 'folder') {
        await updateJob(job.id, (current) => ({
          ...current,
          state: 'done',
          progress: { done: current.progress.total, total: current.progress.total },
        }));
        const blobUrls = Array.isArray(job.params.blobUrls)
          ? job.params.blobUrls.filter((url): url is string => typeof url === 'string')
          : [];
        await revokeUrls(blobUrls);
        continue;
      }
      chrome.downloads.cancel(downloadId, () => undefined);
    }

    const blobUrls = Array.isArray(job.params.blobUrls)
      ? job.params.blobUrls.filter((url): url is string => typeof url === 'string')
      : [];
    await revokeUrls(blobUrls);
    try {
      await sendToOffscreen('CANCEL_ARCHIVE', { jobId: job.id });
    } catch {
      // L’offscreen n’existe pas encore après un redémarrage complet.
    }
    await updateJob(job.id, (current) => {
      const params = { ...current.params };
      delete params.downloadId;
      delete params.blobUrls;
      return {
        ...current,
        state: 'queued',
        params,
        progress: { done: 0, total: current.progress.total },
      };
    });
    await runChapterJob(job.id);
  }
}

export function chapterNumberFromUrlForMeta(url: string): number {
  try {
    return chapterNumberFromUrl(url);
  } catch {
    return 0;
  }
}
