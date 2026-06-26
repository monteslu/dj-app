/**
 * Custom MP4 Atom Handling (isomorphic public API).
 * Write and read custom atoms for karaoke extensions.
 *
 * FULLY ISOMORPHIC: the same code runs in Node and the browser. The core
 * functions operate on a Uint8Array (the whole MP4 file) and return a new
 * Uint8Array — no Node Buffer, no `fs`, no `music-metadata`.
 *
 * The legacy path-based API (writeKaraAtom(filePath, ...), etc.) lives in
 * ./node.js (the one filesystem module) and is re-exported here for back-compat:
 * importing this module never pulls in `fs` because node.js lazily imports it
 * only when a path-based function is actually called.
 *
 * All box manipulation reuses the ONE shared vocabulary from ./bytes.js,
 * ./boxes.js and ./freeform.js so there is no duplicated parser/encoder.
 */

import {
  readUInt32BE,
  readString,
  writeUInt32BE,
  writeUInt16BE,
  writeInt8,
  sliceArray,
  toUint8Array,
  utf8Encode,
  utf8Decode,
} from './bytes.js';
import { parseAtoms, findAtom, createAtom } from './boxes.js';
import {
  createDataAtom,
  createFreeformAtom,
  createKaraAtom,
  injectKaraAtomCore,
  injectAtomToIlstCore,
  injectStemAtomCore,
  findIlst,
  decodeFreeformAtom,
  findFreeformDecoded,
} from './freeform.js';

// Node-only filesystem path wrappers. Re-exported for back-compat; node.js
// lazily imports fs so this stays a no-op in the browser until a path-based
// function is called.
export {
  writeKaraAtom,
  writeVpchAtom,
  writeKonsAtom,
  addNiStemsMetadata,
  addMusicalKey,
  addStandardMetadata,
  addTrackNumber,
  readKaraAtom,
  getKaraokeFeatures,
  readNiStemsMetadata,
  dumpAtomTree,
  disableTracks,
} from './node.js';

// Custom atom names
export const ATOM_NAMES = {
  KARA: '----:com.stems:kara',  // Karaoke Data (JSON)
  VPCH: '----:com.stems:vpch',  // Vocal Pitch (binary)
  KONS: '----:com.stems:kons',  // Karaoke Onsets (binary)
  NI_STEMS: '----:com.native-instruments:stems',  // NI Stems metadata
};

// ============================================================================
// Karaoke data (kara) atom — JSON
// ============================================================================

/**
 * Isomorphic core: inject/replace the kara atom in an in-memory MP4.
 * @param {Uint8Array} uint8 - whole MP4 file
 * @param {Object} karaData - karaoke data (JSON-encoded)
 * @returns {Uint8Array} new MP4 bytes
 */
export function writeKaraAtomBuffer(uint8, karaData) {
  const fileBuffer = toUint8Array(uint8);
  const karaJson = JSON.stringify(karaData);
  const karaAtomData = createKaraAtom(karaJson);
  return injectKaraAtomCore(fileBuffer, karaAtomData);
}

// ============================================================================
// Vocal pitch (vpch) atom — binary
// ============================================================================

/**
 * Build the binary payload for a vpch atom from pitch data.
 */
function encodeVpchPayload(pitchData) {
  const dataLength = pitchData.data.length;
  const binaryData = new Uint8Array(9 + dataLength * 2);

  binaryData[0] = 1; // version
  writeUInt32BE(binaryData, pitchData.sampleRate || 25, 1);
  writeUInt32BE(binaryData, dataLength, 5);

  let offset = 9;
  for (const sample of pitchData.data) {
    const midi = Math.max(0, Math.min(127, sample.midi || 0));
    const cents = Math.max(-50, Math.min(50, sample.cents || 0));
    binaryData[offset] = midi & 0xff;
    writeInt8(binaryData, cents, offset + 1);
    offset += 2;
  }
  return binaryData;
}

/**
 * Isomorphic core: inject/replace the vpch atom in an in-memory MP4.
 * @param {Uint8Array} uint8 - whole MP4 file
 * @param {Object} pitchData - { sampleRate, data:[{midi,cents}] }
 * @returns {Uint8Array} new MP4 bytes
 */
export function writeVpchAtomBuffer(uint8, pitchData) {
  if (!pitchData || !pitchData.data || !Array.isArray(pitchData.data)) {
    throw new Error('Invalid pitch data: must have sampleRate and data array');
  }
  const fileBuffer = toUint8Array(uint8);
  const payload = encodeVpchPayload(pitchData);
  const vpchAtomData = createFreeformAtom('com.stems', 'vpch', 0, payload);
  return injectAtomToIlstCore(fileBuffer, vpchAtomData);
}

