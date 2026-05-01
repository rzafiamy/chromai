// Builds the content script as a self-contained IIFE (no ESM imports).
// Chrome injects content scripts as classic scripts, not modules.
// Also moves HTML files from dist/public/ to dist/ root.
import { build } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync, existsSync, readdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');

// Build content script as IIFE
await build({
  configFile: false,
  build: {
    outDir: distDir,
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, '../src/content/content-script.js'),
      name: 'ContentScript',
      formats: ['iife'],
      fileName: () => 'content/content-script.js'
    },
    rollupOptions: {
      output: { inlineDynamicImports: true }
    },
    minify: false
  }
});

// Move processed HTML files from dist/public/ to dist/ (Vite outputs them
// mirroring the input path relative to root, so public/*.html → dist/public/*.html)
const publicOutDir = path.join(distDir, 'public');
if (existsSync(publicOutDir)) {
  for (const file of readdirSync(publicOutDir)) {
    if (file.endsWith('.html')) {
      copyFileSync(path.join(publicOutDir, file), path.join(distDir, file));
      console.log(`Moved ${file} → dist/${file}`);
    }
  }
}

console.log('Build complete. Load the dist/ folder as an unpacked Chrome extension.');
