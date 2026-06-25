/**
 * WaveformLaneController — the imperative render logic for one scrolling waveform
 * lane, kept OUT of the React component. Owns the GPU renderer + the rAF loop +
 * the per-frame bus/store reads. The component just mounts a canvas and hands it
 * here. Pure logic, no JSX.
 */

import { WaveformGL } from '@dj/waveform';
import { deck as deckGroup, DeckKeys, MASTER, MasterKeys, type ControlBus } from '@dj/control-bus';
import { getDeckTrack } from './deck-state.js';
import { reportLaneDraw } from './perf-monitor.js';
import { onFrame } from './frame-loop.js';

const SR = 48000;
// FIXED zoom presets: source frames per screen pixel. Like Mixxx, the waveform's
// sample→pixel scale is a CONSTANT (never derived from BPM — that caused the
// every-frame rescale/shimmer). A few discrete levels the user cycles through;
// global (same on both decks) so synced waves line up. Index 0 = most zoomed in.
// At 48k: 256→5.3ms/px, 512→10.7ms/px, etc.
export const ZOOM_PRESETS = [256, 384, 512, 768, 1152];
const DEFAULT_ZOOM_INDEX = 2;

export function framesPerPxForZoom(index: number): number {
  const i = Math.max(0, Math.min(ZOOM_PRESETS.length - 1, Math.round(index)));
  return ZOOM_PRESETS[i]!;
}

export class WaveformLaneController {
  private gl: WaveformGL;
  private uploaded: Uint8Array | null = null;
  private unsub: () => void = () => {};
  private ro: ResizeObserver;
  private readonly group: string;


  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly bus: ControlBus,
    private readonly deckIndex: number,
    private readonly framesPerPx: number,
  ) {
    this.group = deckGroup(deckIndex + 1);
    // WebGL is the ONLY renderer — this app requires the GPU (no Canvas2D fallback).
    // WaveformGL never throws; if the context can't init it reports ok=false and the
    // lane shows the GPU-unavailable state instead of silently CPU-rendering.
    this.gl = new WaveformGL(canvas);

    // size the backing store on real resize only (not per frame)
    this.ro = new ResizeObserver(() => this.fit());
    this.fit();
    this.ro.observe(canvas);

    this.unsub = onFrame(this.tick);
  }

  private fit(): void {
    const w = Math.floor(this.canvas.clientWidth);
    if (w && this.canvas.width !== w) this.canvas.width = w;
  }

  private tick = (): void => {
    const st = getDeckTrack(this.deckIndex);
    if (st.peaks) {
      // upload peaks to the GPU only when the track changes
      if (this.uploaded !== st.peaks.detail.peaks) {
        const d = st.peaks.detail;
        this.gl?.setPeaks(d.peaks, d.framesPerBucket, d.low, d.mid, d.high);
        this.uploaded = d.peaks;
      }
      const g = this.group;
      const frames = this.bus.get(g, DeckKeys.trackSamples);
      const fraction = this.bus.get(g, DeckKeys.playPosition);
      const fileBpm = this.bus.get(g, DeckKeys.fileBpm);
      // Use the REAL sample rate (positions + firstBeatFrame are in decoded frames
      // at the AudioContext rate); a hardcoded 48000 drifts the grid when the
      // context runs at 44100, so synced grids wouldn't line up.
      const sr = this.bus.get(MASTER, MasterKeys.sampleRate) || SR;
      const framesPerBeat = fileBpm > 0 ? (60 / fileBpm) * sr : 0;
      const fbf = this.bus.get(g, DeckKeys.firstBeatFrame);

      // FIXED zoom from the global preset index — does NOT depend on BPM, so the
      // wave scale never rescales/shimmers. The beat grid below still uses
      // framesPerBeat for its lines.
      const zoomIdx = this.bus.get(MASTER, MasterKeys.waveformZoom);
      const framesPerPx = framesPerPxForZoom(zoomIdx >= 0 ? zoomIdx : DEFAULT_ZOOM_INDEX);

      // The position to render from: just the playhead, in source frames. The
      // worklet publishes it ~every 10.7ms; we render whatever it currently is.
      // Deterministic: this scalar fully determines the visible window, and the
      // shader maps each pixel to one static bucket, so the same content always has
      // the same height. (No extrapolation/smoothing — that caused the morph.)
      const positionFrames = fraction * frames;

      const params = {
        positionFrames,
        framesPerPx,
        firstBeatFrame: fbf >= 0 ? fbf : 0,
        framesPerBeat,
      };
      const t0 = performance.now();
      this.gl.draw(params);
      reportLaneDraw(`deck${this.deckIndex}`, this.gl.ok, performance.now() - t0);
    } else {
      // no track → clear the GL framebuffer to the panel grey (so the band never
      // shows white from an undrawn buffer).
      this.gl.clear();
      this.uploaded = null;
    }
  };

  dispose(): void {
    this.unsub();
    this.ro.disconnect();
    this.gl?.dispose();
  }
}