// ============================================================================
// Karaoke onsets (kons) atom — binary
// ============================================================================

/**
 * Build the binary payload for a kons atom from an array of onset times (sec).
 */
function encodeKonsPayload(onsetsData) {
  const dataLength = onsetsData.length;
  const binaryData = new Uint8Array(5 + dataLength * 4);

  binaryData[0] = 1; // version
  writeUInt32BE(binaryData, dataLength, 1);

  let offset = 5;
  for (const timeSec of onsetsData) {
    const timeMs = Math.round(timeSec * 1000);
    writeUInt32BE(binaryData, timeMs, offset);
    offset += 4;
  }
  return binaryData;
}

/**
 * Isomorphic core: inject/replace the kons atom in an in-memory MP4.
 * @param {Uint8Array} uint8 - whole MP4 file
 * @param {Array<number>} onsetsData - onset times in seconds
 * @returns {Uint8Array} new MP4 bytes
 */
export function writeKonsAtomBuffer(uint8, onsetsData) {
  if (!onsetsData || !Array.isArray(onsetsData)) {
    throw new Error('Invalid onsets data: must be array of times in seconds');
  }
  const fileBuffer = toUint8Array(uint8);
  const payload = encodeKonsPayload(onsetsData);
  const konsAtomData = createFreeformAtom('com.stems', 'kons', 0, payload);
  return injectAtomToIlstCore(fileBuffer, konsAtomData);
}

// ============================================================================
// NI Stems metadata (moov/udta/stem) — JSON
// ============================================================================

/**
 * Isomorphic core: read NI Stems metadata from an in-memory MP4.
 * @param {Uint8Array} uint8 - whole MP4 file
 * @returns {Object|null}
 */
export function readNiStemsMetadataBuffer(uint8) {
  const fileBuffer = toUint8Array(uint8);

  const atoms = parseAtoms(fileBuffer, 0);
  const moovAtom = findAtom(atoms, 'moov');
  if (!moovAtom) return null;

  const moovChildren = parseAtoms(fileBuffer, moovAtom.dataOffset, moovAtom.size - 8);
  const udtaAtom = findAtom(moovChildren, 'udta');
  if (!udtaAtom) return null;

  const udtaChildren = parseAtoms(fileBuffer, udtaAtom.dataOffset, udtaAtom.size - 8);
  const stemAtom = findAtom(udtaChildren, 'stem');
  if (!stemAtom) return null;

  const stemData = sliceArray(fileBuffer, stemAtom.dataOffset, stemAtom.offset + stemAtom.size);
  try {
    return JSON.parse(utf8Decode(stemData));
  } catch (e) {
    console.error('Failed to parse stem metadata JSON:', e.message);
    return null;
  }
}

/**
 * Build the NI Stems metadata JSON bytes for the given stem names.
 */
function buildNiStemsMetadataBytes(stemNames) {
  const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'];
  const stemsMetadata = {
    version: 1,
    mastering_dsp: {
      compressor: {
        enabled: true,
        input_gain: 0.0,
        output_gain: 0.0,
        threshold: -6.0,
        dry_wet: 100,
        attack: 0.003,
        release: 0.3,
        ratio: 2.0,
        hp_cutoff: 20,
      },
      limiter: {
        enabled: true,
        threshold: -0.3,
        ceiling: -0.3,
        release: 0.05,
      },
    },
    stems: stemNames.map((name, i) => ({
      name,
      color: colors[i] || '#FFFFFF',
    })),
  };
  return utf8Encode(JSON.stringify(stemsMetadata, null, 2));
}

/**
 * Isomorphic core: add NI Stems metadata (moov/udta/stem) to an in-memory MP4.
 * @param {Uint8Array} uint8 - whole MP4 file
 * @param {Array<string>} [stemNames]
 * @returns {Uint8Array} new MP4 bytes
 */
export function addNiStemsMetadataBuffer(uint8, stemNames = null) {
  if (!stemNames) {
    stemNames = ['Drums', 'Bass', 'Other', 'Vocals'];
  }
  const fileBuffer = toUint8Array(uint8);
  const metadataBytes = buildNiStemsMetadataBytes(stemNames);
  return injectStemAtomCore(fileBuffer, metadataBytes);
}

// ============================================================================
// Musical key (----:com.apple.iTunes:initialkey) — UTF-8 text
// ============================================================================

