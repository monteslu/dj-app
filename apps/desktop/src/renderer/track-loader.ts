/**
 * Shared track-load pipeline. Both the Deck (drop / file-picker) and the Library
 * (load-to-deck) used to duplicate this whole decode → peaks → engine → analysis
 * flow inline, which also forced a `window` CustomEvent to shuttle peaks between
 * them. This is the single source of truth: decode the audio, compute the
 * waveform peaks, push the track into the engine, write metadata to the shared
 * deck-state store, fetch cover art, and (if needed) analyze + persist.
 *
 * Pure logic, no React.
 */

import { decodeArrayBuffer, analysisFromDecoded } from '@dj/codec';
import { detailBucketsForDuration, packPeaks, type PeakData } from '@dj/waveform';
import { deck as deckGroup, DeckKeys, type ControlBus } from '@dj/control-bus';
import { camelotToKey, shortestStepsToCompatibleKey } from '@dj/analysis';
import type { Engine } from '@dj/audio-engine';
import { extractAllTracks } from '@dj/stem-mp4';
import type { AnalysisService } from './analysis-service.js';
import { setDeckTrack } from './deck-state.js';

// Load-time waveform peaks run IN THE ANALYSIS WORKER (off the main thread). The band-
// split filtering (Bessel-4 low/mid/high) is heavy — a stem song needs it 6× (mixdown +
// 4 stems) and doing it synchronously froze the UI for ~600-850ms (a multi-frame jank).
// We downmix each track to a fresh mono buffer and hand it to the pool; the 6 passes fan
// out across workers and the main thread never blocks. Returns the full band PeakSet.
function downmixMono(channels: Float32Array[], frames: number): ArrayBuffer {
  const left = channels[0]!;
  const right = channels.length > 1 ? channels[1]! : left;
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = 0.5 * (left[i]! + right[i]!);
  return mono.buffer;
}
function peaksInWorker(
  analysis: AnalysisService,
  channels: Float32Array[],
  frames: number,
  detailBuckets: number,
  sampleRate: number,
): Promise<{ detail: PeakData; overview: PeakData }> {
  return analysis.computePeaks(downmixMono(channels, frames), frames, sampleRate, detailBuckets);
}

export interface TrackLoaderDeps {
  engine: Engine;
  bus: ControlBus;
  analysis: AnalysisService;
}

/** Where the audio bytes come from + the metadata we already know. */
export interface LoadSource {
  /** Raw file bytes + name (decode input). isStem = a NI-Stems .stem.mp4. meta =
   *  stored library analysis (key/bpm) the deck shows immediately. */
  file: {
    name: string;
    data: ArrayBuffer;
    path?: string;
    isStem?: boolean;
    meta?: { title?: string; artist?: string; album?: string; key?: string; bpm?: number };
  };
  /** Known metadata (from the library DB), if any. */
  meta?: {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    key?: string | null;
    bpm?: number;
    /** Stored grid phase (frame of beat 1). Threaded so a known-BPM track gets the
     *  RIGHT grid phase (not frame-0) without re-analysis — needed for sync/smart-fader. */
    firstBeatFrame?: number;
  };
  /** Filesystem path for cover-art extraction (file.path or library location). */
  coverPath?: string;
  /** Library track id, for persisting analysis + incrementing play count. */
  libraryId?: number;
}

const NUM_DECKS = 2;

/**
 * Auto key-match on load (opt-in, app setting 'autoMatchKey'). If enabled and the OTHER
 * deck has a detected key, shift THIS deck into a harmonically compatible key — the
 * key-equivalent of pressing "match" automatically, like sync does for tempo. Only
 * applies a non-zero shift; a 0 (already compatible) leaves the deck at original key.
 */
async function maybeAutoMatchKey(bus: ControlBus, deckIndex: number, thisKey: number): Promise<void> {
  if (!thisKey) return;
  let on: boolean;
  try {
    on = (await window.dj.settingsGet('autoMatchKey')) === '1';
  } catch {
    return;
  }
  if (!on) return;
  const otherIndex = deckIndex === 0 ? 1 : 0;
  if (otherIndex >= NUM_DECKS) return;
  const otherKey = bus.get(deckGroup(otherIndex + 1), DeckKeys.fileKeyNum);
  if (!otherKey) return; // other deck has no known key → nothing to match to
  const shift = shortestStepsToCompatibleKey(thisKey, otherKey);
  if (shift !== 0) bus.set(deckGroup(deckIndex + 1), DeckKeys.pitch, shift);
}

