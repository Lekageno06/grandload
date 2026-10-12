import type { PackagerMetadata } from '../core/types';

export const PACKAGER_METADATA: readonly PackagerMetadata[] = [
  { id: 'cbz', extension: '.cbz' },
  { id: 'zip', extension: '.zip' },
  { id: 'folder', extension: '' },
];

export function getPackagerMetadata(packagerId: string): PackagerMetadata | undefined {
  return PACKAGER_METADATA.find((packager) => packager.id === packagerId);
}
