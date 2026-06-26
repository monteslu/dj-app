/**
 * M4A Track Extractor
 *
 * Extract individual audio tracks from multi-track M4A/MP4 files
 * without requiring FFmpeg.
 *
 * Works with Uint8Array or ArrayBuffer input.
 * Consumer is responsible for I/O (file reading, fetching, etc).
 *
 * The byte/box vocabulary lives in ./bytes.js and ./boxes.js, and the
 * multi-track muxer in ./muxer.js. They are re-exported below so existing
 * consumers that reached for them via the Extractor namespace keep working.
 */

import {
  writeUInt32BE,
  writeUInt16BE,
  concatArrays,
  toUint8Array,
} from './bytes.js';
import {
  parseAtoms,
  findAtom,
  createAtom,
  extractAudioData,
  findTrack,
  parseSampleTableFromTrak,
} from './boxes.js';
import { muxTracks } from './muxer.js';

/**
 * Build a minimal playable M4A file from extracted track data
 */
function buildM4aFile(trackInfo) {
  const { audioData, stsd, sampleSizes, sttsEntries, mdhd } = trackInfo;

  // Build ftyp
  const ftypData = new Uint8Array([
    0x4d, 0x34, 0x41, 0x20,
    0x00, 0x00, 0x00, 0x00,
    0x4d, 0x34, 0x41, 0x20,
    0x6d, 0x70, 0x34, 0x32,
    0x69, 0x73, 0x6f, 0x6d,
  ]);
  const ftyp = createAtom('ftyp', ftypData);

  // Build stts
  const sttsData = new Uint8Array(8 + sttsEntries.length * 8);
  writeUInt32BE(sttsData, 0, 0);
  writeUInt32BE(sttsData, sttsEntries.length, 4);
  for (let i = 0; i < sttsEntries.length; i++) {
    writeUInt32BE(sttsData, sttsEntries[i].sampleCount, 8 + i * 8);
    writeUInt32BE(sttsData, sttsEntries[i].sampleDelta, 8 + i * 8 + 4);
  }
  const stts = createAtom('stts', sttsData);

  // Build stsc
  const stscData = new Uint8Array(8 + 12);
  writeUInt32BE(stscData, 0, 0);
  writeUInt32BE(stscData, 1, 4);
  writeUInt32BE(stscData, 1, 8);
  writeUInt32BE(stscData, sampleSizes.sampleCount, 12);
  writeUInt32BE(stscData, 1, 16);
  const stsc = createAtom('stsc', stscData);

  // Build stsz
  let stsz;
  if (sampleSizes.defaultSize > 0) {
    const stszData = new Uint8Array(12);
    writeUInt32BE(stszData, 0, 0);
    writeUInt32BE(stszData, sampleSizes.defaultSize, 4);
    writeUInt32BE(stszData, sampleSizes.sampleCount, 8);
    stsz = createAtom('stsz', stszData);
  } else {
    const stszData = new Uint8Array(12 + sampleSizes.sizes.length * 4);
    writeUInt32BE(stszData, 0, 0);
    writeUInt32BE(stszData, 0, 4);
    writeUInt32BE(stszData, sampleSizes.sizes.length, 8);
    for (let i = 0; i < sampleSizes.sizes.length; i++) {
      writeUInt32BE(stszData, sampleSizes.sizes[i], 12 + i * 4);
    }
    stsz = createAtom('stsz', stszData);
  }

  // Build stco placeholder
  const stcoData = new Uint8Array(12);
  writeUInt32BE(stcoData, 0, 0);
  writeUInt32BE(stcoData, 1, 4);
  const stco = createAtom('stco', stcoData);

  // Build stbl
  const stbl = createAtom('stbl', concatArrays(stsd, stts, stsc, stsz, stco));

  // Build dinf with dref
  const drefData = new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x0c,
    0x75, 0x72, 0x6c, 0x20,
    0x00, 0x00, 0x00, 0x01,
  ]);
  const dref = createAtom('dref', drefData);
  const dinf = createAtom('dinf', dref);

  // Build smhd
  const smhdData = new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00,
    0x00, 0x00,
  ]);
  const smhd = createAtom('smhd', smhdData);

  // Build minf
  const minf = createAtom('minf', concatArrays(smhd, dinf, stbl));

  // Build hdlr
  const hdlrData = new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x73, 0x6f, 0x75, 0x6e,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00,
  ]);
  const hdlr = createAtom('hdlr', hdlrData);

  // Build mdhd
  const mdhdData = new Uint8Array(24);
  writeUInt32BE(mdhdData, 0, 0);
  writeUInt32BE(mdhdData, 0, 4);
  writeUInt32BE(mdhdData, 0, 8);
  writeUInt32BE(mdhdData, mdhd.timescale, 12);
  writeUInt32BE(mdhdData, mdhd.duration, 16);
  writeUInt16BE(mdhdData, 0x55c4, 20);
  writeUInt16BE(mdhdData, 0, 22);
  const mdhdAtom = createAtom('mdhd', mdhdData);

  // Build mdia
  const mdia = createAtom('mdia', concatArrays(mdhdAtom, hdlr, minf));

  // Build tkhd
  const tkhdData = new Uint8Array(84);
  tkhdData[0] = 0;
  tkhdData[1] = 0;
  tkhdData[2] = 0;
  tkhdData[3] = 0x07;
  writeUInt32BE(tkhdData, 1, 12);
  writeUInt32BE(tkhdData, mdhd.duration, 20);
  writeUInt32BE(tkhdData, 0x00010000, 76);
  const tkhd = createAtom('tkhd', tkhdData);

  // Build trak
  const trak = createAtom('trak', concatArrays(tkhd, mdia));

  // Build mvhd
  const mvhdData = new Uint8Array(100);
  writeUInt32BE(mvhdData, 0, 0);
  writeUInt32BE(mvhdData, mdhd.timescale, 12);
  writeUInt32BE(mvhdData, mdhd.duration, 16);
  writeUInt32BE(mvhdData, 0x00010000, 20);
  writeUInt16BE(mvhdData, 0x0100, 24);
  writeUInt32BE(mvhdData, 0x00010000, 36);
  writeUInt32BE(mvhdData, 0x00010000, 52);
  writeUInt32BE(mvhdData, 0x40000000, 68);
  writeUInt32BE(mvhdData, 2, 96);
  const mvhd = createAtom('mvhd', mvhdData);

  // Build moov
  const moov = createAtom('moov', concatArrays(mvhd, trak));

  // Build mdat
  const mdat = createAtom('mdat', audioData);

  // Update chunk offset
  const chunkOffset = ftyp.length + moov.length + 8;
  writeUInt32BE(moov, chunkOffset, moov.length - stco.length + 8 + 8);

  return concatArrays(ftyp, moov, mdat);
}

