import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist-preview');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, 'design/preview.html'), resolve(output, 'index.html'));
const cssFiles = [
  'src/ui/tokens.css', 'src/ui/base.css',
  'src/ui/components/badges.css', 'src/ui/components/tabs.css', 'src/ui/components/buttons.css',
  'src/ui/components/fields.css', 'src/ui/components/gallery.css', 'src/ui/components/feedback.css',
  'design/ui.css',
];
await writeFile(resolve(output, 'ui.css'), (await Promise.all(cssFiles.map((file) => readFile(resolve(root, file), 'utf8')))).join('\n'), 'utf8');
await build({ entryPoints: [resolve(root, 'design/preview.ts')], bundle: true, format: 'esm', outfile: resolve(output, 'preview.js') });
console.log('Preview written to dist-preview/index.html');
