/**
 * Multi-track MUXER (pure JS — no ffmpeg).
 *
 * Takes several single-track encoded M4A blobs (e.g. one per stem, AAC) plus an
 * optional mov_text subtitle track, and muxes them into ONE multi-track MP4 with a
 * single shared mdat and a faststart moov. Reuses the same parsers + box builders
 * as the extractor (the inverse operation). The caller is responsible for the
 * AAC encoding itself; stem-mp4 only does the container.
 */

import {
  writeUInt32BE,
  writeUInt16BE,
  writeString,
  concatArrays,
  toUint8Array,
} from './bytes.js';
import {
  createAtom,
  findTrack,
  parseSampleTableFromTrak,
  extractAudioData,
} from './boxes.js';

// Build a full-box stbl for ONE track whose samples will live in the shared mdat
// starting at `chunkBaseOffset` (absolute file offset). Uses ONE chunk holding all
// the track's samples (stsc: firstChunk=1, samplesPerChunk=N).
function buildStblForTrack(track, chunkBaseOffset) {
  const { stsd, sampleSizes, sttsEntries } = track;

  const sttsData = new Uint8Array(8 + sttsEntries.length * 8);
  writeUInt32BE(sttsData, 0, 0);
  writeUInt32BE(sttsData, sttsEntries.length, 4);
  for (let i = 0; i < sttsEntries.length; i++) {
    writeUInt32BE(sttsData, sttsEntries[i].sampleCount, 8 + i * 8);
    writeUInt32BE(sttsData, sttsEntries[i].sampleDelta, 8 + i * 8 + 4);
  }
  const stts = createAtom('stts', sttsData);

  // stsc: all samples in a single chunk.
  const stscData = new Uint8Array(8 + 12);
  writeUInt32BE(stscData, 0, 0);
  writeUInt32BE(stscData, 1, 4); // 1 entry
  writeUInt32BE(stscData, 1, 8); // firstChunk
  writeUInt32BE(stscData, sampleSizes.sampleCount, 12); // samplesPerChunk
  writeUInt32BE(stscData, 1, 16); // sampleDescriptionIndex
  const stsc = createAtom('stsc', stscData);

  let stsz;
  if (sampleSizes.defaultSize > 0) {
    const d = new Uint8Array(12);
    writeUInt32BE(d, 0, 0);
    writeUInt32BE(d, sampleSizes.defaultSize, 4);
    writeUInt32BE(d, sampleSizes.sampleCount, 8);
    stsz = createAtom('stsz', d);
  } else {
    const d = new Uint8Array(12 + sampleSizes.sizes.length * 4);
    writeUInt32BE(d, 0, 0);
    writeUInt32BE(d, 0, 4);
    writeUInt32BE(d, sampleSizes.sizes.length, 8);
    for (let i = 0; i < sampleSizes.sizes.length; i++) {
      writeUInt32BE(d, sampleSizes.sizes[i], 12 + i * 4);
    }
    stsz = createAtom('stsz', d);
  }

  // co64: 64-bit chunk offset (single chunk at chunkBaseOffset). 64-bit avoids the
  // 4GB ceiling for multi-track files.
  const co64Data = new Uint8Array(8 + 8);
  writeUInt32BE(co64Data, 0, 0);
  writeUInt32BE(co64Data, 1, 4); // 1 entry
  writeUInt32BE(co64Data, Math.floor(chunkBaseOffset / 0x100000000), 8);
  writeUInt32BE(co64Data, chunkBaseOffset >>> 0, 12);
  const co64 = createAtom('co64', co64Data);

  return createAtom('stbl', concatArrays(stsd, stts, stsc, stsz, co64));
}

