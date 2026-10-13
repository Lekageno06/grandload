import { GrandloadError } from '../core/errors';
import type { PageRef } from '../core/types';

export type FetchedImage = {
  page: PageRef;
  data: Uint8Array;
  extension: string;
};

export type ImageFetchOptions = {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  fetcher?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
  timeoutMs?: number;
};

const MAX_CONCURRENCY = 3;
const RETRY_DELAYS_MS = [1000, 3000, 6000];
const REQUEST_TIMEOUT_MS = 30_000;
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

function extensionFor(page: PageRef, contentType: string): string {
  const extension = page.ext
    .replace(/^\./u, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '');
  if (extension) {
    return extension;
  }

  const mime = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return EXTENSION_BY_MIME[mime] ?? 'img';
}

function remoteFailureMessage(url: string, status: number, contentType: string): string {
  const type = contentType || 'absent';
  if (status === 403 || status === 429 || status === 503 || type.includes('text/html')) {
    return `Le site a refusé ou ralenti les téléchargements (HTTP ${status}) : réessaie plus tard ou augmente le délai dans les préférences. Content-Type : ${type}. URL : ${url}`;
  }
  return `Échec HTTP ${status} pour ${url}. Content-Type : ${type}`;
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /failed to fetch|network error|networkerror/iu.test(error.message));
}

async function fetchOne(
  page: PageRef,
  options: Required<Pick<ImageFetchOptions, 'fetcher' | 'sleep' | 'timeoutMs'>> & ImageFetchOptions,
): Promise<FetchedImage> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (options.signal?.aborted) {
      throw new GrandloadError('FETCH_FAILED', 'Téléchargement annulé.');
    }

    const controller = new AbortController();
    const abortFromParent = (): void => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abortFromParent, { once: true });
    const timeoutId = globalThis.setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await options.fetcher(page.url, {
        credentials: 'include',
        signal: controller.signal,
      });
      const contentType =
        response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
      if (!response.ok) {
        throw new GrandloadError('FETCH_FAILED', remoteFailureMessage(page.url, response.status, contentType));
      }
      if (!contentType.startsWith('image/')) {
        throw new GrandloadError('FETCH_FAILED', remoteFailureMessage(page.url, response.status, contentType));
      }

      const data = new Uint8Array(await response.arrayBuffer());
      if (data.byteLength === 0) {
        throw new GrandloadError('FETCH_FAILED', `Image vide : ${page.url}`);
      }

      return { page, data, extension: extensionFor(page, contentType) };
    } catch (error) {
      if (options.signal?.aborted) {
        throw new GrandloadError('FETCH_FAILED', 'Téléchargement annulé.');
      }

      if (attempt >= RETRY_DELAYS_MS.length) {
        if (error instanceof GrandloadError) {
          throw error;
        }
        if (isNetworkFailure(error)) {
          throw new GrandloadError('FETCH_FAILED', `Connexion interrompue pendant le téléchargement de ${page.url}.`);
        }
        throw new GrandloadError(
          'FETCH_FAILED',
          error instanceof Error ? error.message : `Échec du téléchargement de ${page.url}`,
        );
      }

      await options.sleep(RETRY_DELAYS_MS[attempt] ?? 3000);
    } finally {
      globalThis.clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', abortFromParent);
    }
  }

  throw new GrandloadError('FETCH_FAILED', `Échec du téléchargement de ${page.url}`);
}

export async function fetchImages(
  pages: PageRef[],
  options: ImageFetchOptions = {},
): Promise<FetchedImage[]> {
  const fetchOptions = {
    ...options,
    fetcher: options.fetcher ?? globalThis.fetch.bind(globalThis),
    sleep: options.sleep ?? wait,
    timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  };
  const results: Array<FetchedImage | undefined> = new Array(pages.length);
  let nextIndex = 0;
  let done = 0;
  let hasFailure = false;
  let firstFailure: unknown;
  const controller = new AbortController();
  const abortFromParent = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    controller.abort(options.signal.reason);
  } else {
    options.signal?.addEventListener('abort', abortFromParent, { once: true });
  }
  const workerOptions = { ...fetchOptions, signal: controller.signal };

  const worker = async (workerId: number): Promise<void> => {
    while (true) {
      if (controller.signal.aborted) {
        throw new GrandloadError('FETCH_FAILED', 'Téléchargement annulé.');
      }

      const index = nextIndex;
      nextIndex += 1;
      if (index >= pages.length) {
        return;
      }
      if (hasFailure && workerId > 0) return;

      const page = pages[index];
      if (!page) {
        throw new GrandloadError('FETCH_FAILED', 'Référence de planche manquante.');
      }

      try {
        results[index] = await fetchOne(page, workerOptions);
        done += 1;
        options.onProgress?.(done, pages.length);
      } catch (error) {
        if (!hasFailure) {
          hasFailure = true;
          firstFailure = error;
        }
        throw error;
      }
    }
  };

  try {
    const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, pages.length) }, (_value, index) => worker(index));
    await Promise.allSettled(workers);
    if (hasFailure) {
      throw firstFailure;
    }
  } finally {
    options.signal?.removeEventListener('abort', abortFromParent);
  }

  return results.map((result) => {
    if (!result) {
      throw new GrandloadError('FETCH_FAILED', 'Une image n’a pas été acquise.');
    }
    return result;
  });
}
