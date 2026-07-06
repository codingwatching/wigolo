import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: { build: { outDir: 'out/main' } },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        // Two preloads: `index` (chrome window) and `overlay` (per-tab isolated-world marking).
        // The overlay runs in a SANDBOXED tab and cannot load sibling chunks — keep entries
        // self-contained (overlay.ts shares no runtime module with index.ts; see overlay.ts header).
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay.ts'),
        },
        output: { manualChunks: undefined },
      },
    },
  },
  renderer: { build: { outDir: 'out/renderer' } },
});
