export type ScanViewState = 'idle' | 'loading' | 'results' | 'empty' | 'error' | 'permission';

import type { ScanItem } from './types';

export function estimateArchiveBytes(items: readonly ScanItem[]): number {
  return items.reduce((total, item) => {
    if (item.type !== 'image' || !item.width || !item.height) return total;
    return total + item.width * item.height * 4;
  }, 0);
}

export function archiveWarning(items: readonly ScanItem[]): string | undefined {
  if (items.length > 50) return 'Vous allez télécharger plus de 50 fichiers.';
  if (estimateArchiveBytes(items) > 300 * 1024 * 1024) {
    return 'La taille estimée dépasse 300 Mo.';
  }
  return undefined;
}

export function getScanStateMessage(state: ScanViewState, count = 0): string {
  switch (state) {
    case 'loading':
      return 'Scan en cours…';
    case 'results':
      return `${count} ressource(s) détectée(s).`;
    case 'empty':
      return 'Aucun résultat.';
    case 'permission':
      return 'Autorisation requise pour lire cet onglet.';
    case 'error':
      return 'Erreur pendant le scan.';
    default:
      return 'Aucun scan lancé.';
  }
}
