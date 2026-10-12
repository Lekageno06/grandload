import { zipSync } from 'fflate';

import type { ArchiveEntry, ArchiveMeta, Packager } from './types';

export function createZip(entries: ArchiveEntry[], mimeType = 'application/zip'): Blob {
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    files[entry.name] = entry.data;
  }

  const zipped = zipSync(files, { level: 0 });
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
  return new Blob([buffer as ArrayBuffer], { type: mimeType });
}

export const zipPackager: Packager = {
  id: 'zip',
  extension: '.zip',
  pack: async (entries: ArchiveEntry[], _meta: ArchiveMeta): Promise<Blob> => createZip(entries),
};
