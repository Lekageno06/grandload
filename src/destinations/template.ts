import { sanitizeFileName } from '../shared/url-utils';

export type DestinationTemplateValues = {
  serie?: string;
  chapitre?: string;
  domaine?: string;
  titre?: string;
  date?: string;
};

const TOKEN_PATTERN = /\{(serie|chapitre|domaine|titre|date)\}/gu;

export function validateDestinationTemplate(template: string): { valid: boolean; error?: string } {
  const value = template.trim();
  if (!value) return { valid: true };
  if (/^(?:[a-z]:|[/\\])/iu.test(value) || value.includes('..')) {
    return { valid: false, error: 'Le gabarit ne peut pas contenir de chemin absolu ni « .. ».' };
  }
  if (/[*?:"<>|]/u.test(value)) {
    return { valid: false, error: 'Le gabarit contient un caractère interdit (RG-32).' };
  }
  for (const segment of value.split('/')) {
    if (segment && sanitizeFileName(segment).length > 150) {
      return { valid: false, error: 'Chaque segment du gabarit est limité à 150 caractères.' };
    }
  }
  return { valid: true };
}

export function expandDestinationTemplate(
  template: string,
  values: DestinationTemplateValues,
): string {
  const validation = validateDestinationTemplate(template);
  if (!validation.valid) throw new Error(validation.error ?? 'Gabarit de destination invalide.');
  return template
    .trim()
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const expanded = segment.replace(TOKEN_PATTERN, (_, token: keyof DestinationTemplateValues) => values[token] ?? '');
      return sanitizeFileName(expanded, '');
    })
    .filter(Boolean)
    .join('/');
}

export function destinationTemplateValues(input: {
  series?: string;
  chapter?: string;
  sourceUrl?: string;
  title?: string;
  date?: Date;
}): DestinationTemplateValues {
  let domain = '';
  if (input.sourceUrl) {
    try { domain = new URL(input.sourceUrl).hostname; } catch { domain = ''; }
  }
  const date = input.date ?? new Date();
  return {
    ...(input.series ? { serie: input.series } : {}),
    ...(input.chapter ? { chapitre: input.chapter } : {}),
    ...(domain ? { domaine: domain } : {}),
    ...(input.title ? { titre: input.title } : {}),
    date: date.toISOString().slice(0, 10),
  };
}
