/**
 * MP4 box codec.
 *
 * Parsing/encoding of MP4 atoms (boxes) and the sample-table parsers
 * (stco/co64/stsz/stsc/stsd/stts/mdhd) plus the sample-data extractor. All box
 * manipulation in stem-mp4 reuses this ONE vocabulary instead of re-implementing
 * parsers/encoders. Uint8Array based — works identically in Node and the browser.
 */

import {
  readUInt32BE,
  readBigUInt64BE,
  readUInt8,
  readString,
  writeUInt32BE,
  writeString,
  concatArrays,
  sliceArray,
} from './bytes.js';

/**
 * Parse MP4 atoms from buffer
 */
export function parseAtoms(buffer, offset = 0, maxLength = null) {
  const atoms = [];
  const endOffset = maxLength ? offset + maxLength : buffer.length;
  let pos = offset;

  // `pos + 8 <= endOffset` (not `pos < endOffset - 8`) so an atom occupying
  // exactly the final 8 bytes — e.g. an empty container like an empty `ilst`
  // (size 8, no children) — is still parsed instead of silently dropped.
  while (pos + 8 <= endOffset) {
    const size = readUInt32BE(buffer, pos);
    const type = readString(buffer, pos + 4, 4);

    if (size === 0 || size < 8 || size > buffer.length - pos) {
      break;
    }

    atoms.push({
      type,
      offset: pos,
      size,
      dataOffset: pos + 8,
    });

    pos += size;
  }

  return atoms;
}

/**
 * Find an atom by type within a list
 */
export function findAtom(atoms, type) {
  return atoms.find((a) => a.type === type) || null;
}

/**
 * Parse stco (32-bit chunk offset) atom
 */
export function parseStco(buffer, atom) {
  const offsets = [];
  const entryCount = readUInt32BE(buffer, atom.dataOffset + 4);

  for (let i = 0; i < entryCount; i++) {
    const offset = readUInt32BE(buffer, atom.dataOffset + 8 + i * 4);
    offsets.push(offset);
  }

  return offsets;
}

/**
 * Parse co64 (64-bit chunk offset) atom
 */
export function parseCo64(buffer, atom) {
  const offsets = [];
  const entryCount = readUInt32BE(buffer, atom.dataOffset + 4);

  for (let i = 0; i < entryCount; i++) {
    const offset = readBigUInt64BE(buffer, atom.dataOffset + 8 + i * 8);
    offsets.push(offset);
  }

  return offsets;
}

/**
 * Parse stsz (sample sizes) atom
 */
export function parseStsz(buffer, atom) {
  const defaultSize = readUInt32BE(buffer, atom.dataOffset + 4);
  const sampleCount = readUInt32BE(buffer, atom.dataOffset + 8);

  if (defaultSize > 0) {
    return { defaultSize, sampleCount, sizes: null };
  }

  const sizes = [];
  for (let i = 0; i < sampleCount; i++) {
    const size = readUInt32BE(buffer, atom.dataOffset + 12 + i * 4);
    sizes.push(size);
  }

  return { defaultSize: 0, sampleCount, sizes };
}

/**
 * Parse stsc (sample-to-chunk) atom
 */
export function parseStsc(buffer, atom) {
  const entryCount = readUInt32BE(buffer, atom.dataOffset + 4);
  const entries = [];

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = atom.dataOffset + 8 + i * 12;
    entries.push({
      firstChunk: readUInt32BE(buffer, entryOffset),
      samplesPerChunk: readUInt32BE(buffer, entryOffset + 4),
      sampleDescriptionIndex: readUInt32BE(buffer, entryOffset + 8),
    });
  }

  return entries;
}

/**
 * Parse stsd (sample description) atom - returns raw bytes
 */
export function parseStsd(buffer, atom) {
  return sliceArray(buffer, atom.offset, atom.offset + atom.size);
}

/**
 * Parse stts (time-to-sample) atom
 */
export function parseStts(buffer, atom) {
  const entryCount = readUInt32BE(buffer, atom.dataOffset + 4);
  const entries = [];

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = atom.dataOffset + 8 + i * 8;
    entries.push({
      sampleCount: readUInt32BE(buffer, entryOffset),
      sampleDelta: readUInt32BE(buffer, entryOffset + 4),
    });
  }

  return entries;
}

/**
 * Parse mdhd (media header) atom
 */
export function parseMdhd(buffer, atom) {
  const version = readUInt8(buffer, atom.dataOffset);

  if (version === 0) {
    return {
      timescale: readUInt32BE(buffer, atom.dataOffset + 12),
      duration: readUInt32BE(buffer, atom.dataOffset + 16),
    };
  } else {
    return {
      timescale: readUInt32BE(buffer, atom.dataOffset + 20),
      duration: readBigUInt64BE(buffer, atom.dataOffset + 24),
    };
  }
}

/**
 * Build sample map from stsc entries
 */
