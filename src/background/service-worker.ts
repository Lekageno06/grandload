import '../adapters';
import '../modules';
import { sanitizeFileName, getBaseNameFromUrl } from '../shared/url-utils';
import { listAdapters } from '../core/registry';
import type { PageContext } from '../core/types';
import { suggestRequestedDownloadName } from './download-filenames';
import {
  createChapterJob,
  handleArchiveProgress,
  handleJobControl,
  recoverRunningJobs,
} from './orchestrator';
import { createSeriesJob, handleSeriesJobControl, recoverSeriesJobs } from './series-orchestrator';

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

if (chrome.sidePanel?.setPanelBehavior) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
    console.warn('Le panneau latéral ne peut pas être configuré.', error);
  });
}

if (typeof chrome.downloads.onDeterminingFilename?.addListener === 'function') {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    void suggestRequestedDownloadName(item, suggest);
    return true;
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.info('Grandload installed.');
});

void Promise.resolve()
  .then(recoverSeriesJobs)
  .then(recoverRunningJobs)
  .catch((error: unknown) => {
    console.error('Impossible de reprendre les jobs interrompus.', error);
  });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    sendResponse({ ok: true, data: { ready: true } });
    return false;
  }

  const type = message.type;

  if (
    type === 'BUILD_ARCHIVE' ||
    type === 'CANCEL_ARCHIVE' ||
    type === 'REVOKE_BLOBS' ||
    type === 'JOB_UPDATE'
  ) {
    return false;
  }

  if (type === 'ARCHIVE_PROGRESS') {
    const payload = message.payload as { jobId: string; done: number; total: number };
    void handleArchiveProgress(payload)
      .then(() => sendResponse({ ok: true, data: undefined }))
      .catch((error: unknown) => {
        console.error('Impossible d’enregistrer la progression du chapitre.', error);
        sendResponse({
          ok: false,
          error: { code: 'STORAGE_WRITE_FAILED', message: 'Progression non enregistrée.' },
        });
      });
    return true;
  }

  if (type === 'PAGE_CONTEXT') {
    const payload = message.payload as { tabId: number };

    chrome.tabs.get(payload.tabId, (tab) => {
      const url = tab?.url ?? '';
      const foundAdapter =
        listAdapters().find((adapter) => {
          try {
            return adapter.matches(new URL(url));
          } catch {
            return false;
          }
        }) ?? listAdapters().find((adapter) => adapter.id === 'generic');

      const kind = (() => {
        try {
          return foundAdapter ? foundAdapter.classify(new URL(url)) : 'other';
        } catch {
          return 'other';
        }
      })();

      const context: PageContext = {
        url,
        kind,
        adapterId: foundAdapter?.id ?? 'generic',
        tabId: payload.tabId,
      };

      sendResponse({ ok: true, data: context });
    });

    return true;
  }

  if (type === 'JOB_CREATE') {
    const payload = message.payload as { kind: string; params?: { items?: DownloadItem[] } };

    if (payload.kind === 'chapter' && payload.params) {
      void createChapterJob(payload.params as Record<string, unknown>)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error: unknown) => {
          const messageText =
            error instanceof Error ? error.message : 'Création du chapitre impossible.';
          sendResponse({ ok: false, error: { code: 'ADAPTER_STRUCTURE', message: messageText } });
        });
      return true;
    }

    if (payload.kind === 'series' && payload.params) {
      void createSeriesJob(payload.params as Record<string, unknown>)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error: unknown) => {
          const messageText =
            error instanceof Error ? error.message : 'Création de la série impossible.';
          sendResponse({ ok: false, error: { code: 'ADAPTER_STRUCTURE', message: messageText } });
        });
      return true;
    }

    if (
      payload.kind === 'links' &&
      Array.isArray(payload.params?.items) &&
      payload.params.items.length > 0
    ) {
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
    const payload = message.payload as {
      jobId: string;
      action: 'pause' | 'resume' | 'cancel' | 'retry';
    };
    void handleSeriesJobControl(payload)
      .then(async (seriesResult) => {
        if (seriesResult.handled) {
          sendResponse({ ok: true, data: { ok: seriesResult.ok } });
          return;
        }
        const data = await handleJobControl(payload);
        sendResponse({ ok: true, data });
      })
      .catch((error: unknown) => {
        console.error('Impossible de contrôler le job.', error);
        sendResponse({
          ok: false,
          error: { code: 'UNKNOWN', message: 'Contrôle du job impossible.' },
        });
      });
    return true;
  }

  sendResponse({ ok: true, data: { ready: true } });
  return false;
});
