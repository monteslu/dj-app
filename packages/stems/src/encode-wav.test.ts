import { describe, it, expect } from 'vitest';
import { encodeWav } from './encode-wav.js';

describe('encodeWav', () => {
  it('writes a valid 16-bit stereo PCM WAV header', async () => {
    const n = 100;
    const left = new Float32Array(n).fill(0.5);
    const right = new Float32Array(n).fill(-0.5);
    const blob = encodeWav(left, right, 44100);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    const str = (off: number, len: number) =>
      String.fromCharCode(...buf.subarray(off, off + len));

    expect(str(0, 4)).toBe('RIFF');
    expect(str(8, 4)).toBe('WAVE');
    expect(str(12, 4)).toBe('fmt ');
    expect(dv.getUint16(20, true)).toBe(1); // PCM
    expect(dv.getUint16(22, true)).toBe(2); // stereo
    expect(dv.getUint32(24, true)).toBe(44100);
    expect(dv.getUint16(34, true)).toBe(16); // bits
    expect(str(36, 4)).toBe('data');
    // header (44) + n frames * 4 bytes (16-bit stereo)
    expect(buf.byteLength).toBe(44 + n * 4);
    expect(dv.getUint32(40, true)).toBe(n * 4);
  });

  it('clamps out-of-range samples to [-1, 1]', async () => {
    const left = new Float32Array([2.0]); // over-range → max positive
    const right = new Float32Array([-2.0]); // under-range → max negative
    const buf = new Uint8Array(await encodeWav(left, right, 48000).arrayBuffer());
    const dv = new DataView(buf.buffer);
    expect(dv.getInt16(44, true)).toBe(0x7fff);
    expect(dv.getInt16(46, true)).toBe(-0x8000);
  });
});