/**
 * Run the full load pipeline for a deck. Returns once the track is in the engine
 * + metadata/peaks are on the deck store; cover art + analysis continue in the
 * background.
 */
export async function loadTrackToDeck(
  deps: TrackLoaderDeps,
  deckIndex: number,
  src: LoadSource,
): Promise<void> {
  const { engine, bus, analysis } = deps;
  const ctx = engine.audioContext;
  if (!ctx) return; // engine not started

  // Mark the deck as loading so the UI shows a spinner; cleared after engine.loadTrack.
  const lg = deckGroup(deckIndex + 1);
  bus.set(lg, DeckKeys.loading, 1);
  const t0 = performance.now();
  const sizeMB = src.file.data.byteLength / 1048576;

  // Stem deck: a .stem.mp4 holds the mixdown + 4 separable stems. Decode the 4 stems
  // and load them as a stem deck (independent per-stem gain → live mashups).
  if (src.file.isStem) {
    const loaded = await loadStemFile(deps, deckIndex, src);
    if (loaded) {
      bus.set(lg, DeckKeys.loading, 0);
      return;
    }
    // If stem extraction failed, fall through to play it as a normal mixed track.
  }

  const decoded = await decodeArrayBuffer(ctx, src.file.data, src.file.name);
  const tDecodeDone = performance.now();

  // planar channels → peak set
  const all = new Float32Array(decoded.sampleBuffer);
  const channels: Float32Array[] = [];
  for (let c = 0; c < decoded.channels; c++) {
    channels.push(all.subarray(c * decoded.frames, (c + 1) * decoded.frames));
  }
  const dur = decoded.frames / decoded.sampleRate;
  const peaks = await peaksInWorker(
    analysis,
    channels,
    decoded.frames,
    detailBucketsForDuration(dur),
    decoded.sampleRate,
  );
  const tPeaksDone = performance.now();

  // Merge stored library metadata (from readTrackById) under any explicit meta the
  // caller passed — so EVERY load path (library double-click, drag-drop, deck button)
  // gets the key/bpm without a separate lookup or a needless re-analysis.
  const m = { ...(src.file.meta ?? {}), ...(src.meta ?? {}) };
  const title = m.title ?? src.file.name.replace(/\.[^.]+$/, '');
  setDeckTrack(deckIndex, {
    peaks,
    stemPeaks: null, // a normal track clears any prior stem-deck coloring
    stemOverviewPeaks: null,
    stemScales: null,
    downbeatFrames: null, // cleared; loaded from DB below if analyzed
    title,
    artist: m.artist ?? null,
    album: m.album ?? null,
    key: m.key ?? null,
    coverUrl: null,
    libraryId: src.libraryId ?? null,
  });

  engine.loadTrack(deckIndex, decoded);
  const tEngineDone = performance.now();
  const g = deckGroup(deckIndex + 1);
  // The audible track is ready — clear the spinner + log where the load time went.
  bus.set(g, DeckKeys.loading, 0);
  console.log(
    `[load] deck ${deckIndex + 1} "${src.file.name}" ${sizeMB.toFixed(1)}MB ${dur.toFixed(0)}s ` +
      `in ${(tEngineDone - t0).toFixed(0)}ms — decode ${(tDecodeDone - t0).toFixed(0)}ms, ` +
      `peaks ${(tPeaksDone - tDecodeDone).toFixed(0)}ms, engine ${(tEngineDone - tPeaksDone).toFixed(0)}ms`,
  );
  if (m.bpm && m.bpm > 0) {
    bus.set(g, DeckKeys.fileBpm, m.bpm);
  }
  // Restore the stored grid phase so a known-BPM track aligns on the REAL beat-one, not
  // frame 0. Without this, sync/smart-fader snapped to a frame-0 grid (wrong phase).
  // -1 = unknown; the analysis branch below fills it in.
  if (m.firstBeatFrame != null && m.firstBeatFrame >= 0) {
    bus.set(g, DeckKeys.firstBeatFrame, m.firstBeatFrame);
  }
  // Publish the numeric key (for harmonic match) + reset any prior key shift.
  bus.set(g, DeckKeys.fileKeyNum, m.key ? camelotToKey(m.key) : 0);
  bus.set(g, DeckKeys.pitch, 0);
  // Auto key-match on load (opt-in): if enabled and the OTHER deck has a key, shift this
  // deck into a harmonically compatible key automatically (like sync, but for key).
  if (m.key) void maybeAutoMatchKey(bus, deckIndex, camelotToKey(m.key));
  if (src.libraryId != null) {
    void window.dj.libraryIncrementPlay(src.libraryId);
    // Load cached downbeats (real measures from DownBeat) if analyzed.
    void window.dj.libraryDownbeats(src.libraryId).then((blob) => {
      if (blob && blob.length >= 4) {
        const u = new Uint8Array(blob);
        setDeckTrack(deckIndex, {
          downbeatFrames: new Int32Array(u.buffer, u.byteOffset, u.byteLength >> 2),
        });
      }
    });
  }

  // cover art (background)
  if (src.coverPath) {
    void window.dj.trackCover(src.coverPath).then((cover) => {
      if (cover) {
        const url = URL.createObjectURL(new Blob([cover.data], { type: cover.mime }));
        setDeckTrack(deckIndex, { coverUrl: url });
      }
    });
  }

  // analyze if BPM/key unknown; cache results (background)
  if (!m.bpm || m.bpm <= 0 || !m.key) {
    void analysis.analyze(analysisFromDecoded(decoded)).then((r) => {
      if (r.bpm > 0) {
        bus.set(g, DeckKeys.fileBpm, r.bpm);
        bus.set(g, DeckKeys.firstBeatFrame, r.firstBeatFrame);
      }
      if (r.camelot) {
        setDeckTrack(deckIndex, { key: r.camelot });
        const kn = camelotToKey(r.camelot);
        bus.set(g, DeckKeys.fileKeyNum, kn);
        void maybeAutoMatchKey(bus, deckIndex, kn);
      }
      if (src.libraryId != null) {
        void window.dj.librarySetAnalysis(src.libraryId, {
          bpm: r.bpm,
          firstBeatFrame: r.firstBeatFrame,
          key: r.camelot,
          waveform: packPeaks(peaks.overview),
          analyzedAt: Date.now(),
        });
      }
    });
  }
}

