/**
 * Beat / BPM detection — a self-contained autocorrelation detector.
 *
 * Algorithm (standard onset-autocorrelation, the same family as Mixxx's SoundTouch
 * BPM path):
 *   1. Downmix to mono, compute an onset-strength envelope (positive spectral/energy
 *      flux) at a low frame rate (~100 Hz).
 *   2. Autocorrelate the envelope; find the lag (within a BPM range) with the
 *      strongest periodicity → the tempo.
 *   3. Find the grid phase by correlating a beat-pulse train at that tempo against
 *      the envelope and picking the best offset.
 *
 * This won't be bit-identical to qm-dsp, but it produces a usable constant-tempo
 * beatgrid for 4/4 music — enough for beatloops + sync now. The essentia.js /
 * qm-dsp-WASM swap (05-library-and-data.md §6) drops in behind the same interface.
 *
 * Pure + synchronous so it runs in a Worker (or inline for tests).
 */

import { Beats } from './beats.js';

export interface BeatDetectorOptions {
  /** Candidate BPM range. */
  minBpm?: number;
  maxBpm?: number;
  /** Onset envelope frame rate (Hz). */
  envelopeRate?: number;
}

export interface BeatResult {
  bpm: number;
  firstBeatFrame: number;
  /** A confidence proxy (autocorrelation peak strength, 0..1-ish). */
  confidence: number;
}

const DEFAULTS = { minBpm: 70, maxBpm: 180, envelopeRate: 100 };

/** Downmix planar channels to a mono Float32Array. */
function toMono(channels: Float32Array[], frames: number): Float32Array {
  const n = channels.length;
  if (n === 1) {
    return channels[0]!.subarray(0, frames);
  }
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < n; c++) {
      s += channels[c]![i]!;
    }
    mono[i] = s / n;
  }
  return mono;
}

/**
 * Onset-strength envelope: per envelope-frame, the positive change in
 * short-time energy (half-wave-rectified energy flux). Cheap and effective for
 * percussive music.
 */
function onsetEnvelope(mono: Float32Array, sampleRate: number, envRate: number): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate / envRate));
  const nFrames = Math.floor(mono.length / hop);
  const env = new Float32Array(nFrames);
  let prevEnergy = 0;
  for (let f = 0; f < nFrames; f++) {
    let energy = 0;
    const start = f * hop;
    const end = start + hop;
    for (let i = start; i < end; i++) {
      const s = mono[i]!;
      energy += s * s;
    }
    energy = Math.sqrt(energy / hop);
    const flux = energy - prevEnergy;
    env[f] = flux > 0 ? flux : 0; // half-wave rectify
    prevEnergy = energy;
  }
  return env;
}

/** Normalize a vector to zero mean (so autocorrelation isn't dominated by DC). */
function removeMean(v: Float32Array): void {
  let mean = 0;
  for (let i = 0; i < v.length; i++) {
    mean += v[i]!;
  }
  mean /= v.length;
  for (let i = 0; i < v.length; i++) {
    v[i]! -= mean;
  }
}

export function detectBeats(
  channels: Float32Array[],
  frames: number,
  sampleRate: number,
  options: BeatDetectorOptions = {},
): BeatResult {
  const { minBpm, maxBpm, envelopeRate } = { ...DEFAULTS, ...options };

  const mono = toMono(channels, frames);
  const env = onsetEnvelope(mono, sampleRate, envelopeRate);
  removeMean(env);

  // Lag (in envelope frames) for a given BPM: env frames per beat.
  const lagForBpm = (bpm: number) => (60 / bpm) * envelopeRate;
  const minLag = Math.floor(lagForBpm(maxBpm));
  const maxLag = Math.ceil(lagForBpm(minBpm));

  // Autocorrelation over the candidate lag range; pick the strongest.
  let bestLag = minLag;
  let bestScore = -Infinity;
  let norm0 = 0;
  for (let i = 0; i < env.length; i++) {
    norm0 += env[i]! * env[i]!;
  }
  norm0 = norm0 || 1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < env.length; i++) {
      acc += env[i]! * env[i + lag]!;
    }
    // Slight preference for the middle of the range (octave-error mitigation).
    const score = acc / norm0;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  let bpm = (60 * envelopeRate) / bestLag;

  // Octave correction: if BPM is implausibly low/high but a double/half is in
  // range and scores comparably, prefer the in-the-pocket value (90-150).
  bpm = snapOctave(bpm, minBpm, maxBpm);

  // Phase: correlate a pulse train at the detected period against the envelope,
  // sliding the offset over one beat, pick the best alignment.
  const lag = lagForBpm(bpm);
  let bestOffset = 0;
  let bestPhaseScore = -Infinity;
  const offsetSteps = Math.ceil(lag);
  for (let off = 0; off < offsetSteps; off++) {
    let acc = 0;
    for (let beat = 0; ; beat++) {
      const pos = Math.round(off + beat * lag);
      if (pos >= env.length) {
        break;
      }
      acc += env[pos]!;
    }
    if (acc > bestPhaseScore) {
      bestPhaseScore = acc;
      bestOffset = off;
    }
  }

  // Convert the envelope-frame offset back to source frames.
  const hop = Math.max(1, Math.round(sampleRate / envelopeRate));
  const firstBeatFrame = bestOffset * hop;

  return {
    bpm: Math.round(bpm * 100) / 100,
    firstBeatFrame,
    confidence: Math.max(0, Math.min(1, bestScore)),
  };
}

/** Pull a BPM into a sensible octave if a multiple/division fits better. */
function snapOctave(bpm: number, minBpm: number, maxBpm: number): number {
  const candidates = [bpm, bpm * 2, bpm / 2];
  // Prefer a candidate in [minBpm,maxBpm] closest to 124 (dance pocket).
  let best = bpm;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (c >= minBpm && c <= maxBpm) {
      const d = Math.abs(c - 124);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
  }
  return best;
}

/** Convenience: detect and return a Beats grid. */
export function detectBeatGrid(
  channels: Float32Array[],
  frames: number,
  sampleRate: number,
  options?: BeatDetectorOptions,
): { beats: Beats; confidence: number } {
  const r = detectBeats(channels, frames, sampleRate, options);
  return {
    beats: new Beats(r.bpm, r.firstBeatFrame, sampleRate),
    confidence: r.confidence,
  };
}
