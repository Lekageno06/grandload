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
        /querySelectorAll(?:<[^>]+>)?\(\s*['"](?:img(?:[.: '" ]|\x5b|$)|[^'"]*[, ]img(?:[.: '" ]|\x5b|$))/iu.test(
          readFileSync(path, 'utf8'),
        ),
      );

    expect(violations).toEqual([]);
  });

  it('interdit les imports directs d’un module vers le dossier d’un autre module', () => {
    const modulesRoot = fileURLToPath(new URL('../src/modules', import.meta.url));
    const violations: string[] = [];
    for (const path of sourceFiles(modulesRoot)) {
      const normalized = path.replaceAll('\\', '/');
      const owner = normalized.split('/modules/')[1]?.split('/')[0];
      if (!owner) continue;
      for (const match of readFileSync(path, 'utf8').matchAll(
        /from\s+['"][^'"]*modules\/([^/'"]+)/gu,
      )) {
        if (match[1] && match[1] !== owner) violations.push(`${normalized} -> ${match[1]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
