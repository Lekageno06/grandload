import { registerModule } from '../../core/registry';
import { listModules } from '../../core/registry';
import { getPrefs, setPrefs } from '../../core/storage';
import type { GrandloadModule, ModuleApi, PageContext } from '../../core/types';
import {
  chooseAndStoreCustomFolder,
  getCustomFolderHandle,
  isCustomFolderAvailable,
  isDirectoryPickerCancellation,
} from '../../destinations/custom-folder';

const preferencesModule: GrandloadModule = {
  id: 'preferences',
  title: 'Préférences',
  priority: 10,
  canHandle: () => true, // Toujours disponible
  mountPanel: (root: HTMLElement, _context: PageContext, api: ModuleApi): void => {
    const panel = document.createElement('div');
    panel.className = 'd-grid gap-3';
    root.appendChild(panel);

    const heading = document.createElement('div');
    heading.className = 'fw-semibold';
    heading.textContent = 'Préférences générales';
    panel.appendChild(heading);

    const responsibleUse = document.createElement('p');
    responsibleUse.className = 'small text-body-secondary mb-0';
    responsibleUse.textContent =
      'Respectez les droits d’auteur et les conditions d’utilisation des sites.';
    panel.appendChild(responsibleUse);

    const themeRow = document.createElement('label');
    themeRow.className = 'd-grid gap-1';
    themeRow.textContent = 'Thème';
    const themeSelect = document.createElement('select');
    themeSelect.className = 'form-select form-select-sm';
    for (const option of [
      { value: 'auto', label: 'Auto' },
      { value: 'light', label: 'Clair' },
      { value: 'dark', label: 'Sombre' },
    ]) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      themeSelect.appendChild(element);
    }
    themeRow.appendChild(themeSelect);
    panel.appendChild(themeRow);

    // 1. Format par défaut
    const formatRow = document.createElement('div');
    formatRow.className = 'd-grid gap-1';
    const formatLabel = document.createElement('label');
    formatLabel.className = 'small fw-bold';
    formatLabel.textContent = 'Format d’archive par défaut (RG-300, 704)';
    const formatSelect = document.createElement('select');
    formatSelect.className = 'form-select form-select-sm';
    for (const opt of [
      { value: 'cbz', label: 'CBZ (par défaut)' },
      { value: 'zip', label: 'ZIP' },
      { value: 'folder', label: 'Dossier d’images' },
    ]) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      formatSelect.appendChild(option);
    }
    formatRow.append(formatLabel, formatSelect);
    panel.appendChild(formatRow);

    // 2. Concurrence des téléchargements
    const concurrencyRow = document.createElement('div');
    concurrencyRow.className = 'd-grid gap-1';
    const concurrencyLabel = document.createElement('label');
    concurrencyLabel.className = 'small fw-bold';
    concurrencyLabel.textContent = 'Téléchargements simultanés (1–6) (RG-30, 704)';
    const concurrencyInput = document.createElement('input');
    concurrencyInput.type = 'number';
    concurrencyInput.min = '1';
    concurrencyInput.max = '6';
    concurrencyInput.className = 'form-control form-control-sm';
    concurrencyRow.append(concurrencyLabel, concurrencyInput);
    panel.appendChild(concurrencyRow);

    // 3. Délai entre requêtes (ms)
    const delayRow = document.createElement('div');
    delayRow.className = 'd-grid gap-1';
    const delayLabel = document.createElement('label');
    delayLabel.className = 'small fw-bold';
    delayLabel.textContent = 'Délai entre requêtes série (ms) (RG-206, 704)';
    const delayInput = document.createElement('input');
    delayInput.type = 'number';
    delayInput.min = '500';
    delayInput.step = '250';
    delayInput.className = 'form-control form-control-sm';
    delayRow.append(delayLabel, delayInput);
    panel.appendChild(delayRow);

    // 4. Dossier de téléchargement
    const folderRow = document.createElement('div');
    folderRow.className = 'd-grid gap-1';
    const folderLabel = document.createElement('label');
    folderLabel.className = 'small fw-bold';
    folderLabel.textContent = 'Sous-dossier de téléchargement (RG-31, 32, 704)';
    const folderInput = document.createElement('input');
    folderInput.type = 'text';
    folderInput.className = 'form-control form-control-sm';
    const folderError = document.createElement('div');
    folderError.className = 'small text-danger';
    folderError.hidden = true;
    folderRow.append(folderLabel, folderInput, folderError);
    panel.appendChild(folderRow);

    const destinationModeLabel = document.createElement('label');
    destinationModeLabel.className = 'd-grid gap-1';
    destinationModeLabel.textContent = 'Mode de destination';
    const destinationMode = document.createElement('select');
    destinationMode.className = 'form-select form-select-sm';
    for (const option of [
      { value: 'browser', label: 'Dossier du navigateur' },
      { value: 'custom-folder', label: 'Dossier personnalisé' },
      { value: 'ask-each-time', label: 'Demander à chaque fois' },
    ]) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      destinationMode.appendChild(element);
    }
    panel.appendChild(destinationModeLabel);
    destinationModeLabel.appendChild(destinationMode);
    const customFolderStatus = document.createElement('div');
    customFolderStatus.className = 'small text-body-secondary';
    const chooseFolderButton = document.createElement('button');
    chooseFolderButton.type = 'button';
    chooseFolderButton.className = 'btn btn-outline-secondary btn-sm';
    chooseFolderButton.textContent = 'Choisir un dossier…';
    panel.append(customFolderStatus, chooseFolderButton);

    const customFolderAvailable = isCustomFolderAvailable();
    const customFolderOption = destinationMode.querySelector<HTMLOptionElement>('[value="custom-folder"]');
    if (!customFolderAvailable && customFolderOption) {
      customFolderOption.disabled = true;
      customFolderOption.title = 'Non disponible dans ce navigateur';
      destinationMode.value = 'browser';
      customFolderStatus.textContent = 'Dossier personnalisé : non disponible dans ce navigateur.';
      chooseFolderButton.disabled = true;
    }
    chooseFolderButton.addEventListener('click', () => {
      chooseFolderButton.disabled = true;
      void chooseAndStoreCustomFolder()
        .then((handle) => {
          customFolderInput.value = handle.name;
          customFolderStatus.textContent = `Dossier sélectionné : ${handle.name}`;
          destinationMode.value = 'custom-folder';
        })
        .catch((error: unknown) => {
          customFolderStatus.textContent = isDirectoryPickerCancellation(error)
            ? 'Sélection annulée.'
            : error instanceof Error ? error.message : 'Sélection impossible.';
        })
        .finally(() => {
          chooseFolderButton.disabled = !customFolderAvailable;
        });
    });

    const templateRow = document.createElement('label');
    templateRow.className = 'd-grid gap-1';
    templateRow.textContent = 'Gabarit de sous-dossier';
    const templateInput = document.createElement('input');
    templateInput.type = 'text';
    templateInput.className = 'form-control form-control-sm';
    templateInput.placeholder = 'Grandload/{serie}/{chapitre}';
    templateRow.appendChild(templateInput);
    panel.appendChild(templateRow);

    const customFolderRow = document.createElement('label');
    customFolderRow.className = 'd-grid gap-1';
    customFolderRow.textContent = 'Nom du dossier personnalisé';
    const customFolderInput = document.createElement('input');
    customFolderInput.type = 'text';
    customFolderInput.className = 'form-control form-control-sm';
    customFolderRow.appendChild(customFolderInput);
    panel.appendChild(customFolderRow);

    // 5. Stratégie d'acquisition (RG-205, Point 3)
    const strategyRow = document.createElement('div');
    strategyRow.className = 'd-grid gap-1';
    const strategyLabel = document.createElement('label');
    strategyLabel.className = 'small fw-bold';
    strategyLabel.textContent = 'Stratégie d’acquisition (RG-205)';
    const strategySelect = document.createElement('select');
    strategySelect.className = 'form-select form-select-sm';
    for (const opt of [
      { value: 'auto', label: 'Auto (défaut selon le site)' },
      { value: 'live-dom', label: 'Toujours onglet inactif (live-dom)' },
      { value: 'html-parse', label: 'Toujours sans onglet (html-parse)' },
    ]) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      strategySelect.appendChild(option);
    }
    strategyRow.append(strategyLabel, strategySelect);
    panel.appendChild(strategyRow);

    // 6. Pré-exclusions automatiques
    const autoExcludeRow = document.createElement('div');
    autoExcludeRow.className = 'form-check form-switch';
    const autoExcludeInput = document.createElement('input');
    autoExcludeInput.type = 'checkbox';
    autoExcludeInput.className = 'form-check-input';
    autoExcludeInput.id = 'pref-auto-exclude';
    autoExcludeInput.setAttribute('role', 'switch');
    const autoExcludeLabel = document.createElement('label');
    autoExcludeLabel.className = 'form-check-label small';
    autoExcludeLabel.htmlFor = 'pref-auto-exclude';
    autoExcludeLabel.textContent = 'Activer les pré-exclusions automatiques (RG-106)';
    autoExcludeRow.append(autoExcludeInput, autoExcludeLabel);
    panel.appendChild(autoExcludeRow);

    // 7. Activation / désactivation des modules (RG-503, 704)
    const modulesSection = document.createElement('div');
    modulesSection.className = 'd-grid gap-2 border-top pt-2';
    const modulesHeading = document.createElement('div');
    modulesHeading.className = 'small fw-bold';
    modulesHeading.textContent = 'Activation des modules (RG-503)';
    modulesSection.appendChild(modulesHeading);

    const modulesList = document.createElement('div');
    modulesList.className = 'd-grid gap-1';
    modulesSection.appendChild(modulesList);
    panel.appendChild(modulesSection);

    // Bouton de sauvegarde
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn-primary btn-sm w-100';
    saveButton.textContent = 'Enregistrer les préférences';
    panel.appendChild(saveButton);

    const moduleToggles: Record<string, HTMLInputElement> = {};

    void getPrefs().then((prefs) => {
      themeSelect.value = prefs.theme || 'dark';
      formatSelect.value = prefs.format || 'cbz';
      concurrencyInput.value = String(prefs.concurrency || 1);
      delayInput.value = String(prefs.requestDelayMs || 1500);
      folderInput.value = prefs.downloadFolder || 'Grandload';
      destinationMode.value = prefs.destination.mode;
      templateInput.value = prefs.destination.subfolderTemplate;
      customFolderInput.value = prefs.destination.customFolderName;
      void getCustomFolderHandle().then((handle) => {
        if (handle) customFolderStatus.textContent = `Dossier sélectionné : ${handle.name}`;
        if (prefs.destination.mode === 'custom-folder' && !handle) {
          customFolderStatus.textContent = 'Le dossier mémorisé est indisponible. Choisissez-en un autre avant de continuer.';
          destinationMode.value = 'browser';
        }
      });
      strategySelect.value = prefs.acquisitionStrategy || 'auto';
      autoExcludeInput.checked = prefs.autoExclude ?? true;

      const allModules = listModules();
      modulesList.replaceChildren();
      for (const m of allModules) {
        const row = document.createElement('div');
        row.className = 'form-check form-switch';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'form-check-input';
        checkbox.id = `mod-${m.id}`;

        if (m.id === 'preferences') {
          // Le module Préférences ne peut pas être désactivé (case grisée et message) (Point 4)
          checkbox.checked = true;
          checkbox.disabled = true;
        } else {
          // Par défaut activé sauf si explicite false
          checkbox.checked = prefs.modulesEnabled[m.id] !== false;
          moduleToggles[m.id] = checkbox;
        }

        const label = document.createElement('label');
        label.className = 'form-check-label small';
        label.htmlFor = `mod-${m.id}`;
        label.textContent = m.id === 'preferences' ? `${m.title} (indispensable, non désactivable)` : m.title;

        row.append(checkbox, label);
        modulesList.appendChild(row);
      }
    });

    saveButton.addEventListener('click', () => {
      void (async () => {
        folderError.hidden = true;
        folderError.textContent = '';

        const rawFolder = folderInput.value;
        const { validateDownloadFolder } = await import('../../shared/url-utils');
        const validation = validateDownloadFolder(rawFolder);
        if (!validation.valid) {
          folderError.textContent = validation.error ?? 'Dossier invalide.';
          folderError.hidden = false;
          folderInput.focus();
          return;
        }

        const concurrency = Math.min(6, Math.max(1, Number(concurrencyInput.value) || 1));
        const requestDelayMs = Math.max(0, Number(delayInput.value) || 1500);
        const { sanitizeDownloadFolder } = await import('../../shared/url-utils');
        const downloadFolder = sanitizeDownloadFolder(rawFolder);
        const format = (formatSelect.value as 'cbz' | 'zip' | 'folder') || 'cbz';
        const acquisitionStrategy = (strategySelect.value as 'auto' | 'live-dom' | 'html-parse') || 'auto';
        const autoExclude = autoExcludeInput.checked;
        const destinationTemplate = templateInput.value.trim();
        const { validateDestinationTemplate } = await import('../../destinations/template');
        const templateValidation = validateDestinationTemplate(destinationTemplate);
        if (!templateValidation.valid) {
          folderError.textContent = templateValidation.error ?? 'Gabarit de destination invalide.';
          folderError.hidden = false;
          templateInput.focus();
          return;
        }
        const destination = {
          mode: destinationMode.value as 'browser' | 'custom-folder' | 'ask-each-time',
          subfolderTemplate: destinationTemplate,
          customFolderName: customFolderInput.value.trim(),
        };

        const modulesEnabled: Record<string, boolean> = {};
        for (const [id, input] of Object.entries(moduleToggles)) {
          modulesEnabled[id] = input.checked;
        }

        await setPrefs({
          theme: themeSelect.value as 'auto' | 'light' | 'dark',
          format,
          concurrency,
          requestDelayMs,
          downloadFolder,
          acquisitionStrategy,
          autoExclude,
          modulesEnabled,
          destination,
        });

        saveButton.textContent = 'Préférences enregistrées !';
        saveButton.classList.remove('btn-primary');
        saveButton.classList.add('btn-success');
        setTimeout(() => {
          saveButton.textContent = 'Enregistrer les préférences';
          saveButton.classList.remove('btn-success');
          saveButton.classList.add('btn-primary');
        }, 1500);

        api.setStatus?.('Préférences enregistrées.');
      })();
    });
  },
};

registerModule(preferencesModule);

export default preferencesModule;

