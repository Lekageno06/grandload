import { registerModule } from '../../core/registry';
import { getAdapter } from '../../core/registry';
import { send } from '../../core/messaging';
import { getExclusions, getJobs, getPrefs, setExclusions, updateJobs } from '../../core/storage';
import { createDestinationPicker } from '../../destinations/picker';
import type { ExclusionMemory } from '../../core/storage';
import type {
  ArchiveMeta,
  ChapterMeta,
  GrandloadModule,
  Job,
  ModuleApi,
  PageContext,
  PageRef,
} from '../../core/types';
import { processPageExclusions } from './exclusions';
import { ImageGallery } from '../../ui/components/gallery';
import type { GalleryItem } from '../../ui/components/gallery';
import { t } from '../../sidepanel/i18n';

type SelectablePage = PageRef & {
  id: string;
  label: string;
  selected: boolean;
  excludeReason?: string;
  isAutoExcluded?: boolean;
  isSuggestedExclusion?: boolean;
};
type ChapterDomData = { pages: SelectablePage[]; seriesTitle: string; chapterLabel: string };

export function formatChapterSource(url: string, maxLength = 72): string {
  try {
    const parsed = new URL(url);
    const source = `${parsed.hostname}${parsed.pathname}${parsed.search}`;
    return source.length > maxLength ? `${source.slice(0, maxLength - 1)}…` : source;
  } catch {
    return 'Source indisponible';
  }
}

export function getChapterSelectionCounts(items: readonly Pick<SelectablePage, 'selected'>[]): {
  included: number;
  excluded: number;
} {
  const included = items.filter((item) => item.selected).length;
  return { included, excluded: items.length - included };
}

export function getExclusionBadgeText(item: {
  selected: boolean;
  excludeReason?: string | undefined;
  isSuggestedExclusion?: boolean | undefined;
}): string | null {
  if (item.isSuggestedExclusion) return item.excludeReason || 'Suggestion mémorisée';
  if (!item.selected) return item.excludeReason || 'Exclusion manuelle';
  return null;
}

function sendContentRequest<T>(
  tabId: number,
  type: 'READ_CHAPTER_PAGES' | 'READ_CHAPTER_META',
  adapterId: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type, payload: { adapterId } },
      (response: { ok?: boolean; data?: T; error?: { message?: string } } | undefined) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message ?? 'Lecture de la page impossible.'));
          return;
        }
        if (response?.ok && response.data !== undefined) {
          resolve(response.data);
          return;
        }
        reject(new Error(response?.error?.message ?? 'Lecture du chapitre impossible.'));
      },
    );
  });
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

