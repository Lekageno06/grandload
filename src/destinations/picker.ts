import type { DestinationMode, DestinationSettings } from './types';
import {
  chooseAndStoreCustomFolder,
  getCustomFolderHandle,
  isCustomFolderAvailable,
  isDirectoryPickerCancellation,
} from './custom-folder';

export function createDestinationPicker(initial: DestinationSettings): {
  element: HTMLElement;
  getSettings: () => DestinationSettings;
  setSettings: (settings: DestinationSettings) => void;
} {
  const element = document.createElement('fieldset');
  element.className = 'border rounded p-2 d-grid gap-2';
  const legend = document.createElement('legend');
  legend.className = 'float-none w-auto px-1 small mb-0';
  legend.textContent = 'Destination';
  const mode = document.createElement('select');
  mode.className = 'form-select form-select-sm';
  for (const option of [
    ['browser', 'Dossier du navigateur'],
    ['custom-folder', 'Dossier personnalisé'],
    ['ask-each-time', 'Demander à chaque fois'],
  ] as const) {
    const item = document.createElement('option');
    item.value = option[0];
    item.textContent = option[1];
    mode.append(item);
  }
  mode.value = initial.mode;
  const template = document.createElement('input');
  template.type = 'text';
  template.className = 'form-control form-control-sm';
  template.value = initial.subfolderTemplate;
  template.placeholder = 'Sous-dossier (vide = Téléchargements)';
  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'btn btn-outline-secondary btn-sm';
  choose.textContent = 'Choisir un dossier…';
  const saveAsFallback = document.createElement('button');
  saveAsFallback.type = 'button';
  saveAsFallback.className = 'btn btn-link btn-sm text-start p-0';
  saveAsFallback.textContent = 'Choisir le chemin de l’archive à chaque téléchargement';
  saveAsFallback.hidden = true;
  const status = document.createElement('small');
  status.className = 'text-body-secondary';
  let userInteracted = false;
  const option = mode.querySelector<HTMLOptionElement>('[value="custom-folder"]');
  if (!isCustomFolderAvailable() && option) {
    option.disabled = true;
    option.title = 'Non disponible dans ce navigateur';
    if (mode.value === 'custom-folder') mode.value = 'browser';
    status.textContent = 'Dossier personnalisé : non disponible dans ce navigateur.';
    choose.disabled = true;
  } else {
    void getCustomFolderHandle().then((handle) => {
      if (handle) status.textContent = `Dossier : ${handle.name}`;
    });
  }
  mode.addEventListener('change', () => {
    userInteracted = true;
  });
  choose.addEventListener('click', () => {
    userInteracted = true;
    choose.disabled = true;
    void chooseAndStoreCustomFolder()
      .then((handle) => {
        mode.value = 'custom-folder';
        status.textContent = `Dossier : ${handle.name}`;
      })
      .catch(async (error: unknown) => {
        if (isDirectoryPickerCancellation(error)) {
          const previousHandle = await getCustomFolderHandle();
          status.textContent = previousHandle
            ? `Dossier : ${previousHandle.name} (sélection conservée)`
            : 'Sélection annulée. Aucun dossier personnalisé n’est enregistré.';
          saveAsFallback.hidden = Boolean(previousHandle);
          return;
        }
        status.textContent = error instanceof Error ? error.message : 'Sélection impossible.';
      })
      .finally(() => {
        choose.disabled = !isCustomFolderAvailable();
      });
  });
  saveAsFallback.addEventListener('click', () => {
    userInteracted = true;
    mode.value = 'ask-each-time';
    saveAsFallback.hidden = true;
    status.textContent = 'Le chemin sera demandé pour chaque archive.';
  });
  element.append(legend, mode, template, choose, status, saveAsFallback);
  return {
    element,
    getSettings: () => ({
      mode: mode.value as DestinationMode,
      subfolderTemplate: template.value.trim(),
      customFolderName: status.textContent.startsWith('Dossier : ')
        ? status.textContent.slice('Dossier : '.length)
        : initial.customFolderName,
    }),
    setSettings: (settings) => {
      // L'initialisation asynchrone des préférences ne doit pas annuler
      // un choix déjà effectué dans la feuille par l'utilisateur.
      if (userInteracted) return;
      mode.value = settings.mode === 'custom-folder' && option?.disabled ? 'browser' : settings.mode;
      template.value = settings.subfolderTemplate;
    },
  };
}