/**
 * Extract a single track as a playable M4A
 * @param {Uint8Array|ArrayBuffer|Buffer} data - M4A file data (Uint8Array, ArrayBuffer, or Node.js Buffer)
 * @param {number} trackIndex - Track index (0-based)
 * @returns {Uint8Array} Playable M4A file
 */
export function extractTrack(data, trackIndex) {
  const fileBuffer = toUint8Array(data);

  const trak = findTrack(fileBuffer, trackIndex);
  if (!trak) {
    throw new Error(`Track ${trackIndex} not found in file`);
  }

  const sampleTable = parseSampleTableFromTrak(fileBuffer, trak);
  const audioData = extractAudioData(fileBuffer, sampleTable);

  return buildM4aFile({
    audioData,
    stsd: sampleTable.stsd,
    sampleSizes: sampleTable.sampleSizes,
    sttsEntries: sampleTable.sttsEntries,
    mdhd: sampleTable.mdhd,
  });
}

/**
 * Extract all audio tracks as playable M4A files
 * @param {Uint8Array|ArrayBuffer|Buffer} data - M4A file data (Uint8Array, ArrayBuffer, or Node.js Buffer)
 * @returns {Array<Uint8Array>} Array of playable M4A files
 */
export function extractAllTracks(data) {
  const fileBuffer = toUint8Array(data);

  const atoms = parseAtoms(fileBuffer);
  const moov = findAtom(atoms, 'moov');
  if (!moov) throw new Error('No moov atom found');

  const moovChildren = parseAtoms(fileBuffer, moov.dataOffset, moov.size - 8);
  const traks = moovChildren.filter((a) => a.type === 'trak');

  const tracks = [];
  for (let i = 0; i < traks.length; i++) {
    try {
      const sampleTable = parseSampleTableFromTrak(fileBuffer, traks[i]);

      if (sampleTable.sampleSizes.sampleCount < 100) {
        continue;
      }

      const audioData = extractAudioData(fileBuffer, sampleTable);
      const trackBuffer = buildM4aFile({
        audioData,
        stsd: sampleTable.stsd,
        sampleSizes: sampleTable.sampleSizes,
        sttsEntries: sampleTable.sttsEntries,
        mdhd: sampleTable.mdhd,
      });
      tracks.push(trackBuffer);
    } catch (err) {
      console.warn(`Skipping track ${i}: ${err.message}`);
    }
  }

  return tracks;
}

