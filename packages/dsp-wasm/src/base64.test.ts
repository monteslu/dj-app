import { describe, it, expect } from 'vitest';
import { base64ToBytes } from './base64.js';

// This decoder is what loads the embedded WASM INSIDE the AudioWorklet (which has
// no atob and no Buffer). A bug here = the audio engine never loads = no playback.
// So: verify it against Node's own base64 decode across many inputs.

// Node's Buffer is the test ORACLE (the shipping code is globals-free; this only
// runs under vitest/Node). Declared locally so the package's tsconfig stays free
// of @types/node — @types/node 26 no longer leaks Buffer as an ambient global.
declare const Buffer: {
  from(s: string, enc: string): Uint8Array;
  from(a: Uint8Array): { toString(enc: string): string };
};

function ref(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

describe('base64ToBytes (globals-free, worklet-safe)', () => {
  it('decodes simple known strings', () => {
    // "Man" → "TWFu", "M" → "TQ==", "Ma" → "TWE="
    expect([...base64ToBytes('TWFu')]).toEqual([...ref('TWFu')]);
    expect([...base64ToBytes('TQ==')]).toEqual([...ref('TQ==')]);
    expect([...base64ToBytes('TWE=')]).toEqual([...ref('TWE=')]);
  });

  it('decodes the WASM magic header (\\0asm)', () => {
    // a real wasm module starts with bytes 00 61 73 6d 01 00 00 00
    const b64 = Buffer.from(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])).toString('base64');
    expect([...base64ToBytes(b64)]).toEqual([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  });

  it('matches Node base64 for random byte arrays of every length mod 3', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256);
    for (let len = 0; len < 200; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = rnd();
      const b64 = Buffer.from(bytes).toString('base64');
      expect([...base64ToBytes(b64)]).toEqual([...bytes]);
    }
  });

  it('tolerates embedded newlines/whitespace', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const b64 = Buffer.from(bytes).toString('base64');
    const withWs = b64.slice(0, 4) + '\n' + b64.slice(4, 8) + ' ' + b64.slice(8);
    expect([...base64ToBytes(withWs)]).toEqual([...bytes]);
  });

  it('produces output the size WASM expects (exact length)', () => {
    for (const len of [1, 2, 3, 100, 1000, 4096]) {
      const bytes = new Uint8Array(len);
      const b64 = Buffer.from(bytes).toString('base64');
      expect(base64ToBytes(b64).length).toBe(len);
    }
  });
});
