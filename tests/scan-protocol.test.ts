import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('protocole de scan du content script', () => {
  const source = readFileSync(new URL('../src/content/content.ts', import.meta.url), 'utf8');

  it('installe un seul écouteur malgré les injections répétées', () => {
    expect(source).toContain('if (!contentGlobal.__grandloadContentReader)');
    expect(source.match(/chrome\.runtime\.onMessage\.addListener/g)).toHaveLength(1);
  });

  it('utilise le protocole démarrage, progression, résultat et annulation', () => {
    expect(source).toContain("message.type === 'SCAN_START'");
    expect(source).toContain("message.type === 'SCAN_CANCEL'");
    expect(source).toContain("emitScanEvent('SCAN_PROGRESS'");
    expect(source).toContain("emitScanEvent('SCAN_RESULT'");
    expect(source).toContain('activeAssetScan?.abort()');
  });
});
