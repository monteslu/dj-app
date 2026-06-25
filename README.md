# dj-app

A Mixxx-class DJ application built in Electron + Web Audio + WASM + WebGPU.
Built for the love of it.

## Status

Working DJ engine: 2 decks, waveforms, play/cue, **36 hotcues + beatloops + manual loops**,
3-band EQ + crossfader + VU meters, **keylock** (independent tempo/pitch), tempo + pitch-bend,
**BPM/beatgrid analysis**, **beat sync + Smart Fader** (crossfader-driven tempo blend),
**effects** (filter/echo/reverb/distortion/bitcrusher) with a per-deck QuickEffect filter,
a **SQLite library** (scan/search/browse/load-to-deck), and a **Mixxx-compatible controller host**
(the `engine`/`midi` API + `.midi.xml` parser, so stock Mixxx mappings run nearly unchanged).

The real-time sample resampler and the BPM detector run in **WASM+SIMD**, not JS — per the
"zero heavy lifting in JS" rule.

## Run it

### Prerequisites
- **Node ≥ 22** (uses npm workspaces; tested on Node 22–24).
- **No native build toolchain.** SQLite is **pure WASM** (`node-sqlite3-wasm`), so there is no
  `node-gyp` compile and no `electron-rebuild` — the same `.wasm` runs on every OS and Electron/Node
  ABI. No C++ compiler, Python, or Visual Studio Build Tools required.
- **No emcc either** — the DSP WASM (resampler, beat detector) is committed pre-built (base64-embedded
  `.ts`). You only need emscripten if you change the C source in `packages/dsp-wasm/csrc/`.

### Clone and run (any computer)

```bash
git clone git@github.com:monteslu/dj-app.git
cd dj-app
npm install            # installs all workspaces (+ self-heals the Electron binary)
npm run dev            # build renderer/worklet/main → launch
```

The renderer packages are bundled from source by Vite/esbuild, so there is **no separate
`build:packages` step** before `dev` — `npm run dev` is the whole flow.

**Linux/Wayland:** launch is handled automatically (`ELECTRON_OZONE_PLATFORM_HINT=auto` in
`scripts/run-electron.mjs`); no flags needed on X11 or Wayland.

> The `dev`/`start` scripts pass `--no-sandbox` (needed in some sandboxed/CI dev environments).
> On a normal desktop this is harmless; remove it from `apps/desktop/package.json` if you prefer
> the Chromium sandbox on.

```bash
npm test               # vitest across all packages (no native rebuild needed)
npm run typecheck      # tsc --build across the monorepo
```

## Layout (npm-workspaces monorepo)

```
apps/desktop/          the Electron app (main + renderer + shared)
packages/
  control-bus/         the spine: a (group,key)->number store + SAB mirror + useControl hook
  audio-engine/        AudioWorklet mixer, decks, scalers (linear + SoundTouch keylock),
                       cue/loop EngineControls, sync engine, Smart Fader, effects
  dsp-wasm/            WASM+SIMD DSP (resampler, beat detector) — emcc from csrc/
  analysis/            beatgrid model + BPM detection (Worker)
  codec/               decode (decodeAudioData → planar SAB)
  waveform/            peak precompute + canvas render
  controller-host/     the Mixxx engine/midi API + .midi.xml parser + MIDI router
  db/                  SQLite library (better-sqlite3): schema, repos, search parser
```

## Design docs

The full research + design record lives in **`../internal-dj/`** (private docs):
overview, functional spec, architecture, audio-engine, library/data, UI/controllers/effects,
the Electron port plan, source map, the Smart Fader writeup, the feasibility analysis, the
development plan, and the running build log (`12-build-log.md`).

## Principles

- **Zero heavy lifting in JS** — DSP/codec/ML in WASM (SIMD/threads) or WebGPU, never per-sample JS.
- **WebGPU required, no fallback** — we own the Electron Chromium runtime.
- **The control bus is the spine** — everything binds to `[group],key` controls (Mixxx-compatible names),
  so we inherit the Mixxx controller-mapping ecosystem.
- **Mixxx is the reference, not the implementation** — React + canvas UI, not a port of its skins.
