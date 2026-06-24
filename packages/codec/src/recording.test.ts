import { describe, it, expect } from 'vitest';
import { encodeWav, interleave, concatFloat32 } from './wav.js';
import { allocateRing, ringWrite, ringRead, ringDropped } from './sab-ring.js';

describe('encodeWav', () => {
  it('writes a valid 16-bit WAV header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0]); // 3 stereo frames
    const buf = encodeWav(samples, 2, 48000, 16);
    const view = new DataView(buf);
    const str = (o: number, n: number) =>
      String.fromCharCode(...new Uint8Array(buf, o, n));
    expect(str(0, 4)).toBe('RIFF');
    expect(str(8, 4)).toBe('WAVE');
    expect(str(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(48000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bit depth
    expect(str(36, 4)).toBe('data');
    // data size = 6 samples × 2 bytes
    expect(view.getUint32(40, true)).toBe(12);
    expect(buf.byteLength).toBe(44 + 12);
  });

  it('clamps and quantizes 16-bit samples', () => {
    const buf = encodeWav(new Float32Array([1, -1]), 1, 48000, 16);
    const view = new DataView(buf);
    expect(view.getInt16(44, true)).toBe(0x7fff); // +1 → max
    expect(view.getInt16(46, true)).toBe(-0x8000); // -1 → min
  });

  it('writes 32-bit float WAV (format tag 3)', () => {
    const buf = encodeWav(new Float32Array([0.25]), 1, 44100, 32);
    const view = new DataView(buf);
    expect(view.getUint16(20, true)).toBe(3); // IEEE float
    expect(view.getFloat32(44, true)).toBeCloseTo(0.25);
  });
});

describe('interleave / concat', () => {
  it('interleaves planar stereo', () => {
    const l = new Float32Array([1, 2, 3]);
    const r = new Float32Array([4, 5, 6]);
    expect([...interleave([l, r], 3)]).toEqual([1, 4, 2, 5, 3, 6]);
  });

  it('passes mono through', () => {
    const m = new Float32Array([1, 2]);
    expect([...interleave([m], 2)]).toEqual([1, 2]);
  });

  it('concatenates chunks', () => {
    const out = concatFloat32([new Float32Array([1, 2]), new Float32Array([3])]);
    expect([...out]).toEqual([1, 2, 3]);
  });
});

describe('SabRing (lock-free recorder ring)', () => {
  it('writes and reads samples in order', () => {
    const { views } = allocateRing(16);
    ringWrite(views, new Float32Array([1, 2, 3, 4]), 4);
    const out = new Float32Array(4);
    expect(ringRead(views, out)).toBe(4);
    expect([...out]).toEqual([1, 2, 3, 4]);
  });

  it('rounds capacity up to a power of two', () => {
    const { views } = allocateRing(10);
    expect(views.capacity).toBe(16);
  });

  it('wraps around the ring', () => {
    const { views } = allocateRing(4); // cap 4
    ringWrite(views, new Float32Array([1, 2, 3]), 3);
    const o1 = new Float32Array(3);
    ringRead(views, o1); // read 3, read index now 3
    ringWrite(views, new Float32Array([4, 5, 6]), 3); // wraps
    const o2 = new Float32Array(3);
    expect(ringRead(views, o2)).toBe(3);
    expect([...o2]).toEqual([4, 5, 6]);
  });

  it('drops + counts on overflow rather than blocking', () => {
    const { views } = allocateRing(4);
    ringWrite(views, new Float32Array([1, 2, 3, 4]), 4); // fills it
    ringWrite(views, new Float32Array([5, 6]), 2); // no room → dropped
    expect(ringDropped(views)).toBe(2);
    // original data intact
    const out = new Float32Array(4);
    expect(ringRead(views, out)).toBe(4);
    expect([...out]).toEqual([1, 2, 3, 4]);
  });

  it('reads only what is available', () => {
    const { views } = allocateRing(16);
    ringWrite(views, new Float32Array([1, 2]), 2);
    const out = new Float32Array(8);
    expect(ringRead(views, out)).toBe(2);
  });
});
