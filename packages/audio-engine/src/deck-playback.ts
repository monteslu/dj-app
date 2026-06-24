/**
 * DeckPlayback — the per-deck sample producer (Mixxx EngineBuffer +
 * EngineBufferScale analog, 04-audio-engine.md §4). Two scaler paths:
 *
 *   - LINEAR (keylock off): varispeed. One linear-interpolation read does
 *     resampling + tempo together, so pitch follows speed (like vinyl). Can ramp
 *     through zero → also the path for scratch/reverse.
 *   - KEYLOCK (keylock on): the source is resampled to the engine rate at
 *     ORIGINAL pitch (baseRate only), then a KeylockScaler (SoundTouch) applies
 *     the user tempo independently, holding pitch constant.
 *
 * DeckPlayback owns the fractional source read position in both paths (the
 * KeylockScaler pulls through `pullResampled`, which advances it), so seeking and
 * position reporting work identically regardless of scaler.
 *
 * Pure (no Web Audio / no SAB) → unit-tested sample-accurately.
 */

import type { Scaler, SourcePull } from './scaler.js';
import { KeylockScaler } from './keylock-scaler.js';

export interface DeckTrack {
  /** Planar Float32 channel data. channelData[c][frame]. */
  channelData: Float32Array[];
  channels: number;
  frames: number;
  sampleRate: number;
}

export class DeckPlayback {
  private track: DeckTrack | null = null;
  /** Fractional play position, in source frames. */
  private position = 0;
  /** Resampling ratio = trackSampleRate / engineSampleRate. */
  private baseRate = 1;

  private keylock = false;
  private keylockScaler: Scaler | null = null;

  // Loop state (in source frames). When enabled and playing forward, the read
  // position wraps from loopEnd back to loopStart with a short seam crossfade.
  private loopEnabled = false;
  private loopStart = 0;
  private loopEnd = 0;
  /** Crossfade length (source frames) applied across a loop seam to avoid clicks. */
  private static readonly SEAM_FADE = 64;

  constructor(private engineSampleRate: number) {}

  loadTrack(track: DeckTrack): void {
    this.track = track;
    this.position = 0;
    this.baseRate = track.sampleRate / this.engineSampleRate;
    this.keylockScaler?.reset();
  }

  eject(): void {
    this.track = null;
    this.position = 0;
    this.keylockScaler?.reset();
  }

  hasTrack(): boolean {
    return this.track !== null;
  }

  get frames(): number {
    return this.track?.frames ?? 0;
  }

  getPositionFrames(): number {
    return this.position;
  }

  getPositionFraction(): number {
    if (!this.track || this.track.frames === 0) {
      return 0;
    }
    return this.position / this.track.frames;
  }

  seekFrames(frame: number): void {
    if (!this.track) {
      return;
    }
    this.position = Math.max(0, Math.min(frame, this.track.frames));
    // A seek invalidates the keylock scaler's buffered/primed state.
    this.keylockScaler?.reset();
  }

  seekFraction(fraction: number): void {
    if (!this.track) {
      return;
    }
    this.seekFrames(fraction * this.track.frames);
  }

  /** Enable/disable keylock. Toggling resets the scaler to re-prime cleanly. */
  setKeylock(on: boolean): void {
    if (on === this.keylock) {
      return;
    }
    this.keylock = on;
    if (on && !this.keylockScaler) {
      this.keylockScaler = new KeylockScaler();
    }
    this.keylockScaler?.reset();
  }

  isKeylock(): boolean {
    return this.keylock;
  }

  /** Set the loop region (frames) and whether it's active. */
  setLoop(start: number, end: number, enabled: boolean): void {
    this.loopStart = Math.max(0, start);
    this.loopEnd = Math.max(this.loopStart, end);
    this.loopEnabled = enabled && this.loopEnd > this.loopStart;
  }

  setLoopEnabled(enabled: boolean): void {
    this.loopEnabled = enabled && this.loopEnd > this.loopStart;
  }

  isLoopEnabled(): boolean {
    return this.loopEnabled;
  }

  getLoop(): { start: number; end: number; enabled: boolean } {
    return { start: this.loopStart, end: this.loopEnd, enabled: this.loopEnabled };
  }

