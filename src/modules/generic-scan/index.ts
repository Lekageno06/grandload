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

function scanCurrentPageInTab(
  tabId: number,
  pageUrl: string,
  loadLazy: boolean,
): Promise<ScanItem[]> {
  return injectContentReader(tabId).then(
    () =>
      new Promise<ScanItem[]>((resolve, reject) => {
        chrome.tabs.sendMessage(
          tabId,
          { type: 'READ_PAGE_ASSETS', payload: { pageUrl, loadLazy } },
          (response: { ok?: boolean; data?: ScanItem[] } | undefined) => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) {
              reject(new Error(runtimeError.message ?? 'Lecture de la page impossible.'));
              return;
            }
            if (!response?.ok || !response.data) {
              reject(new Error('Lecture de la page impossible.'));
              return;
            }
            resolve(response.data);
          },
        );
      }),
  );
}

function isPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /permission|access|autorisation|not allowed|cannot access/iu.test(message);
}
function buildPopupCard(root: HTMLElement, ctx: PageContext, api: ModuleApi): void {
  const state: ModuleState = {
    items: [],
    selectedIds: new Set<string>(),
    filters: { type: 'all', extension: '', text: '' },
  };

  const wrapper = document.createElement('div');
  wrapper.className = 'ui-stack';
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
  filterPanel.className = 'row g-2';
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
  downloadSheet.className = 'ui-download-sheet border rounded p-3 d-grid gap-2';
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
  list.className = 'ui-stack';
  wrapper.appendChild(list);

  const imageSection = document.createElement('section');
  imageSection.className = 'ui-scan-gallery';
  imageSection.hidden = true;
  wrapper.appendChild(imageSection);
  let gallery: ImageGallery | undefined;

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
    list.innerHTML = '';

    if (filtered.length === 0) {
      emptyMessage.hidden = false;
      return;
    }

    emptyMessage.hidden = true;

    for (const item of filtered) {
      const row = document.createElement('li');
      row.className = 'list-group-item d-flex justify-content-between align-items-start gap-3';

      const labelBox = document.createElement('div');
      labelBox.className = 'flex-grow-1';
      const title = document.createElement('div');
      title.className = 'fw-semibold';
      title.textContent = item.label;
      const meta = document.createElement('small');
      meta.className = 'text-muted';
      meta.textContent = `${item.type} · ${item.ext || 'no ext'} · ${item.source}`;
      labelBox.appendChild(title);
      labelBox.appendChild(meta);
      if (item.type === 'image' && item.provenance) {
        const provenance = document.createElement('span');
        provenance.className = 'badge text-bg-secondary align-self-start';
        provenance.textContent = `Provenance : ${item.provenance}`;
        labelBox.appendChild(provenance);
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
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
      scanState.textContent = getScanStateMessage(viewState, count);
      scanState.dataset.state = viewState;
      scanState.className = `ui-scan-state ui-muted mb-0${
        viewState === 'error' || viewState === 'permission' ? ' text-danger' : ''
      }`;
      stopScanButton.hidden = viewState !== 'loading';
    };

    setScanState('loading');
    renderSkeletons();
    try {
      const results = await scanCurrentPageInTab(ctx.tabId, ctx.url, lazyCheckbox.checked);
      state.items = results;
      renderBadges();
      renderList();
      renderGallery();
      updateButtons();
      setScanState(results.length === 0 ? 'empty' : 'results', results.length);
    } catch (error: unknown) {
      const permission = isPermissionError(error);
      setScanState(permission ? 'permission' : 'error');
      emptyMessage.hidden = false;
      emptyMessage.className = 'alert alert-danger mb-0';
      emptyMessage.textContent = permission
        ? 'Cliquez sur l’icône Grandload pour autoriser la lecture de cet onglet.'
        : `Le scan a échoué : ${error instanceof Error ? error.message : String(error)}`;
      updateButtons();
    }
  };

  stopScanButton.addEventListener('click', () => {
    stopScanButton.disabled = true;
    chrome.tabs.sendMessage(ctx.tabId, { type: 'STOP_PAGE_ASSETS', payload: {} });
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
  title: 'Liens et médias',
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
