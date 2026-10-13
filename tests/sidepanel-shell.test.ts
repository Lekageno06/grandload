import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sidepanel = readFileSync(
  fileURLToPath(new URL('../public/sidepanel.html', import.meta.url)),
  'utf8',
);

describe('coquille du panneau', () => {
  it('ne duplique pas le nom et expose les préférences via le bouton réglages', () => {
    expect(sidepanel).not.toContain('panel-kicker');
    expect(sidepanel).toContain('id="preferences-button"');
    expect(sidepanel).toContain('aria-label="Préférences"');
    expect(sidepanel).toContain('<details id="tasks-panel"');
  });

  it('n’utilise plus de règles de secours natives scoppées sous ui-app', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../src/sidepanel/shell.css', import.meta.url)),
      'utf8',
    );
    expect(css).not.toMatch(/\.ui-app\s+(button|input|select|label|h2)/u);
  });
});
