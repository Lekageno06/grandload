import { sanitizeFileName, getBaseNameFromUrl } from '../shared/url-utils';
import type { PageContext } from '../core/types';

type DownloadItem = {
  id: string;
  url: string;
  label: string;
  type: string;
  ext: string;
};

const MAX_CONCURRENCY = 3;

function createJobId(kind: string): string {
  return `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function scheduleDownloads(items: DownloadItem[], domain: string): void {
  const queue = [...items];
  let inFlight = 0;

  const launchNext = (): void => {
    while (inFlight < MAX_CONCURRENCY && queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        continue;
      }

      inFlight += 1;
      const filename = `Grandload/${domain}/${sanitizeFileName(item.label || getBaseNameFromUrl(item.url) || 'download')}`;

      const attemptDownload = (attempt: number): void => {
        chrome.downloads.download(
          {
            url: item.url,
            filename,
            conflictAction: 'uniquify',
          },
          () => {
            inFlight -= 1;

            if (typeof chrome.runtime?.lastError !== 'undefined' && attempt < 2) {
              attemptDownload(attempt + 1);
              return;
            }

            if (queue.length > 0) {
              launchNext();
            }
          },
        );
      };

      attemptDownload(0);
    }
  };

  launchNext();
}

console.info('Grandload service worker started.');

chrome.runtime.onInstalled.addListener(() => {
  console.info('Grandload installed.');
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    sendResponse({ ok: true, data: { ready: true } });
    return false;
  }

  const type = message.type;

  if (type === 'PAGE_CONTEXT') {
    const payload = message.payload as { tabId: number };

    chrome.tabs.get(payload.tabId, (tab) => {
      const url = tab?.url ?? '';
      const context: PageContext = {
        url,
        kind: 'other',
        adapterId: 'generic',
        tabId: payload.tabId,
      };

      sendResponse({ ok: true, data: context });
    });

    return true;
  }

  if (type === 'JOB_CREATE') {
    const payload = message.payload as { kind: string; params?: { items?: DownloadItem[] } };

    if (payload.kind === 'links' && Array.isArray(payload.params?.items) && payload.params.items.length > 0) {
      const items = payload.params.items as DownloadItem[];
      const firstUrl = items[0]?.url ?? 'https://example.invalid';
      const domain = (() => {
        try {
          return new URL(firstUrl).hostname;
        } catch {
          return 'grandload';
        }
      })();

      const jobId = createJobId(payload.kind);
      scheduleDownloads(items, domain);
      sendResponse({ ok: true, data: { jobId } });
      return true;
    }
  }

  if (type === 'JOB_CONTROL') {
    sendResponse({ ok: true, data: { ok: true } });
    return false;
  }

  sendResponse({ ok: true, data: { ready: true } });
  return false;
});
