import { registerModule } from '../../core/registry';
import { send } from '../../core/messaging';
import { getJobs, updateJobs } from '../../core/storage';
import type {
  ArchiveMeta,
  GrandloadModule,
  Job,
  ModuleApi,
  PageContext,
  PageRef,
} from '../../core/types';

type SelectablePage = PageRef & { id: string; label: string; selected: boolean };
type ChapterDomData = { pages: SelectablePage[]; seriesTitle: string; chapterLabel: string };

function collectChapterImages(tabId: number, adapterId: string): Promise<ChapterDomData> {
  if (
    typeof chrome === 'undefined' ||
    !chrome.scripting ||
    typeof chrome.scripting.executeScript !== 'function'
  ) {
    return Promise.resolve({ pages: [], seriesTitle: 'Série', chapterLabel: '' });
  }

  return new Promise<ChapterDomData>((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        args: [adapterId],
        func: (currentAdapterId: string) => {
          const seen = new Set<string>();
          const preciseSelector =
            '.ori-lec-scene .reading-content .page-break img.wp-manga-chapter-img';
          const preciseImages = Array.from(
            document.querySelectorAll<HTMLImageElement>(preciseSelector),
          );
          const fallbackImages = Array.from(
            document.querySelectorAll<HTMLImageElement>('img.wp-manga-chapter-img'),
          );
          const images =
            currentAdapterId === 'mangas-origines'
              ? preciseImages.length > 0
                ? preciseImages
                : fallbackImages
              : Array.from(document.querySelectorAll<HTMLImageElement>('img'));
          let pageNumber = 0;

          const pages = images
            .filter(
              (image) =>
                currentAdapterId === 'mangas-origines' ||
                !image.closest('header, footer, nav, aside, .logo, .avatar, .social'),
            )
            .flatMap((image, index) => {
              const sources = [
                image.getAttribute('src'),
                image.getAttribute('data-src'),
                image.getAttribute('data-lazy-src'),
                image.getAttribute('data-original'),
                image.getAttribute('data-srcset'),
                image.getAttribute('srcset'),
              ].filter((value): value is string => Boolean(value?.trim()));

              const rawUrl = sources[0]?.split(',')[0]?.trim() ?? '';
              if (!rawUrl) {
                return [];
              }

              let cleanedUrl: string;
              try {
                cleanedUrl = new URL(rawUrl, window.location.href).toString();
              } catch {
                return [];
              }
              if (seen.has(cleanedUrl)) {
                return [];
              }
              seen.add(cleanedUrl);
              pageNumber += 1;
              const base = cleanedUrl.split('/').filter(Boolean).pop() || `Page ${index + 1}`;
              const pathname = new URL(cleanedUrl).pathname;
              const extension = pathname.match(/\.([a-z0-9]+)$/iu)?.[1]?.toLowerCase() ?? '';
              return {
                id: `${index + 1}-${cleanedUrl}`,
                label: base.length > 30 ? `${base.slice(0, 27)}…` : base,
                index: pageNumber,
                url: cleanedUrl,
                ext: extension,
                width: image.naturalWidth || undefined,
                height: image.naturalHeight || undefined,
                selected: true,
              };
            })
            .map((item) => item as SelectablePage);

          const seriesTitle =
            document.querySelector('.ori-lec-titre')?.textContent?.trim() ||
            document.title.replace(/\s*[-|].*$/u, '').trim() ||
            'Série';
          const chapterLabel = document.querySelector('.ori-lec-chap')?.textContent?.trim() || '';
          return { pages, seriesTitle, chapterLabel };
        },
      },
      (results) => {
        const first = results?.[0]?.result as ChapterDomData | undefined;
        resolve(first ?? { pages: [], seriesTitle: 'Série', chapterLabel: '' });
      },
    );
  });
}

function createActionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm btn-outline-secondary';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function buildEmptyState(): HTMLDivElement {
  const message = document.createElement('div');
  message.className = 'alert alert-warning mb-0';
  message.textContent = 'Aucune image détectée sur cette page ou chapitre vide.';
  return message;
}

