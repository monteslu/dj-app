/**
 * WAV → AAC-in-MP4 encoder. The stem-mp4 muxer wants PRE-ENCODED single-track AAC
 * (.m4a) per stem, so we encode each PCM stem here. ffmpeg-core's exec() is a
 * BLOCKING wasm call, so it runs in a Web Worker (vendor/aacWorker.js) driven over
 * rawr (JSON-RPC). ffmpeg-core itself loads at runtime from /webgpu-assets/. Ported
 * from loukai aacEncoder.
 *
 * Renderer-only (Worker + same-origin asset server).
 */

import rawr from 'rawr';
// rawr's worker transport ships as untyped JS.
import { dom as domTransport } from 'rawr/transports/worker';

interface RawrPeer {
  methods: { encode: (bytes: Uint8Array, bitrate: number) => Promise<Uint8Array> };
}

let peer: RawrPeer | null = null;
let worker: Worker | null = null;

function getPeer(): RawrPeer {
  if (peer) return peer;
  // The worker is a same-origin module worker bundled by Vite from this package.
  worker = new Worker(new URL('./vendor/aacWorker.js', import.meta.url), { type: 'module' });
  // Generous timeout: the first call also fetches + instantiates the ~32MB core.
  peer = rawr({ transport: domTransport(worker), timeout: 120000 }) as unknown as RawrPeer;
  return peer;
}

/**
 * Encode a WAV (PCM) input to a single-track AAC-in-MP4 (.m4a) Uint8Array.
 */
export async function encodeWavToAac(
  wav: Blob | Uint8Array | ArrayBuffer,
  bitrate = 192000,
): Promise<Uint8Array> {
  let bytes: Uint8Array;
  if (wav instanceof Uint8Array) bytes = wav;
  else if (wav instanceof ArrayBuffer) bytes = new Uint8Array(wav);
  else bytes = new Uint8Array(await wav.arrayBuffer());

  const result = await getPeer().methods.encode(bytes, bitrate);
  return result instanceof Uint8Array ? result : new Uint8Array(result);
}

/** Tear down the encode worker. */
export function disposeAacEncoder(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    peer = null;
  }
}

/** ffmpeg's native aac encoder priming delay (samples). Passed to the muxer. */
export const FFMPEG_AAC_ENCODER_DELAY = 1024;
