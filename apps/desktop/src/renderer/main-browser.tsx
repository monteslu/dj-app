/**
 * Browser entry point — runs the full renderer in a plain browser (no Electron),
 * for Playwright e2e + as the base for a future web-DJ build. Installs the
 * in-memory DjApi on window.dj BEFORE the App's modules run, then mounts the App
 * exactly as the Electron entry does. The ?demo seeding still applies.
 */

import { createRoot } from 'react-dom/client';
import { makeBrowserDj, loadDemoLibrary } from './browser-dj.js';

// Self-heal: a stale service worker from a PREVIOUS app on this localhost port can
// hijack our pages (serving cached, wrong assets). We never register one, so kill
// any that exist + clear its caches. (We don't await it — best-effort.)
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister()));
  if ('caches' in window) void caches.keys().then((ks) => ks.forEach((k) => void caches.delete(k)));
}

// Mark this as the WEB build: the browser autoplay policy requires a user gesture
// before AudioContext can run, so the engine starts on first interaction (not auto).
// In Electron we disable that policy and auto-start. (absent = Electron)
(window as unknown as { __DJ_WEB__?: boolean }).__DJ_WEB__ = true;

// Load the bundled pre-processed demo songs (if deployed), then install the browser DjApi
// backed by them. Falls back to synth tracks when the manifest isn't present (e.g. e2e).
const demo = await loadDemoLibrary();
window.dj = makeBrowserDj(demo);

// Dynamic import so window.dj is set before App's module graph evaluates.
const { App } = await import('./App.js');
await import('./styles.css');

const root = document.getElementById('root');
if (!root) throw new Error('no #root element');

if (!('gpu' in navigator)) {
  console.warn('[MochaMix web] WebGPU unavailable in this browser');
}

// NOTE: no StrictMode here — its double-mount disposes+recreates the WebGL lane
// controllers, and the GL context's deleted program/texture state doesn't survive
// that cleanly (the canvas keeps one context). Electron's entry has the same risk.
createRoot(root).render(<App />);
