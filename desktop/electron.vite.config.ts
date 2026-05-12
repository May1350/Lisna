import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/main', rollupOptions: { input: 'src/main/index.ts' } },
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload', rollupOptions: { input: 'src/preload/index.ts' } },
  },
  renderer: {
    plugins: [react()],
    build: { outDir: 'out/renderer' },
    resolve: { alias: { '@shared': resolve('src/shared') } },
    root: 'src/renderer',
  },
});
