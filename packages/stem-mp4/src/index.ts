/**
 * @dj/stem-mp4 — NI-Stems .stem.mp4 read/write.
 *
 * A .stem.mp4 holds the original mix plus 4 separated stems (drums, bass, other,
 * vocals) as independent AAC audio tracks, tagged with NI-Stems metadata so DJ
 * software (and our stem decks) can address each stem. We GENERATE these with the
 * WebGPU Demucs pipeline (@dj/stems) and PLAY them back as independent stem decks.
 *
 * The container muxing/demuxing is the proven pure-JS upstream `stem-mp4` package,
 * vendored under ./vendor (browser + Node safe). This module is the typed surface.
 */

// The vendored JS has no types; we re-type the surface we use here.
import writerMod from './vendor/writer.js';
import * as extractorMod from './vendor/extractor.js';

export interface StemMp4WriteOpts {
  /** Pre-encoded single-track AAC (.m4a) bytes per stem (keys: drums/bass/other/vocals). */
  stemsAac: Record<string, Uint8Array | ArrayBuffer>;
  /** Pre-encoded AAC (.m4a) of the original mix. */
  mixdownAac: Uint8Array | ArrayBuffer;
  lyricsData?: { lines?: unknown[]; singers?: unknown[] };
  metadata?: {
    title?: string;
    artist?: string;
    album?: string;
    year?: number | string;
    genre?: string;
    tempo?: number;
    bpm?: number;
    key?: string;
    track?: number;
  };
  analysisFeatures?: unknown;
  profile?: 'STEMS-4' | 'STEMS-2';
  encoderDelaySamples?: number;
  sampleRate?: number;
  /** Node only — write to this path. Bytes are also returned as `data`. */
  outputPath?: string;
}
export interface StemMp4WriteResult {
  success: boolean;
  data: Uint8Array;
  outputFile?: string;
  fileSizeBytes: number;
  profile: string;
  encoderDelaySamples: number;
  sampleRate: number;
}

interface StemMp4WriterStatic {
  write(opts: StemMp4WriteOpts): Promise<StemMp4WriteResult>;
}

/** Write a NI-Stems .stem.mp4 from pre-encoded AAC tracks (mixdown + 4 stems). */
export const StemMp4Writer = writerMod as unknown as StemMp4WriterStatic;

/** Extract every audio track from a .stem.mp4 as a standalone playable M4A. */
export const extractAllTracks = extractorMod.extractAllTracks as (
  data: Uint8Array | ArrayBuffer,
) => Uint8Array[];
/** Extract one track (0-based) as a standalone playable M4A. */
export const extractTrack = extractorMod.extractTrack as (
  data: Uint8Array | ArrayBuffer,
  trackIndex: number,
) => Uint8Array;
export const getTrackCount = extractorMod.getTrackCount as (
  data: Uint8Array | ArrayBuffer,
) => number;
export const getTrackInfo = extractorMod.getTrackInfo as (
  data: Uint8Array | ArrayBuffer,
) => Array<{ index: number; sampleCount: number; duration: number }>;

/** The 4 Demucs stems, in NI-Stems track order. */
export const STEM_NAMES = ['drums', 'bass', 'other', 'vocals'] as const;
export type StemName = (typeof STEM_NAMES)[number];

/**
 * Track layout inside a STEMS-4 .stem.mp4 (the order muxTracks writes):
 * index 0 = mixdown (original mix), 1..4 = drums/bass/other/vocals.
 */
export const STEM_TRACK_ORDER = ['mixdown', ...STEM_NAMES] as const;
