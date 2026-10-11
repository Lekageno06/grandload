import { toGrandloadError } from './errors';
import type {
  ArchiveMeta,
  Job,
  JobState,
  PageContext,
  PageRef,
  SeriesInfo,
} from './types';

export type MessageKind =
  | 'PAGE_CONTEXT'
  | 'READ_CHAPTER_PAGES'
  | 'READ_SERIES'
  | 'JOB_CREATE'
  | 'JOB_CONTROL'
  | 'JOB_UPDATE'
  | 'BUILD_ARCHIVE'
  | 'ARCHIVE_PROGRESS';

export interface MessagePayloadMap {
  PAGE_CONTEXT: { tabId: number };
  READ_CHAPTER_PAGES: { adapterId: string };
  READ_SERIES: { adapterId: string };
  JOB_CREATE: { kind: 'chapter' | 'series' | 'links'; params: Record<string, unknown> };
  JOB_CONTROL: { jobId: string; action: 'pause' | 'resume' | 'cancel' | 'retry' };
  JOB_UPDATE: {
    jobId: string;
    state: JobState;
    progress: { done: number; total: number };
    error?: { code: string; message: string };
  };
  BUILD_ARCHIVE: {
    pages: PageRef[];
    packagerId: string;
    meta: ArchiveMeta;
    options: Record<string, unknown>;
  };
  ARCHIVE_PROGRESS: { jobId: string; done: number; total: number };
}

export interface MessageResultMap {
  PAGE_CONTEXT: PageContext;
  READ_CHAPTER_PAGES: PageRef[];
  READ_SERIES: SeriesInfo;
  JOB_CREATE: { jobId: string };
  JOB_CONTROL: { ok: boolean };
  JOB_UPDATE: void;
  BUILD_ARCHIVE: { blobUrl: string; size: number };
  ARCHIVE_PROGRESS: void;
}

export type MessageEnvelope<T extends MessageKind> = {
  type: T;
  payload: MessagePayloadMap[T];
};

export type MessageResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

function isEnvelope(value: unknown): value is { type: MessageKind; payload: Record<string, unknown> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type?: unknown }).type === 'string' &&
    'payload' in value
  );
}

function normalizeErrorResponse(error: unknown): MessageResponse<never> {
  const normalized = toGrandloadError(error, 'UNKNOWN');
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
    },
  };
}

function normalizeMessageResponse<T>(response: unknown): MessageResponse<T> {
  if (typeof response === 'object' && response !== null && 'ok' in response) {
    const typed = response as { ok: boolean; data?: T; error?: { code: string; message: string } };

    if (typed.ok === true) {
      return {
        ok: true,
        data: typed.data as T,
      };
    }

    return {
      ok: false,
      error: {
        code: typed.error?.code ?? 'UNKNOWN',
        message: typed.error?.message ?? 'Erreur inconnue.',
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'UNKNOWN',
      message: 'Aucune réponse valide n’a été reçue.',
    },
  };
}

export async function send<T extends MessageKind>(
  type: T,
  payload: MessagePayloadMap[T],
): Promise<MessageResponse<MessageResultMap[T]>> {
  if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
    return {
      ok: false,
      error: {
        code: 'RUNTIME_UNAVAILABLE',
        message: 'Le runtime Chrome n’est pas disponible.',
      },
    };
  }

  return await new Promise<MessageResponse<MessageResultMap[T]>>((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response: unknown) => {
      resolve(normalizeMessageResponse<MessageResultMap[T]>(response));
    });
  });
}

export function onMessage<T extends MessageKind>(
  type: T,
  handler: (payload: MessagePayloadMap[T]) => MessageResultMap[T] | Promise<MessageResultMap[T]>,
): void {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
    return;
  }

  chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
    if (!isEnvelope(message) || message.type !== type) {
      return false;
    }

    void Promise.resolve(handler(message.payload as MessagePayloadMap[T]))
      .then((data: MessageResultMap[T]) => {
        sendResponse({ ok: true, data });
      })
      .catch((error: unknown) => {
        sendResponse(normalizeErrorResponse(error));
      });

    return true;
  });
}

export const messageTypes: readonly MessageKind[] = [
  'PAGE_CONTEXT',
  'READ_CHAPTER_PAGES',
  'READ_SERIES',
  'JOB_CREATE',
  'JOB_CONTROL',
  'JOB_UPDATE',
  'BUILD_ARCHIVE',
  'ARCHIVE_PROGRESS',
];

export type JobMessage = Pick<Job, 'id' | 'kind' | 'state' | 'progress' | 'error'>;
