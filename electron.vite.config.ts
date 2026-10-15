import { defineConfig } from 'electron-vite';
import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Paths are worked out from this file's folder, so building works whichever folder the command
// is started from.
const here = import.meta.dirname ?? process.cwd();
const path = (...parts: string[]) => resolve(here, ...parts);

// pdf.js needs its character maps, standard fonts, image decoders and colour profiles at run
// time. They are copied next to the app so pdf.js loads them from the app itself, never from
// the internet.
function copyPdfjsAssets() {
  return {
    name: 'scribeforge-copy-pdfjs-assets',
    buildStart() {
      const from = path('node_modules/pdfjs-dist');
      const to = path('src/renderer/public/pdfjs');
      mkdirSync(to, { recursive: true });
      for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
        cpSync(resolve(from, dir), resolve(to, dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  main: {
    build: {
      outDir: path('out/main'),
      rollupOptions: { input: { index: path('src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      outDir: path('out/preload'),
      // Sandboxed preload scripts must be a single CommonJS file.
      rollupOptions: {
        input: { index: path('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: path('src/renderer'),
    plugins: [copyPdfjsAssets()],
    build: {
      outDir: path('out/renderer'),
      rollupOptions: { input: { index: path('src/renderer/index.html') } },
    },
  },
});
