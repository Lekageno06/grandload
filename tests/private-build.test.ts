import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('build public', () => {
  it('ne référence pas les adaptateurs privés dans le point d’enregistrement', () => {
    const source = readFileSync(new URL('../src/adapters/index.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]\.\/private['"]/u);
    expect(source).toContain('__GRANDLOAD_PRIVATE__');
  });

  it('n’inclut pas les adaptateurs privés dans le bundle public généré', () => {
    const dist = fileURLToPath(new URL('../dist', import.meta.url));
    if (!existsSync(dist)) return;
    const bundles = readdirSync(dist, { recursive: true, encoding: 'utf8' })
      .filter((path) => path.endsWith('.js'))
      .map((path) => readFileSync(`${dist}/${path}`, 'utf8'));
    expect(bundles.length).toBeGreaterThan(0);
    const publicCode = bundles.join('\n');
    expect(publicCode).not.toMatch(/hentai-origines|hentai-scantrad/iu);
  });

  it('le bundle privé contient le service worker, content.js et le side panel avec les deux adaptateurs', () => {
    const dist = fileURLToPath(new URL('../dist-private', import.meta.url));
    if (!existsSync(dist)) return;
    for (const entry of ['service-worker.js', 'content.js', 'sidepanel.js']) {
      expect(existsSync(`${dist}/${entry}`)).toBe(true);
      const code = readFileSync(`${dist}/${entry}`, 'utf8');
      expect(code).toMatch(/hentai-origines|hentai-scantrad/iu);
    }
  });
});
