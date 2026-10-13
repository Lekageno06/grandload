export type ScanViewState = 'idle' | 'loading' | 'results' | 'empty' | 'error' | 'permission';

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
