import '../adapters';
import { getAdapter } from '../core/registry';
import { toGrandloadError } from '../core/errors';
import type { MessageKind, MessagePayloadMap, MessageResultMap } from '../core/messaging';
import { readPageAssets } from '../modules/generic-scan/content/dom-reader';

type ContentRequest = { type: MessageKind; payload: Record<string, unknown> };

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
  T extends 'READ_SERIES' | 'READ_CHAPTER_PAGES' | 'READ_CHAPTER_META' | 'READ_PAGE_ASSETS',
>(type: T, payload: MessagePayloadMap[T]): Promise<MessageResultMap[T]> {
  if (type === 'READ_PAGE_ASSETS') {
    return readPageAssets(
      document,
      (payload as MessagePayloadMap['READ_PAGE_ASSETS']).pageUrl,
    ) as MessageResultMap[T];
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
if (!contentGlobal.__grandloadContentReader) {
  contentGlobal.__grandloadContentReader = true;
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isContentRequest(message)) {
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
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => {
        const normalized = toGrandloadError(error, 'ADAPTER_STRUCTURE');
        sendResponse({
          ok: false,
          error: { code: normalized.code, message: normalized.message },
        });
      });
    return true;
  });
}

console.info('Grandload content reader ready.');
