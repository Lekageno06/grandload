import '../adapters';
import '../modules';
import './shell.css';
import { send } from '../core/messaging';
import { listModules } from '../core/registry';
import { getJobs, getPrefs } from '../core/storage';
import type { Job, PageContext } from '../core/types';
import { formatJobLabel } from './job-labels';
import { getVisibleModules } from './module-visibility';
import { icon } from '../ui/icons';

declare const __BUILD_DATE__: string;

type ActiveTab = chrome.tabs.Tab & { id: number; url: string };
let refreshSequence = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

function node(id: string): HTMLElement | null {
  return document.getElementById(id);
}
function setStatus(message: string): void {
  const target = node('status');
  if (target) target.textContent = message;
}

function applyTheme(theme: 'auto' | 'light' | 'dark'): void {
  const resolved = theme === 'auto'
    ? (globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.dataset.theme = resolved;
}
function renderBuildInfo(): void {
  const version = node('app-version');
  const build = node('build-info');
  if (version && chrome.runtime?.getManifest)
    version.textContent = `v${chrome.runtime.getManifest().version}`;
  if (build) build.textContent = `Build ${new Date(__BUILD_DATE__).toLocaleString('fr-FR')}`;
}

function renderJobs(): void {
  void getJobs()
    .then((jobs) => {
      const list = node('job-list');
      const count = node('task-count');
      if (!list || !count) return;
      const active = Object.values(jobs).filter(
        (job) => !['done', 'cancelled', 'ignored'].includes(job.state),
      );
      count.textContent = String(active.length);
      list.replaceChildren();
      if (active.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'ui-muted';
        empty.textContent = 'Aucune tâche en cours.';
        list.append(empty);
        return;
      }
      for (const job of active) {
        const item = document.createElement('article');
        item.className = 'job-item';
        const title = document.createElement('div');
        title.className = 'job-item__title';
        title.textContent = formatJobLabel(job.params);
        const state = document.createElement('div');
        state.className = 'job-item__meta';
        const labels: Record<Job['state'], string> = {
          queued: 'En attente', running: 'En cours', paused: 'En pause', done: 'Terminé',
          failed: 'Échec', ignored: 'Ignoré', cancelled: 'Annulé',
        };
        state.textContent = labels[job.state];
        const progress = document.createElement('div');
        progress.className = 'job-item__meta';
        progress.textContent = `${job.progress.done}/${job.progress.total} planches`;
        const progressBar = document.createElement('progress');
        progressBar.max = Math.max(1, job.progress.total);
        progressBar.value = job.progress.done;
        progressBar.setAttribute('aria-label', 'Progression de la tâche');
        item.append(title, state, progress, progressBar);
        if (job.error || job.warning) {
          const details = document.createElement('details');
          const summary = document.createElement('summary');
          summary.textContent = 'Détails';
          const message = document.createElement('p');
          message.className = 'job-item__meta';
          message.textContent = job.error?.message ?? job.warning?.message ?? '';
          details.append(summary, message);
          item.append(details);
        }
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-outline-danger';
        cancel.textContent = 'Annuler';
        cancel.addEventListener('click', () => {
          cancel.disabled = true;
          void send('JOB_CONTROL', { jobId: job.id, action: 'cancel' }).then(() => renderJobs());
        });
        item.append(cancel);
        list.append(item);
      }
    })
    .catch(() => undefined);
}

async function getActiveTab(): Promise<ActiveTab | undefined> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return undefined;
  const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) =>
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve),
  );
  const tab = tabs[0];
  if (!tab || typeof tab.id !== 'number' || typeof tab.url !== 'string' || tab.url.length === 0)
    return undefined;
  try {
    const parsed = new URL(tab.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  } catch {
    return undefined;
  }
  return tab as ActiveTab;
}

function showEmptyState(message: string, action?: { label: string; handler: () => void }): void {
  const container = node('module-list');
  if (!container) return;
  container.replaceChildren();
  const empty = document.createElement('section');
  empty.className = 'panel-empty';
  const text = document.createElement('p');
  text.textContent = message;
  empty.append(text);
  if (action) {
    const button = document.createElement('button');
    button.className = 'ui-button ui-button--secondary';
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', action.handler);
    empty.append(button);
  }
  container.append(empty);
}

function showPermissionMessage(tab: ActiveTab): void {
  const permission = node('permission-state');
  if (!permission) return;
  permission.hidden = false;
  permission.replaceChildren();
  permission.className = 'panel-permission';
  const message = document.createElement('p');
  message.textContent = `Grandload peut analyser ${new URL(tab.url).hostname} après votre autorisation.`;
  const button = document.createElement('button');
  button.className = 'ui-button ui-button--secondary';
  button.type = 'button';
  button.textContent = 'Autoriser sur ce site';
  button.addEventListener('click', () => {
    void requestSiteAccess(tab.url);
  });
  permission.append(message, button);
}

