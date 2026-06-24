/**
 * Canvas2D waveform renderers — the fast path to "I can see the waveform" (first
 * light). A WebGPU/WGSL renderer (porting Mixxx's GLSL from res/shaders) replaces
 * these for the GPU-accelerated scrolling view later (10-electron-feasibility.md
 * §3a). Canvas2D is fine for the overview and good enough to start.
 */

import type { PeakData } from './peaks.js';

/** A point marker (hotcue, main cue) at a track fraction 0..1. */
export interface Marker {
  fraction: number;
  color: string;
  label?: string;
}

/** A loop region (start/end fractions 0..1). */
export interface LoopRegion {
  start: number;
  end: number;
  active: boolean;
}

export interface WaveformColors {
  background: string;
  /** Waveform body color. */
  wave: string;
  /** Already-played portion (overview). */
  played: string;
  /** Playhead line. */
  playhead: string;
  /** Center axis line. */
  axis: string;
}

export const DEFAULT_COLORS: WaveformColors = {
  background: '#14161c',
  wave: '#37b6ff',
  played: '#1d5e80',
  playhead: '#ff5a5a',
  axis: '#2a2e38',
};

/**
 * Draw the full-track overview: the whole waveform scaled to the canvas width,
 * with the played portion tinted and a playhead at `positionFraction` (0..1).
 */
export interface Overlay {
  markers?: Marker[];
  loop?: LoopRegion;
}

export function drawOverview(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  peaks: PeakData,
  positionFraction: number,
  colors: WaveformColors = DEFAULT_COLORS,
  overlay?: Overlay,
): void {
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) {
    return;
  }
  const w = canvas.width;
  const h = canvas.height;
  const mid = h / 2;

  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, w, h);

  // center axis
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();

  const playedX = Math.round(positionFraction * w);
  const n = peaks.length;

  for (let x = 0; x < w; x++) {
    // map canvas column → peak bucket
    const b = Math.min(n - 1, Math.floor((x / w) * n));
    const amp = (peaks.peaks[b]! / 255) * mid;
    ctx.strokeStyle = x <= playedX ? colors.played : colors.wave;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, mid - amp);
    ctx.lineTo(x + 0.5, mid + amp);
    ctx.stroke();
  }

  // loop region
  if (overlay?.loop && overlay.loop.end > overlay.loop.start) {
    const x0 = overlay.loop.start * w;
    const x1 = overlay.loop.end * w;
    ctx.fillStyle = overlay.loop.active ? 'rgba(74,222,128,0.18)' : 'rgba(125,134,150,0.12)';
    ctx.fillRect(x0, 0, x1 - x0, h);
  }

  // markers (hotcues / main cue)
  if (overlay?.markers) {
    for (const m of overlay.markers) {
      const mx = Math.round(m.fraction * w);
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx + 0.5, 0);
      ctx.lineTo(mx + 0.5, h);
      ctx.stroke();
    }
  }

  // playhead
  ctx.strokeStyle = colors.playhead;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(playedX + 0.5, 0);
  ctx.lineTo(playedX + 0.5, h);
  ctx.stroke();
}

/**
 * Draw the zoomed scrolling waveform centered on the play position. `framesPerPx`
 * controls zoom (source frames per canvas pixel). The playhead sits at canvas
 * center; the waveform scrolls under it. Uses the detailed peak set.
 */
export function drawScrolling(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  detail: PeakData,
  positionFrames: number,
  framesPerPx: number,
  colors: WaveformColors = DEFAULT_COLORS,
): void {
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) {
    return;
  }
  const w = canvas.width;
  const h = canvas.height;
  const mid = h / 2;
  const centerX = w / 2;

  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();

  const { peaks, framesPerBucket, length } = detail;

  ctx.strokeStyle = colors.wave;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const frame = positionFrames + (x - centerX) * framesPerPx;
    if (frame < 0) {
      continue;
    }
    const b = Math.floor(frame / framesPerBucket);
    if (b >= length) {
      break;
    }
    const amp = (peaks[b]! / 255) * mid;
    ctx.moveTo(x + 0.5, mid - amp);
    ctx.lineTo(x + 0.5, mid + amp);
  }
  ctx.stroke();

  // playhead at center
  ctx.strokeStyle = colors.playhead;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX + 0.5, 0);
  ctx.lineTo(centerX + 0.5, h);
  ctx.stroke();
}
