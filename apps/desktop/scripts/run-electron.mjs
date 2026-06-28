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
  // X11 ozone — REQUIRED for WebGPU. main.ts enables Vulkan (the WebGPU/Dawn backend),
  // and Vulkan is incompatible with the Wayland ozone path (vkAcquireNextImageKHR hangs
  // / GPU-process crash), so Electron must run under X11. This matches loukai's config,
  // which runs WebGPU fine on this same box. The commandLine ozone switch in main.ts is
  // read too late on a Wayland session, so set it here as an env var (read at startup).
  env.ELECTRON_OZONE_PLATFORM_HINT = 'x11';
}

const args = ['.', ...process.argv.slice(2)];
const res = spawnSync(electron, args, { stdio: 'inherit', env });
process.exit(res.status ?? 1);
