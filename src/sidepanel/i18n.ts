const messages = {
  chapterTitle: 'Télécharger le chapitre',
  noImages: 'Aucune image détectée sur cette page ou chapitre vide.',
  orderedGallery: 'Galerie ordonnée du chapitre',
  autoExclusions: 'Pré-exclusions automatiques',
  remember: 'Mémoriser',
  included: 'incluses',
  excluded: 'exclues',
  download: 'Télécharger',
  cancel: 'Annuler',
  format: 'Format',
  filename: 'Nom de l’archive',
  suggestion: 'Suggestion mémorisée',
  manualExclusion: 'Exclusion manuelle',
  emptyState: 'Aucun résultat.',
} as const;

export type MessageKey = keyof typeof messages;

export function t(key: MessageKey): string {
  return messages[key];
}
