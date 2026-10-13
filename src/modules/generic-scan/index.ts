import { send } from '../../core/messaging';
import { registerModule } from '../../core/registry';
import type { GrandloadModule, ModuleApi, PageContext } from '../../core/types';
import { ImageGallery, ImageToolbar, lightbox } from '../../ui/components/gallery';
import type { GalleryItem } from '../../ui/components/gallery';
import { exportCsv, exportJson, exportTxt } from './exports';
import { filterScanItems, getTypeCounts } from './filters';
import type { ScanFilterState, ScanItem } from './types';
import { archiveWarning, getScanStateMessage, type ScanViewState } from './state';
import { createDestinationPicker } from '../../destinations/picker';
import { getPrefs } from '../../core/storage';
import { tabs as createTabs } from '../../ui/components/components';

const typeOptions = [
  'all',
  'image',
  'video',
  'audio',
  'document',
  'archive',
  'link',
  'other',
] as const;

type ModuleState = {
  items: ScanItem[];
  selectedIds: Set<string>;
  filters: ScanFilterState;
};

export function isCurrentScanEvent(
  eventScanId: string,
  currentScanId: string | undefined,
  eventTabId: number | undefined,
  currentTabId: number,
): boolean {
  return eventScanId === currentScanId && eventTabId === currentTabId;
}

function injectContentReader(tabId: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    console.info('[Grandload][debug][scan] injection content.js', { tabId, frame: 0 });
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

type ScanEventResult = { items: ScanItem[]; warning?: string };

function scanCurrentPageInTab(
  tabId: number,
  pageUrl: string,
  loadLazy: boolean,
  scanId: string,
  onProgress: (step: number, count: number) => void,
): Promise<ScanEventResult> {
  return new Promise<ScanEventResult>((resolve, reject) => {
    let settled = false;
    const startedAt = performance.now();
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(onEvent);
      callback();
    };
    const onEvent = (message: unknown, sender: chrome.runtime.MessageSender): void => {
      if (sender.tab?.id !== tabId || typeof message !== 'object' || message === null || !('type' in message)) return;
      const typed = message as { type?: unknown; payload?: { scanId?: unknown; step?: unknown; count?: unknown; items?: unknown; error?: unknown; warning?: unknown } };
      const payload = typed.payload;
      if (!payload || !isCurrentScanEvent(String(payload.scanId ?? ''), scanId, sender.tab?.id, tabId)) return;
      if (typed.type === 'SCAN_PROGRESS') {
        onProgress(Number(payload.step) || 0, Number(payload.count) || 0);
        return;
      }
      if (typed.type !== 'SCAN_RESULT') return;
      if (typeof payload.error === 'string') {
        console.info('[Grandload][debug][scan] fermeture/échec du scan', { tabId, scanId, cause: payload.error });
        finish(() => reject(new Error(payload.error as string)));
        return;
      }
      const items = Array.isArray(payload.items) ? payload.items as ScanItem[] : [];
      console.info('[Grandload][debug][scan] résultat reçu', { tabId, scanId, durationMs: Math.round(performance.now() - startedAt), images: items.filter((item) => item.type === 'image').length });
      finish(() => resolve({ items, ...(typeof payload.warning === 'string' ? { warning: payload.warning } : {}) }));
    };
    chrome.runtime.onMessage.addListener(onEvent);
    void injectContentReader(tabId).then(() => {
      chrome.tabs.sendMessage(
        tabId,
        { type: 'SCAN_START', payload: { scanId, pageUrl, loadLazy } },
        (response: { ok?: boolean; data?: { scanId?: string }; error?: { message?: string } } | undefined) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            console.info('[Grandload][debug][scan] fermeture du canal de démarrage', { tabId, scanId, cause: runtimeError.message });
            if (loadLazy && /channel closed|message port closed|returning true/iu.test(runtimeError.message ?? '')) {
              finish(() => {
                void scanCurrentPageInTab(tabId, pageUrl, false, scanId, onProgress)
                  .then((result) => resolve({
                    ...result,
                    warning: 'Chargement des images paresseuses interrompu : résultats partiels',
                  }))
                  .catch(reject);
              });
            } else {
              finish(() => reject(new Error(runtimeError.message ?? 'Lecture de la page impossible.')));
            }
            return;
          }
          if (!response?.ok || response.data?.scanId !== scanId) {
            finish(() => reject(new Error(response?.error?.message ?? 'Le scan n’a pas pu démarrer.')));
          }
        },
      );
    }).catch((error: unknown) => finish(() => reject(error)));
  });
}

function isPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /permission|access|autorisation|not allowed|cannot access/iu.test(message);
}

async function requestGenericSiteAccess(pageUrl: string): Promise<boolean> {
  if (!chrome.permissions?.request) return false;
  const parsed = new URL(pageUrl);
  const origin = `${parsed.protocol}//${parsed.host}/*`;
  return await new Promise<boolean>((resolve) => {
    chrome.permissions.request({ origins: [origin] }, resolve);
  });
}
function buildPopupCard(root: HTMLElement, ctx: PageContext, api: ModuleApi): void {
  const state: ModuleState = {
    items: [],
    selectedIds: new Set<string>(),
    filters: { type: 'all', extension: '', text: '' },
  };
  let activeScanId: string | undefined;
  let loadSequence = 0;

  const wrapper = document.createElement('div');
  wrapper.className = 'ui-stack generic-scan-panel';
  root.appendChild(wrapper);

  const tabs = createTabs(['Images', 'Liens et médias']);
  const [imagesTab, linksTab] = [...tabs.querySelectorAll<HTMLButtonElement>('.ui-tab')];
  if (!imagesTab || !linksTab) return;
  wrapper.appendChild(tabs);
  let activeView: 'images' | 'links' = 'images';

  const emptyMessage = document.createElement('div');
  emptyMessage.className = 'alert alert-info mb-0';
  emptyMessage.textContent = 'Aucune ressource détectée sur cette page.';
  emptyMessage.hidden = true;
  wrapper.appendChild(emptyMessage);

  const scanState = document.createElement('p');
  scanState.className = 'ui-scan-state ui-muted mb-0';
  scanState.textContent = getScanStateMessage('idle');
  wrapper.appendChild(scanState);

  const progressListener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
  ): void => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as { type?: unknown }).type !== 'GRANDLOAD_SCAN_PROGRESS' ||
      sender.tab?.id !== ctx.tabId
    ) return;
    const payload = (message as { payload?: { step?: number; count?: number } }).payload;
    scanState.textContent = `Scan en cours… étape ${payload?.step ?? 0}, ${payload?.count ?? 0} ressource(s) détectée(s).`;
  };
  chrome.runtime.onMessage?.addListener(progressListener);
  chrome.runtime.onMessage?.addListener((message: unknown, sender: chrome.runtime.MessageSender) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'CONTENT_READER_READY' &&
      sender.tab?.id === ctx.tabId
    ) {
      const payload = 'payload' in message && typeof message.payload === 'object' && message.payload !== null
        ? message.payload as { listeners?: number; frame?: number }
        : {};
      console.info('[Grandload][debug][scan] content.js prêt', {
        tabId: ctx.tabId,
        frame: payload.frame ?? 0,
        listeners: payload.listeners ?? 0,
      });
    }
  });

  const stopScanButton = document.createElement('button');
  stopScanButton.type = 'button';
  stopScanButton.className = 'btn btn-outline-danger';
  stopScanButton.textContent = 'Arrêter';
  stopScanButton.hidden = true;
  wrapper.appendChild(stopScanButton);

  const lazyLabel = document.createElement('label');
  lazyLabel.className = 'form-check d-flex align-items-center gap-2 mb-0';
  const lazyCheckbox = document.createElement('input');
  lazyCheckbox.type = 'checkbox';
  lazyCheckbox.className = 'form-check-input';
  lazyCheckbox.checked = true;
  const lazyText = document.createElement('span');
  lazyText.textContent = 'Charger les images paresseuses';
  lazyLabel.append(lazyCheckbox, lazyText);
  wrapper.appendChild(lazyLabel);

  const filterPanel = document.createElement('div');
  filterPanel.className = 'row g-2 generic-scan-filter-panel';
  wrapper.appendChild(filterPanel);

  const typeFilter = document.createElement('select');
  typeFilter.className = 'form-select form-select-sm';
  for (const option of typeOptions) {
    const optionElement = document.createElement('option');
    optionElement.value = option;
    optionElement.textContent = option === 'all' ? 'Tous les types' : option;
    typeFilter.appendChild(optionElement);
  }
  typeFilter.value = 'all';

  const extensionFilter = document.createElement('input');
  extensionFilter.type = 'text';
  extensionFilter.placeholder = 'Extension';
  extensionFilter.className = 'form-control form-control-sm';

  const textFilter = document.createElement('input');
  textFilter.type = 'search';
  textFilter.placeholder = 'Filtrer par texte';
  textFilter.className = 'form-control form-control-sm';

  const controls = [
    { element: typeFilter, className: 'col-4' },
    { element: extensionFilter, className: 'col-3' },
    { element: textFilter, className: 'col-5' },
  ];

  for (const item of controls) {
    const field = document.createElement('div');
    field.className = item.className;
    field.appendChild(item.element);
    filterPanel.appendChild(field);
  }

  const actionRow = document.createElement('div');
  actionRow.className = 'ui-actions ui-row';
  wrapper.appendChild(actionRow);

  const selectAllButton = document.createElement('button');
  selectAllButton.type = 'button';
  selectAllButton.className = 'btn btn-sm btn-outline-primary';
  selectAllButton.textContent = 'Tout';

  const selectNoneButton = document.createElement('button');
  selectNoneButton.type = 'button';
  selectNoneButton.className = 'btn btn-sm btn-outline-secondary';
  selectNoneButton.textContent = 'Aucun';

  const invertButton = document.createElement('button');
  invertButton.type = 'button';
  invertButton.className = 'btn btn-sm btn-outline-warning';
  invertButton.textContent = 'Inverser';

  const downloadButton = document.createElement('button');
  downloadButton.type = 'button';
  downloadButton.className = 'btn btn-sm btn-primary';
  downloadButton.textContent = 'Télécharger la sélection';
  downloadButton.disabled = true;

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'btn btn-sm btn-outline-primary';
  copyButton.textContent = 'Copier les URL';
  copyButton.disabled = true;

  const csvButton = document.createElement('button');
  csvButton.type = 'button';
  csvButton.className = 'btn btn-sm btn-outline-success';
  csvButton.textContent = 'CSV';
  csvButton.disabled = true;

  const jsonButton = document.createElement('button');
  jsonButton.type = 'button';
  jsonButton.className = 'btn btn-sm btn-outline-secondary';
  jsonButton.textContent = 'JSON';
  jsonButton.disabled = true;

  const txtButton = document.createElement('button');
  txtButton.type = 'button';
  txtButton.className = 'btn btn-sm btn-outline-secondary';
  txtButton.textContent = 'TXT';
  txtButton.disabled = true;

  const rescanButton = document.createElement('button');
  rescanButton.type = 'button';
  rescanButton.className = 'btn';
  rescanButton.textContent = 'Rescanner';

  for (const button of [
    selectAllButton,
    selectNoneButton,
    invertButton,
    downloadButton,
    copyButton,
    csvButton,
    jsonButton,
    txtButton,
    rescanButton,
  ]) {
    actionRow.appendChild(button);
  }

  const downloadSheet = document.createElement('section');
  downloadSheet.className = 'ui-download-sheet generic-scan-download-sheet border rounded p-3 d-grid gap-2';
  const downloadSheetTitle = document.createElement('strong');
  downloadSheetTitle.textContent = 'Téléchargement';
  const formatSelect = document.createElement('select');
  formatSelect.className = 'form-select form-select-sm';
  for (const [value, label] of [
    ['zip', 'ZIP'],
    ['cbz', 'CBZ'],
    ['folder', 'Dossier'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    formatSelect.appendChild(option);
  }
  const archiveName = document.createElement('input');
  archiveName.type = 'text';
  archiveName.className = 'form-control form-control-sm';
  archiveName.value = document.title.trim() || new URL(ctx.url).hostname;
  archiveName.maxLength = 150;
  archiveName.placeholder = 'Nom de l’archive';
  const archiveEstimate = document.createElement('small');
  archiveEstimate.className = 'text-muted';
  archiveEstimate.textContent = 'Le format et le nom s’appliquent aux images sélectionnées.';
  const destinationPicker = createDestinationPicker({ mode: 'browser', subfolderTemplate: 'Grandload', customFolderName: '' });
  void getPrefs().then((prefs) => destinationPicker.setSettings(prefs.destination));
  downloadSheet.append(downloadSheetTitle, formatSelect, archiveName, destinationPicker.element, archiveEstimate);
  wrapper.appendChild(downloadSheet);

  const badges = document.createElement('div');
  badges.className = 'd-flex flex-wrap gap-2';
  wrapper.appendChild(badges);

  const list = document.createElement('ul');
  list.className = 'ui-resource-list';
  wrapper.appendChild(list);

  const imageSection = document.createElement('section');
  imageSection.className = 'ui-scan-gallery';
  imageSection.hidden = true;
  wrapper.appendChild(imageSection);
  let gallery: ImageGallery | undefined;
  let gallerySummary: HTMLElement | undefined;
  let gallerySelectAll: HTMLButtonElement | undefined;
  let galleryDownload: HTMLButtonElement | undefined;

  const renderSkeletons = (): void => {
    imageSection.replaceChildren();
    imageSection.hidden = false;
    const grid = document.createElement('div');
    grid.className = 'ui-grid';
    for (let index = 0; index < 6; index += 1) {
      const skeleton = document.createElement('div');
      skeleton.className = 'ui-card ui-skeleton';
      skeleton.setAttribute('aria-hidden', 'true');
      grid.appendChild(skeleton);
    }
    imageSection.appendChild(grid);
  };

  const renderView = (): void => {
    const showingImages = activeView === 'images';
    imageSection.hidden = !showingImages;
    list.hidden = showingImages;
    imagesTab.setAttribute('aria-selected', String(showingImages));
    linksTab.setAttribute('aria-selected', String(!showingImages));
  };

  imagesTab.addEventListener('click', () => {
    activeView = 'images';
    renderView();
  });
  linksTab.addEventListener('click', () => {
    activeView = 'links';
    renderView();
  });

  const renderGallery = (): void => {
    const imageItems: GalleryItem[] = state.items
      .filter((item) => item.type === 'image')
      .map((item) => ({
        id: item.id,
        url: item.url,
        label: item.label,
        ext: item.ext,
        ...(item.width ? { width: item.width } : {}),
        ...(item.height ? { height: item.height } : {}),
        ...(item.provenance ? { provenance: item.provenance } : {}),
        selected: state.selectedIds.has(item.id),
        ...(item.width !== undefined && item.height !== undefined
          ? { likelyThumbnail: item.width < 200 || item.height < 200 }
          : {}),
        ...(item.width !== undefined && item.height !== undefined &&
        (item.width < 200 || item.height < 200)
          ? { badge: 'Miniature probable' }
          : {}),
      }));
    imageSection.replaceChildren();
    if (imageItems.length === 0) {
      imageSection.hidden = true;
      gallery = undefined;
      gallerySummary = undefined;
      gallerySelectAll = undefined;
      galleryDownload = undefined;
      return;
    }
    imageSection.hidden = false;
    const toolbar = new ImageToolbar((filters) => gallery?.setFilters(filters));
    gallery = new ImageGallery(imageItems, {
      onSelectionChange: (selected) => {
        const imageIds = new Set(imageItems.map((item) => item.id));
        state.selectedIds = new Set([
          ...Array.from(state.selectedIds).filter((id) => !imageIds.has(id)),
          ...selected.map((item) => item.id),
        ]);
        updateButtons();
      },
      onOpen: (item) => {
        const dialog = lightbox(item, () => {
          dialog.close();
          dialog.remove();
        }) as HTMLDialogElement;
        document.body.appendChild(dialog);
        if (typeof dialog.showModal === 'function') dialog.showModal();
      },
    });
    imageSection.append(toolbar.element, gallery.element);

    gallerySummary = document.createElement('span');
    gallerySummary.className = 'ui-gallery-actions__summary';
    gallerySelectAll = document.createElement('button');
    gallerySelectAll.type = 'button';
    gallerySelectAll.className = 'ui-button ui-button--secondary';
    gallerySelectAll.textContent = 'Tout sélectionner';
    galleryDownload = document.createElement('button');
    galleryDownload.type = 'button';
    galleryDownload.className = 'ui-button ui-button--primary';
    galleryDownload.textContent = 'Télécharger';
    const galleryActions = document.createElement('div');
    galleryActions.className = 'ui-selection-bar ui-gallery-actions';
    galleryActions.append(gallerySummary, gallerySelectAll, galleryDownload);
    gallery.element.appendChild(galleryActions);

    gallerySelectAll.addEventListener('click', () => gallery?.selectFiltered());
    galleryDownload.addEventListener('click', () => downloadButton.click());
  };

  const updateButtons = (): void => {
    const selectedCount = state.selectedIds.size;
    downloadButton.disabled = selectedCount === 0;
    copyButton.disabled = selectedCount === 0;
    csvButton.disabled = selectedCount === 0;
    jsonButton.disabled = selectedCount === 0;
    txtButton.disabled = selectedCount === 0;
    const selectedImages = state.items.filter(
      (item) => item.type === 'image' && state.selectedIds.has(item.id),
    );
    archiveEstimate.textContent = selectedImages.length
      ? `${selectedImages.length} image(s) sélectionnée(s) pour l’archive.`
      : 'Le format et le nom s’appliquent aux images sélectionnées.';
    if (gallerySummary) {
      const visibleCount = gallery?.filtered.length ?? 0;
      gallerySummary.textContent = `${selectedImages.length} sélectionnée(s) · ${visibleCount} affichée(s)`;
    }
    if (gallerySelectAll) gallerySelectAll.disabled = (gallery?.filtered.length ?? 0) === 0;
    if (galleryDownload) galleryDownload.disabled = selectedCount === 0;
  };

  const renderBadges = (): void => {
    const counts = getTypeCounts(state.items);
    badges.innerHTML = '';

    for (const [type, count] of Object.entries(counts)) {
      const badge = document.createElement('span');
      badge.className = 'badge text-bg-light border';
      badge.textContent = `${type}: ${count}`;
      badges.appendChild(badge);
    }
  };

  const renderList = (): void => {
    const filtered = filterScanItems(state.items, state.filters);
    list.replaceChildren();

    if (filtered.length === 0) {
      emptyMessage.hidden = false;
      return;
    }

    emptyMessage.hidden = true;

    for (const item of filtered) {
      const row = document.createElement('li');
      row.className = 'ui-resource-item';

      const labelBox = document.createElement('div');
      labelBox.className = 'ui-resource-item__content';
      const title = document.createElement('div');
      title.className = 'ui-resource-item__title';
      title.textContent = item.label;
      const meta = document.createElement('small');
      meta.className = 'ui-resource-item__meta';
      meta.textContent = `${item.type} · ${item.ext || 'no ext'} · ${item.source}`;
      labelBox.appendChild(title);
      labelBox.appendChild(meta);
      if (item.type === 'image' && item.provenance) {
        const provenance = document.createElement('span');
        provenance.className = 'ui-badge ui-badge--neutral';
        provenance.textContent = `Provenance : ${item.provenance}`;
        labelBox.appendChild(provenance);
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'ui-resource-item__check';
      checkbox.checked = state.selectedIds.has(item.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.selectedIds.add(item.id);
        } else {
          state.selectedIds.delete(item.id);
        }
        updateButtons();
      });

      row.appendChild(labelBox);
      row.appendChild(checkbox);
      list.appendChild(row);
    }
  };

  const refresh = (): void => {
    renderBadges();
    renderList();
    renderGallery();
    updateButtons();
    renderView();
  };

  const syncFilters = (): void => {
    state.filters = {
      type: typeFilter.value as ScanFilterState['type'],
      extension: extensionFilter.value,
      text: textFilter.value,
    };
    refresh();
  };

  typeFilter.addEventListener('change', syncFilters);
  extensionFilter.addEventListener('input', syncFilters);
  textFilter.addEventListener('input', syncFilters);

  selectAllButton.addEventListener('click', () => {
    const filtered = filterScanItems(state.items, state.filters);
    for (const item of filtered) {
      state.selectedIds.add(item.id);
    }
    refresh();
  });

  selectNoneButton.addEventListener('click', () => {
    state.selectedIds.clear();
    refresh();
  });

  invertButton.addEventListener('click', () => {
    const filtered = filterScanItems(state.items, state.filters);
    const filteredIds = new Set(filtered.map((item) => item.id));
    const next = new Set<string>();

    for (const item of state.items) {
      if (filteredIds.has(item.id) && !state.selectedIds.has(item.id)) {
        next.add(item.id);
      }
      if (!filteredIds.has(item.id) && state.selectedIds.has(item.id)) {
        next.add(item.id);
      }
    }

    state.selectedIds = next;
    refresh();
  });

  downloadButton.addEventListener('click', async () => {
    const selected = state.items.filter((item) => state.selectedIds.has(item.id));
    if (selected.length === 0) {
      return;
    }

    const imageSelection = selected.filter((item) => item.type === 'image');
    const warning = archiveWarning(imageSelection);
    if (warning) {
      const confirmed = window.confirm(`${warning} Confirmez le téléchargement ?`);
      if (!confirmed) return;
    }

    if (imageSelection.length > 0) {
      const pages = imageSelection.map((item, index) => ({
        index,
        url: item.url,
        ext: item.ext || 'jpg',
        ...(item.width ? { width: item.width } : {}),
        ...(item.height ? { height: item.height } : {}),
      }));
        const destination = destinationPicker.getSettings();
        const response = await send('JOB_CREATE', {
        kind: 'chapter',
        params: {
          pages,
          packagerId: formatSelect.value as 'cbz' | 'zip' | 'folder',
          meta: {
            series: 'Liens et médias',
            chapter: { number: 0, label: 'Scan de la page', url: ctx.url },
            pageCount: pages.length,
            sourceUrl: ctx.url,
          },
          options: {
            archiveName: archiveName.value,
            destinationMode: destination.mode,
            destinationTemplate: destination.subfolderTemplate,
          },
        },
      });
      api.setStatus?.(
        response.ok
          ? `Archive en préparation : ${pages.length} image(s).`
          : response.error?.message ?? 'Le téléchargement a échoué.',
      );
      return;
    }

    if (selected.length > 50) {
      const confirmed = window.confirm('Vous allez télécharger plus de 50 fichiers. Confirmez ?');
      if (!confirmed) {
        return;
      }
    }

    const response = await send('JOB_CREATE', {
      kind: 'links',
      params: {
        items: selected.map((item) => ({
          id: item.id,
          url: item.url,
          label: item.label,
          type: item.type,
          ext: item.ext,
        })),
      },
    });

    if (response.ok) {
      api.setStatus?.(`Téléchargement démarré : ${selected.length} fichier(s) en attente.`);
    } else {
      api.setStatus?.(response.error?.message ?? 'Le téléchargement a échoué.');
    }
  });

  copyButton.addEventListener('click', async () => {
    const selected = state.items.filter((item) => state.selectedIds.has(item.id));
    const urls = selected.map((item) => item.url).join('\n');
    await navigator.clipboard.writeText(urls);
    api.setStatus?.(`${selected.length} URL(s) copiées.`);
  });

  const buildExport = (
    content: string,
    extension: string,
    mimeType: string,
    fileName: string,
  ): void => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${fileName}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  csvButton.addEventListener('click', () => {
    const selected = state.items.filter((item) => state.selectedIds.has(item.id));
    buildExport(exportCsv(selected), 'csv', 'text/csv;charset=utf-8', 'grandload-export');
  });

  jsonButton.addEventListener('click', () => {
    const selected = state.items.filter((item) => state.selectedIds.has(item.id));
    buildExport(exportJson(selected), 'json', 'application/json;charset=utf-8', 'grandload-export');
  });

  txtButton.addEventListener('click', () => {
    const selected = state.items.filter((item) => state.selectedIds.has(item.id));
    buildExport(exportTxt(selected), 'txt', 'text/plain;charset=utf-8', 'grandload-export');
  });

  const load = async (): Promise<void> => {
    if (!/^https?:\/\//i.test(ctx.url)) {
      emptyMessage.hidden = false;
      emptyMessage.textContent = 'Cette page ne peut pas être analysée.';
      emptyMessage.classList.add('alert-danger');
      downloadButton.disabled = true;
      copyButton.disabled = true;
      csvButton.disabled = true;
      jsonButton.disabled = true;
      txtButton.disabled = true;
      return;
    }

    const setScanState = (viewState: ScanViewState, count = 0): void => {
      scanState.textContent = viewState === 'error' ? '' : getScanStateMessage(viewState, count);
      scanState.dataset.state = viewState;
      scanState.className = `ui-scan-state ui-muted mb-0${
        viewState === 'error' || viewState === 'permission' ? ' text-danger' : ''
      }`;
      stopScanButton.hidden = viewState !== 'loading';
    };

    setScanState('loading');
    renderSkeletons();
    emptyMessage.hidden = true;
    stopScanButton.disabled = false;
    wrapper.querySelector('.generic-scan-partial-warning')?.remove();
    const sequence = ++loadSequence;
    const scanId = `scan-${Date.now()}-${sequence}`;
    activeScanId = scanId;
    try {
      const result = await scanCurrentPageInTab(
        ctx.tabId,
        ctx.url,
        lazyCheckbox.checked,
        scanId,
        (step, count) => {
          if (sequence === loadSequence) {
            scanState.textContent = `Scan en cours… étape ${step}, ${count} ressource(s) détectée(s).`;
          }
        },
      );
      if (sequence !== loadSequence || activeScanId !== scanId) return;
      const results = result.items;
      state.items = results;
      renderBadges();
      renderList();
      renderGallery();
      updateButtons();
      setScanState(results.length === 0 ? 'empty' : 'results', results.length);
      if (result.warning) {
        const warning = document.createElement('p');
        warning.className = 'alert alert-warning mb-0 generic-scan-partial-warning';
        warning.textContent = result.warning;
        wrapper.insertBefore(warning, filterPanel);
      }
    } catch (error: unknown) {
      if (sequence !== loadSequence || activeScanId !== scanId) return;
      const permission = isPermissionError(error);
      setScanState(permission ? 'permission' : 'error');
      emptyMessage.hidden = false;
      emptyMessage.className = 'alert alert-danger mb-0';
      emptyMessage.replaceChildren();
      const message = document.createElement('p');
      message.textContent = permission
        ? `Grandload a besoin d’un accès temporaire à ${new URL(ctx.url).hostname} pour lire cette page.`
        : `Le scan a échoué : ${error instanceof Error ? error.message : String(error)}`;
      emptyMessage.appendChild(message);
      if (permission) {
        const authorize = document.createElement('button');
        authorize.type = 'button';
        authorize.className = 'ui-button ui-button--secondary';
        authorize.textContent = 'Autoriser sur ce site';
        authorize.addEventListener('click', () => {
          authorize.disabled = true;
          void requestGenericSiteAccess(ctx.url).then((granted) => {
            if (granted) {
              void load();
              return;
            }
            authorize.disabled = false;
            api.setStatus?.('Autorisation non accordée pour ce site.');
          });
        });
        emptyMessage.appendChild(authorize);
      } else {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'ui-button ui-button--secondary';
        retry.textContent = 'Réessayer';
        retry.addEventListener('click', () => void load());
        emptyMessage.appendChild(retry);
      }
      updateButtons();
    }
  };

  stopScanButton.addEventListener('click', () => {
    stopScanButton.disabled = true;
    if (activeScanId) {
      chrome.tabs.sendMessage(ctx.tabId, { type: 'SCAN_CANCEL', payload: { scanId: activeScanId } });
      activeScanId = undefined;
    }
    api.setStatus?.('Arrêt du chargement des images demandé.');
  });

  rescanButton.addEventListener('click', () => {
    void load();
  });
  renderView();

  void load();
}

export const genericScanModule: GrandloadModule = {
  id: 'generic-scan',
  title: 'Scan',
  priority: 10,
  canHandle: (ctx: PageContext) => /^https?:\/\//.test(ctx.url),
  mountPanel: (root: HTMLElement, ctx: PageContext, api: ModuleApi): void => {
    buildPopupCard(root, ctx, api);
  },
  requiredPermissions: ['activeTab', 'scripting'],
};

export default genericScanModule;

export function registerGenericScanModule(): void {
  registerModule(genericScanModule);
}
