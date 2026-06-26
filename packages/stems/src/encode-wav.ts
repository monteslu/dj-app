/**
 * Float32 stereo → 16-bit PCM WAV. The intermediate the stems take on the way to
 * AAC (the muxer wants pre-encoded AAC; we PCM-WAV → ffmpeg-wasm → AAC). Ported
 * from loukai creatorAudio.encodeWav.
 */
export function encodeWav(left: Float32Array, right: Float32Array, sampleRate = 44100): Blob {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4); // 16-bit stereo
  const v = new DataView(buf);
  const ws = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ws(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 2, true); // stereo
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true); // byte rate
  v.setUint16(32, 4, true); // block align
  v.setUint16(34, 16, true); // bits
  ws(36, 'data');
  v.setUint32(40, n * 4, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i] ?? 0));
    const r = Math.max(-1, Math.min(1, right[i] ?? 0));
    v.setInt16(off, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    v.setInt16(off + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    off += 4;
  }
  return new Blob([buf], { type: 'audio/wav' });
}