/**
 * Load a .stem.mp4 as a stem deck: extract + decode its 4 stem tracks (drums/bass/other/
 * vocals); track 0 (the mixdown) is NOT decoded — we play the stems and derive the mix
 * waveform + BPM input by summing them. Hands the 4 stems to the engine for independent
 * mixing. Returns true on success, false to fall back to normal playback.
 */
async function loadStemFile(
  deps: TrackLoaderDeps,
  deckIndex: number,
  src: LoadSource,
): Promise<boolean> {
  const { engine, bus, analysis } = deps;
  const ctx = engine.audioContext;
  if (!ctx) return false;
  // The deck was already marked loading by loadTrackToDeck; we time the stem phases here.
  const t0 = performance.now();
  const sizeMB = src.file.data.byteLength / 1048576;
  try {
    const tracks = extractAllTracks(new Uint8Array(src.file.data));
    // STEMS-4 layout: [mixdown, drums, bass, other, vocals]. We DON'T decode track 0 (the
    // mixdown) — the 4 stems sum to it (NI Stems are gain-1 separations of the master), so
    // we derive the mix from the stems we already decode. Saves a whole decode + stream.
    if (tracks.length < 5) return false;
    const tDemux = performance.now();
    const stemBytes = tracks.slice(1, 5);

    // Decode the 4 stems in parallel → planar Float32.
    const stems = await Promise.all(
      stemBytes.map((b) => {
        const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        return decodeArrayBuffer(ctx, ab, 'stem.m4a');
      }),
    );
    const tDecode = performance.now();

    // Per-stem planar channels (sub-views of each decoded buffer).
    const stemChans = stems.map((s) => {
      const sAll = new Float32Array(s.sampleBuffer);
      const sCh: Float32Array[] = [];
      for (let c = 0; c < s.channels; c++) sCh.push(sAll.subarray(c * s.frames, (c + 1) * s.frames));
      return sCh;
    });

    // The "mixdown" = sum of the 4 stems. Build a stereo mix (sum each channel) for the
    // mix waveform + BPM analysis, instead of decoding the redundant mixdown track.
    const frames = Math.max(...stems.map((s) => s.frames));
    const sampleRate = stems[0]!.sampleRate;
    const mixL = new Float32Array(frames);
    const mixR = new Float32Array(frames);
    for (const sc of stemChans) {
      const l = sc[0]!;
      const r = sc[1] ?? sc[0]!;
      const n = Math.min(frames, l.length);
      for (let i = 0; i < n; i++) {
        mixL[i]! += l[i]!;
        mixR[i]! += r[i]!;
      }
    }
    const ch = [mixL, mixR];
    const dur = frames / sampleRate;
    const detailBuckets = detailBucketsForDuration(dur);

    // Mix + per-stem peaks, all computed IN THE WORKER POOL in parallel (fan out across
    // workers instead of blocking the main thread).
    const [peaks, ...stemSets] = await Promise.all([
      peaksInWorker(analysis, ch, frames, detailBuckets, sampleRate),
      ...stemChans.map((sCh, i) =>
        peaksInWorker(analysis, sCh, stems[i]!.frames, detailBuckets, stems[i]!.sampleRate),
      ),
    ]);
    const stemPeaks = stemSets.map((p) => p.detail);
    const stemOverviewPeaks = stemSets.map((p) => p.overview);
    // Normalize all stems by ONE shared max (the loudest stem), like Mixxx
    // (waveformrendererstem: height / m_maxValue with a single m_maxValue). The
    // loudest stem fills the lane; quieter stems stay proportionally shorter, so the
    // wave is honest about the real mix (drums dwarf a near-silent vocal, as they do
    // in the audio). Same scale for every stem.
    let sharedMax = 1;
    for (const p of stemPeaks) {
      for (let i = 0; i < p.peaks.length; i++) if (p.peaks[i]! > sharedMax) sharedMax = p.peaks[i]!;
    }
    const sharedScale = 255 / sharedMax;
    const stemScales = stemPeaks.map(() => sharedScale);
    const tPeaks = performance.now();

    const m = { ...(src.file.meta ?? {}), ...(src.meta ?? {}) };
    setDeckTrack(deckIndex, {
      peaks,
      stemPeaks,
      stemOverviewPeaks,
      stemScales,
      title: m.title ?? src.file.name.replace(/\.[^.]+$/, ''),
      artist: m.artist ?? null,
      album: m.album ?? null,
      key: m.key ?? null,
      coverUrl: null,
      libraryId: src.libraryId ?? null,
    });

    engine.loadStems(deckIndex, stems, { bpm: m.bpm });
    const g = deckGroup(deckIndex + 1);
    // Stem track is ready — clear the spinner + log where the load went. We decode only
    // the 4 stems (NOT the mixdown — we play + sum the stems), and peak the 4 stems + the
    // summed mix in the worker pool.
    bus.set(g, DeckKeys.loading, 0);
    console.log(
      `[load] deck ${deckIndex + 1} STEMS "${src.file.name}" ${sizeMB.toFixed(1)}MB ${dur.toFixed(0)}s ` +
        `in ${(performance.now() - t0).toFixed(0)}ms — demux ${(tDemux - t0).toFixed(0)}ms, ` +
        `decode(4) ${(tDecode - tDemux).toFixed(0)}ms, peaks(5) ${(tPeaks - tDecode).toFixed(0)}ms, ` +
        `engine ${(performance.now() - tPeaks).toFixed(0)}ms`,
    );
    if (m.bpm && m.bpm > 0) bus.set(g, DeckKeys.fileBpm, m.bpm);
    // Restore the stored grid phase (same fix as the normal path) so a stems deck snaps
    // to the REAL beat-one — without this, a stem deck used a frame-0 grid and never
    // beat-aligned against a non-stem deck under sync / smart fader.
    if (m.firstBeatFrame != null && m.firstBeatFrame >= 0) {
      bus.set(g, DeckKeys.firstBeatFrame, m.firstBeatFrame);
    }

    // Background BPM/grid analysis if unknown (bpm OR phase missing), so sync/smart-fader
    // work even for an unanalyzed stem file. Analyze the SUMMED stems (= the mix) — no
    // mixdown decode needed; we already have the stems.
    if (!m.bpm || m.bpm <= 0 || m.firstBeatFrame == null || m.firstBeatFrame < 0) {
      void analysis.analyze({ mono: downmixMono(ch, frames), frames, sampleRate }).then((r) => {
        if (r.bpm > 0) {
          bus.set(g, DeckKeys.fileBpm, r.bpm);
          bus.set(g, DeckKeys.firstBeatFrame, r.firstBeatFrame);
          if (src.libraryId != null) {
            void window.dj.librarySetAnalysis(src.libraryId, {
              bpm: r.bpm,
              firstBeatFrame: r.firstBeatFrame,
            });
          }
        }
      });
    }
    return true;
  } catch (e) {
    console.error('[stems] failed to load stem file, falling back to mixed playback', e);
    return false;
  }
}
