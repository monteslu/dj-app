/**
 * Launch Electron with the right display backend. On a Linux Wayland session,
 * Electron's default X11 ozone path crashes early ("Missing X server or $DISPLAY")
 * — BEFORE app.commandLine switches are read — so the fix must be an env var the
 * binary reads at startup: ELECTRON_OZONE_PLATFORM_HINT=auto (Electron then picks
 * Wayland or X11 correctly). Cross-platform; passes through all extra args.
 *
 * Usage: node scripts/run-electron.mjs [electron args...]
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron'); // resolves to the binary path string

const env = { ...process.env };
if (process.platform === 'linux' && !env.ELECTRON_OZONE_PLATFORM_HINT) {
  // Native Wayland (auto). Without Vulkan enabled (see main.ts — WebGPU is opt-in
  // via DJ_WEBGPU), the Wayland present path is FAST and the waveform WebGL flies.
  // The Vulkan/Wayland incompatibility that pinned ~30fps only bites when Vulkan
  // is on, which we no longer do by default.
  env.ELECTRON_OZONE_PLATFORM_HINT = 'auto';
}

const args = ['.', ...process.argv.slice(2)];
const res = spawnSync(electron, args, { stdio: 'inherit', env });
process.exit(res.status ?? 1);
