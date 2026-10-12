import { strToU8 } from 'fflate';

import type { ArchiveEntry, ArchiveMeta, Packager } from './types';
import { createComicInfo } from './comicinfo';
import { createZip } from './zip';

export const cbzPackager: Packager = {
  id: 'cbz',
  extension: '.cbz',
  pack: async (entries: ArchiveEntry[], meta: ArchiveMeta): Promise<Blob> =>
    createZip(
      [...entries, { name: 'ComicInfo.xml', data: strToU8(createComicInfo(meta)) }],
      'application/octet-stream',
    ),
};
