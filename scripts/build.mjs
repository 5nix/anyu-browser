// Bundles main (ESM), preload (CJS, sandboxed) and the shell's own pages into dist/.
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
await rm('dist', { recursive: true, force: true });
await mkdir('dist/renderer', { recursive: true });
const common = { bundle: true, sourcemap: 'linked', logLevel: 'warning', target: 'chrome156', jsx: 'automatic', jsxImportSource: 'preact' };
await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main/index.ts'],
    outfile: 'dist/main.mjs',
    platform: 'node',
    format: 'esm',
    target: 'node24',
    external: ['electron'],
    // yaml is CommonJS; give the ESM bundle a require() for it.
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  }),
  build({ ...common, entryPoints: ['src/preload.cts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/renderer/shell.tsx', 'src/renderer/settings.tsx', 'src/renderer/home.tsx', 'src/renderer/history.tsx', 'src/renderer/bookmarks.tsx', 'src/renderer/internal-error.tsx', 'src/renderer/overlay.tsx'], outdir: 'dist/renderer', format: 'iife' }),
]);
await cp('src/renderer/ui/ui.css', 'dist/renderer/ui.css');
await cp('resources/icon.png', 'dist/renderer/app-icon.png');
for (const f of ['shell.html', 'settings.html', 'home.html', 'history.html', 'bookmarks.html', 'history.css', 'bookmarks.css', 'home.css', 'internal-error.html', 'internal-error.css', 'overlay.html', 'shadow.html', 'shadow.css', 'style.css', 'shell.css', 'settings.css', 'overlay.css']) await cp(`src/renderer/${f}`, `dist/renderer/${f}`);
if (watch) console.log('built');