/**
 * Get track count
 * @param {Uint8Array|ArrayBuffer|Buffer} data - M4A file data (Uint8Array, ArrayBuffer, or Node.js Buffer)
 * @returns {number} Number of tracks
 */
export function getTrackCount(data) {
  const fileBuffer = toUint8Array(data);

  const atoms = parseAtoms(fileBuffer);
  const moov = findAtom(atoms, 'moov');
  if (!moov) throw new Error('No moov atom found');

  const moovChildren = parseAtoms(fileBuffer, moov.dataOffset, moov.size - 8);
  const traks = moovChildren.filter((a) => a.type === 'trak');

  return traks.length;
}

/**
 * Get information about all tracks
 * @param {Uint8Array|ArrayBuffer|Buffer} data - M4A file data (Uint8Array, ArrayBuffer, or Node.js Buffer)
 * @returns {Array} Array of track info objects
 */
export function getTrackInfo(data) {
  const fileBuffer = toUint8Array(data);

  const atoms = parseAtoms(fileBuffer);
  const moov = findAtom(atoms, 'moov');
  if (!moov) throw new Error('No moov atom found');

  const moovChildren = parseAtoms(fileBuffer, moov.dataOffset, moov.size - 8);
  const traks = moovChildren.filter((a) => a.type === 'trak');

  const trackInfo = [];
  for (let i = 0; i < traks.length; i++) {
    try {
      const sampleTable = parseSampleTableFromTrak(fileBuffer, traks[i]);
      trackInfo.push({
        index: i,
        sampleCount: sampleTable.sampleSizes.sampleCount,
        duration: sampleTable.mdhd.duration / sampleTable.mdhd.timescale,
        timescale: sampleTable.mdhd.timescale,
      });
    } catch (err) {
      trackInfo.push({
        index: i,
        error: err.message,
      });
    }
  }

  return trackInfo;
}

// Re-export the multi-track muxer (moved to ./muxer.js) so consumers that used
// `Extractor.muxTracks` keep working.
export { muxTracks };

export default {
  muxTracks,
  extractTrack,
  extractAllTracks,
  getTrackCount,
  getTrackInfo,
};

// ---------------------------------------------------------------------------
// Back-compat re-exports of the shared box-manipulation helpers.
//
// These primitives now live in ./bytes.js and ./boxes.js. They are re-exported
// here unchanged so existing consumers that imported them from the Extractor
// namespace (e.g. `Extractor.createAtom`, `Extractor.parseAtoms`) keep working.
// ---------------------------------------------------------------------------
export {
  readUInt32BE,
  readBigUInt64BE,
  writeBigUInt64BE,
  readUInt8,
  readString,
  writeUInt32BE,
  writeUInt16BE,
  writeString,
  concatArrays,
  sliceArray,
  toUint8Array,
} from './bytes.js';
export { parseAtoms, findAtom, createAtom } from './boxes.js';
