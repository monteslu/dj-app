/**
 * display.ts — the visualizer DISPLAY (popup window) renderer: the CONSUMER of the
 * output bus. dj-app renders nothing; ALL visual work happens here, in this separate
 * window/process. It subscribes via IpcTransport (frames relayed by main from the
 * producer) and drives Butterchurn (MilkDrop) on a canvas.
 *
 * Audio: butter-visualizer's trick — Butterchurn needs NO real AudioNode; we patch its
 * internal analysers' getByteTimeDomainData to return the piped master-bus bytes. It
 * does its own FFT. So this window needs no AudioContext hardware access.
 *
 * Control: consumer.directive() says what to show (preset / random / series / off);
 * each display obeys independently. Metadata drives the now-playing overlay + (optional)
 * beat-synced preset changes.
 */

import { OutputConsumer, IpcTransport, type VizDirective } from '@dj/output-bus';

declare global {
  interface Window {
    butterchurn?: {
      createVisualizer?: (ctx: BaseAudioContext, canvas: HTMLCanvasElement, opts: object) => Butterchurn;
      default?: { createVisualizer?: (ctx: BaseAudioContext, canvas: HTMLCanvasElement, opts: object) => Butterchurn };
    };
    butterchurnPresets?: { getPresets?: () => Record<string, unknown> };
  }
}
interface ByteAnalyser {
  getByteTimeDomainData(a: Uint8Array): void;
}
interface Butterchurn {
  audio?: { analyser?: ByteAnalyser; analyserL?: ByteAnalyser; analyserR?: ByteAnalyser };
  loadPreset(preset: unknown, blendSec: number): void;
  render(): void;
  setRendererSize(w: number, h: number): void;
}

const vizCanvas = document.getElementById('viz') as HTMLCanvasElement;
const scope = document.getElementById('scope') as HTMLCanvasElement;
const metaEl = document.getElementById('meta') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

// ── consumer + identity ──────────────────────────────────────────────────────
const displayId = `display-${Math.floor(performance.now())}`;
const consumer = new OutputConsumer(
  new IpcTransport({ subscribe: (cb) => window.dj.onDisplayFrame((f) => cb(f as never)) }),
  { id: displayId },
);

// Latest master-bus bytes, fed into Butterchurn's patched analysers.
let latestTime: Uint8Array | null = null;

// ── Butterchurn setup ────────────────────────────────────────────────────────
function getBcApi() {
  const bc = window.butterchurn;
  if (bc?.createVisualizer) return bc;
  if (bc?.default?.createVisualizer) return bc.default;
  return null;
}

let viz: Butterchurn | null = null;
let presetNames: string[] = [];

function setupButterchurn(): boolean {
  const api = getBcApi();
  const presetsLib = window.butterchurnPresets;
  if (!api?.createVisualizer || !presetsLib?.getPresets) {
    console.warn('[display] Butterchurn libs not present — falling back to oscilloscope');
    document.body.classList.add('no-butterchurn');
    return false;
  }
  // A dummy OfflineAudioContext (no hardware) — Butterchurn just needs a context object;
  // the actual audio comes from the patched analysers below.
  const dummyCtx = new OfflineAudioContext(2, 44100, 44100);
  viz = api.createVisualizer(dummyCtx, vizCanvas, {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: window.devicePixelRatio || 1,
    textureRatio: 1,
  });

  // Patch the 3 internal analysers to read OUR piped time-domain bytes.
  const audio = viz.audio;
  const patch = (an?: ByteAnalyser) => {
    if (!an) return;
    an.getByteTimeDomainData = (arr: Uint8Array) => {
      if (latestTime) arr.set(latestTime.subarray(0, Math.min(arr.length, latestTime.length)));
      else arr.fill(128);
    };
  };
  patch(audio?.analyser);
  patch(audio?.analyserL);
  patch(audio?.analyserR);

  presetNames = Object.keys(presetsLib.getPresets!());
  fitViz();
  console.log(`[display] Butterchurn ready — ${presetNames.length} presets`);
  return true;
}

function loadPresetByName(name: string, blendSec = 2.0): void {
  const presets = window.butterchurnPresets?.getPresets?.();
  if (!viz || !presets || !presets[name]) return;
  viz.loadPreset(presets[name], blendSec);
}
function loadRandomPreset(blendSec = 2.0): void {
  if (!presetNames.length) return;
  const name = presetNames[Math.floor(Math.random() * presetNames.length)]!;
  loadPresetByName(name, blendSec);
}

