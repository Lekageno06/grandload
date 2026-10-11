import { beforeEach, describe, expect, it } from 'vitest';

import { onMessage, send } from '../src/core/messaging';

type RuntimeListener = (
  message: unknown,
  _sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

describe('messaging', () => {
  let runtimeListener: RuntimeListener | undefined;

  beforeEach(() => {
    runtimeListener = undefined;

    (globalThis as typeof globalThis & {
      chrome: {
        runtime: {
          sendMessage: (message: unknown, callback: (response: unknown) => void) => void;
          onMessage: {
            addListener: (newListener: RuntimeListener) => void;
          };
        };
      };
    }).chrome = {
      runtime: {
        sendMessage: (message: unknown, callback: (response: unknown) => void) => {
          const typed = message as { type: string; payload: Record<string, unknown> };
          if (typed.type === 'PAGE_CONTEXT') {
            callback({
              ok: true,
              data: {
                url: 'https://example.com',
                kind: 'other',
                adapterId: 'generic',
                tabId: Number(typed.payload.tabId ?? 0),
              },
            });
            return;
          }

          callback({ ok: true, data: { jobId: 'job-1' } });
        },
        onMessage: {
          addListener: (newListener: RuntimeListener) => {
            runtimeListener = newListener;
          },
        },
      },
    };
  });

  it('sends a message and resolves the typed response', async () => {
    const response = await send('PAGE_CONTEXT', { tabId: 42 });

    expect(response).toEqual({
      ok: true,
      data: {
        url: 'https://example.com',
        kind: 'other',
        adapterId: 'generic',
        tabId: 42,
      },
    });
  });

  it('registers a listener and returns the handler payload', async () => {
    let received: unknown;

    onMessage('JOB_CREATE', (payload) => {
      received = payload;
      return { jobId: 'job-1' };
    });

    const response = await new Promise<unknown>((resolve) => {
      if (!runtimeListener) {
        resolve({ ok: false, error: { code: 'UNKNOWN', message: 'listener missing' } });
        return;
      }

      runtimeListener(
        {
          type: 'JOB_CREATE',
          payload: { kind: 'chapter', params: { title: 'Test Chapter' } },
        },
        {},
        (callbackResponse: unknown) => resolve(callbackResponse),
      );
    });

    expect(received).toEqual({ kind: 'chapter', params: { title: 'Test Chapter' } });
    expect(response).toEqual({ ok: true, data: { jobId: 'job-1' } });
  });
});
