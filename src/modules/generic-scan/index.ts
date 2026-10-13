import { send } from '../../core/messaging';
import { registerModule } from '../../core/registry';
import type { GrandloadModule, ModuleApi, PageContext } from '../../core/types';
import { exportCsv, exportJson, exportTxt } from './exports';
import { filterScanItems, getTypeCounts } from './filters';
import type { ScanFilterState, ScanItem } from './types';

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

function scanCurrentPageInTab(tabId: number, pageUrl: string): Promise<ScanItem[]> {
  return injectContentReader(tabId).then(
    () =>
      new Promise<ScanItem[]>((resolve) => {
        chrome.tabs.sendMessage(
          tabId,
          { type: 'READ_PAGE_ASSETS', payload: { pageUrl } },
          (response: { ok?: boolean; data?: ScanItem[] } | undefined) => {
            const runtimeError = chrome.runtime.lastError;
            resolve(runtimeError || !response?.ok || !response.data ? [] : response.data);
          },
        );
      }),
  );
}
function buildPopupCard(root: HTMLElement, ctx: PageContext, api: ModuleApi): void {
  const state: ModuleState = {
    items: [],
    selectedIds: new Set<string>(),
    filters: { type: 'all', extension: '', text: '' },
  };

  const wrapper = document.createElement('div');
  wrapper.className = 'd-grid gap-3';
  root.appendChild(wrapper);

  const emptyMessage = document.createElement('div');
  emptyMessage.className = 'alert alert-info mb-0';
  emptyMessage.textContent = 'Aucune ressource détectée sur cette page.';
  emptyMessage.hidden = true;
  wrapper.appendChild(emptyMessage);

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
  actionRow.className = 'd-flex flex-wrap gap-2';
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

  for (const button of [
    selectAllButton,
    selectNoneButton,
    invertButton,
    downloadButton,
    copyButton,
    csvButton,
    jsonButton,
    txtButton,
  ]) {
    actionRow.appendChild(button);
  }

  const badges = document.createElement('div');
  badges.className = 'd-flex flex-wrap gap-2';
  wrapper.appendChild(badges);

  const list = document.createElement('ul');
  list.className = 'list-group mt-3';
  wrapper.appendChild(list);

  const updateButtons = (): void => {
    const selectedCount = state.selectedIds.size;
    downloadButton.disabled = selectedCount === 0;
    copyButton.disabled = selectedCount === 0;
    csvButton.disabled = selectedCount === 0;
    jsonButton.disabled = selectedCount === 0;
    txtButton.disabled = selectedCount === 0;
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
    updateButtons();
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

    const results = await scanCurrentPageInTab(ctx.tabId, ctx.url);
    state.items = results;
    renderBadges();
    renderList();
    updateButtons();
  };

  void load();
}

export const genericScanModule: GrandloadModule = {
  id: 'generic-scan',
  title: 'Scan générique',
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
