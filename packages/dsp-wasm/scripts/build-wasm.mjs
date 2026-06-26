/**
 * Build the WASM DSP modules from csrc/ and emit them as base64-embedded .ts so
 * they can be instantiated SYNCHRONOUSLY inside an AudioWorklet (no fetch/import
 * available there). Requires emcc on PATH (source emsdk_env.sh first).
 *
 * Run: npm run build:wasm  (from packages/dsp-wasm)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Recursively collect files under `dir` matching one of the extensions. */
function walkExt(dir, exts) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkExt(full, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const csrc = join(root, 'csrc');
const wasmDir = join(root, 'wasm');
const genDir = join(root, 'src', 'generated');
mkdirSync(wasmDir, { recursive: true });
mkdirSync(genDir, { recursive: true });

const modules = [
  {
    name: 'resampler',
    src: 'resampler.c',
    exports: ['_resampler_pull', '_resampler_last_position', '_resampler_last_produced', '_malloc', '_free'],
    // The resampler holds the WHOLE track's stereo float source — a 3-min song is
    // ~66MB, well past the 32MB default. Without growth malloc returns 0 and the
    // heap.set() crashes with "offset is out of bounds" on load. Allow growth.
    growMemory: true,
  },
  {
    name: 'beatdetect',
    src: 'beatdetect.c',
    exports: [
      '_beatdetect_run',
      '_beatdetect_bpm',
      '_beatdetect_first_beat_frame',
      '_beatdetect_confidence',
      '_bd_malloc',
      '_bd_free',
    ],
    // A full track's stereo float source can be large; allow the heap to grow.
    growMemory: true,
  },
  {
    name: 'peaks',
    src: 'peaks.c',
    // Faithful Mixxx AnalyzerWaveform: Bessel-4 band split via FIDLIB + per-stride
    // max peaks, detail + overview in one pass. Compile FIDLIB in too. FIDLIB needs
    // a target macro — wasm is posix-like, so T_LINUX (what Mixxx uses on Linux).
    extraSrc: ['fidlib/fidlib.c'],
    defines: ['T_LINUX'],
    exports: ['_peaks_run', '_peaks_malloc', '_peaks_free'],
    growMemory: true,
  },
  {
    name: 'qmanalysis',
    src: 'qmanalysis.cpp',
    // Mixxx's REAL analysis (Queen Mary DSP): GetKeyMode (key) + DetectionFunction/
    // TempoTrackV2 (beat) + DownBeat (real downbeats/measures). Compiles the whole
    // vendored qm-dsp subtree + KissFFT. C++ (emscripten handles it).
    glob: ['qm-dsp/dsp/**/*.cpp', 'qm-dsp/maths/**/*.cpp', 'qm-dsp/base/**/*.cpp', 'qm-dsp/ext/kissfft/**/*.c'],
    includeDirs: ['qm-dsp', 'qm-dsp/ext/kissfft', 'qm-dsp/ext/kissfft/tools'],
    // qm-dsp configures KissFFT for double precision (Mixxx: kiss_fft_scalar=double).
    defines: ['kiss_fft_scalar=double'],
    cpp: true,
    exports: [
      '_qm_analyze', '_qm_bpm', '_qm_first_beat_frame', '_qm_confidence', '_qm_key',
      '_qm_beat_count', '_qm_beat_frame', '_qm_downbeat_count', '_qm_downbeat_frame',
      '_qm_malloc', '_qm_free',
    ],
    growMemory: true,
  },
];

for (const m of modules) {
  const out = join(wasmDir, `${m.name}-standalone.wasm`);
  // Expand any glob dirs (qm-dsp) into concrete source files.
  const globSrcs = (m.glob ?? []).flatMap((g) => {
    const base = join(csrc, g.split('/**')[0]);
    const exts = g.endsWith('*.c') ? ['.c'] : ['.cpp', '.c'];
    return walkExt(base, exts);
  });
  const sources = [join(csrc, m.src), ...((m.extraSrc ?? []).map((s) => join(csrc, s))), ...globSrcs];
  console.log(`compiling ${m.src} (+${sources.length - 1} deps) → ${m.name}-standalone.wasm (SIMD, O3)`);
  execFileSync(
    m.cpp ? 'em++' : 'emcc',
    [
      ...sources,
      ...((m.includeDirs ?? []).flatMap((d) => ['-I', join(csrc, d)])),
      ...((m.defines ?? []).map((d) => `-D${d}`)),
      '-O3',
      '-msimd128',
      '--no-entry',
      // qm-dsp uses throw in a couple of spots; keep exceptions for C++ modules
      // (offline analysis, not perf-critical re: exception support).
      ...(m.cpp ? ['-std=c++17'] : []),
      '-s', 'STANDALONE_WASM=1',
      '-s', `EXPORTED_FUNCTIONS=${JSON.stringify(m.exports)}`,
      '-s', `ALLOW_MEMORY_GROWTH=${m.growMemory ? 1 : 0}`,
      '-s', 'INITIAL_MEMORY=33554432',
      ...(m.growMemory ? ['-s', 'MAXIMUM_MEMORY=536870912'] : []),
      '-o', out,
    ],
    { stdio: 'inherit' },
  );

  const bytes = readFileSync(out);
  const b64 = bytes.toString('base64');
  const ts = `/* AUTO-GENERATED from csrc/${m.src} by scripts/build-wasm.mjs. Do not edit. */
/* eslint-disable */
export const ${m.name}WasmBase64 = '${b64}';
`;
  const dest = join(genDir, `${m.name}-wasm.ts`);
  writeFileSync(dest, ts);
  console.log(`wrote ${dest} (${b64.length} b64 chars, ${bytes.length} wasm bytes)`);
}

console.log('done.');