const chapterDownloadModule: GrandloadModule = {
  id: 'chapter-download',
  title: 'Télécharger le chapitre',
  priority: 100,
  requiredPermissions: ['activeTab'],
  canHandle: (ctx: PageContext) => ctx.kind === 'chapter',
  mountPopup: (root: HTMLElement, ctx: PageContext, api: ModuleApi): void => {
    const state = {
      items: [] as SelectablePage[],
      chapterData: { pages: [] as SelectablePage[], seriesTitle: 'Série', chapterLabel: '' },
      jobId: '',
      busy: false,
    };
    const panel = document.createElement('div');
    panel.className = 'd-grid gap-3';
    root.appendChild(panel);

    const heading = document.createElement('div');
    heading.className = 'fw-semibold';
    heading.textContent = 'Télécharger le chapitre';
    panel.appendChild(heading);

    const meta = document.createElement('div');
    meta.className = 'small text-muted';
    meta.textContent = `Source : ${ctx.url}`;
    panel.appendChild(meta);

    const actionRow = document.createElement('div');
    actionRow.className = 'd-flex flex-wrap gap-2';
    panel.appendChild(actionRow);

    const grid = document.createElement('div');
    grid.className = 'd-grid gap-2';
    panel.appendChild(grid);

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

    const progressContainer = document.createElement('div');
    progressContainer.className = 'd-grid gap-1';
    progressContainer.hidden = true;
    const progress = document.createElement('progress');
    progress.className = 'w-100';
    progress.max = 1;
    progress.value = 0;
    const progressText = document.createElement('span');
    progressText.className = 'small text-muted';
    progressText.textContent = 'En attente';
    progressContainer.append(progress, progressText);
    panel.appendChild(progressContainer);

    const jobsSection = document.createElement('section');
    jobsSection.className = 'd-grid gap-2 border-top pt-2';
    const jobsHeading = document.createElement('h2');
    jobsHeading.className = 'h6 mb-0';
    jobsHeading.textContent = 'Téléchargements';
    const jobsList = document.createElement('div');
    jobsList.className = 'd-grid gap-2';
    const clearHistory = document.createElement('button');
    clearHistory.type = 'button';
    clearHistory.className = 'btn btn-sm btn-outline-secondary';
    clearHistory.textContent = 'Effacer l’historique';
    clearHistory.hidden = true;
    jobsSection.append(jobsHeading, jobsList, clearHistory);
    panel.appendChild(jobsSection);

    const buttonDownload = document.createElement('button');
    buttonDownload.type = 'button';
    buttonDownload.className = 'btn btn-primary w-100';
    buttonDownload.disabled = true;
    buttonDownload.textContent = 'Télécharger';
    panel.appendChild(buttonDownload);

    const buttonCancel = document.createElement('button');
    buttonCancel.type = 'button';
    buttonCancel.className = 'btn btn-outline-danger w-100';
    buttonCancel.textContent = 'Annuler';
    buttonCancel.hidden = true;
    panel.appendChild(buttonCancel);

    const renderGrid = (): void => {
      grid.innerHTML = '';

      if (state.items.length === 0) {
        grid.appendChild(buildEmptyState());
        return;
      }

      for (const item of state.items) {
        const entry = document.createElement('label');
        entry.className = 'd-flex align-items-center gap-2 p-2 border rounded';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.selected;
        checkbox.disabled = state.busy;
        checkbox.addEventListener('change', () => {
          item.selected = checkbox.checked;
        });

        const text = document.createElement('span');
        text.className = 'small text-truncate';
        text.textContent = `${item.label}`;

        entry.appendChild(checkbox);
        entry.appendChild(text);
        grid.appendChild(entry);
      }
    };

    const updateActions = (): void => {
      const selectedCount = state.items.filter((item) => item.selected).length;
      buttonDownload.disabled = state.busy || selectedCount === 0;
      buttonDownload.textContent =
        selectedCount === 0 ? 'Télécharger' : `Télécharger (${selectedCount})`;
      formatSelect.disabled = state.busy;
      buttonCancel.hidden = !state.busy;
    };

    const setBusy = (busy: boolean): void => {
      state.busy = busy;
      buttonCancel.disabled = false;
      progressContainer.hidden = !busy;
      updateActions();
      renderGrid();
    };

    const showUpdate = (payload: {
      jobId: string;
      state: string;
      progress: { done: number; total: number };
      error?: { code: string; message: string };
      warning?: { requested: string; actual: string };
    }): void => {
      if (payload.jobId !== state.jobId) {
        return;
      }
      progress.max = Math.max(1, payload.progress.total);
      progress.value = payload.progress.done;
      progressText.textContent = `${payload.progress.done} / ${payload.progress.total} planches`;

      if (payload.state === 'done') {
        setBusy(false);
        progressText.textContent = 'Téléchargement terminé.';
        api.setStatus?.('Chapitre téléchargé.');
      } else if (payload.state === 'failed') {
        setBusy(false);
        progressText.textContent = payload.error?.message ?? 'Échec du téléchargement.';
        api.setStatus?.(progressText.textContent);
      } else if (payload.state === 'cancelled') {
        setBusy(false);
        progressText.textContent = 'Annulé';
        api.setStatus?.('Annulé');
      } else {
        progressContainer.hidden = false;
        api.setStatus?.(
          `${payload.state === 'queued' ? 'En attente' : 'Téléchargement'} : ${payload.progress.done}/${payload.progress.total}`,
        );
      }
      if (payload.warning) {
        progressText.textContent = `Le fichier a été enregistré sous ${payload.warning.actual} (nom demandé : ${payload.warning.requested}). Une autre extension ou un réglage du navigateur a peut-être modifié le nom.`;
        api.setStatus?.(progressText.textContent);
      }
      void refreshJobs();
    };

    const isTerminal = (job: Job): boolean =>
      job.state === 'done' || job.state === 'failed' || job.state === 'cancelled';

    const warningText = (job: Job): string => {
      if (!job.warning) {
        return '';
      }
      return `Le fichier a été enregistré sous ${job.warning.actual} (nom demandé : ${job.warning.requested}). Une autre extension ou un réglage du navigateur a peut-être modifié le nom.`;
    };

    const jobTitle = (job: Job): string => {
      const meta = job.params.meta;
      if (typeof meta === 'object' && meta !== null && 'chapter' in meta) {
        const chapter = meta.chapter;
        if (
          typeof chapter === 'object' &&
          chapter !== null &&
          'label' in chapter &&
          typeof chapter.label === 'string'
        ) {
          return chapter.label;
        }
      }
      return 'Chapitre';
    };

    async function refreshJobs(): Promise<void> {
      const jobs = Object.values(await getJobs())
        .filter((job) => job.kind === 'chapter')
        .sort((left, right) => right.createdAt - left.createdAt);
      const activeJobs = jobs.filter((job) => !isTerminal(job));
      const recentJobs = jobs.filter(isTerminal).slice(0, 8);
      const visibleJobs = [...activeJobs, ...recentJobs];
      jobsList.replaceChildren();

      for (const job of visibleJobs) {
        const row = document.createElement('div');
        row.className = 'd-grid gap-1 border rounded p-2';
        const title = document.createElement('strong');
        title.className = 'small';
        title.textContent = jobTitle(job);
        const status = document.createElement('span');
        status.className = 'small text-body-secondary';
        const stateLabel =
          job.state === 'cancelled'
            ? 'Annulé'
            : job.state === 'done'
              ? 'Terminé'
              : job.state === 'failed'
                ? 'Échec'
                : job.state === 'queued'
                  ? 'En attente'
                  : 'En cours';
        status.textContent = `${stateLabel} · ${job.progress.done}/${job.progress.total} planches`;
        row.append(title, status);

        if (job.error) {
          const error = document.createElement('span');
          error.className = 'small text-danger';
          error.textContent = job.error.message;
          row.appendChild(error);
        }
        const warning = warningText(job);
        if (warning) {
          const warningNode = document.createElement('span');
          warningNode.className = 'small text-warning-emphasis';
          warningNode.textContent = warning;
          row.appendChild(warningNode);
        }

        if (!isTerminal(job)) {
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'btn btn-sm btn-outline-danger';
          cancel.textContent = 'Annuler';
          cancel.addEventListener('click', () => {
            cancel.disabled = true;
            void send('JOB_CONTROL', { jobId: job.id, action: 'cancel' }).then((response) => {
              if (!response.ok || !response.data.ok) {
                cancel.disabled = false;
                api.setStatus?.(
                  response.ok ? 'Impossible d’annuler le job.' : response.error.message,
                );
              } else {
                api.setStatus?.('Annulé');
              }
            });
          });
          row.appendChild(cancel);
        }
        jobsList.appendChild(row);
      }

      if (visibleJobs.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'small text-body-secondary';
        empty.textContent = 'Aucun téléchargement récent.';
        jobsList.appendChild(empty);
      }
      clearHistory.hidden = !jobs.some(isTerminal);
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message: unknown) => {
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'JOB_UPDATE' &&
          'payload' in message &&
          typeof message.payload === 'object' &&
          message.payload !== null
        ) {
          showUpdate(
            message.payload as {
              jobId: string;
              state: string;
              progress: { done: number; total: number };
              error?: { code: string; message: string };
              warning?: { requested: string; actual: string };
            },
          );
        }
      });
    }

    buttonDownload.addEventListener('click', () => {
      void (async () => {
        const selected = state.items.filter((item) => item.selected);
        if (selected.length === 0) {
          return;
        }

        const origins = Array.from(
          new Set(
            selected.map((page) => {
              const url = new URL(page.url);
              return `${url.protocol}//${url.host}/*`;
            }),
          ),
        );
        if (
          typeof chrome !== 'undefined' &&
          chrome.permissions?.request &&
          !(await chrome.permissions.request({ origins }))
        ) {
          api.setStatus?.('Accès aux images refusé. Autorise le domaine puis réessaie.');
          return;
        }

        const chapterNumber = (() => {
          const match = new URL(ctx.url).pathname.match(/\/chapitre-(\d+)(?:-(\d+))?\/?$/u);
          return match?.[1] ? Number(match[1]) + (match[2] ? Number(`0.${match[2]}`) : 0) : 0;
        })();
        const chapterLabel = state.chapterData.chapterLabel || `Chapitre ${chapterNumber}`;
        const meta: ArchiveMeta = {
          series: state.chapterData.seriesTitle,
          chapter: { number: chapterNumber, label: chapterLabel, url: ctx.url },
          pageCount: selected.length,
          sourceUrl: ctx.url,
        };

        const response = await send('JOB_CREATE', {
          kind: 'chapter',
          params: {
            pages: selected.map(({ id: _id, label: _label, selected: _selected, ...page }) => page),
            packagerId: formatSelect.value as 'cbz' | 'zip' | 'folder',
            meta,
            options: {},
          },
        });
        if (!response.ok) {
          api.setStatus?.(response.error.message);
          return;
        }

        state.jobId = response.data.jobId;
        progress.max = selected.length;
        progress.value = 0;
        progressText.textContent = 'Préparation de l’archive…';
        setBusy(true);
        void refreshJobs();
      })().catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Le téléchargement du chapitre a échoué.';
        api.setStatus?.(message);
      });
    });

    buttonCancel.addEventListener('click', () => {
      if (!state.jobId) {
        return;
      }
      buttonCancel.disabled = true;
      void send('JOB_CONTROL', { jobId: state.jobId, action: 'cancel' }).then((response) => {
        if (!response.ok || !response.data.ok) {
          buttonCancel.disabled = false;
          api.setStatus?.(response.ok ? 'Impossible d’annuler le job.' : response.error.message);
        }
      });
    });

    clearHistory.addEventListener('click', () => {
      void updateJobs((jobs) =>
        Object.fromEntries(Object.entries(jobs).filter(([, job]) => !isTerminal(job))),
      ).then(() => refreshJobs());
    });

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((_changes, areaName) => {
        if (areaName === 'local') {
          void refreshJobs();
        }
      });
    }
    void refreshJobs();

    actionRow.appendChild(
      createActionButton('Tout', () => {
        state.items.forEach((item) => {
          item.selected = true;
        });
        renderGrid();
        updateActions();
      }),
    );
    actionRow.appendChild(
      createActionButton('Aucune', () => {
        state.items.forEach((item) => {
          item.selected = false;
        });
        renderGrid();
        updateActions();
      }),
    );
    actionRow.appendChild(
      createActionButton('Inverser', () => {
        state.items.forEach((item) => {
          item.selected = !item.selected;
        });
        renderGrid();
        updateActions();
      }),
    );
    actionRow.appendChild(
      createActionButton('Exclure avant', () => {
        const selected = state.items.filter((item) => item.selected);
        const lastSelected = selected.at(-1);
        const cursor = lastSelected ? state.items.indexOf(lastSelected) : 0;
        state.items.forEach((item, index) => {
          item.selected = index >= cursor;
        });
        renderGrid();
        updateActions();
      }),
    );
    actionRow.appendChild(
      createActionButton('Exclure après', () => {
        const selected = state.items.filter((item) => item.selected);
        const firstSelected = selected[0];
        const cursor = firstSelected ? state.items.indexOf(firstSelected) : state.items.length - 1;
        state.items.forEach((item, index) => {
          item.selected = index <= cursor;
        });
        renderGrid();
        updateActions();
      }),
    );

    void collectChapterImages(ctx.tabId, ctx.adapterId).then((chapterData) => {
      state.chapterData = chapterData;
      state.items = chapterData.pages;
      renderGrid();
      updateActions();
    });
  },
};

registerModule(chapterDownloadModule);

export default chapterDownloadModule;
