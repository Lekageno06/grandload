import { send } from '../../core/messaging';
import { getJobs, getPrefs, readStorage } from '../../core/storage';
import { registerModule } from '../../core/registry';
import type {
  ChapterRef,
  GrandloadModule,
  Job,
  ModuleApi,
  PageContext,
  SeriesInfo,
} from '../../core/types';
import { STORAGE_KEYS } from '../../core/storage';

type SeriesChapter = ChapterRef & { selected: boolean; downloaded: boolean };
type ContentReply<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
export const SERIES_CONFIRMATION_THRESHOLD = 20;

export function requiresSeriesConfirmation(selectedCount: number): boolean {
  return selectedCount > SERIES_CONFIRMATION_THRESHOLD;
}

export function selectChaptersInRange(
  chapters: readonly ChapterRef[],
  from: number,
  to: number,
): ChapterRef[] {
  const minimum = Math.min(from, to);
  const maximum = Math.max(from, to);
  return chapters
    .filter((chapter) => chapter.number >= minimum && chapter.number <= maximum)
    .sort((left, right) => left.number - right.number);
}

export function selectUndownloadedChapters(
  chapters: readonly ChapterRef[],
  downloadedUrls: ReadonlySet<string>,
): ChapterRef[] {
  return chapters.filter((chapter) => !downloadedUrls.has(chapter.url));
}

function injectContentReader(tabId: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message ?? 'Impossible de lire cette page.'));
        return;
      }
      resolve();
    });
  });
}

function sendToTab<T>(tabId: number, type: 'READ_SERIES', adapterId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type, payload: { adapterId } }, (response: unknown) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message ?? 'Le lecteur de page ne répond pas.'));
        return;
      }
      if (typeof response !== 'object' || response === null || !('ok' in response)) {
        reject(new Error('Réponse invalide du lecteur de page.'));
        return;
      }
      const typed = response as ContentReply<T>;
      if (!typed.ok) {
        reject(new Error(typed.error.message));
        return;
      }
      resolve(typed.data);
    });
  });
}

function readSeries(tabId: number, adapterId: string): Promise<SeriesInfo> {
  return injectContentReader(tabId).then(() =>
    sendToTab<SeriesInfo>(tabId, 'READ_SERIES', adapterId),
  );
}

function chapterNumberLabel(chapter: ChapterRef): string {
  return String(chapter.number);
}

