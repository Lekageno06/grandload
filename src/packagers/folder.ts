import type { ArchiveEntry, ArchiveMeta, Packager } from './types';

export const folderPackager: Packager = {
  id: 'folder',
  extension: '',
  pack: async (entries: ArchiveEntry[], _meta: ArchiveMeta): Promise<ArchiveEntry[]> => entries,
};
