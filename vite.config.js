import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Set root to project root so both public/ and src/ are accessible
  root: __dirname,
  publicDir: 'public',
  // Use relative paths so assets work from any directory in the extension
  base: './',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidebar: path.resolve(__dirname, 'public/sidebar.html'),
        settings: path.resolve(__dirname, 'public/settings.html'),
        'background/service-worker': path.resolve(__dirname, 'src/background/service-worker.js'),
      },
      output: {
        entryFileNames: (chunk) => {
          // Stable filenames for manifest references
          if (chunk.name === 'background/service-worker') return 'background/service-worker.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      }
    },
    // Don't minify for easier debugging during dev
    minify: false
  },

  resolve: {
    alias: {
      crypto: path.resolve(__dirname, 'src/polyfills/crypto.js'),
      child_process: path.resolve(__dirname, 'src/polyfills/child_process.js'),
    }
  },

  // The content script is built separately (see scripts/build-content.js)
  // because it needs IIFE format, not ESM
});
