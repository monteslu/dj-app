/**
 * Stem MP4 Writer (pure JS — no ffmpeg)
 *
 * Builds a multi-track Stem MP4 with karaoke extensions from PRE-ENCODED AAC tracks.
 * The caller is responsible for encoding the audio (WAV -> AAC) however it likes —
 * native ffmpeg on a server, ffmpeg-wasm in a browser, or any AAC encoder. This
 * library only does the container: mux (via muxTracks) + the karaoke/metadata atoms.
 *
 * Works in Node AND the browser. In Node you can pass an `outputPath` to write the
 * file; everywhere it also returns the muxed bytes (`data`) so a browser can offer
 * a download with no filesystem.
 */

import { muxTracks } from './muxer.js';
import * as Atoms from './atoms.js';

// Optional Node filesystem (only used when outputPath is given). Lazy + guarded so
// the module imports cleanly in the browser.
let nodeFs = null;
async function getFs() {
  if (nodeFs) return nodeFs;
  try {
    nodeFs = await import('fs/promises');
  } catch {
    nodeFs = null;
  }
  return nodeFs;
}

function toUint8(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (x && x.buffer instanceof ArrayBuffer) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  throw new Error('Expected AAC data as Uint8Array/ArrayBuffer/Buffer');
}

class StemMp4Writer {
  /**
   * Write a Stem MP4 from pre-encoded AAC tracks.
   *
   * @param {Object} opts
   * @param {Object} opts.stemsAac - { drums, bass, other, vocals } each an encoded
   *   single-track AAC .m4a (Uint8Array/ArrayBuffer/Buffer). For STEMS-2: { music, vocals }.
   * @param {Uint8Array} opts.mixdownAac - the encoded mixdown/original-mix AAC .m4a.
   * @param {Object} [opts.lyricsData] - { lines:[{text,start,end,words?}], singers? }.
   * @param {Object} [opts.metadata] - { title, artist, album, year, genre, tempo, track, key }.
   * @param {Object} [opts.analysisFeatures] - { key_detection, vocal_pitch, onsets, tempo_map }.
   * @param {string} [opts.profile] - 'STEMS-4' (default) | 'STEMS-2'.
   * @param {number} [opts.encoderDelaySamples] - AAC priming delay the caller's encoder
   *   introduced (default 1105, ffmpeg's native aac). Used to align lyric timing.
   * @param {number} [opts.sampleRate] - default 44100.
   * @param {string} [opts.outputPath] - Node only; if given, writes the file there.
   * @returns {Promise<{success, data:Uint8Array, outputFile?:string, fileSizeBytes, profile}>}
   */
  static async write(opts) {
    const {
      stemsAac,
      mixdownAac,
      lyricsData = { lines: [] },
      metadata = {},
      analysisFeatures = null,
      profile = 'STEMS-4',
      encoderDelaySamples = 1105,
      sampleRate = 44100,
      outputPath = null,
    } = opts;

    if (!mixdownAac) throw new Error('mixdownAac (encoded AAC) is required');
    if (!stemsAac) throw new Error('stemsAac (encoded AAC per stem) is required');

    // NI-Stems track order.
    const order =
      profile === 'STEMS-2'
        ? ['mixdown', 'music', 'vocals']
        : ['mixdown', 'drums', 'bass', 'other', 'vocals'];

    // Build the ordered track list for muxTracks (track 0 = mixdown, enabled; rest off).
    const tracks = order.map((name, i) => {
      const src = name === 'mixdown' ? mixdownAac : stemsAac[name];
      if (!src) throw new Error(`Missing AAC for stem: ${name}`);
      return { data: toUint8(src), kind: 'soun', enabled: i === 0 };
    });

    // 1) Mux the multi-track container (pure JS).
    let file = muxTracks(tracks);

    // The atoms.js helpers operate on a file PATH today. To stay pure-JS + browser-
    // friendly we apply them to an in-memory buffer via a tiny shim: write atoms
    // straight onto the buffer. atoms.js exposes buffer-level helpers below.
    // 2) Karaoke data atom (the lyrics loukai reads back).
    const karaData = this._generateKaraAtom(
      lyricsData,
      analysisFeatures,
      encoderDelaySamples,
      profile
    );
    file = await Atoms.writeKaraAtomBuffer(file, karaData);

    // 3) NI-Stems metadata (stem names).
    const stemNames =
      profile === 'STEMS-2' ? ['Music', 'Vocals'] : ['Drums', 'Bass', 'Other', 'Vocals'];
    file = await Atoms.addNiStemsMetadataBuffer(file, stemNames);

    // 4) Standard metadata (title/artist/album/year/genre/tempo).
    const md = metadata.song || metadata;
    file = await Atoms.addStandardMetadataBuffer(file, {
      title: md.title,
      artist: md.artist,
      album: md.album,
      year: md.year,
      genre: md.genre,
      tempo: md.tempo || md.bpm || analysisFeatures?.tempo_map?.bpm,
    });

    // 5) Musical key (from metadata.key or analysisFeatures.key_detection).
    const key =
      md.key ||
      (analysisFeatures?.key_detection?.confidence > 0.3
        ? analysisFeatures.key_detection.key?.trim()
        : null);
    if (key && key !== 'unknown') {
      file = await Atoms.addMusicalKeyBuffer(file, key);
    }

    // 6) Track number.
    if (md.track) file = await Atoms.addTrackNumberBuffer(file, md.track);

    // 7) Vocal pitch atom.
    const pitch = analysisFeatures?.vocal_pitch || opts.pitch;
    if (pitch) {
      let p = pitch;
      if (p.quant_data && p.sample_rate_hz) {
        p = { sampleRate: p.sample_rate_hz, data: p.quant_data.map(([midi, cents]) => ({ midi, cents })) };
      }
      if (p.data?.length) file = await Atoms.writeVpchAtomBuffer(file, p);
    }

    // 8) Onset markers.
    const onsets = analysisFeatures?.onsets || analysisFeatures?.onsets_ref;
    const onsetsArr = Array.isArray(onsets) ? onsets : onsets?.times;
    if (onsetsArr?.length) file = await Atoms.writeKonsAtomBuffer(file, onsetsArr);

    // 9) Optionally write to disk (Node).
    let outputFile;
    if (outputPath) {
      const fs = await getFs();
      if (!fs) throw new Error('outputPath given but no filesystem (browser?) — use the returned data');
      await fs.writeFile(outputPath, file);
      outputFile = outputPath;
    }

    return {
      success: true,
      data: file,
      outputFile,
      fileSizeBytes: file.length,
      profile,
      encoderDelaySamples,
      sampleRate,
    };
  }