function getSeriesId(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.pathname.replace(/\/$/u, '')}`;
}

function getParentSeriesId(job: Job): string | undefined {
  const seriesId = job.params.seriesId;
  return typeof seriesId === 'string' ? seriesId : undefined;
}

function seriesSummary(children: Job[]): {
  done: number;
  failed: number;
  ignored: number;
  cancelled: number;
} {
  return {
    done: children.filter((job) => job.state === 'done').length,
    failed: children.filter((job) => job.state === 'failed').length,
    ignored: children.filter((job) => job.state === 'ignored').length,
    cancelled: children.filter((job) => job.state === 'cancelled').length,
  };
}

function formatJobChapter(job: Job): string {
  const chapter = job.params.chapter;
  if (
    typeof chapter === 'object' &&
    chapter !== null &&
    'label' in chapter &&
    typeof chapter.label === 'string'
  ) {
    return chapter.label;
  }
  return 'Chapitre';
}

const seriesDownloadModule: GrandloadModule = {
  id: 'series-download',
  title: 'Télécharger la série',
  priority: 90,
  requiredPermissions: ['activeTab', 'scripting'],
  canHandle: (context: PageContext) => context.kind === 'series',
  mountPanel: (root: HTMLElement, context: PageContext, api: ModuleApi): void => {
    const panel = document.createElement('div');
    panel.className = 'd-grid gap-3';
    root.appendChild(panel);

    const heading = document.createElement('h2');
    heading.className = 'h6 mb-0';
    heading.textContent = 'Chapitres de la série';
    panel.appendChild(heading);

    const status = document.createElement('p');
    status.className = 'small text-body-secondary mb-0';
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Lecture des chapitres…';
    panel.appendChild(status);

    const selectionActions = document.createElement('div');
    selectionActions.className = 'd-flex gap-2 align-items-end';
    panel.appendChild(selectionActions);

    const allButton = document.createElement('button');
    allButton.type = 'button';
    allButton.className = 'btn btn-sm btn-outline-secondary';
    allButton.textContent = 'Tout';
    selectionActions.appendChild(allButton);

    const rangeFromLabel = document.createElement('label');
    rangeFromLabel.className = 'small';
    rangeFromLabel.textContent = 'De';
    const rangeFrom = document.createElement('input');
    rangeFrom.type = 'number';
    rangeFrom.step = 'any';
    rangeFrom.className = 'form-control form-control-sm';
    rangeFromLabel.appendChild(rangeFrom);
    selectionActions.appendChild(rangeFromLabel);

    const rangeToLabel = document.createElement('label');
    rangeToLabel.className = 'small';
    rangeToLabel.textContent = 'À';
    const rangeTo = document.createElement('input');
    rangeTo.type = 'number';
    rangeTo.step = 'any';
    rangeTo.className = 'form-control form-control-sm';
    rangeToLabel.appendChild(rangeTo);
    selectionActions.appendChild(rangeToLabel);

    const rangeButton = document.createElement('button');
    rangeButton.type = 'button';
    rangeButton.className = 'btn btn-sm btn-outline-secondary';
    rangeButton.textContent = 'Plage';
    selectionActions.appendChild(rangeButton);

    const downloadedLabel = document.createElement('label');
    downloadedLabel.className = 'form-check small mb-0';
    const downloadedOnly = document.createElement('input');
    downloadedOnly.type = 'checkbox';
    downloadedOnly.className = 'form-check-input';
    const downloadedText = document.createElement('span');
    downloadedText.className = 'form-check-label';
    downloadedText.textContent = 'Non téléchargés seulement';
    downloadedLabel.append(downloadedOnly, downloadedText);
    panel.appendChild(downloadedLabel);

    const chapterList = document.createElement('div');
    chapterList.className = 'd-grid gap-1';
    chapterList.style.maxHeight = '260px';
    chapterList.style.overflowY = 'auto';
    chapterList.setAttribute('aria-label', 'Liste des chapitres');
    chapterList.setAttribute('aria-busy', 'true');
    panel.appendChild(chapterList);

    const formatLabel = document.createElement('label');
    formatLabel.className = 'd-grid gap-1 small';
    formatLabel.textContent = 'Format';
    const formatSelect = document.createElement('select');
    formatSelect.className = 'form-select form-select-sm';
    for (const format of [
      { value: 'cbz', label: 'CBZ' },
      { value: 'zip', label: 'ZIP' },
      { value: 'folder', label: 'Dossier d’images' },
    ]) {
      const option = document.createElement('option');
      option.value = format.value;
      option.textContent = format.label;
      formatSelect.appendChild(option);
    }
    formatLabel.appendChild(formatSelect);
    panel.appendChild(formatLabel);

    const startButton = document.createElement('button');
    startButton.type = 'button';
    startButton.className = 'btn btn-primary';
    startButton.textContent = 'Télécharger la sélection';
    startButton.disabled = true;
    panel.appendChild(startButton);

    const jobsArea = document.createElement('section');
    jobsArea.className = 'd-grid gap-2 border-top pt-2';
    const jobsHeading = document.createElement('h3');
    jobsHeading.className = 'h6 mb-0';
    jobsHeading.textContent = 'File de téléchargement';
    const jobsList = document.createElement('div');
    jobsList.className = 'd-grid gap-2';
    jobsList.setAttribute('aria-live', 'polite');
    jobsArea.append(jobsHeading, jobsList);
    panel.appendChild(jobsArea);

    const state = {
      chapters: [] as SeriesChapter[],
      seriesInfo: { title: 'Série', chapters: [] } as SeriesInfo,
      seriesId: getSeriesId(context.url),
      downloadedUrls: new Set<string>(),
      loading: true,
      busy: false,
    };

    const renderChapters = (): void => {
      chapterList.replaceChildren();
      for (const chapter of state.chapters) {
        const row = document.createElement('label');
        row.className = 'd-flex gap-2 align-items-center border-bottom py-1';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = chapter.selected;
        checkbox.disabled = state.busy;
        checkbox.addEventListener('change', () => {
          chapter.selected = checkbox.checked;
          updateStartButton();
        });
        const label = document.createElement('span');
        label.className = 'small text-truncate';
        label.textContent = chapter.label;
        const number = document.createElement('span');
        number.className = 'small text-body-secondary ms-auto';
        number.textContent = chapter.downloaded
          ? `${chapterNumberLabel(chapter)} · téléchargé`
          : chapterNumberLabel(chapter);
        if (chapter.downloaded) {
          number.title = 'Déjà téléchargé';
        }
        row.append(checkbox, label, number);
        chapterList.appendChild(row);
      }
    };

    const updateStartButton = (): void => {
      const count = state.chapters.filter((chapter) => chapter.selected).length;
      startButton.disabled = state.loading || state.busy || count === 0;
      startButton.textContent =
        count > 0 ? `Télécharger la sélection (${count})` : 'Télécharger la sélection';
    };

    const refreshJobs = async (): Promise<void> => {
      const jobs = Object.values(await getJobs())
        .filter((job) => job.kind === 'series' && getParentSeriesId(job) === state.seriesId)
        .sort((left, right) => right.createdAt - left.createdAt);
      jobsList.replaceChildren();
      const visible = jobs.slice(0, 5);
      state.busy = jobs.some(
        (job) => job.state === 'queued' || job.state === 'running' || job.state === 'paused',
      );
      updateStartButton();
      for (const parent of visible) {
        const allJobs = await getJobs();
        const children = (parent.children ?? [])
          .map((id) => allJobs[id])
          .filter((job): job is Job => Boolean(job));
        const counts = seriesSummary(children);
        const card = document.createElement('div');
        card.className = 'd-grid gap-1 border rounded p-2';
        const title = document.createElement('strong');
        title.className = 'small';
        title.textContent = state.seriesInfo.title || 'Série';
        const progress = document.createElement('span');
        progress.className = 'small text-body-secondary';
        const stateLabel =
          parent.state === 'paused'
            ? 'En pause'
            : parent.state === 'running'
              ? 'En cours'
              : parent.state === 'done'
                ? 'Terminé'
                : parent.state === 'failed'
                  ? 'Échec'
                  : parent.state === 'cancelled'
                    ? 'Annulé'
                    : 'En attente';
        progress.textContent = `${stateLabel} · ${parent.progress.done}/${parent.progress.total} chapitres`;
        card.append(title, progress);
        const overall = document.createElement('progress');
        overall.max = Math.max(1, parent.progress.total);
        overall.value = parent.progress.done;
        overall.setAttribute('aria-label', 'Progression globale de la série');
        card.appendChild(overall);

        const summary = document.createElement('span');
        summary.className = 'small';
        summary.textContent = `Réussis ${counts.done} · Échecs ${counts.failed} · Ignorés ${counts.ignored}`;
        card.appendChild(summary);

        const currentChildId = parent.params.currentChildId;
        const currentChild =
          typeof currentChildId === 'string' ? allJobs[currentChildId] : undefined;
        if (currentChild) {
          const childProgress = document.createElement('span');
          childProgress.className = 'small text-body-secondary';
          childProgress.textContent = `${formatJobChapter(currentChild)} · ${currentChild.progress.done}/${currentChild.progress.total} planches`;
          card.appendChild(childProgress);
        }

        for (const child of children) {
          if (child.warning) {
            const warning = document.createElement('span');
            warning.className = 'small text-warning-emphasis';
            warning.textContent = child.warning.message || `Le fichier a été enregistré sous ${child.warning.actual} (nom demandé : ${child.warning.requested}). Une autre extension ou un réglage du navigateur a peut-être modifié le nom.`;
            card.appendChild(warning);
          }
        }

        const controls = document.createElement('div');
        controls.className = 'd-flex gap-2 flex-wrap';
        if (parent.state === 'running' || parent.state === 'queued') {
          controls.appendChild(createJobButton('Pause', () => controlJob(parent.id, 'pause')));
        } else if (parent.state === 'paused') {
          controls.appendChild(createJobButton('Reprendre', () => controlJob(parent.id, 'resume')));
        }
        if (parent.state === 'running' || parent.state === 'queued' || parent.state === 'paused') {
          controls.appendChild(createJobButton('Annuler', () => controlJob(parent.id, 'cancel')));
        }
        if (counts.failed > 0 && (parent.state === 'done' || parent.state === 'failed')) {
          controls.appendChild(
            createJobButton('Relancer les échecs', () => controlJob(parent.id, 'retry')),
          );
        }
        if (controls.childElementCount > 0) {
          card.appendChild(controls);
        }

        const chapterStatuses = document.createElement('div');
        chapterStatuses.className = 'd-grid gap-1';
        for (const child of children) {
          const childStatus = document.createElement('span');
          childStatus.className = 'small text-body-secondary';
          const label =
            child.state === 'queued'
              ? 'En attente'
              : child.state === 'running'
                ? 'En cours'
                : child.state === 'done'
                  ? 'Terminé'
                  : child.state === 'failed'
                    ? 'Échec'
                    : child.state === 'ignored'
                      ? 'Ignoré'
                      : child.state === 'cancelled'
                        ? 'Annulé'
                        : 'En pause';
          const reason = child.error?.message ? ` · ${child.error.message}` : '';
          const strategy = child.params.strategyUsed === 'html-parse' ? ' [sans onglet]' : child.params.strategyUsed === 'live-dom' ? ' [onglet inactif]' : '';
          childStatus.textContent = `${formatJobChapter(child)} : ${label}${strategy}${reason}`;
          chapterStatuses.appendChild(childStatus);
        }
        card.appendChild(chapterStatuses);
        jobsList.appendChild(card);
      }
    };

    function createJobButton(label: string, onClick: () => void): HTMLButtonElement {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm btn-outline-secondary';
      button.textContent = label;
      button.addEventListener('click', onClick);
      return button;
    }

    function controlJob(jobId: string, action: 'pause' | 'resume' | 'cancel' | 'retry'): void {
      void send('JOB_CONTROL', { jobId, action }).then((response) => {
        if (!response.ok || !response.data.ok) {
          api.setStatus?.(response.ok ? 'Contrôle impossible.' : response.error.message);
        } else {
          void refreshJobs();
        }
      });
    }

    allButton.addEventListener('click', () => {
      state.chapters.forEach((chapter) => {
        chapter.selected = true;
      });
      renderChapters();
      updateStartButton();
    });

    rangeButton.addEventListener('click', () => {
      if (rangeFrom.value.trim() === '' || rangeTo.value.trim() === '') {
        api.setStatus?.('Saisis les deux bornes de la plage.');
        return;
      }
      const from = Number(rangeFrom.value);
      const to = Number(rangeTo.value);
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        api.setStatus?.('Saisis les deux bornes de la plage.');
        return;
      }
      const range = new Set(
        selectChaptersInRange(state.chapters, from, to).map((chapter) => chapter.url),
      );
      state.chapters.forEach((chapter) => {
        chapter.selected = range.has(chapter.url);
      });
      renderChapters();
      updateStartButton();
    });

    downloadedOnly.addEventListener('change', () => {
      if (downloadedOnly.checked) {
        const undownloaded = new Set(
          selectUndownloadedChapters(state.chapters, state.downloadedUrls).map(
            (chapter) => chapter.url,
          ),
        );
        state.chapters.forEach((chapter) => {
          chapter.selected = undownloaded.has(chapter.url);
        });
      } else {
        state.chapters.forEach((chapter) => {
          chapter.selected = true;
        });
      }
      renderChapters();
      updateStartButton();
    });

    startButton.addEventListener('click', () => {
      void (async () => {
        const selected = state.chapters.filter((chapter) => chapter.selected);
        if (selected.length === 0) {
          return;
        }
        if (
          requiresSeriesConfirmation(selected.length) &&
          !window.confirm(`Télécharger ${selected.length} chapitres ?`)
        ) {
          return;
        }

        const origin = new URL(context.url).origin;
        if (
          typeof chrome !== 'undefined' &&
          chrome.permissions?.request &&
          !(await chrome.permissions.request({ origins: [`${origin}/*`] }))
        ) {
          api.setStatus?.('Accès au site refusé. Autorise le domaine puis réessaie.');
          return;
        }

        const prefs = await getPrefs();
        const response = await send('JOB_CREATE', {
          kind: 'series',
          params: {
            seriesId: state.seriesId,
            seriesTitle: state.seriesInfo.title,
            sourceUrl: context.url,
            adapterId: context.adapterId,
            packagerId: formatSelect.value,
            requestDelayMs: prefs.requestDelayMs,
            downloadFolder: prefs.downloadFolder,
            chapters: selected.map(
              ({ selected: _selected, downloaded: _downloaded, ...chapter }) => chapter,
            ),
          },
        });
        if (!response.ok) {
          api.setStatus?.(response.error.message);
          return;
        }
        state.busy = true;
        updateStartButton();
        api.setStatus?.('Téléchargement de la série lancé.');
        await refreshJobs();
      })().catch((error: unknown) => {
        api.setStatus?.(error instanceof Error ? error.message : 'Impossible de lancer la série.');
      });
    });

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message: unknown) => {
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'JOB_UPDATE'
        ) {
          void refreshJobs();
        }
      });
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((_changes, areaName) => {
        if (areaName === 'local') void refreshJobs();
      });
    }

    void (async () => {
      try {
        const [info, history] = await Promise.all([
          readSeries(context.tabId, context.adapterId),
          readStorage<Record<string, { url: string; completedAt: number }>>(
            'local',
            STORAGE_KEYS.history(state.seriesId),
          ),
        ]);
        state.seriesInfo = info;
        state.downloadedUrls = new Set(Object.values(history ?? {}).map((item) => item.url));
        state.chapters = info.chapters.map((chapter) => ({
          ...chapter,
          downloaded: state.downloadedUrls.has(chapter.url),
          selected: !state.downloadedUrls.has(chapter.url),
        }));
        chapterList.setAttribute('aria-busy', 'false');
        status.textContent = `${info.title} · ${info.chapters.length} chapitres`;
        renderChapters();
        updateStartButton();
        await refreshJobs();
      } catch (error) {
        chapterList.setAttribute('aria-busy', 'false');
        chapterList.classList.add('alert', 'alert-danger');
        status.textContent =
          error instanceof Error ? error.message : 'Lecture de la série impossible.';
        api.setStatus?.(status.textContent);
      } finally {
        state.loading = false;
        updateStartButton();
      }
    })();
  },
};

registerModule(seriesDownloadModule);

export default seriesDownloadModule;
