import { describe, expect, it } from 'vitest';

import {
  destinationTemplateValues,
  expandDestinationTemplate,
  validateDestinationTemplate,
} from '../src/destinations/template';
import { getDestination, registerDestination } from '../src/destinations/registry';

describe('destinations', () => {
  it('développe les jetons dans des segments nettoyés', () => {
    expect(
      expandDestinationTemplate(
        'Grandload/{serie}/{chapitre}/{domaine}',
        destinationTemplateValues({
          series: 'The Boxer',
          chapter: 'Chapitre 119',
          sourceUrl: 'https://example.test/chapitre-119/',
          date: new Date('2026-01-02T00:00:00Z'),
        }),
      ),
    ).toBe('Grandload/The Boxer/Chapitre 119/example.test');
  });

  it('refuse les chemins absolus, traversées et caractères interdits', () => {
    expect(validateDestinationTemplate('../outside').valid).toBe(false);
    expect(validateDestinationTemplate('C:\\Downloads').valid).toBe(false);
    expect(validateDestinationTemplate('Manga|Test').valid).toBe(false);
    expect(expandDestinationTemplate('', {})).toBe('');
  });

  it('enregistre et retrouve un writer par identifiant', () => {
    const writer = { id: 'test', writeArchive: async () => undefined };
    expect(registerDestination(writer)).toBe(writer);
    expect(getDestination('test')).toBe(writer);
  });
});