  /** Generate kara (Karaoke Data) atom content. @private */
  static _generateKaraAtom(lyricsData, analysisFeatures, encoderDelay, profile) {
    let sources;
    if (profile === 'STEMS-4') {
      sources = [
        { track: 0, id: 'mixdown', role: 'mixdown' },
        { track: 1, id: 'drums', role: 'drums' },
        { track: 2, id: 'bass', role: 'bass' },
        { track: 3, id: 'other', role: 'other' },
        { track: 4, id: 'vocals', role: 'vocals' },
      ];
    } else if (profile === 'STEMS-2') {
      sources = [
        { track: 0, id: 'mixdown', role: 'mixdown' },
        { track: 1, id: 'music', role: 'music' },
        { track: 2, id: 'vocals', role: 'vocals' },
      ];
    } else {
      sources = [];
    }

    return {
      stems_karaoke_version: '1.0',
      audio: {
        profile,
        encoder_delay_samples: encoderDelay,
        sources,
        presets: [{ id: 'karaoke', levels: { vocals: -120 } }],
      },
      timing: { reference: 'aligned_to_vocals', offset_sec: 0.0 },
      lines: lyricsData.lines || [],
      singers: lyricsData.singers || [
        { id: 'A', name: 'Lead', guide_track: profile === 'STEMS-4' ? 4 : 2 },
      ],
    };
  }
}

export default StemMp4Writer;
export { StemMp4Writer };
