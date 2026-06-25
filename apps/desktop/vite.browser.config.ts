/**
 * Browser build/dev config — runs the renderer as a standalone web app (no
 * Electron) for Playwright e2e + the future web-DJ target. Same workspace aliases
 * as the Electron build, plus the COOP/COEP headers SharedArrayBuffer needs.
 */

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

// Serve the pre-built AudioWorklets (dist-renderer/worklets, made by
// vite.worklet.config.ts) at /worklets/* so the full audio engine — and thus the
// real SYNC snap — works in the browser dev/e2e build too.
function serveWorklets(): Plugin {
  return {
    name: 'serve-worklets',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/worklets/')) return next();
        try {
          const file = fileURLToPath(new URL('.' + req.url, new URL('./dist-renderer/', import.meta.url)));
          const body = await readFile(file);
          res.setHeader('Content-Type', 'text/javascript');
          res.end(body);
        } catch {
          next();
        }
      });
    },
  };
}

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

// cross-origin isolation (required for SharedArrayBuffer)
const coopCoep = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(
      new Date().toISOString().slice(11, 19) + ' ' + new Date().toISOString().slice(5, 10),
    ),
  },
  plugins: [react(), serveWorklets()],
  resolve: {
    alias: {
      '@internal-dj/analysis/worker': fileURLToPath(
        new URL('../../packages/analysis/src/analysis.worker.ts', import.meta.url),
      ),
      '@internal-dj/control-bus': pkg('control-bus'),
      '@internal-dj/audio-engine': pkg('audio-engine'),
      '@internal-dj/codec': pkg('codec'),
      '@internal-dj/waveform': pkg('waveform'),
      '@internal-dj/analysis': pkg('analysis'),
      '@internal-dj/dsp-wasm': pkg('dsp-wasm'),
    },
  },
  server: {
    headers: coopCoep,
    port: 5174,
  },
  preview: {
    headers: coopCoep,
    port: 5174,
  },
  build: {
    outDir: fileURLToPath(new URL('./dist-browser', import.meta.url)),
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: { browser: fileURLToPath(new URL('./src/renderer/browser.html', import.meta.url)) },
    },
  },
  worker: { format: 'es' },
});
