# MochaMix desktop

The MochaMix Electron app. Two decks + a center mixer, bound to the control bus.

## Run it

From the **repo root** (`mochamix/`):

```bash
npm install            # installs all workspaces; a postinstall repairs Electron (see below)
npm run dev            # rebuilds native modules for Electron, builds, launches (--no-sandbox)
```

> **Electron binary on Node 24:** Electron's own postinstall uses an old extractor
> that silently stalls on Node 24, leaving a half-extracted `node_modules/electron/dist`
> (no `path.txt`) → "Electron failed to install correctly". A `postinstall` script
> (`apps/desktop/scripts/ensure-electron.js`) re-extracts the downloaded zip with the
> system `unzip` and writes `path.txt`. It's a silent no-op when Electron is healthy.
> If you ever see the error anyway, run `node apps/desktop/scripts/ensure-electron.js`.

> **Linux SUID sandbox:** `dev`/`start` pass `--no-sandbox` so you don't need root.
> To run sandboxed instead: `sudo chown root node_modules/electron/dist/chrome-sandbox &&
> sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`, then drop `--no-sandbox`.

> **Native module ABI note (better-sqlite3):** the library DB uses better-sqlite3,
> a native addon. Tests run in **Node** (one ABI); Electron needs a **different**
> ABI. The `dev`/`start` scripts run `electron-rebuild` first so the app gets the
> Electron build. After running the app, native modules are built for Electron —
> if you then run `npm test` and the db tests fail with a `NODE_MODULE_VERSION`
> mismatch, rebuild for Node: `cd node_modules/better-sqlite3 && npm run build-release`.
> (A cleaner long-term fix is a prebuilt-per-ABI setup or running db tests under Electron.)

Or from this directory:

```bash
npm run build          # renderer + worklet + main
npm start              # launch Electron (after a build)
npm run dev            # build + launch with devtools
```

## What works (M1)

- Load a track (button or drag-and-drop) → decode → waveform (overview + scrolling) → play/pause/seek.
- Two decks, a crossfader (deck 1 = left, deck 2 = right), per-deck 3-band EQ + volume + tempo (±10%,
  varispeed for now — keylock is M2).
- Everything is bound to the **control bus** (`@internal-dj/control-bus`) via the `useControl` hook.
  The audio engine (`@internal-dj/audio-engine`) runs in an AudioWorklet reading control values from a
  SharedArrayBuffer mirror of the bus.

## Architecture notes

- **Cross-origin isolation:** the renderer is served from a custom `app://` protocol with
  COOP/COEP headers so `SharedArrayBuffer` + WASM threads work. (Injecting the headers on a `file://`
  load does *not* work — see `../../12-build-log.md`.)
- **WebGPU is required, no fallback** (`../../10-electron-feasibility.md` §0a). The renderer logs an
  error if it's unavailable.
- **The worklet is built separately** (`vite.worklet.config.ts`) into `dist-renderer/worklets/` because
  Vite can't bundle a `.ts` AudioWorklet via `new URL(...)`.

## Layout

```
src/
  main/      main process (app:// protocol, window, file IPC) + preload
  shared/    IPC type contracts
  renderer/  React UI + the dj-context (control bus + engine wiring)
    components/  Deck, Mixer, Knob, WaveformView
```

See the design docs in the repo root (`01`–`12`) for the full picture.
