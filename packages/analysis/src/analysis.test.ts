import { describe, it, expect } from 'vitest';
import { Beats } from './beats.js';
import { detectBeats } from './beat-detector.js';

describe('Beats', () => {
  const b = new Beats(120, 1000, 48000); // 120bpm → 0.5s/beat → 24000 frames/beat

  it('computes framesPerBeat', () => {
    expect(b.framesPerBeat).toBe(24000);
  });

  it('finds beat frames, nearest/next/prev', () => {
    expect(b.beatFrame(0)).toBe(1000);
    expect(b.beatFrame(2)).toBe(1000 + 48000);
    expect(b.nearestBeat(1000 + 12000)).toBe(1000 + 24000); // just past halfway → next
    expect(b.nextBeat(1000)).toBe(1000); // on a beat
    expect(b.nextBeat(1001)).toBe(1000 + 24000);
    expect(b.prevBeat(1000 + 23999)).toBe(1000);
  });

  it('beatDistance is 0 on a beat and ~0.5 halfway', () => {
    expect(b.beatDistance(1000)).toBeCloseTo(0, 5);
    expect(b.beatDistance(1000 + 12000)).toBeCloseTo(0.5, 5);
  });

  it('scale/translate/withBpm return new grids', () => {
    expect(b.scale(2).bpm).toBe(240);
    expect(b.translate(500).firstBeatFrame).toBe(1500);
    expect(b.withBpm(128).bpm).toBe(128);
  });

  it('round-trips JSON', () => {
    const j = b.toJSON();
    const b2 = Beats.fromJSON(j);
    expect(b2.bpm).toBe(b.bpm);
    expect(b2.firstBeatFrame).toBe(b.firstBeatFrame);
  });
});

/** Build a synthetic click track: a short percussive transient every beat. */
function clickTrack(bpm: number, seconds: number, sampleRate: number, firstBeatSec = 0): Float32Array {
  const frames = Math.floor(seconds * sampleRate);
  const a = new Float32Array(frames);
  const framesPerBeat = (60 / bpm) * sampleRate;
  const first = firstBeatSec * sampleRate;
  for (let beat = 0; ; beat++) {
    const pos = Math.round(first + beat * framesPerBeat);
    if (pos >= frames) break;
    // a 5ms decaying click
    const clickLen = Math.round(0.005 * sampleRate);
    for (let i = 0; i < clickLen && pos + i < frames; i++) {
      const env = 1 - i / clickLen;
      a[pos + i] = Math.sin((i / sampleRate) * 2 * Math.PI * 2000) * env;
    }
  }
  return a;
}

describe('detectBeats', () => {
  it('detects the BPM of a 120bpm click track within tolerance', () => {
    const sr = 48000;
    const track = clickTrack(120, 12, sr);
    const r = detectBeats([track], track.length, sr);
    // Allow octave-corrected result near 120 (±2 bpm for envelope quantization).
    expect(Math.abs(r.bpm - 120)).toBeLessThan(2.5);
  });

  it('detects 128bpm too', () => {
    const sr = 48000;
    const track = clickTrack(128, 12, sr);
    const r = detectBeats([track], track.length, sr);
    expect(Math.abs(r.bpm - 128)).toBeLessThan(2.5);
  });

  it('finds a plausible first-beat phase (near a real beat)', () => {
    const sr = 48000;
    const firstBeatSec = 0.25;
    const track = clickTrack(120, 12, sr, firstBeatSec);
    const r = detectBeats([track], track.length, sr);
    const beats = new Beats(r.bpm, r.firstBeatFrame, sr);
    // The detected grid should land a beat near the true first beat (within ~30ms).
    const trueFirst = firstBeatSec * sr;
    const nearest = beats.nearestBeat(trueFirst);
    expect(Math.abs(nearest - trueFirst)).toBeLessThan(0.03 * sr);
  });

  it('returns a confidence value', () => {
    const sr = 48000;
    const track = clickTrack(120, 8, sr);
    const r = detectBeats([track], track.length, sr);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });
});
