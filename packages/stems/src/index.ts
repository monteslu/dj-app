/**
 * @dj/stems — generate a NI-Stems .stem.mp4 from stereo audio, fully in the browser.
 *
 * Pipeline (the headline differentiator — we GENERATE stems, Mixxx only plays them):
 *   stereo PCM
 *     → separateStems()  WebGPU Demucs → { drums, bass, other, vocals }
 *     → encodeWav() per stem + the original mix
 *     → encodeWavToAac() per stem (ffmpeg-wasm worker)
 *     → StemMp4Writer.write()  → .stem.mp4 (mixdown + 4 stems + NI-Stems metadata)
 *
 * The result is a self-contained file with 4 independently-addressable stems for
 * live mashups (vocals of one track over another's instrumental). Renderer-only;
 * requires WebGPU + the same-origin /webgpu-assets server.
 */

import { StemMp4Writer, STEM_NAMES, type StemName } from '@dj/stem-mp4';
import { separateStems, detectWebGpu, type SeparateOpts, type SeparatedStems } from './separate.js';
import { encodeWav } from './encode-wav.js';
import { encodeWavToAac, FFMPEG_AAC_ENCODER_DELAY, disposeAacEncoder } from './aac-encoder.js';

export { separateStems, detectWebGpu, encodeWav, encodeWavToAac, disposeAacEncoder };
export type { SeparatedStems, StemName };

export interface GenerateProgress {
  /** Coarse stage label. */
  phase: 'separating' | 'encoding' | 'muxing' | 'done';
  /** Overall 0..1. */
  progress: number;
  log?: string;
}

export interface GenerateOpts {
  model?: SeparateOpts['model'];
  assetBase?: string;
  /** Track tags written into the .stem.mp4. */
  metadata?: { title?: string; artist?: string; album?: string; bpm?: number; key?: string };
  onProgress?: (p: GenerateProgress) => void;
}

// Separation is the long pole; encode/mux are quick. Map to an overall bar.
const SEPARATE_SHARE = 0.85;

/**
 * Generate a .stem.mp4 (bytes) from stereo audio. The 4 stems are tagged with
 * NI-Stems metadata so they stay individually controllable on playback.
 */
export async function generateStems(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  opts: GenerateOpts = {},
): Promise<Uint8Array> {
  const emit = (p: GenerateProgress) => opts.onProgress?.(p);
  const log = (msg: string) => emit({ phase: 'separating', progress: 0, log: msg });

  // 1) WebGPU separation (drums/bass/other/vocals).
  emit({ phase: 'separating', progress: 0.02, log: 'starting separation' });
  const stems: SeparatedStems = await separateStems(left, right, {
    model: opts.model,
    assetBase: opts.assetBase,
    onLog: log,
    onProgress: (per) => {
      // average the per-stem fractions into the separation share of the bar
      const vals = STEM_NAMES.map((s) => per[s] ?? 0);
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      emit({ phase: 'separating', progress: avg * SEPARATE_SHARE });
    },
  });

  // 2) Encode the mix + each stem: Float32 → WAV → AAC-in-MP4.
  emit({ phase: 'encoding', progress: SEPARATE_SHARE, log: 'encoding stems to AAC' });
  const mixdownAac = await encodeWavToAac(encodeWav(left, right, sampleRate));
  const stemsAac: Record<string, Uint8Array> = {};
  for (let i = 0; i < STEM_NAMES.length; i++) {
    const name = STEM_NAMES[i]!;
    const s = stems[name];
    stemsAac[name] = await encodeWavToAac(encodeWav(s.left, s.right, sampleRate));
    emit({
      phase: 'encoding',
      progress: SEPARATE_SHARE + ((i + 1) / STEM_NAMES.length) * (0.97 - SEPARATE_SHARE),
    });
  }

  // 3) Mux the NI-Stems .stem.mp4 (mixdown enabled; 4 stems addressable).
  emit({ phase: 'muxing', progress: 0.98, log: 'muxing .stem.mp4' });
  const res = await StemMp4Writer.write({
    mixdownAac,
    stemsAac,
    profile: 'STEMS-4',
    encoderDelaySamples: FFMPEG_AAC_ENCODER_DELAY,
    sampleRate,
    metadata: opts.metadata,
  });

  emit({ phase: 'done', progress: 1, log: 'stems ready' });
  return res.data;
}