function fitViz(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  vizCanvas.width = w * (window.devicePixelRatio || 1);
  vizCanvas.height = h * (window.devicePixelRatio || 1);
  viz?.setRendererSize(vizCanvas.width, vizCanvas.height);
  scope.width = w * (window.devicePixelRatio || 1);
  scope.height = h * (window.devicePixelRatio || 1);
}
window.addEventListener('resize', fitViz);

// ── directive handling (preset / random / series / off) ──────────────────────
let appliedDirective: VizDirective | null = null;
let seriesIdx = 0;
let lastSwitch = 0;

function applyDirective(d: VizDirective, now: number): void {
  const changed = JSON.stringify(d) !== JSON.stringify(appliedDirective);
  if (changed) {
    appliedDirective = d;
    lastSwitch = now;
    seriesIdx = 0;
    if (d.mode === 'preset') loadPresetByName(d.name, d.blendSec ?? 2.0);
    else if (d.mode === 'random') loadRandomPreset();
    else if (d.mode === 'series' && d.names.length) loadPresetByName(d.names[0]!, 2.0);
    return;
  }
  // Time-based advancement for random/series.
  if (d.mode === 'random' && d.everySec && now - lastSwitch >= d.everySec * 1000) {
    lastSwitch = now;
    loadRandomPreset();
  } else if (d.mode === 'series' && d.everySec && now - lastSwitch >= d.everySec * 1000) {
    lastSwitch = now;
    seriesIdx = (seriesIdx + 1) % d.names.length;
    loadPresetByName(d.names[seriesIdx]!, 2.0);
  }
}

// ── metadata overlay ─────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
consumer.onChange(() => {
  const meta = consumer.latestMeta();
  const master = meta?.masterDeck;
  const deck = master != null ? meta?.decks[master] : meta?.decks.find((d) => d.playing);
  if (deck?.title) {
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    metaEl.innerHTML =
      `<div class="title">${escapeHtml(deck.title)}</div>` +
      `<div class="sub">${escapeHtml(deck.artist ?? '')} ` +
      `${deck.bpm ? `· ${deck.bpm.toFixed(0)} BPM` : ''} ${deck.key ? `· ${deck.key}` : ''} ` +
      `· ${fmt(deck.positionSec ?? 0)} / ${fmt(deck.durationSec ?? 0)}</div>`;
  } else {
    metaEl.innerHTML = '';
  }
});

// ── render loop ──────────────────────────────────────────────────────────────
const hasButterchurn = setupButterchurn();
if (hasButterchurn) loadRandomPreset(0); // start on something immediately

const scopeCtx = scope.getContext('2d');
function drawScopeFallback(samples: Uint8Array): void {
  if (!scopeCtx) return;
  const w = scope.width;
  const h = scope.height;
  scopeCtx.fillStyle = 'rgba(0,0,0,0.18)';
  scopeCtx.fillRect(0, 0, w, h);
  scopeCtx.strokeStyle = '#5db8ff';
  scopeCtx.lineWidth = 2;
  scopeCtx.beginPath();
  const step = w / samples.length;
  for (let i = 0; i < samples.length; i++) {
    const y = (samples[i]! / 255) * h;
    if (i === 0) scopeCtx.moveTo(0, y);
    else scopeCtx.lineTo(i * step, y);
  }
  scopeCtx.stroke();
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  // pull the latest piped audio (newest-wins) for Butterchurn's patched analysers
  latestTime = consumer.latestAudio();
  if (latestTime && statusEl.textContent !== 'live') statusEl.textContent = 'live';

  const directive = consumer.directive();
  if (directive.mode === 'off') {
    // Blank: stop driving Butterchurn (leaves the canvas dark) + clear the scope.
    if (scopeCtx) {
      scopeCtx.fillStyle = '#000';
      scopeCtx.fillRect(0, 0, scope.width, scope.height);
    }
    return;
  }

  if (viz) {
    applyDirective(directive, now);
    viz.render();
  } else if (latestTime) {
    drawScopeFallback(latestTime);
  }
}
requestAnimationFrame(frame);