function collectChapterImages(tabId: number, adapterId: string): Promise<ChapterDomData> {
  if (
    typeof chrome === 'undefined' ||
    !chrome.tabs ||
    typeof chrome.tabs.sendMessage !== 'function'
  ) {
    return Promise.resolve({ pages: [], seriesTitle: 'Série', chapterLabel: '' });
  }

  return injectContentReader(tabId)
    .then(() =>
      Promise.all([
        sendContentRequest<PageRef[]>(tabId, 'READ_CHAPTER_PAGES', adapterId),
        sendContentRequest<ChapterMeta>(tabId, 'READ_CHAPTER_META', adapterId),
      ]),
    )
    .then(([pages, meta]) => ({
      pages: pages.map((page) => ({
        ...page,
        id: `${page.index}-${page.url}`,
        label: page.url.split('/').filter(Boolean).pop() ?? `Page ${page.index}`,
        selected: true,
      })),
      seriesTitle: meta.series,
      chapterLabel: meta.label,
    }))
    .catch(() => ({ pages: [], seriesTitle: 'Série', chapterLabel: '' }));
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
  mountPanel: (root: HTMLElement, ctx: PageContext, api: ModuleApi): void => {
    const state = {
      items: [] as SelectablePage[],
      chapterData: { pages: [] as SelectablePage[], seriesTitle: 'Série', chapterLabel: '' },
      jobId: '',
      busy: false,
      autoExcludeEnabled: true,
      exclusionsMemory: undefined as ExclusionMemory | undefined,
    };
    const panel = document.createElement('div');
    panel.className = 'd-grid gap-3';
    root.appendChild(panel);

    const heading = document.createElement('div');
    heading.className = 'fw-semibold';
    heading.textContent = t('chapterTitle');
    panel.appendChild(heading);

    const meta = document.createElement('div');
    meta.className = 'small text-muted';
    meta.textContent = `Source : ${formatChapterSource(ctx.url)}`;
    panel.appendChild(meta);

    // Option pour activer/désactiver les pré-exclusions (RG-106)
    const optionsRow = document.createElement('div');
    optionsRow.className = 'd-flex align-items-center justify-content-between py-1 border-bottom';
    const autoExcludeLabel = document.createElement('label');
    autoExcludeLabel.className = 'form-check form-switch mb-0 small';
    const autoExcludeInput = document.createElement('input');
    autoExcludeInput.type = 'checkbox';
    autoExcludeInput.className = 'form-check-input';
    autoExcludeInput.checked = true;
    autoExcludeInput.setAttribute('role', 'switch');
    const autoExcludeText = document.createElement('span');
    autoExcludeText.className = 'form-check-label ms-1';
    autoExcludeText.textContent = t('autoExclusions');
    autoExcludeLabel.append(autoExcludeInput, autoExcludeText);
    optionsRow.appendChild(autoExcludeLabel);

    // Bouton pour mémoriser les exclusions actuelles pour le site (RG-107)
    const memorizeButton = document.createElement('button');
    memorizeButton.type = 'button';
    memorizeButton.className = 'btn btn-sm btn-outline-secondary';
    memorizeButton.title = 'Mémoriser les exclusions (dernière planche ou motifs) pour ce site';
    memorizeButton.textContent = t('remember');
    optionsRow.appendChild(memorizeButton);
    panel.appendChild(optionsRow);

    const actionRow = document.createElement('div');
    actionRow.className = 'd-flex flex-wrap gap-2';
    panel.appendChild(actionRow);

    const grid = document.createElement('div');
    grid.className = 'd-grid gap-2';
    panel.appendChild(grid);

    const formatLabel = document.createElement('label');
    formatLabel.className = 'd-grid gap-1 small';
    formatLabel.textContent = t('format');
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

    const archiveNameLabel = document.createElement('label');
    archiveNameLabel.className = 'd-grid gap-1 small';
    archiveNameLabel.textContent = t('filename');
    const archiveNameInput = document.createElement('input');
    archiveNameInput.type = 'text';
    archiveNameInput.className = 'form-control form-control-sm';
    archiveNameInput.placeholder = 'Automatique : œuvre - chapitre';
    archiveNameInput.maxLength = 150;
    archiveNameLabel.appendChild(archiveNameInput);
    panel.appendChild(archiveNameLabel);
    const destinationPicker = createDestinationPicker({ mode: 'browser', subfolderTemplate: 'Grandload', customFolderName: '' });
    void getPrefs().then((prefs) => destinationPicker.setSettings(prefs.destination));
    panel.appendChild(destinationPicker.element);

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

    const counterText = document.createElement('div');
    counterText.className = 'small text-muted text-center py-1';
    counterText.textContent = '0 planche incluse / 0 exclue';
    panel.appendChild(counterText);

    const buttonDownload = document.createElement('button');
    buttonDownload.type = 'button';
    buttonDownload.className = 'btn btn-primary w-100';
    buttonDownload.disabled = true;
    buttonDownload.textContent = t('download');
    panel.appendChild(buttonDownload);

    const buttonCancel = document.createElement('button');
    buttonCancel.type = 'button';
    buttonCancel.className = 'btn btn-outline-danger w-100';
    buttonCancel.textContent = t('cancel');
    buttonCancel.hidden = true;
    panel.appendChild(buttonCancel);

    const renderGrid = (): void => {
      grid.replaceChildren();

      if (state.items.length === 0) {
        grid.appendChild(buildEmptyState());
        return;
      }
      const galleryItems: GalleryItem[] = state.items.map((item) => ({
        id: item.id,
        url: item.url,
        label: item.label,
        ext: item.ext,
        ...(item.width ? { width: item.width } : {}),
        ...(item.height ? { height: item.height } : {}),
        selected: item.selected,
        ...(getExclusionBadgeText(item) ? { badge: getExclusionBadgeText(item)! } : {}),
      }));
      const gallery = new ImageGallery(galleryItems, {
        ordered: true,
        onSelectionChange: (selected) => {
          const selectedIds = new Set(selected.map((item) => item.id));
          state.items.forEach((item) => {
            setItemSelection(item, selectedIds.has(item.id));
          });
          renderGrid();
          updateActions();
        },
      });
      gallery.element.setAttribute('aria-label', t('orderedGallery'));
      grid.appendChild(gallery.element);
    };

    const setItemSelection = (item: SelectablePage, selected: boolean): void => {
      item.selected = selected;
      if (selected) {
        delete item.isAutoExcluded;
        delete item.isSuggestedExclusion;
        delete item.excludeReason;
      } else if (!item.excludeReason || item.isSuggestedExclusion) {
        item.isSuggestedExclusion = false;
        item.excludeReason = 'Exclusion manuelle';
      }
    };

    const updateActions = (): void => {
      const counts = getChapterSelectionCounts(state.items);
      counterText.textContent = `${counts.included} planche${counts.included > 1 ? 's' : ''} incluse${counts.included > 1 ? 's' : ''} / ${counts.excluded} exclue${counts.excluded > 1 ? 's' : ''}`;
      buttonDownload.disabled = state.busy || counts.included === 0;
      buttonDownload.textContent =
        counts.included === 0 ? 'Télécharger' : `Télécharger (${counts.included})`;
      formatSelect.disabled = state.busy;
      archiveNameInput.disabled = state.busy;
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
      warning?: { requested: string; actual: string; message?: string };
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
      return (
        job.warning.message ||
        `Le fichier a été enregistré sous ${job.warning.actual} (nom demandé : ${job.warning.requested}). Une autre extension ou un réglage du navigateur a peut-être modifié le nom.`
      );
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
              warning?: { requested: string; actual: string; message?: string };
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
        const prefs = await getPrefs();
        const destination = destinationPicker.getSettings();
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
            options: {
              downloadFolder: prefs.downloadFolder,
              destinationMode: destination.mode,
              destinationTemplate: destination.subfolderTemplate,
              ...(archiveNameInput.value.trim() ? { archiveName: archiveNameInput.value.trim() } : {}),
            },
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
          setItemSelection(item, true);
        });
        renderGrid();
        updateActions();
      }),
    );
    actionRow.appendChild(
      createActionButton('Aucune', () => {
        state.items.forEach((item) => {
          setItemSelection(item, false);
        });
        renderGrid();
        updateActions();
      }),
    );
    actionRow.appendChild(
      createActionButton('Inverser', () => {
        state.items.forEach((item) => {
          setItemSelection(item, !item.selected);
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
          setItemSelection(item, index >= cursor);
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
          setItemSelection(item, index <= cursor);
        });
        renderGrid();
        updateActions();
      }),
    );

    const applyExclusionRules = (): void => {
      const adapter = getAdapter(ctx.adapterId);
      const rawPages: PageRef[] = state.chapterData.pages.map((p) => {
        const ref: PageRef = {
          index: p.index,
          url: p.url,
          ext: p.ext,
        };
        if (p.width !== undefined) ref.width = p.width;
        if (p.height !== undefined) ref.height = p.height;
        return ref;
      });
      const processed = processPageExclusions(
        rawPages,
        adapter,
        state.autoExcludeEnabled,
        state.exclusionsMemory,
      );

      state.items = state.chapterData.pages.map((orig, i) => {
        const proc = processed[i];
        const isExcluded = proc?.excluded ?? false;
        const pageItem: SelectablePage = {
          ...orig,
          selected: !isExcluded,
        };
        if (proc?.reason !== undefined) {
          pageItem.excludeReason = proc.reason;
        }
        if (proc?.isAutoExcluded !== undefined) {
          pageItem.isAutoExcluded = proc.isAutoExcluded;
        }
        if (proc?.isSuggestedExclusion !== undefined) {
          pageItem.isSuggestedExclusion = proc.isSuggestedExclusion;
        }
        return pageItem;
      });
      renderGrid();
      updateActions();
    };

    autoExcludeInput.addEventListener('change', () => {
      state.autoExcludeEnabled = autoExcludeInput.checked;
      applyExclusionRules();
    });

    memorizeButton.addEventListener('click', () => {
      void (async () => {
        const currentExclusions = (await getExclusions(ctx.adapterId)) ?? {
          lastPage: false,
          urlPatterns: [],
        };
        const lastItem = state.items.at(-1);
        const lastIsExcluded = Boolean(lastItem && !lastItem.selected);

        // Détection des motifs d'URL exclus manuellement
        const excludedItems = state.items.filter((item) => !item.selected);
        const patterns = new Set<string>(currentExclusions.urlPatterns);
        for (const item of excludedItems) {
          // Si une image contient un segment reconnaissable (ex. 'banner', 'discord', etc.)
          const match = item.url.match(
            /(?:banner|banniere|discord|credit|promo|recrutement|fin)/iu,
          );
          if (match) {
            patterns.add(match[0].toLowerCase());
          }
        }

        const updated = await setExclusions(ctx.adapterId, {
          lastPage: lastIsExcluded || currentExclusions.lastPage,
          urlPatterns: Array.from(patterns),
        });
        state.exclusionsMemory = updated;
        memorizeButton.textContent = 'Mémorisé !';
        memorizeButton.classList.remove('btn-outline-secondary');
        memorizeButton.classList.add('btn-success');
        setTimeout(() => {
          memorizeButton.textContent = 'Mémoriser';
          memorizeButton.classList.remove('btn-success');
          memorizeButton.classList.add('btn-outline-secondary');
        }, 1500);
        api.setStatus?.('Exclusions mémorisées pour ce site.');
      })();
    });

    void Promise.all([
      getPrefs(),
      getExclusions(ctx.adapterId),
      collectChapterImages(ctx.tabId, ctx.adapterId),
    ]).then(([prefs, memory, chapterData]) => {
      state.autoExcludeEnabled = prefs.autoExclude ?? true;
      autoExcludeInput.checked = state.autoExcludeEnabled;
      state.exclusionsMemory = memory;
      state.chapterData = chapterData;
      formatSelect.value = prefs.format || 'cbz';
      applyExclusionRules();
    });
  },
};

registerModule(chapterDownloadModule);

export default chapterDownloadModule;
