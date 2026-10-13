import { sanitizeFileName } from '../shared/url-utils';

export interface DirectoryHandleLike {
  name: string;
  queryPermission?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<DirectoryHandleLike>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileHandleLike>;
  removeEntry?: (name: string, options?: { recursive?: boolean }) => Promise<void>;
}

export interface FileHandleLike {
  createWritable: () => Promise<WritableFileLike>;
}

export interface WritableFileLike {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
}

const DATABASE = 'grandload-destinations';
const STORE = 'handles';
const HANDLE_KEY = 'custom-folder';

type PickerGlobal = typeof globalThis & {
  showDirectoryPicker?: (options?: { mode?: 'readwrite' }) => Promise<DirectoryHandleLike>;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Le stockage local des dossiers est indisponible.'));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Impossible d’ouvrir le stockage local.'));
  });
}

async function withStore<T>(mode: 'readonly' | 'readwrite', operation: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const database = await openDatabase();
  return await new Promise<T>((resolve, reject) => {
    const request = operation(database.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error('Échec du stockage du dossier.'));
  }).finally(() => database.close());
}

export function isCustomFolderAvailable(): boolean {
  return typeof (globalThis as PickerGlobal).showDirectoryPicker === 'function';
}

export function isDirectoryPickerCancellation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; message?: unknown };
  return (
    candidate.name === 'AbortError' ||
    (typeof candidate.message === 'string' && /user aborted (a request|the request)/iu.test(candidate.message))
  );
}

export async function chooseAndStoreCustomFolder(): Promise<DirectoryHandleLike> {
  const picker = (globalThis as PickerGlobal).showDirectoryPicker;
  if (!picker) throw new Error('Non disponible dans ce navigateur.');
  const handle = await picker({ mode: 'readwrite' });
  await withStore('readwrite', (store) => store.put(handle, HANDLE_KEY));
  return handle;
}

export async function getCustomFolderHandle(): Promise<DirectoryHandleLike | undefined> {
  return await withStore<DirectoryHandleLike | undefined>('readonly', (store) => store.get(HANDLE_KEY));
}

export async function clearCustomFolderHandle(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(HANDLE_KEY));
}

export async function queryCustomFolderPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  const handle = await getCustomFolderHandle();
  if (!handle) return 'prompt';
  if (!handle.queryPermission) return 'granted';
  return await handle.queryPermission({ mode: 'readwrite' });
}

export async function requestCustomFolderPermission(): Promise<boolean> {
  const handle = await getCustomFolderHandle();
  if (!handle) return false;
  const result = handle.requestPermission
    ? await handle.requestPermission({ mode: 'readwrite' })
    : 'granted';
  return result === 'granted';
}

async function getOrCreateDirectory(root: DirectoryHandleLike, segments: string[]): Promise<DirectoryHandleLike> {
  let current = root;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(sanitizeFileName(segment, 'Grandload'), { create: true });
  }
  return current;
}

async function nextAvailableName(directory: DirectoryHandleLike, filename: string): Promise<string> {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  let candidate = filename;
  let suffix = 1;
  while (true) {
    try {
      await directory.getFileHandle(candidate, { create: false });
      candidate = `${stem} (${suffix++})${extension}`;
    } catch {
      return candidate;
    }
  }
}

export async function writeBlobToDirectory(
  root: DirectoryHandleLike,
  blobUrl: string,
  filename: string,
): Promise<string> {
  const parts = filename.split('/').filter(Boolean).map((part) => sanitizeFileName(part, 'download'));
  const basename = parts.pop();
  if (!basename) throw new Error('Nom de fichier invalide.');
  const directory = await getOrCreateDirectory(root, parts);
  const actualName = await nextAvailableName(directory, basename);
  const file = await directory.getFileHandle(actualName, { create: true });
  const writable = await file.createWritable();
  try {
    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Téléchargement de l’archive impossible (HTTP ${response.status}).`);
    await writable.write(await response.blob());
    await writable.close();
    return actualName;
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    await directory.removeEntry?.(actualName).catch(() => undefined);
    throw error;
  }
}

export async function writeBlobToCustomFolder(blobUrl: string, filename: string): Promise<string> {
  const root = await getCustomFolderHandle();
  if (!root) throw new Error('Aucun dossier personnalisé n’est sélectionné.');
  const permission = await queryCustomFolderPermission();
  if (permission !== 'granted') throw new Error('Autorisation du dossier personnalisé requise.');
  return await writeBlobToDirectory(root, blobUrl, filename);
}

export async function writeCustomFiles(files: Array<{ blobUrl: string; filename: string }>): Promise<void> {
  for (const file of files) await writeBlobToCustomFolder(file.blobUrl, file.filename);
}
