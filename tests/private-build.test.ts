import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('build public', () => {
  it('ne référence pas les adaptateurs privés dans le point d’enregistrement', () => {
    const source = readFileSync(new URL('../src/adapters/index.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]\.\/private['"]/u);
    expect(source).toContain('__GRANDLOAD_PRIVATE__');
  });
});
