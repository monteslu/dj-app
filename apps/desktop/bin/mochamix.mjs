#!/usr/bin/env node
/**
 * `npx mochamix` / `mochamix` launcher. Resolves the Electron binary that ships as a
 * dependency of this package and runs the bundled app (dist-main/main.js) against it.
 *
 * This is the published entry point. The app is fully bundled at publish time:
 * dist-main/main.js has the @dj/* workspace packages inlined; the renderer is in
 * dist-renderer; only electron + node-sqlite3-wasm + music-metadata load at runtime.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

let electronPath;
try {
  electronPath = require('electron'); // 'electron' module exports the binary path string
} catch {
  console.error(
    'MochaMix: the Electron runtime is missing. Reinstall the package (npm i -g mochamix) ' +
      'or run `npx mochamix@latest`.',
  );
  process.exit(1);
}

const env = { ...process.env };
// On Linux let Electron auto-pick the ozone backend (Wayland/X11) — see run-electron.mjs.
if (process.platform === 'linux' && !env.ELECTRON_OZONE_PLATFORM_HINT) {
  env.ELECTRON_OZONE_PLATFORM_HINT = 'auto';
}

// Launch Electron on the bundled app dir (package root), passing through any extra args.
const args = [pkgRoot, ...process.argv.slice(2)];
const child = spawn(electronPath, args, { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('MochaMix: failed to launch Electron:', err.message);
  process.exit(1);
});