  /**
   * Read one interpolated source frame into the planar outputs at column `i`.
   * Centralizes the sample fetch so the loop seam crossfade can mix two reads.
   */
  private readFrameInto(outputs: Float32Array[], i: number, pos: number, gain = 1): void {
    const track = this.track!;
    const { channelData, channels, frames } = track;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const i1 = i0 + 1 < frames ? i0 + 1 : i0;
    for (let c = 0; c < outputs.length; c++) {
      const srcCh = c < channels ? c : channels - 1;
      const data = channelData[srcCh]!;
      const s0 = data[i0]!;
      const s1 = data[i1]!;
      const sample = s0 + (s1 - s0) * frac;
      if (gain === 1) {
        outputs[c]![i] = sample;
      } else {
        outputs[c]![i]! += sample * gain;
      }
    }
  }

  /**
   * Linear-interpolation read of `numFrames` from the source into planar
   * `outputs`, advancing the play position by `resampleRatio` source frames per
   * output frame. Returns frames actually produced (fewer at end-of-track). This
   * is both the varispeed path and the source-pull for the keylock scaler.
   */
  private pullResampled(
    outputs: Float32Array[],
    numFrames: number,
    resampleRatio: number,
  ): number {
    const track = this.track;
    if (!track) {
      return 0;
    }
    const { frames } = track;
    const outChannels = outputs.length;
    let produced = 0;
    const fade = DeckPlayback.SEAM_FADE;

    for (let i = 0; i < numFrames; i++) {
      let pos = this.position;

      // Loop wrap: if we've reached/passed loopEnd, jump back to loopStart. We
      // keep the fractional overshoot so pitch/phase stays continuous.
      if (this.loopEnabled && resampleRatio > 0 && pos >= this.loopEnd) {
        pos = this.loopStart + (pos - this.loopEnd);
        this.position = pos;
      }

      if (pos < 0 || pos >= frames) {
        this.position = pos < 0 ? 0 : frames;
        break;
      }

      // Base read.
      this.readFrameInto(outputs, i, pos, 1);

      // Seam crossfade: within `fade` frames before loopEnd, blend in the
      // corresponding frame just past loopStart so the wrap is click-free.
      if (this.loopEnabled && resampleRatio > 0) {
        const distToEnd = this.loopEnd - pos;
        if (distToEnd > 0 && distToEnd < fade) {
          const t = distToEnd / fade; // 1 → far from seam, 0 → at seam
          // fade current out, fade the wrapped-in frame in
          const wrapPos = this.loopStart + (fade - distToEnd);
          if (wrapPos < frames) {
            for (let c = 0; c < outChannels; c++) {
              outputs[c]![i]! *= t;
            }
            this.readFrameInto(outputs, i, wrapPos, 1 - t);
          }
        }
      }

      this.position = pos + resampleRatio;
      produced++;
    }
    return produced;
  }

  /**
   * Produce `numFrames` of output into planar `outputs`, playing at `speed` (the
   * tempo scalar from RateControl; sign = direction). When stopped writes
   * silence. Returns true while still playing.
   */
  process(
    outputs: Float32Array[],
    numFrames: number,
    speed: number,
    playing: boolean,
  ): boolean {
    const track = this.track;
    const outChannels = outputs.length;

    if (!track || !playing || speed === 0) {
      for (let c = 0; c < outChannels; c++) {
        outputs[c]!.fill(0, 0, numFrames);
      }
      return track !== null && this.position < track.frames;
    }

    // Keylock requires a forward, non-scratch speed; otherwise fall back to the
    // linear path (which alone can ramp through zero / go reverse — Mixxx does the
    // same: scratching/reverse always use the linear scaler).
    const useKeylock =
      this.keylock && this.keylockScaler !== null && speed > 0.1 && speed < 1.9;

    if (useKeylock) {
      const scaler = this.keylockScaler!;
      scaler.setRatios(speed, 1); // tempo = speed, pitch held
      // The scaler pulls source resampled to engine rate at ORIGINAL pitch
      // (baseRate only — tempo is applied by the scaler, not the pull).
      const pull: SourcePull = (chans, n) => this.pullResampled(chans, n, this.baseRate);
      const flowing = scaler.process(outputs, numFrames, pull);
      // An active loop never "ends" at the track tail.
      return flowing && (this.loopEnabled || this.position < track.frames);
    }

    // Linear varispeed path.
    const produced = this.pullResampled(outputs, numFrames, this.baseRate * speed);
    // Zero the tail if we ran off the end.
    for (let c = 0; c < outChannels; c++) {
      outputs[c]!.fill(0, produced, numFrames);
    }
    return produced === numFrames && (this.loopEnabled || this.position < track.frames);
  }
}