/**
 * Isomorphic core: add a musical key freeform atom to an in-memory MP4.
 * @param {Uint8Array} uint8 - whole MP4 file
 * @param {string} musicalKey - e.g. "Am", "C#m", "5A"
 * @returns {Uint8Array} new MP4 bytes
 */
export function addMusicalKeyBuffer(uint8, musicalKey) {
  const fileBuffer = toUint8Array(uint8);
  const freeformAtom = createFreeformAtom(
    'com.apple.iTunes',
    'initialkey',
    1,
    utf8Encode(musicalKey)
  );
  return injectAtomToIlstCore(fileBuffer, freeformAtom);
}

// ============================================================================
// Standard metadata (title/artist/album/year/genre/tempo) — iTunes atoms
// ============================================================================

/**
 * Build the list of standard metadata atoms (each a complete ilst child).
 * @returns {Array<{name:string, atom:Uint8Array}>}
 */
function buildStandardMetadataAtoms(metadata) {
  const atomsToWrite = [];

  const createTextAtom = (atomType, text) => {
    if (!text) return null;
    const dataAtom = createDataAtom(1, utf8Encode(String(text))); // type 1 = UTF-8 text
    return createAtom(atomType, dataAtom);
  };

  const createBpmAtom = (bpm) => {
    if (!bpm || isNaN(bpm)) return null;
    const bpmValue = parseInt(bpm, 10);
    const dataPayload = new Uint8Array(2);
    writeUInt16BE(dataPayload, bpmValue, 0);
    const dataAtom = createDataAtom(21, dataPayload); // type 21 = big-endian integer
    return createAtom('tmpo', dataAtom);
  };

  if (metadata.title) {
    const atom = createTextAtom('©nam', metadata.title);
    if (atom) atomsToWrite.push({ name: 'title', atom });
  }
  if (metadata.artist) {
    const atom = createTextAtom('©ART', metadata.artist);
    if (atom) atomsToWrite.push({ name: 'artist', atom });
  }
  if (metadata.album) {
    const atom = createTextAtom('©alb', metadata.album);
    if (atom) atomsToWrite.push({ name: 'album', atom });
  }
  if (metadata.year) {
    const atom = createTextAtom('©day', String(metadata.year));
    if (atom) atomsToWrite.push({ name: 'year', atom });
  }
  if (metadata.genre) {
    const atom = createTextAtom('©gen', metadata.genre);
    if (atom) atomsToWrite.push({ name: 'genre', atom });
  }
  if (metadata.tempo) {
    const atom = createBpmAtom(metadata.tempo);
    if (atom) atomsToWrite.push({ name: 'BPM', atom });
  }

  return atomsToWrite;
}

/**
 * Isomorphic core: add standard metadata atoms to an in-memory MP4.
 * @param {Uint8Array} uint8 - whole MP4 file
 * @param {Object} metadata - { title, artist, album, year, genre, tempo }
 * @returns {Uint8Array} new MP4 bytes
 */
export function addStandardMetadataBuffer(uint8, metadata) {
  let fileBuffer = toUint8Array(uint8);
  const atomsToWrite = buildStandardMetadataAtoms(metadata);
  if (atomsToWrite.length === 0) {
    return fileBuffer;
  }
  for (const { atom } of atomsToWrite) {
    fileBuffer = injectAtomToIlstCore(fileBuffer, atom);
  }
  return fileBuffer;
}

// ============================================================================
// Track number (trkn) atom
// ============================================================================

/**
 * Build a trkn atom from track info; returns null on invalid input.
 */
function buildTrackNumberAtom(trackInfo) {
  let trackNo = 0;
  let trackOf = 0;

  if (typeof trackInfo === 'number') {
    trackNo = trackInfo;
  } else if (typeof trackInfo === 'string' && !isNaN(trackInfo)) {
    trackNo = parseInt(trackInfo, 10);
  } else if (typeof trackInfo === 'object' && trackInfo && trackInfo.no !== undefined) {
    trackNo = trackInfo.no;
    trackOf = trackInfo.of || 0;
  } else {
    console.warn(`Invalid track number format: ${JSON.stringify(trackInfo)}`);
    return null;
  }

  const dataPayload = new Uint8Array(8);
  writeUInt16BE(dataPayload, 0, 0);       // reserved
  writeUInt16BE(dataPayload, trackNo, 2); // track number
  writeUInt16BE(dataPayload, trackOf, 4); // total tracks
  writeUInt16BE(dataPayload, 0, 6);       // reserved

  const dataAtom = createDataAtom(0, dataPayload); // type 0 = implicit/binary
  return createAtom('trkn', dataAtom);
}

