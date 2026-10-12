import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const releaseDir = 'release';
const version = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8')).version;

function collectFiles(root, current = root) {
  const files = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(root, absolute));
    } else {
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (!relative.endsWith('.map')) files.push([relative, fs.readFileSync(absolute)]);
    }
  }
  return files;
}

function createPackage(sourceDir, browser, ignored = []) {
  const entries = collectFiles(sourceDir).filter(([name]) => !ignored.some((prefix) => name.startsWith(prefix)));
  const names = new Set(entries.map(([name]) => name));
  if (!names.has('manifest.json')) throw new Error(`${browser}: manifest.json manquant.`);
  for (const size of [16, 32, 48, 128]) {
    if (!names.has(`icons/${size}.png`)) throw new Error(`${browser}: icône ${size} absente.`);
  }
  if (entries.some(([name]) => /(?:^|\/)(?:tests?|docs?)(?:\/|$)|\.map$/iu.test(name))) {
    throw new Error(`${browser}: contenu de développement détecté dans le paquet.`);
  }
  const archive = zipSync(Object.fromEntries(entries), { level: 0 });
  const output = path.join(releaseDir, `grandload-${browser}-v${version}.zip`);
  fs.writeFileSync(output, archive);
  console.log(`${browser}: ${output} (${entries.length} fichiers)`);
  return { output, entries: entries.map(([name]) => name).sort() };
}

fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });
const chrome = createPackage('dist', 'Chrome', ['firefox/']);
const firefox = createPackage(path.join('dist', 'firefox'), 'Firefox');
fs.writeFileSync(
  path.join(releaseDir, 'CONTENTS.txt'),
  [
    `Chrome: ${chrome.output}`,
    ...chrome.entries.map((name) => `  ${name}`),
    `Firefox: ${firefox.output}`,
    ...firefox.entries.map((name) => `  ${name}`),
    '',
  ].join('\n'),
);