// Build a complete `trak` for one media track.
// kind: 'soun' (audio) | 'text' (mov_text subtitle). enabled toggles the tkhd flag.
function buildTrak(track, trackId, chunkBaseOffset, { kind = 'soun', enabled = true } = {}) {
  const { mdhd, sttsEntries } = track;
  const stbl = buildStblForTrack(track, chunkBaseOffset);

  // total media duration (sum of stts deltas) — fall back to mdhd.duration.
  let mediaDuration = 0;
  for (const e of sttsEntries) mediaDuration += e.sampleCount * e.sampleDelta;
  if (!mediaDuration) mediaDuration = mdhd.duration;

  const drefData = new Uint8Array([
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x0c, 0x75, 0x72, 0x6c, 0x20,
    0x00, 0x00, 0x00, 0x01,
  ]);
  const dinf = createAtom('dinf', createAtom('dref', drefData));

  let mediaHeader;
  let handlerType;
  if (kind === 'text') {
    // nmhd (null media header) for mov_text.
    mediaHeader = createAtom('nmhd', new Uint8Array([0, 0, 0, 0]));
    handlerType = 'text';
  } else {
    mediaHeader = createAtom('smhd', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]));
    handlerType = 'soun';
  }
  const minf = createAtom('minf', concatArrays(mediaHeader, dinf, stbl));

  const hdlrData = new Uint8Array(25);
  writeString(hdlrData, handlerType, 8);
  const hdlr = createAtom('hdlr', hdlrData);

  const mdhdData = new Uint8Array(24);
  writeUInt32BE(mdhdData, mdhd.timescale, 12);
  writeUInt32BE(mdhdData, mediaDuration, 16);
  writeUInt16BE(mdhdData, 0x55c4, 20); // 'und' language
  const mdia = createAtom(
    'mdia',
    concatArrays(createAtom('mdhd', mdhdData), hdlr, minf)
  );

  // tkhd — flags: bit0 enabled (0x1), bit1 in-movie (0x2). Track-duration in movie
  // timescale; we set the movie timescale = this track's timescale per-mux below,
  // but tkhd uses the MOVIE timescale. To keep it simple we store media duration and
  // rely on players using mdhd; set a reasonable movie-timescale duration in mux().
  const tkhdData = new Uint8Array(84);
  tkhdData[3] = enabled ? 0x03 : 0x02; // enabled+inmovie, or just inmovie
  writeUInt32BE(tkhdData, trackId, 12);
  writeUInt32BE(tkhdData, 0, 20); // duration filled by caller (movie timescale)
  // unity matrix
  writeUInt32BE(tkhdData, 0x00010000, 36 + 0);
  writeUInt32BE(tkhdData, 0x00010000, 36 + 16);
  writeUInt32BE(tkhdData, 0x40000000, 36 + 32);
  const tkhd = createAtom('tkhd', tkhdData);

  return { trak: createAtom('trak', concatArrays(tkhd, mdia)), mediaDuration, timescale: mdhd.timescale };
}

/**
 * Mux several single-track M4A blobs into one multi-track MP4 (pure JS, no ffmpeg).
 * @param {Array<{data:Uint8Array|ArrayBuffer|Buffer, kind?:'soun'|'text', enabled?:boolean}>} tracks
 *   Ordered tracks. The first audio track is the default; pass kind:'text' for a
 *   mov_text subtitle track. `enabled` defaults true for track 0, false otherwise
 *   (NI-Stems: only the mixdown is enabled).
 * @returns {Uint8Array} the muxed MP4 (ftyp + moov + single shared mdat), faststart.
 */
