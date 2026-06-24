import { describe, it, expect } from 'vitest';
import { WasmResampler } from './resampler.js';

/** Reference JS implementation (the loop we're replacing) for parity checks. */
function jsResample(
  srcL: Float32Array,
  srcR: Float32Array,
  frames: number,
  numFrames: number,
  position: number,
  ratio: number,
): { outL: Float32Array; outR: Float32Array; newPos: number; produced: number } {
  const outL = new Float32Array(numFrames);
  const outR = new Float32Array(numFrames);
  let produced = 0;
  let pos = position;
  for (let i = 0; i < numFrames; i++) {
    if (pos < 0 || pos >= frames) {
      pos = pos < 0 ? 0 : frames;
      break;
    }
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const i1 = i0 + 1 < frames ? i0 + 1 : i0;
    outL[i] = srcL[i0]! + (srcL[i1]! - srcL[i0]!) * frac;
    outR[i] = srcR[i0]! + (srcR[i1]! - srcR[i0]!) * frac;
    pos += ratio;
    produced++;
  }
  return { outL, outR, newPos: pos, produced };
}

function ramp(n: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.sin(i / 7) * 0.9;
  return a;
}

describe('WasmResampler', () => {
  it('matches the JS reference at unity rate', () => {
    const r = new WasmResampler();
    const N = 1000;
    const src = ramp(N);
    r.setSource(src, src, N);
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);
    const res = r.pull(outL, outR, 128, {
      position: 0,
      ratio: 1,
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 0,
      seamFade: 64,
    });
    const ref = jsResample(src, src, N, 128, 0, 1);
    for (let i = 0; i < 128; i++) {
      expect(outL[i]!).toBeCloseTo(ref.outL[i]!, 5);
    }
    expect(res.newPosition).toBeCloseTo(ref.newPos, 5);
    expect(res.produced).toBe(ref.produced);
  });

  it('matches the JS reference at fractional rate (interpolation)', () => {
    const r = new WasmResampler();
    const N = 2000;
    const src = ramp(N);
    r.setSource(src, src, N);
    const outL = new Float32Array(256);
    const outR = new Float32Array(256);
    const ratio = 1.0473;
    const res = r.pull(outL, outR, 256, {
      position: 13.7,
      ratio,
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 0,
      seamFade: 64,
    });
    const ref = jsResample(src, src, N, 256, 13.7, ratio);
    for (let i = 0; i < 256; i++) {
      expect(outL[i]!).toBeCloseTo(ref.outL[i]!, 4);
    }
    expect(res.newPosition).toBeCloseTo(ref.newPos, 3);
  });

  it('produces fewer frames + zeros the tail at end-of-track', () => {
    const r = new WasmResampler();
    const N = 100;
    const src = ramp(N);
    r.setSource(src, src, N);
    const outL = new Float32Array(256);
    const outR = new Float32Array(256);
    const res = r.pull(outL, outR, 256, {
      position: 0,
      ratio: 1,
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 0,
      seamFade: 64,
    });
    expect(res.produced).toBe(100);
    // tail is zeroed
    expect(outL[150]).toBe(0);
  });

  it('wraps a loop and keeps playing inside the bounds', () => {
    const r = new WasmResampler();
    const N = 5000;
    const src = ramp(N);
    r.setSource(src, src, N);
    const outL = new Float32Array(256);
    const outR = new Float32Array(256);
    const res = r.pull(outL, outR, 256, {
      position: 990,
      ratio: 1,
      loopEnabled: true,
      loopStart: 500,
      loopEnd: 1000,
      seamFade: 64,
    });
    // After crossing 1000 it wraps back toward 500 → still well inside [500,1000)
    expect(res.newPosition).toBeGreaterThanOrEqual(500);
    expect(res.newPosition).toBeLessThan(1000);
  });

  it('handles silence before a source is set', () => {
    const r = new WasmResampler();
    const outL = new Float32Array(64);
    const outR = new Float32Array(64);
    const res = r.pull(outL, outR, 64, {
      position: 0,
      ratio: 1,
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 0,
      seamFade: 64,
    });
    expect(res.produced).toBe(0);
    expect(outL[0]).toBe(0);
  });
});
