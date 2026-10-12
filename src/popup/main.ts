import '../adapters';
import '../modules';
import { send } from '../core/messaging';
import { listModules } from '../core/registry';
import type { PageContext } from '../core/types';

declare const __BUILD_DATE__: string;

function renderBuildInfo(): void {
  const versionNode = document.querySelector('#app-version');
  const buildNode = document.querySelector('#build-info');
  if (versionNode && typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    versionNode.textContent = `v${chrome.runtime.getManifest().version}`;
  }
  if (buildNode) {
    buildNode.textContent = `Build ${new Date(__BUILD_DATE__).toLocaleString('fr-FR')}`;
  }
}

function setStatus(message: string): void {
  const statusNode = document.querySelector('#status');

  if (statusNode) {
    statusNode.textContent = message;
  }
}

function createTabsContainer(): HTMLElement {
  const existing = document.querySelector('#module-list');
  if (existing instanceof HTMLElement) {
    return existing;
  }

  const container = document.createElement('div');
  container.id = 'module-list';
  container.className = 'mt-3';
  document.body.appendChild(container);
  return container;
}

async function getActiveTabId(): Promise<number | undefined> {
  if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.query !== 'function') {
    return undefined;
  }

  const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (results: chrome.tabs.Tab[]) =>
      resolve(results),
    );
  });

  const [activeTab] = tabs;
  if (!activeTab || typeof activeTab.id !== 'number') {
    return undefined;
  }

  return activeTab.id;
}

async function initializePopup(): Promise<void> {
  renderBuildInfo();
  const tabId = await getActiveTabId();

  if (typeof tabId !== 'number') {
    setStatus('Aucun onglet actif.');
    return;
  }

  const response = await send('PAGE_CONTEXT', { tabId });

  if (!response.ok) {
    setStatus('Impossible d’obtenir le contexte de l’onglet.');
    return;
  }

  const context = response.data as PageContext;
  const { getPrefs } = await import('../core/storage');
  const prefs = await getPrefs();

  // Filtrer les modules selon canHandle ET modulesEnabled (RG-503)
  const applicableModules = listModules().filter((module) => {
    if (!module.canHandle(context)) {
      return false;
    }
    // Le module préférences reste toujours accessible
    if (module.id === 'preferences') {
      return true;
    }
    return prefs.modulesEnabled[module.id] !== false;
  });

  if (applicableModules.length === 0) {
    setStatus('Aucun module applicable sur cette page.');
    return;
  }

  const container = createTabsContainer();
  container.innerHTML = '';

  const tabsRow = document.createElement('div');
  tabsRow.className = 'd-flex flex-wrap gap-1 mb-2';
  container.appendChild(tabsRow);

  const contentArea = document.createElement('div');
  container.appendChild(contentArea);

  const mountModule = (module: (typeof applicableModules)[number], activeBtn: HTMLButtonElement): void => {
    Array.from(tabsRow.querySelectorAll('button')).forEach((btn) => {
      btn.className = 'btn btn-sm btn-outline-primary';
    });
    activeBtn.className = 'btn btn-sm btn-primary';
    contentArea.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'border rounded p-3 bg-white shadow-sm';
    contentArea.appendChild(panel);
    module.mountPopup(panel, context, {
      setStatus: (message: string) => setStatus(message),
    });
  };

  applicableModules.forEach((module, index) => {
    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.className = index === 0 ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline-primary';
    tabButton.textContent = module.title;
    tabButton.addEventListener('click', () => {
      mountModule(module, tabButton);
    });
    tabsRow.appendChild(tabButton);

    if (index === 0) {
      mountModule(module, tabButton);
    }
  });

  setStatus(`${applicableModules.length} module(s) applicable(s).`);
}

void initializePopup();