/**
 * Isomorphic core: add a track-number atom to an in-memory MP4.
 * @param {Uint8Array} uint8 - whole MP4 file
 * @param {number|string|Object} trackInfo
 * @returns {Uint8Array} new MP4 bytes (unchanged on invalid input)
 */
export function addTrackNumberBuffer(uint8, trackInfo) {
  const fileBuffer = toUint8Array(uint8);
  const trknAtom = buildTrackNumberAtom(trackInfo);
  if (!trknAtom) return fileBuffer;
  return injectAtomToIlstCore(fileBuffer, trknAtom);
}

// ============================================================================
// Reading karaoke atoms back (no music-metadata) — parse moov/udta/meta/ilst
// ============================================================================

/**
 * Isomorphic core: read and parse the kara atom from an in-memory MP4.
 * @param {Uint8Array} uint8 - whole MP4 file
 * @returns {Object|null} parsed kara data, or null if not present
 */
export function readKaraAtomBuffer(uint8) {
  const fileBuffer = toUint8Array(uint8);
  const decoded = findFreeformDecoded(fileBuffer, 'com.stems', 'kara');
  if (!decoded) return null;
  const json = utf8Decode(decoded.payload);
  try {
    return JSON.parse(json);
  } catch (parseErr) {
    throw new Error(`Failed to parse kara atom: ${parseErr.message}`);
  }
}

/**
 * Isomorphic core: get karaoke feature flags from an in-memory MP4.
 * @param {Uint8Array} uint8 - whole MP4 file
 * @returns {Object} { has_lyrics, has_word_timing, has_advanced }
 */
export function getKaraokeFeaturesBuffer(uint8) {
  const fileBuffer = toUint8Array(uint8);

  const features = {
    has_lyrics: false,
    has_word_timing: false,
    has_advanced: false,
  };

  const ilst = findIlst(fileBuffer);
  if (!ilst) return features;

  let karaDecoded = null;
  let hasVpch = false;
  let hasKons = false;

  for (const child of ilst.ilstChildren) {
    if (child.type !== '----') continue;
    const decoded = decodeFreeformAtom(fileBuffer, child);
    if (!decoded || decoded.namespace !== 'com.stems') continue;
    if (decoded.name === 'kara') karaDecoded = decoded;
    else if (decoded.name === 'vpch') hasVpch = true;
    else if (decoded.name === 'kons') hasKons = true;
  }

  if (karaDecoded) {
    features.has_lyrics = true;
    try {
      const karaData = JSON.parse(utf8Decode(karaDecoded.payload));
      const lines = karaData.lines || [];
      features.has_word_timing = lines.some((line) => 'word_timing' in line);
      const singers = karaData.singers || [];
      if (singers.length > 1) features.has_advanced = true;
    } catch (err) {
      console.warn('Could not parse kara data:', err.message);
    }
  }

  if (hasVpch || hasKons) features.has_advanced = true;

  return features;
}

// ============================================================================
// dumpAtomTree — debug helper
// ============================================================================

/**
 * Isomorphic core: dump the complete atom tree of an in-memory MP4.
 * @param {Uint8Array} uint8 - whole MP4 file
 * @param {number} [maxDepth=10]
 * @returns {Array} atom tree
 */
export function dumpAtomTreeBuffer(uint8, maxDepth = 10) {
  const buffer = toUint8Array(uint8);

  function parseAtomsRecursive(buf, offset, endOffset, depth = 0) {
    const atoms = [];
    let pos = offset;

    while (pos < endOffset - 8) {
      const size = readUInt32BE(buf, pos);
      const type = readString(buf, pos + 4, 4);

      if (size === 0 || size < 8 || pos + size > buf.length) {
        break;
      }

      const atom = { type, size, offset: pos };

      const containerAtoms = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'meta', 'ilst', 'edts', '----'];

      if (containerAtoms.includes(type) && depth < maxDepth) {
        // meta atom has 4 bytes of version/flags before children
        const childOffset = type === 'meta' ? pos + 12 : pos + 8;
        const childEndOffset = pos + size;
        if (childOffset < childEndOffset) {
          atom.children = parseAtomsRecursive(buf, childOffset, childEndOffset, depth + 1);
        }
      }

      atoms.push(atom);
      pos += size;
    }

    return atoms;
  }

  return parseAtomsRecursive(buffer, 0, buffer.length, 0);
}
