import type { ArchiveEntry, ArchiveMeta, Packager } from '../core/types';

export type { ArchiveEntry, ArchiveMeta, Packager };

export type ArchiveOutput = Blob | ArchiveEntry[];

export function formatArchiveEntryName(index: number, total: number, extension: string): string {
  const digits = Math.max(3, String(total).length);
  const safeExtension =
    extension
      .replace(/^\./u, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/gu, '') || 'bin';
  return `${String(index).padStart(digits, '0')}.${safeExtension}`;
}
