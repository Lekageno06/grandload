import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('architecture de collecte DOM', () => {
  it('interdit la collecte directe d’images hors dom-reader et adaptateurs', () => {
    const srcRoot = fileURLToPath(new URL('../src', import.meta.url));
    const violations = sourceFiles(srcRoot)
      .filter((path) => {
        const normalized = path.replaceAll('\\', '/');
        return !normalized.includes('/adapters/') && !normalized.endsWith('/dom-reader.ts');
      })
      .filter((path) =>
        /querySelectorAll(?:<[^>]+>)?\(\s*['"][^'"]*img/iu.test(readFileSync(path, 'utf8')),
      );

    expect(violations).toEqual([]);
  });
});
