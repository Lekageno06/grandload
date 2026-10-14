import { adaptersReady } from '../adapters';
import { getAdapter } from '../core/registry';
import { toGrandloadError } from '../core/errors';
import type { MessageKind, MessagePayloadMap, MessageResultMap } from '../core/messaging';
import { readPageAssets } from './dom-reader';
import { autoScrollUntilStable } from './scroll-loader';

declare const __GRANDLOAD_DEBUG__: boolean;

type ContentRequest = { type: MessageKind; payload: Record<string, unknown> };
let activeAssetScan: AbortController | undefined;
let activeScanId: string | undefined;
let activeScanDebug = false;

function debugScan(message: string, data: Record<string, unknown> = {}): void {
  if (typeof __GRANDLOAD_DEBUG__ === 'undefined' || !__GRANDLOAD_DEBUG__ || !activeScanDebug) return;
  console.info('[Grandload][debug][scan]', message, data);
}

function emitScanEvent(type: 'SCAN_PROGRESS' | 'SCAN_RESULT', payload: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage({ type, payload }, () => {
      const error = chrome.runtime.lastError;
      if (error) debugScan('fermeture du canal événementiel', { type, cause: error.message });
    });
  } catch (error) {
    debugScan('exception pendant l’émission d’un événement', {
      type,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function reply(sendResponse: (response: unknown) => void, response: unknown): void {
  try {
    sendResponse(response);
  } catch (error) {
    debugScan('cause de fermeture du canal lors de sendResponse', {
      cause: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // Le callback Chrome ne doit être appelé qu’une seule fois.
  }
}

function startGenericScan(scanId: string, pageUrl: string, loadLazy: boolean, debug: boolean): void {
  activeAssetScan?.abort();
  const controller = new AbortController();
  activeAssetScan = controller;
  activeScanId = scanId;
  activeScanDebug = debug;
  const startedAt = performance.now();
  debugScan('début du scan', { scanId, loadLazy });
  void (async () => {
    try {
      await adaptersReady;
      if (loadLazy) {
        await autoScrollUntilStable({
          document,
          ...(document.defaultView ? { windowRef: document.defaultView } : {}),
          pageCountProvider: () => readPageAssets(document, pageUrl).length,
          scrollStep: 700,
          maxScrolls: 20,
          stabilizationWindow: 2,
          delayMs: 150,
          signal: controller.signal,
          onProgress: (step, count) => emitScanEvent('SCAN_PROGRESS', { scanId, step, count }),
        });
      }
      const items = readPageAssets(document, pageUrl);
      const cancelled = controller.signal.aborted;
      debugScan('fin du scan', {
        scanId,
        durationMs: Math.round(performance.now() - startedAt),
        images: items.filter((item) => item.type === 'image').length,
        cancelled,
      });
      emitScanEvent('SCAN_RESULT', {
        scanId,
        items,
        ...(cancelled ? { warning: 'Chargement des images paresseuses interrompu : résultats partiels' } : {}),
      });
    } catch (error) {
      debugScan('exception pendant le scan', {
        scanId,
        durationMs: Math.round(performance.now() - startedAt),
        cause: error instanceof Error ? error.message : String(error),
      });
      emitScanEvent('SCAN_RESULT', {
        scanId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (activeScanId === scanId) {
        activeAssetScan = undefined;
        activeScanId = undefined;
      }
    }
  })();
}

function isContentRequest(value: unknown): value is ContentRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    'payload' in value &&
    typeof value.payload === 'object' &&
    value.payload !== null
  );
}

async function handleContentRequest<
  T extends 'READ_SERIES' | 'READ_CHAPTER_PAGES' | 'READ_CHAPTER_META' | 'READ_PAGE_ASSETS' | 'STOP_PAGE_ASSETS',
>(type: T, payload: MessagePayloadMap[T]): Promise<MessageResultMap[T]> {
  await adaptersReady;
  if (type === 'STOP_PAGE_ASSETS') {
    activeAssetScan?.abort();
    return undefined as MessageResultMap[T];
  }
  if (type === 'READ_PAGE_ASSETS') {
    const pagePayload = payload as MessagePayloadMap['READ_PAGE_ASSETS'];
    activeAssetScan?.abort();
    activeAssetScan = new AbortController();
    if (pagePayload.loadLazy) {
      await autoScrollUntilStable({
        document,
        ...(document.defaultView ? { windowRef: document.defaultView } : {}),
        pageCountProvider: () => readPageAssets(document, pagePayload.pageUrl).length,
        scrollStep: 700,
        maxScrolls: 20,
        stabilizationWindow: 2,
        delayMs: 150,
        signal: activeAssetScan.signal,
        onProgress: (step, count) => {
          chrome.runtime.sendMessage({
            type: 'GRANDLOAD_SCAN_PROGRESS',
            payload: { step, count },
          });
        },
      });
    }
    const result = readPageAssets(document, pagePayload.pageUrl) as MessageResultMap[T];
    activeAssetScan = undefined;
    return result;
  }

  const adapter = getAdapter(
    (payload as MessagePayloadMap['READ_CHAPTER_PAGES'] | MessagePayloadMap['READ_SERIES'])
      .adapterId,
  );
  if (!adapter) {
    throw new Error('Adaptateur inconnu.');
  }

  if (type === 'READ_SERIES') {
    return adapter.readSeries(document) as MessageResultMap[T];
  }

  if (type === 'READ_CHAPTER_META') {
    return adapter.readChapterMeta(document, window.location.href) as MessageResultMap[T];
  }

  if (adapter.prepareChapter) {
    await adapter.prepareChapter(document);
  }
  const pages = adapter.readChapterPages(document);
  if (pages.length === 0) {
    throw new Error('Aucune image détectée dans le chapitre.');
  }
  return pages as MessageResultMap[T];
}

const contentGlobal = globalThis as typeof globalThis & { __grandloadContentReader?: boolean };
const existingListenerCount = contentGlobal.__grandloadContentReader ? 1 : 0;
debugScan('injection de content.js', {
  listenersAlreadyPresent: existingListenerCount,
  frame: 0,
});
if (!contentGlobal.__grandloadContentReader) {
  contentGlobal.__grandloadContentReader = true;
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isContentRequest(message)) {
      return false;
    }
    if (message.type === 'SCAN_START') {
      try {
        const payload = message.payload as { scanId?: unknown; pageUrl?: unknown; loadLazy?: unknown; debug?: unknown };
        if (typeof payload.scanId !== 'string' || typeof payload.pageUrl !== 'string') {
          throw new Error('Paramètres de scan invalides.');
        }
        reply(sendResponse, { ok: true, data: { scanId: payload.scanId } });
        startGenericScan(payload.scanId, payload.pageUrl, payload.loadLazy === true, payload.debug === true);
      } catch (error) {
        debugScan('exception avant réponse SCAN_START', {
          cause: error instanceof Error ? error.message : String(error),
        });
        reply(sendResponse, {
          ok: false,
          error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) },
        });
      }
      return false;
    }
    if (message.type === 'SCAN_CANCEL') {
      try {
        const payload = message.payload as { scanId?: unknown };
        if (payload.scanId === activeScanId) activeAssetScan?.abort();
        reply(sendResponse, { ok: true, data: { ok: true } });
      } catch (error) {
        reply(sendResponse, { ok: false, error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) } });
      }
      return false;
    }
    if (message.type === 'STOP_PAGE_ASSETS') {
      activeAssetScan?.abort();
      reply(sendResponse, { ok: true });
      return false;
    }
    if (
      message.type !== 'READ_SERIES' &&
      message.type !== 'READ_CHAPTER_PAGES' &&
      message.type !== 'READ_CHAPTER_META' &&
      message.type !== 'READ_PAGE_ASSETS'
    ) {
      return false;
    }

    void handleContentRequest(
      message.type,
      message.payload as MessagePayloadMap[typeof message.type],
    )
        .then((data) => reply(sendResponse, { ok: true, data }))
      .catch((error: unknown) => {
        const normalized = toGrandloadError(error, 'ADAPTER_STRUCTURE');
          reply(sendResponse, {
          ok: false,
          error: { code: normalized.code, message: normalized.message },
        });
      });
    return true;
  });
}

try {
  chrome.runtime.sendMessage(
    {
      type: 'CONTENT_READER_READY',
      payload: { listeners: existingListenerCount, frame: 0 },
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
} catch (error) {
  debugScan('exception pendant le journal de ready', {
    cause: error instanceof Error ? error.message : String(error),
  });
}

console.info('Grandload content reader ready.');
