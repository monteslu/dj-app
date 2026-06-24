/**
 * WAV encoding (05-library-and-data.md §5: WAV/AIFF are trivial — header + PCM,
 * the cheapest "render mix to file" path, no ffmpeg needed). Pure functions.
 *
 * Writes 16-bit or 32-bit-float PCM. Used by the recorder (the master-bus tap →
 * Worker → WAV). MP3/FLAC/Ogg go through ffmpeg-wasm later; WAV is the default,
 * matching Mixxx.
 */

export type WavBitDepth = 16 | 32; // 16 = PCM int, 32 = IEEE float

/**
 * Encode interleaved Float32 stereo (or N-channel) samples into a WAV file
 * (ArrayBuffer). `samples` is interleaved [L0,R0,L1,R1,...].
 */
export function encodeWav(
  samples: Float32Array,
  channels: number,
  sampleRate: number,
  bitDepth: WavBitDepth = 16,
): ArrayBuffer {
  const bytesPerSample = bitDepth === 16 ? 2 : 4;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
  };

  // RIFF header
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  // fmt chunk
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, bitDepth === 16 ? 1 : 3, true); // 1=PCM, 3=IEEE float
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  // data chunk
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  if (bitDepth === 16) {
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]!));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  } else {
    for (let i = 0; i < samples.length; i++) {
      view.setFloat32(offset, samples[i]!, true);
      offset += 4;
    }
  }
  return buffer;
}

/** Interleave planar channel buffers into one Float32Array. */
export function interleave(channels: Float32Array[], frames: number): Float32Array {
  const n = channels.length;
  if (n === 1) {
    return channels[0]!.subarray(0, frames);
  }
  const out = new Float32Array(frames * n);
  for (let c = 0; c < n; c++) {
    const ch = channels[c]!;
    for (let i = 0; i < frames; i++) {
      out[i * n + c] = ch[i]!;
    }
  }
  return out;
}

/** Concatenate Float32 chunks into one buffer (the recorder accumulator). */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) {
    total += c.length;
  }
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