export function buildChunkSampleMap(stscEntries, totalChunks) {
  const chunkMap = [];
  let currentSampleIndex = 0;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const chunkNumber = chunkIndex + 1;
    let samplesPerChunk = stscEntries[0].samplesPerChunk;

    for (let i = stscEntries.length - 1; i >= 0; i--) {
      if (chunkNumber >= stscEntries[i].firstChunk) {
        samplesPerChunk = stscEntries[i].samplesPerChunk;
        break;
      }
    }

    chunkMap.push({
      chunkIndex,
      sampleStart: currentSampleIndex,
      sampleCount: samplesPerChunk,
    });

    currentSampleIndex += samplesPerChunk;
  }

  return chunkMap;
}

/**
 * Extract raw audio data for a track
 */
export function extractAudioData(fileBuffer, sampleTable) {
  const { chunkOffsets, sampleSizes, stscEntries } = sampleTable;
  const chunkMap = buildChunkSampleMap(stscEntries, chunkOffsets.length);

  let totalSize = 0;
  if (sampleSizes.sizes) {
    totalSize = sampleSizes.sizes.reduce((sum, size) => sum + size, 0);
  } else {
    totalSize = sampleSizes.sampleCount * sampleSizes.defaultSize;
  }

  const audioData = new Uint8Array(totalSize);
  let writeOffset = 0;

  for (const chunk of chunkMap) {
    let readOffset = chunkOffsets[chunk.chunkIndex];

    for (let i = 0; i < chunk.sampleCount; i++) {
      const sampleIndex = chunk.sampleStart + i;
      const sampleSize = sampleSizes.sizes
        ? sampleSizes.sizes[sampleIndex]
        : sampleSizes.defaultSize;

      audioData.set(
        fileBuffer.subarray(readOffset, readOffset + sampleSize),
        writeOffset
      );
      writeOffset += sampleSize;
      readOffset += sampleSize;
    }
  }

  return audioData;
}

/**
 * Create a minimal MP4 atom
 */
export function createAtom(type, data) {
  const size = 8 + data.length;
  const header = new Uint8Array(8);
  writeUInt32BE(header, size, 0);
  writeString(header, type, 4);
  return concatArrays(header, data);
}

/**
 * Find a trak atom by index
 */
export function findTrack(buffer, trackIndex) {
  const atoms = parseAtoms(buffer);
  const moov = findAtom(atoms, 'moov');
  if (!moov) return null;

  const moovChildren = parseAtoms(buffer, moov.dataOffset, moov.size - 8);
  const traks = moovChildren.filter((a) => a.type === 'trak');

  if (trackIndex >= traks.length) return null;

  return traks[trackIndex];
}

/**
 * Parse sample table from a trak atom
 */
export function parseSampleTableFromTrak(buffer, trak) {
  const trakChildren = parseAtoms(buffer, trak.dataOffset, trak.size - 8);
  const mdia = findAtom(trakChildren, 'mdia');
  if (!mdia) throw new Error('No mdia atom found in trak');

  const mdiaChildren = parseAtoms(buffer, mdia.dataOffset, mdia.size - 8);
  const minf = findAtom(mdiaChildren, 'minf');
  const mdhd = findAtom(mdiaChildren, 'mdhd');
  if (!minf) throw new Error('No minf atom found in mdia');
  if (!mdhd) throw new Error('No mdhd atom found in mdia');

  const minfChildren = parseAtoms(buffer, minf.dataOffset, minf.size - 8);
  const stbl = findAtom(minfChildren, 'stbl');
  if (!stbl) throw new Error('No stbl atom found in minf');

  const stblChildren = parseAtoms(buffer, stbl.dataOffset, stbl.size - 8);

  const stcoAtom = findAtom(stblChildren, 'stco');
  const co64Atom = findAtom(stblChildren, 'co64');
  const stszAtom = findAtom(stblChildren, 'stsz');
  const stscAtom = findAtom(stblChildren, 'stsc');
  const stsdAtom = findAtom(stblChildren, 'stsd');
  const sttsAtom = findAtom(stblChildren, 'stts');

  if (!stszAtom) throw new Error('No stsz atom found');
  if (!stscAtom) throw new Error('No stsc atom found');
  if (!stsdAtom) throw new Error('No stsd atom found');
  if (!(stcoAtom || co64Atom)) throw new Error('No stco or co64 atom found');

  const chunkOffsets = stcoAtom
    ? parseStco(buffer, stcoAtom)
    : parseCo64(buffer, co64Atom);

  return {
    chunkOffsets,
    sampleSizes: parseStsz(buffer, stszAtom),
    stscEntries: parseStsc(buffer, stscAtom),
    stsd: parseStsd(buffer, stsdAtom),
    sttsEntries: sttsAtom ? parseStts(buffer, sttsAtom) : [{ sampleCount: 1, sampleDelta: 1 }],
    mdhd: parseMdhd(buffer, mdhd),
  };
}
