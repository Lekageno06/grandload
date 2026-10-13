import { describe, expect, it } from 'vitest';

import { formatJobLabel } from '../src/sidepanel/job-labels';

describe('libellés des tâches', () => {
  it('affiche série et chapitre sur une ligne stable', () => {
    expect(formatJobLabel({ seriesTitle: 'The Boxer', chapter: { label: 'Chapitre 119' } })).toBe('The Boxer · Chapitre 119');
  });

  it('refuse les textes de page comme libellé de tâche', () => {
    expect(formatJobLabel({ title: 'Random', text: 'Se connecter' })).toBe('Téléchargement Grandload');
  });
});
