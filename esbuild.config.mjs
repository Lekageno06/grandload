import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const outDir = 'dist';
const publicDir = 'public';
const watchMode = process.argv.includes('--watch');
const buildTimestamp = new Date().toISOString();
const buildDefines = { __BUILD_DATE__: JSON.stringify(buildTimestamp) };
const releaseVersion = process.env.GRANDLOAD_VERSION ?? '0.2.0';

const commonEntries = {
  'service-worker': 'src/background/service-worker.ts',
  content: 'src/content/content.ts',
  sidepanel: 'src/sidepanel/main.ts',
};

function makeManifest(browser) {
  const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.json'), 'utf8'));
  manifest.version = releaseVersion;
  if (browser === 'firefox') {
    manifest.permissions = manifest.permissions.filter(
      (permission) => permission !== 'offscreen' && permission !== 'sidePanel',
    );
    delete manifest.side_panel;
    manifest.sidebar_action = {
      default_panel: 'sidepanel.html',
      default_title: 'Grandload',
    };
    manifest.background = { scripts: ['service-worker.js'], type: 'module' };
    manifest.browser_specific_settings = {
      gecko: {
        id: '@grandload-extension',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    };
  } else {
    manifest.background = { service_worker: 'service-worker.js' };
  }
  return manifest;
}

async function buildEntry(entry, outfile, target) {
  await build({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: 'iife',
    target: [target],
    platform: 'browser',
    sourcemap: false,
    minify: false,
    logLevel: 'info',
    legalComments: 'none',
    define: buildDefines,
  });
}

async function buildVariant(browser, variantDir) {
  const isFirefox = browser === 'firefox';
  const target = isFirefox ? 'firefox128' : 'chrome120';
  const entries = isFirefox
    ? commonEntries
    : { ...commonEntries, offscreen: 'src/offscreen/offscreen.ts' };
  fs.mkdirSync(path.join(variantDir, 'icons'), { recursive: true });
  for (const [name, entry] of Object.entries(entries)) {
    await buildEntry(entry, path.join(variantDir, `${name}.js`), target);
  }
  fs.cpSync(publicDir, variantDir, { recursive: true });
  fs.writeFileSync(
    path.join(variantDir, 'manifest.json'),
    `${JSON.stringify(makeManifest(browser), null, 2)}\n`,
  );
  if (isFirefox) fs.rmSync(path.join(variantDir, 'offscreen.html'), { force: true });
}

async function bundle() {
  fs.rmSync(outDir, { recursive: true, force: true });
  await buildVariant('chrome', outDir);
  await buildVariant('firefox', path.join(outDir, 'firefox'));
  console.log('Build finished for Chrome and Firefox.');
}

if (watchMode) {
  console.log('Watching the Chrome build...');
  await buildVariant('chrome', outDir);
} else {
  await bundle();
}
