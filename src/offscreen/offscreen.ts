import { toGrandloadError } from '../core/errors';
import type { MessagePayloadMap, MessageResponse } from '../core/messaging';
import { createArchive, revokeBlobUrls } from './archive-builder';
import { writeCustomFiles } from '../destinations/custom-folder';

const activeBuilds = new Map<string, AbortController>();

function sendProgress(jobId: string, done: number, total: number): void {
  chrome.runtime.sendMessage({ type: 'ARCHIVE_PROGRESS', payload: { jobId, done, total } }, () => {
    if (chrome.runtime.lastError) {
      console.error('Impossible de transmettre la progression de l’archive.');
    }
  });
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (typeof message !== 'object' || message === null || !('type' in message)) {
    return false;
  }
  if (!('payload' in message) || typeof message.payload !== 'object' || message.payload === null) {
    return false;
  }

  if (message.type === 'BUILD_ARCHIVE') {
    const payload = message.payload as MessagePayloadMap['BUILD_ARCHIVE'];
    const controller = new AbortController();
    activeBuilds.set(payload.jobId, controller);

    void createArchive({
      jobId: payload.jobId,
      pages: payload.pages,
      packagerId: payload.packagerId,
      meta: payload.meta,
      signal: controller.signal,
      onProgress: sendProgress,
    })
      .then((result) => {
        const response: MessageResponse<typeof result> = { ok: true, data: result };
        sendResponse(response);
      })
      .catch((error: unknown) => {
        const normalized = toGrandloadError(error, 'FETCH_FAILED');
        const response: MessageResponse<never> = {
          ok: false,
          error: { code: normalized.code, message: normalized.message },
        };
        sendResponse(response);
      })
      .finally(() => activeBuilds.delete(payload.jobId));

    return true;
  }

  if (message.type === 'CANCEL_ARCHIVE') {
    const payload = message.payload as MessagePayloadMap['CANCEL_ARCHIVE'];
    activeBuilds.get(payload.jobId)?.abort();
    sendResponse({ ok: true, data: { ok: true } });
    return false;
  }

  if (message.type === 'REVOKE_BLOBS') {
    const payload = message.payload as MessagePayloadMap['REVOKE_BLOBS'];
    revokeBlobUrls(payload.blobUrls);
    sendResponse({ ok: true, data: { ok: true } });
    return false;
  }

  if (message.type === 'WRITE_CUSTOM_FILES') {
    const payload = message.payload as MessagePayloadMap['WRITE_CUSTOM_FILES'];
    void writeCustomFiles(payload.files)
      .then(() => sendResponse({ ok: true, data: { ok: true } }))
      .catch((error: unknown) => sendResponse({
        ok: false,
        error: { code: 'FETCH_FAILED', message: error instanceof Error ? error.message : 'Écriture impossible.' },
      }));
    return true;
  }

  return false;
});

console.info('Grandload offscreen document ready.');