async function requestSiteAccess(url: string): Promise<void> {
  const parsed = new URL(url);
  const origin = `${parsed.protocol}//${parsed.host}/*`;
  const granted = await new Promise<boolean>((resolve) =>
    chrome.permissions.request({ origins: [origin] }, resolve),
  );
  if (granted) void initializePanel();
  else setStatus('Autorisation non accordée.');
}

function renderModules(
  context: PageContext,
  prefs: Awaited<ReturnType<typeof getPrefs>>,
  sequence: number,
): void {
  const container = node('module-list');
  if (!container || sequence !== refreshSequence) return;
  const modules = getVisibleModules(listModules(), context, prefs);
  const preferences = modules.find((module) => module.id === 'preferences');
  const featureModules = modules.filter((module) => module.id !== 'preferences');
  const preferencesButton = node('preferences-button');
  if (preferencesButton instanceof HTMLButtonElement) {
    preferencesButton.replaceChildren(icon('settings'));
    preferencesButton.onclick = () => {
      if (!preferences) return;
      container.replaceChildren();
      const content = document.createElement('section');
      content.className = 'panel-content';
      const panel = document.createElement('div');
      content.append(panel);
      container.append(content);
      preferences.mountPanel(panel, context, {
        setStatus,
        setBusy: (busy) => {
          preferencesButton.disabled = busy;
        },
      });
    };
  }
  container.replaceChildren();
  if (featureModules.length === 0) {
    showEmptyState('Aucun module applicable sur cette page.');
    return;
  }
  const tabs = document.createElement('nav');
  tabs.className = 'ui-tabs panel-tabs';
  tabs.setAttribute('aria-label', 'Modules Grandload');
  const indicator = document.createElement('span');
  indicator.className = 'ui-tabs__indicator';
  indicator.setAttribute('aria-hidden', 'true');
  tabs.append(indicator);
  const content = document.createElement('section');
  content.className = 'panel-content';
  const mount = (module: (typeof modules)[number], active: HTMLButtonElement): void => {
    for (const tab of tabs.querySelectorAll<HTMLButtonElement>('.panel-tab'))
      tab.className = 'ui-button ui-button--ghost panel-tab';
    active.className = 'ui-button ui-button--secondary ui-tab panel-tab';
    content.replaceChildren();
    indicator.style.width = `${active.offsetWidth}px`;
    indicator.style.transform = `translateX(${active.offsetLeft}px)`;
    const panel = document.createElement('div');
    content.append(panel);
    module.mountPanel(panel, context, {
      setStatus,
      setBusy: (busy) => {
        active.disabled = busy;
      },
    });
  };
  featureModules.forEach((module, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `ui-button ui-tab panel-tab ${index === 0 ? 'ui-button--secondary' : 'ui-button--ghost'}`;
    tab.textContent = module.title;
    tab.addEventListener('click', () => mount(module, tab));
    tabs.append(tab);
  });
  container.append(tabs, content);
  const first = tabs.querySelector<HTMLButtonElement>('.panel-tab');
  if (first) requestAnimationFrame(() => mount(featureModules[0]!, first));
  setStatus('');
}

async function initializePanel(): Promise<void> {
  const sequence = ++refreshSequence;
  renderBuildInfo();
  renderJobs();
  const permission = node('permission-state');
  if (permission) permission.hidden = true;
  const tab = await getActiveTab();
  if (sequence !== refreshSequence) return;
  if (!tab) {
    setStatus('Cliquez sur l’icône Grandload pour analyser cet onglet.');
    showEmptyState(
      'L’URL de l’onglet est indisponible. Le panneau ne peut pas demander d’autorisation sans connaître le domaine.',
    );
    return;
  }
  const domain = node('page-domain');
  if (domain) domain.textContent = new URL(tab.url).hostname;
  const response = await send('PAGE_CONTEXT', { tabId: tab.id });
  if (!response.ok) {
    setStatus('Impossible d’obtenir le contexte de l’onglet.');
    showPermissionMessage(tab);
    return;
  }
  const context = response.data as PageContext;
  if (!context.url) {
    showPermissionMessage(tab);
    setStatus('Le domaine est connu, mais le contexte n’est pas encore accessible.');
    return;
  }
  const prefs = await getPrefs();
  applyTheme(prefs.theme);
  renderModules(context, prefs, sequence);
}

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    void initializePanel();
  }, 150);
}

if (chrome.tabs?.onActivated) chrome.tabs.onActivated.addListener(scheduleRefresh);
if (chrome.tabs?.onUpdated)
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url) scheduleRefresh();
  });
if (chrome.storage?.onChanged)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'prefs' in changes) scheduleRefresh();
  });

void initializePanel();