export function muxTracks(tracks) {
  // 1) Parse each input track → samples + tables.
  const parsed = tracks.map((t, i) => {
    const buf = toUint8Array(t.data);
    const trak = findTrack(buf, 0);
    if (!trak) throw new Error(`muxTracks: input ${i} has no track`);
    const st = parseSampleTableFromTrak(buf, trak);
    const audioData = extractAudioData(buf, st);
    return {
      audioData,
      stsd: st.stsd,
      sampleSizes: st.sampleSizes,
      sttsEntries: st.sttsEntries,
      mdhd: st.mdhd,
      kind: t.kind || 'soun',
      enabled: t.enabled ?? i === 0,
    };
  });

  // 2) Movie timescale = first track's timescale; compute each track's movie-duration.
  const movieTimescale = parsed[0].mdhd.timescale;

  // 3) Lay out as ftyp + mdat + moov (moov LAST). This matches ffmpeg's output and —
  //    critically — what atoms.js expects: with mdat BEFORE moov, the sample chunk
  //    offsets are fixed once, and later growing moov (kara/key/vpch atoms) never
  //    shifts sample data. (moov-first would break every atoms.js offset patch.)
  const ftypData = new Uint8Array([
    0x4d, 0x34, 0x41, 0x20, 0x00, 0x00, 0x00, 0x00, 0x4d, 0x34, 0x41, 0x20, 0x6d, 0x70, 0x34, 0x32,
    0x69, 0x73, 0x6f, 0x6d,
  ]);
  const ftyp = createAtom('ftyp', ftypData);

  const mvhdData = new Uint8Array(100);
  writeUInt32BE(mvhdData, movieTimescale, 12);
  writeUInt32BE(mvhdData, 0, 16); // movie duration (filled below)
  writeUInt32BE(mvhdData, 0x00010000, 20); // rate 1.0
  writeUInt16BE(mvhdData, 0x0100, 24); // volume 1.0
  writeUInt32BE(mvhdData, 0x00010000, 36); // matrix
  writeUInt32BE(mvhdData, 0x00010000, 52);
  writeUInt32BE(mvhdData, 0x40000000, 68);
  writeUInt32BE(mvhdData, parsed.length + 1, 96); // next track ID

  // Empty udta/meta/ilst scaffold so the metadata writers in atoms.js
  // (writeKaraAtom / addMusicalKey / addStandardMetadata / …) always take their
  // proven "augment existing meta/ilst" path. meta = 4-byte version/flags + hdlr
  // (mdir/appl) + empty ilst, inside udta. (ffmpeg always emits this; we must too.)
  const buildUdta = () => {
    const metaHdlr = createAtom(
      'hdlr',
      new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x6d, 0x64, 0x69, 0x72, 0x61, 0x70, 0x70,
        0x6c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ])
    );
    const ilst = createAtom('ilst', new Uint8Array(0));
    const meta = createAtom('meta', concatArrays(new Uint8Array(4), metaHdlr, ilst));
    return createAtom('udta', meta);
  };

  const buildAll = (offsets) => {
    let movieDuration = 0;
    const trakBufs = parsed.map((p, i) => {
      const { trak, mediaDuration, timescale } = buildTrak(p, i + 1, offsets[i], {
        kind: p.kind,
        enabled: p.enabled,
      });
      const movDur = Math.round((mediaDuration / timescale) * movieTimescale);
      if (movDur > movieDuration) movieDuration = movDur;
      // patch tkhd duration (movie timescale) — tkhd is first child of trak:
      // trak(8) → tkhd(8 hdr)+data; duration at data offset 20.
      writeUInt32BE(trak, movDur, 8 + 8 + 20);
      return trak;
    });
    writeUInt32BE(mvhdData, movieDuration, 16);
    const mvhd = createAtom('mvhd', mvhdData);
    const moov = createAtom('moov', concatArrays(mvhd, ...trakBufs, buildUdta()));
    return moov;
  };

  // mdat goes right after ftyp, so chunk offsets are known immediately (independent
  // of moov size) — and stay valid when moov grows later.
  const mdatPayloadStart = ftyp.length + 8; // 8 = mdat header
  const offsets = [];
  let running = mdatPayloadStart;
  for (const p of parsed) {
    offsets.push(running);
    running += p.audioData.length;
  }

  // mdat payload = all tracks' samples concatenated (in track order)
  const mdatPayload = concatArrays(...parsed.map((p) => p.audioData));
  const mdat = createAtom('mdat', mdatPayload);

  const moov = buildAll(offsets);

  return concatArrays(ftyp, mdat, moov);
}
