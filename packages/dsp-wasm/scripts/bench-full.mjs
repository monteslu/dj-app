/**
 * Full analysis benchmark: every algorithm WASM replaces, vs the JS/old-C it
 * replaces, on REAL music from ~/Music/mp3. Warms up, then medians multiple runs.
 *
 *   PEAKS : JS computeBandPeaks (×2 passes)   vs  WasmPeaks (Mixxx Bessel-4, 1 pass)
 *   BEAT  : JS autocorrelation detectBeats     vs  qm-dsp TempoTrackV2 (Mixxx)
 *   KEY   : JS Goertzel detectKey              vs  qm-dsp GetKeyMode (Mixxx)
 *   ALL   : JS (key+beat+peaks separately)     vs  WASM (qm one-pass + peaks)
 *
 * Run: node scripts/bench-full.mjs [N]   (default 10 tracks)
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const MUSIC = join(homedir(), 'Music', 'mp3');
const N = parseInt(process.argv[2] || '10', 10);
const SR = 44100;

function decode(p) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', p, '-ac', '2', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 30 });
  const inter = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength >> 2);
  const frames = inter.length >> 1;
  const l = new Float32Array(frames), rr = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { l[i] = inter[i * 2]; rr[i] = inter[i * 2 + 1]; }
  return { left: l, right: rr, frames };
}
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const time = (fn, n = 5) => { const a = []; for (let i = 0; i < n; i++) { const t = performance.now(); fn(); a.push(performance.now() - t); } return med(a); };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

const here = process.cwd();
const dsp = await import(pathToFileURL(join(here, 'dist', 'index.js')).href);
const wf = await import(pathToFileURL(join(here, '..', 'waveform', 'dist', 'index.js')).href);
const an = await import(pathToFileURL(join(here, '..', 'analysis', 'dist', 'index.js')).href);
const beatJs = await import(pathToFileURL(join(here, '..', 'analysis', 'dist', 'beat-detector.js')).href);

const wasmPeaks = new dsp.WasmPeaks();
const qm = new dsp.WasmQmAnalysis();
const OVERVIEW = 1920;

const files = readdirSync(MUSIC).filter((f) => f.toLowerCase().endsWith('.mp3')).slice(0, N).map((f) => join(MUSIC, f));
console.log(`\nFull analysis benchmark — ${files.length} tracks, ${SR}Hz, warmed up, median of 5\n`);

const sp = { peaks: [], beat: [], key: [], total: [] };
let totalAudioSec = 0;

for (const p of files) {
  const { left, right, frames } = decode(p);
  const ch = [left, right];
  const dur = frames / SR; totalAudioSec += dur;
  const detail = wf.detailBucketsForDuration(dur);

  // warm
  for (let i = 0; i < 2; i++) {
    wf.computePeakSet(ch, frames, detail, SR);
    wasmPeaks.compute(ch, frames, detail, OVERVIEW, SR);
    beatJs.detectBeats(ch, frames, SR);
    an.detectKey(ch, frames, SR);
    qm.analyze(ch, frames, SR);
  }

  const jsPeaks = time(() => wf.computePeakSet(ch, frames, detail, SR));
  const wsPeaks = time(() => wasmPeaks.compute(ch, frames, detail, OVERVIEW, SR));
  const jsBeat = time(() => beatJs.detectBeats(ch, frames, SR));
  const jsKey = time(() => an.detectKey(ch, frames, SR));
  const wsQm = time(() => qm.analyze(ch, frames, SR)); // key+beat+downbeats together

  // totals: JS path = peaks + beat + key (three separate); WASM = peaks + qm(all)
  const jsTotal = jsPeaks + jsBeat + jsKey;
  const wsTotal = wsPeaks + wsQm;

  sp.peaks.push(jsPeaks / wsPeaks);
  sp.beat.push(jsBeat / wsQm); // qm does beat (+ key + downbeats) — beat alone has no separate WASM
  sp.key.push(jsKey / wsQm);
  sp.total.push(jsTotal / wsTotal);

  const name = p.split('/').pop().slice(0, 34).padEnd(34);
  console.log(
    `${name} ${dur.toFixed(0).padStart(3)}s | ` +
    `peaks ${jsPeaks.toFixed(0)}→${wsPeaks.toFixed(0)}ms (${(jsPeaks / wsPeaks).toFixed(1)}×) | ` +
    `beat ${jsBeat.toFixed(0)}ms · key ${jsKey.toFixed(0)}ms JS → qm ${wsQm.toFixed(0)}ms (key+beat+downbeat) | ` +
    `TOTAL JS ${jsTotal.toFixed(0)}→WASM ${wsTotal.toFixed(0)}ms (${(jsTotal / wsTotal).toFixed(1)}×)`,
  );
}

console.log('\n=== AVERAGES (WASM+SIMD vs the JS it replaces) ===');
console.log(`  peaks (band waveform):    ${avg(sp.peaks).toFixed(2)}× faster   [Mixxx Bessel-4, 1 pass vs JS 2 passes]`);
console.log(`  key (JS Goertzel → qm):   ${avg(sp.key).toFixed(2)}× faster   [but qm ALSO does beat + downbeats in that time]`);
console.log(`  total analysis per track: ${avg(sp.total).toFixed(2)}× faster   [JS key+beat+peaks  vs  WASM qm+peaks]`);
console.log(`\n  Note: qm replaces JS key AND beat AND adds downbeats in ONE pass — the`);
console.log(`  per-algorithm 'key speedup' understates it (one qm call = 3 JS algorithms).`);
console.log(`  Total audio analyzed: ${(totalAudioSec / 60).toFixed(1)} min across ${files.length} tracks.`);
