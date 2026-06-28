/**
 * Message protocol for the analysis Worker. The sample data is passed as a
 * SharedArrayBuffer (planar Float32) so no copy is needed — the same buffer the
 * deck already holds (05-library-and-data.md §6).
 */

export interface AnalyzeRequest {
  type: 'analyze';
  /** Correlation id so the caller can match the response. */
  id: number;
  /** MONO Float32 samples in a plain ArrayBuffer, TRANSFERRED to the worker (so the
   *  main thread frees it immediately — no lingering SharedArrayBuffers). */
  mono: ArrayBuffer;
  frames: number;
  sampleRate: number;
  /** If set, also compute the waveform peak set in the worker (off main thread). */
  computePeaks?: boolean;
  /** Detail bucket count for the peak set (overview count is fixed). */
  detailBuckets?: number;
}

/** Peaks-only request: compute the full band PeakSet for ONE track off the main thread
 *  (no beat/key analysis). Used by the load path so the heavy band-split filtering never
 *  blocks the UI. mono samples are TRANSFERRED in. */
export interface PeaksRequest {
  type: 'peaks';
  id: number;
  mono: ArrayBuffer;
  frames: number;
  sampleRate: number;
  detailBuckets: number;
}

/** Full band peaks for one track (detail + overview), returned as transferables. */
export interface PeaksResponse {
  type: 'peaks';
  id: number;
  detailLength: number;
  detailPeaks: Uint8Array;
  detailLow: Uint8Array;
  detailMid: Uint8Array;
  detailHigh: Uint8Array;
  detailFramesPerBucket: number;
  overviewLength: number;
  overviewPeaks: Uint8Array;
  overviewLow: Uint8Array;
  overviewMid: Uint8Array;
  overviewHigh: Uint8Array;
  overviewFramesPerBucket: number;
}

export interface AnalyzeResponse {
  type: 'analyzed';
  id: number;
  bpm: number;
  firstBeatFrame: number;
  confidence: number;
  /** Musical key, e.g. "Am" (or '' if not detected). */
  key: string;
  /** Camelot code, e.g. "8A". */
  camelot: string;
  /** Numeric key index 1..24 (0 = none) for Camelot harmonic-match math. */
  keyNum?: number;
  /** Bar-start beats (downbeats), in source frames — real measures from DownBeat. */
  downbeatFrames?: Int32Array;
  /** Overview peaks (Uint8 per bucket), if computePeaks was requested. */
  overviewPeaks?: Uint8Array;
  /** Overview band peaks (low/mid/high) for frequency coloring. */
  overviewLow?: Uint8Array;
  overviewMid?: Uint8Array;
  overviewHigh?: Uint8Array;
  /** Detail peaks, if computePeaks was requested. */
  detailPeaks?: Uint8Array;
  detailFramesPerBucket?: number;
}
