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
  // X11 ozone (XWayland) by default. Chromium itself reports the reason:
  //   "'--ozone-platform=wayland' is not compatible with Vulkan. Consider
  //    switching to '--ozone-platform=x11' or disabling Vulkan"
  // We REQUIRE Vulkan (WebGPU / stem separation), so on native Wayland Chromium
  // falls back to a slow present path → pinned ~30fps. Running under XWayland
  // makes Vulkan + the compositor cooperate → full frame rate, GPU accel, and
  // WebGPU all intact. (Same fix loukai uses.) DJ_WAYLAND=1 forces native Wayland.
  if (process.env.DJ_WAYLAND === '1') {
    env.ELECTRON_OZONE_PLATFORM_HINT = 'auto';
  } else {
    env.ELECTRON_OZONE_PLATFORM_HINT = 'x11';
    if (!env.DISPLAY) env.DISPLAY = ':0'; // XWayland runs here
  }
}

const args = ['.', ...process.argv.slice(2)];
const res = spawnSync(electron, args, { stdio: 'inherit', env });
process.exit(res.status ?? 1);
