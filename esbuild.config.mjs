import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const outDir = 'dist';
const publicDir = 'public';
const watchMode = process.argv.includes('--watch');
const buildTimestamp = new Date().toISOString();
const buildDefines = { __BUILD_DATE__: JSON.stringify(buildTimestamp) };

const entries = {
  'service-worker': 'src/background/service-worker.ts',
  content: 'src/content/content.ts',
  offscreen: 'src/offscreen/offscreen.ts',
  popup: 'src/popup/main.ts',
};

async function bundle() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'icons'), { recursive: true });

  for (const [name, entry] of Object.entries(entries)) {
    await build({
      entryPoints: [entry],
      bundle: true,
      outfile: path.join(outDir, `${name}.js`),
      format: 'iife',
      target: ['chrome120'],
      platform: 'browser',
      sourcemap: false,
      minify: false,
      logLevel: 'info',
      legalComments: 'none',
      define: buildDefines,
    });
  }

  fs.cpSync(publicDir, outDir, { recursive: true });

  const bootstrapSource = path.join(
    'node_modules',
    'bootstrap',
    'dist',
    'css',
    'bootstrap.min.css',
  );
  const bootstrapTarget = path.join(outDir, 'vendor', 'bootstrap.min.css');
  fs.mkdirSync(path.dirname(bootstrapTarget), { recursive: true });
  fs.copyFileSync(bootstrapSource, bootstrapTarget);

  const iconSizes = [16, 32, 48, 128];
  for (const size of iconSizes) {
    const source = path.join(publicDir, 'icons', `${size}.png`);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(outDir, 'icons', `${size}.png`));
    }
  }

  console.log('Build finished.');
}

if (watchMode) {
  console.log('Watching for changes...');
  await build({
    entryPoints: Object.values(entries),
    bundle: true,
    outdir: outDir,
    format: 'iife',
    target: ['chrome120'],
    platform: 'browser',
    sourcemap: false,
    logLevel: 'info',
    define: buildDefines,
    watch: true,
  });
} else {
  await bundle();
}
