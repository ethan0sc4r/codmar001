import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@modules': resolve(__dirname, 'src/modules'),
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
  },
});
