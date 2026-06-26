/**
 * Freeform (`----`) atom codec + ilst injection + chunk-offset patching.
 *
 * The iTunes-style freeform metadata layer: encode/decode `----` atoms
 * (mean/name/data), locate and read the moov/udta/meta/ilst chain, and the
 * buffer-level "inject an atom into ilst (creating the chain as needed) and
 * patch chunk offsets" cores used by the public atoms.js writers.
 *
 * FULLY ISOMORPHIC — Uint8Array in / Uint8Array out, no Node Buffer, no `fs`.
 * The offset-patching algorithm is preserved EXACTLY; only the file boundaries
 * moved.
 */

import {
  readUInt32BE,
  readBigUInt64BE,
  writeBigUInt64BE,
  readString,
  writeUInt32BE,
  writeString,
  concatArrays,
  sliceArray,
  utf8Encode,
  utf8Decode,
} from './bytes.js';
import { parseAtoms, findAtom, createAtom } from './boxes.js';

// ============================================================================
// Freeform atom builders
// ============================================================================

/**
 * Build a "data" atom payload: 8-byte data-atom header (4-byte type + 4-byte
 * locale/flags) followed by `payload`. Returns the full `data` atom.
 */
export function createDataAtom(typeFlag, payload) {
  const header = new Uint8Array(8);
  writeUInt32BE(header, typeFlag, 0); // data type
  writeUInt32BE(header, 0, 4);        // locale
  return createAtom('data', concatArrays(header, payload));
}

/**
 * Build a freeform `----` atom: mean(namespace) + name + data(typeFlag, payload).
 * This is the exact layout iTunes / music-metadata expects and that the reader
 * round-trips.
 */
export function createFreeformAtom(namespace, name, typeFlag, payload) {
  const nsBytes = utf8Encode(namespace);
  const meanData = new Uint8Array(4 + nsBytes.length);
  writeUInt32BE(meanData, 0, 0); // version/flags
  meanData.set(nsBytes, 4);
  const meanAtom = createAtom('mean', meanData);

  const nameBytes = utf8Encode(name);
  const nameData = new Uint8Array(4 + nameBytes.length);
  writeUInt32BE(nameData, 0, 0); // version/flags
  nameData.set(nameBytes, 4);
  const nameAtom = createAtom('name', nameData);

  const dataAtom = createDataAtom(typeFlag, payload);

  return createAtom('----', concatArrays(meanAtom, nameAtom, dataAtom));
}

/**
 * Create the kara (Karaoke Data) freeform atom from a JSON string.
 * Layout: ----[ mean(com.stems) name(kara) data(type=1 UTF-8 text, json) ]
 * @param {string} karaJson
 * @returns {Uint8Array}
 */
export function createKaraAtom(karaJson) {
  return createFreeformAtom('com.stems', 'kara', 1, utf8Encode(karaJson));
}

// ============================================================================
// Reading: locate ilst + decode freeform atoms
// ============================================================================

/**
 * Locate the ilst atom (and its children) inside moov/udta/meta. Returns the
 * fileBuffer-relative ilst atom and its parsed children, or null.
 */
export function findIlst(fileBuffer) {
  const atoms = parseAtoms(fileBuffer, 0);
  const moovAtom = findAtom(atoms, 'moov');
  if (!moovAtom) return null;

  const moovChildren = parseAtoms(fileBuffer, moovAtom.dataOffset, moovAtom.size - 8);
  const udtaAtom = findAtom(moovChildren, 'udta');
  if (!udtaAtom) return null;

  const udtaChildren = parseAtoms(fileBuffer, udtaAtom.dataOffset, udtaAtom.size - 8);
  const metaAtom = findAtom(udtaChildren, 'meta');
  if (!metaAtom) return null;

  // meta has a 4-byte version/flags before its children.
  const metaChildren = parseAtoms(fileBuffer, metaAtom.dataOffset + 4, metaAtom.size - 12);
  const ilstAtom = findAtom(metaChildren, 'ilst');
  if (!ilstAtom) return null;

  const ilstChildren = parseAtoms(fileBuffer, ilstAtom.dataOffset, ilstAtom.size - 8);
  return { ilstAtom, ilstChildren };
}

/**
 * Decode a freeform `----` atom into { namespace, name, dataType, payload }.
 * `payload` is the bytes AFTER the 16-byte data sub-atom header
 * ('data' size+type + 4-byte data-type + 4-byte locale). Returns null if it is
 * not a well-formed freeform atom.
 */
export function decodeFreeformAtom(fileBuffer, atom) {
  // Parse the children of the ---- atom (mean, name, data).
  const children = parseAtoms(fileBuffer, atom.dataOffset, atom.size - 8);
  const meanAtom = findAtom(children, 'mean');
  const nameAtom = findAtom(children, 'name');
  const dataAtom = findAtom(children, 'data');
  if (!meanAtom || !nameAtom || !dataAtom) return null;

  // mean/name: 4-byte version/flags then the UTF-8 string.
  const namespace = utf8Decode(
    sliceArray(fileBuffer, meanAtom.dataOffset + 4, meanAtom.offset + meanAtom.size)
  );
  const name = utf8Decode(
    sliceArray(fileBuffer, nameAtom.dataOffset + 4, nameAtom.offset + nameAtom.size)
  );

  // data: 4-byte data-type + 4-byte locale then the payload.
  const dataType = readUInt32BE(fileBuffer, dataAtom.dataOffset);
  const payload = sliceArray(fileBuffer, dataAtom.dataOffset + 8, dataAtom.offset + dataAtom.size);

  return { namespace, name, dataType, payload };
}

/**
 * Find a freeform atom by namespace+name and return its decoded form, or null.
 */
export function findFreeformDecoded(fileBuffer, namespace, name) {
  const ilst = findIlst(fileBuffer);
  if (!ilst) return null;
  for (const child of ilst.ilstChildren) {
    if (child.type !== '----') continue;
    const decoded = decodeFreeformAtom(fileBuffer, child);
    if (decoded && decoded.namespace === namespace && decoded.name === name) {
      return decoded;
    }
  }
  return null;
}

/**
 * Extract namespace from a freeform (----) atom.
 * @param {Uint8Array} freeformAtom - Complete ---- atom
 * @returns {string|null} Namespace (e.g., 'com.stems', 'com.apple.iTunes')
 */
export function extractFreeformNamespace(freeformAtom) {
  try {
    // Skip atom header (8 bytes)
    const offset = 8;

    // Read first child atom (should be 'mean')
    if (offset + 8 > freeformAtom.length) return null;

    const meanSize = readUInt32BE(freeformAtom, offset);
    const meanType = readString(freeformAtom, offset + 4, 4);

    if (meanType !== 'mean') return null;

    // Skip mean header (8 bytes) + version/flags (4 bytes)
    const namespaceStart = offset + 12;
    const namespaceEnd = offset + meanSize;

    if (namespaceEnd > freeformAtom.length) return null;

    return utf8Decode(sliceArray(freeformAtom, namespaceStart, namespaceEnd));
  } catch (_error) {
    return null;
  }
}

/**
 * Extract name from a freeform (----) atom.
 * @param {Uint8Array} freeformAtom - Complete ---- atom
 * @returns {string|null} Name (e.g., 'kara', 'vpch', 'initialkey')
 */
export function extractFreeformName(freeformAtom) {
  try {
    // Skip atom header (8 bytes)
    let offset = 8;

    // Skip 'mean' atom
    if (offset + 4 > freeformAtom.length) return null;
    const meanSize = readUInt32BE(freeformAtom, offset);
    offset += meanSize;

    // Read 'name' atom
    if (offset + 8 > freeformAtom.length) return null;
    const nameSize = readUInt32BE(freeformAtom, offset);
    const nameType = readString(freeformAtom, offset + 4, 4);

    if (nameType !== 'name') return null;

    // Skip name header (8 bytes) + version/flags (4 bytes)
    const nameStart = offset + 12;
    const nameEnd = offset + nameSize;

    if (nameEnd > freeformAtom.length) return null;

    return utf8Decode(sliceArray(freeformAtom, nameStart, nameEnd));
  } catch (_error) {
    return null;
  }
}

// ============================================================================
// kara meta/ilst structure builders
// ============================================================================

/**
 * Create meta > ilst > kara structure (returns the meta CONTENT, i.e. the bytes
 * that go inside a meta atom: version/flags + hdlr + ilst).
 */
function createMetaIlstKaraStructure(karaAtomData) {
  const ilst = createAtom('ilst', karaAtomData);

  const metaVersion = new Uint8Array(4); // version/flags = 0

  const hdlrData = new Uint8Array([
    0x00, 0x00, 0x00, 0x00, // Version/flags
    0x00, 0x00, 0x00, 0x00, // Pre-defined
    0x6d, 0x64, 0x69, 0x72, // Handler type: 'mdir'
    0x61, 0x70, 0x70, 0x6c, // Reserved: 'appl'
    0x00, 0x00, 0x00, 0x00, // Reserved
    0x00, 0x00, 0x00, 0x00, // Reserved
    0x00, // Name (empty)
  ]);
  const hdlr = createAtom('hdlr', hdlrData);

  return concatArrays(metaVersion, hdlr, ilst);
}

/**
 * Update meta atom with new kara data (returns the meta CONTENT bytes).
 */
function updateMetaWithKara(fileBuffer, metaAtom, karaAtomData) {
  // Parse meta children (skip 4-byte version/flags)
  const metaChildren = parseAtoms(fileBuffer, metaAtom.dataOffset + 4, metaAtom.size - 12);
  const ilstAtom = findAtom(metaChildren, 'ilst');

  if (!ilstAtom) {
    // Add ilst to end of meta
    const beforeIlst = sliceArray(
      fileBuffer,
      metaAtom.dataOffset,
      metaAtom.dataOffset + metaAtom.size - 8
    );
    const ilst = createAtom('ilst', karaAtomData);
    return concatArrays(beforeIlst, ilst);
  }

  // Parse ilst children to find existing kara
  const ilstChildren = parseAtoms(fileBuffer, ilstAtom.dataOffset, ilstAtom.size - 8);
  const existingKara = findAtom(ilstChildren, '----');

  if (existingKara) {
    // Replace existing kara
    const beforeKara = sliceArray(fileBuffer, ilstAtom.dataOffset, existingKara.offset);
    const afterKara = sliceArray(
      fileBuffer,
      existingKara.offset + existingKara.size,
      ilstAtom.offset + ilstAtom.size
    );
    const newIlstData = concatArrays(beforeKara, karaAtomData, afterKara);
    const newIlst = createAtom('ilst', newIlstData);

    const beforeIlst = sliceArray(fileBuffer, metaAtom.dataOffset, ilstAtom.offset);
    const afterIlst = sliceArray(
      fileBuffer,
      ilstAtom.offset + ilstAtom.size,
      metaAtom.offset + metaAtom.size
    );

    return concatArrays(beforeIlst, newIlst, afterIlst);
  } else {
    // Add kara to ilst
    const beforeNewKara = sliceArray(
      fileBuffer,
      ilstAtom.dataOffset,
      ilstAtom.dataOffset + ilstAtom.size - 8
    );
    const newIlstData = concatArrays(beforeNewKara, karaAtomData);
    const newIlst = createAtom('ilst', newIlstData);

    const beforeIlst = sliceArray(fileBuffer, metaAtom.dataOffset, ilstAtom.offset);
    const afterIlst = sliceArray(
      fileBuffer,
      ilstAtom.offset + ilstAtom.size,
      metaAtom.offset + metaAtom.size
    );

    return concatArrays(beforeIlst, newIlst, afterIlst);
  }
}

// ============================================================================
// Chunk-offset patchers (CRITICAL — algorithm preserved exactly)
// ============================================================================

/**
 * Update chunk offset tables (stco/co64) in moov atom.
 * This is CRITICAL when modifying moov size - prevents file corruption.
 * The algorithm is preserved EXACTLY from the original; only Buffer ops were
 * converted to Uint8Array helpers. Mutates `moovBuffer` in place.
 */
export function updateChunkOffsets(moovBuffer, sizeDelta, shiftThreshold) {

  const searchAtoms = (buffer, start, end) => {
    let pos = start;

    while (pos < end - 8 && pos < buffer.length - 8) {
      try {
        const size = readUInt32BE(buffer, pos);
        if (size < 8 || size > end - pos) {
          pos += 8;
          continue;
        }

        const atype = readString(buffer, pos + 4, 4);

        // Update 32-bit chunk offset table (stco)
        if (atype === 'stco') {
          const entryCount = readUInt32BE(buffer, pos + 12);

          for (let i = 0; i < entryCount; i++) {
            const offsetPos = pos + 16 + i * 4;
            const chunkOffset = readUInt32BE(buffer, offsetPos);

            // Only update offsets pointing to data after the original moov end
            if (chunkOffset >= shiftThreshold) {
              const newOffset = chunkOffset + sizeDelta;
              writeUInt32BE(buffer, newOffset, offsetPos);
            }
          }
        }
        // Update 64-bit chunk offset table (co64)
        else if (atype === 'co64') {
          const entryCount = readUInt32BE(buffer, pos + 12);

          for (let i = 0; i < entryCount; i++) {
            const offsetPos = pos + 16 + i * 8;
            const chunkOffset = readBigUInt64BE(buffer, offsetPos);

            // Only update offsets pointing to data after the original moov end
            if (chunkOffset >= shiftThreshold) {
              const newOffset = chunkOffset + sizeDelta;
              writeBigUInt64BE(buffer, newOffset, offsetPos);
            }
          }
        }
        // Recursively search container atoms
        else if (['trak', 'mdia', 'minf', 'stbl', 'moov'].includes(atype)) {
          searchAtoms(buffer, pos + 8, pos + size);
        }

        pos += size;
      } catch (error) {
        console.warn(`  Error parsing atom at ${pos}:`, error.message);
        pos += 8;
      }
    }
  };

  searchAtoms(moovBuffer, 0, moovBuffer.length);
}

/**
 * Update chunk offset tables for stem atom injection
 * (separate function to mirror the original; preserves logging/behaviour).
 * Mutates `moovBuffer` in place.
 */
export function updateChunkOffsetsForStem(moovBuffer, offsetDelta, shiftThreshold) {

  const searchAtoms = (buffer, start, end) => {
    let pos = start;

    while (pos < end - 8 && pos < buffer.length - 8) {
      try {
        const size = readUInt32BE(buffer, pos);
        if (size < 8 || size > end - pos) {
          pos += 8;
          continue;
        }

        const atype = readString(buffer, pos + 4, 4);

        // Update 32-bit chunk offset table (stco)
        if (atype === 'stco') {
          const entryCount = readUInt32BE(buffer, pos + 12);

          for (let i = 0; i < entryCount; i++) {
            const offsetPos = pos + 16 + i * 4;
            const chunkOffset = readUInt32BE(buffer, offsetPos);

            // Only update offsets that point to data after the moov atom
            if (chunkOffset >= shiftThreshold) {
              const newOffset = chunkOffset + offsetDelta;
              writeUInt32BE(buffer, newOffset, offsetPos);
            }
          }
        }
        // Update 64-bit chunk offset table (co64)
        else if (atype === 'co64') {
          const entryCount = readUInt32BE(buffer, pos + 12);

          for (let i = 0; i < entryCount; i++) {
            const offsetPos = pos + 16 + i * 8;
            const chunkOffset = readBigUInt64BE(buffer, offsetPos);

            // Only update offsets that point to data after the moov atom
            if (chunkOffset >= shiftThreshold) {
              const newOffset = chunkOffset + offsetDelta;
              writeBigUInt64BE(buffer, newOffset, offsetPos);
            }
          }
        }
        // Recursively search container atoms
        else if (['trak', 'mdia', 'minf', 'stbl', 'moov'].includes(atype)) {
          searchAtoms(buffer, pos + 8, pos + size);
        }

        pos += size;
      } catch (error) {
        console.warn(`  Error parsing atom at ${pos}:`, error.message);
        pos += 8;
      }
    }
  };

  searchAtoms(moovBuffer, 0, moovBuffer.length);
}

// ============================================================================
// Injection cores (isomorphic, operate on Uint8Array)
// ============================================================================

/**
 * Inject/replace the kara atom into the moov/udta/meta/ilst chain of an
 * in-memory MP4 and patch chunk offsets. Mirrors the original injectKaraAtom
 * but pure-JS and buffer-in/buffer-out.
 * @param {Uint8Array} fileBuffer
 * @param {Uint8Array} karaAtomData - complete ---- atom
 * @returns {Uint8Array}
 */
export function injectKaraAtomCore(fileBuffer, karaAtomData) {
  // Parse MP4 atoms
  const atoms = parseAtoms(fileBuffer);
  const moovAtom = findAtom(atoms, 'moov');
  if (!moovAtom) {
    throw new Error('No moov atom found in M4A file');
  }

  // Find or create udta atom inside moov
  const moovChildren = parseAtoms(fileBuffer, moovAtom.dataOffset, moovAtom.size - 8);
  const udtaAtom = findAtom(moovChildren, 'udta');

  let newMoovData;

  if (!udtaAtom) {
    // Create new udta atom with meta > ilst > kara
    const metaIlstKara = createMetaIlstKaraStructure(karaAtomData);
    const udtaData = createAtom('udta', metaIlstKara);

    const moovDataEnd = moovAtom.dataOffset + moovAtom.size - 8;
    const beforeUdta = sliceArray(fileBuffer, moovAtom.dataOffset, moovDataEnd);

    newMoovData = concatArrays(beforeUdta, udtaData);
  } else {
    const udtaChildren = parseAtoms(fileBuffer, udtaAtom.dataOffset, udtaAtom.size - 8);
    const metaAtom = findAtom(udtaChildren, 'meta');

    if (!metaAtom) {
      // Create meta > ilst > kara
      const metaIlstKara = createMetaIlstKaraStructure(karaAtomData);

      const beforeMeta = sliceArray(fileBuffer, udtaAtom.dataOffset, udtaAtom.offset + udtaAtom.size);
      const newUdtaData = concatArrays(beforeMeta, metaIlstKara);
      const newUdta = createAtom('udta', newUdtaData);

      const beforeUdta = sliceArray(fileBuffer, moovAtom.dataOffset, udtaAtom.offset);
      const afterUdta = sliceArray(
        fileBuffer,
        udtaAtom.offset + udtaAtom.size,
        moovAtom.offset + moovAtom.size
      );

      newMoovData = concatArrays(beforeUdta, newUdta, afterUdta);
    } else {
      // Update ilst in meta with new kara
      const newMetaData = updateMetaWithKara(fileBuffer, metaAtom, karaAtomData);
      const newMeta = createAtom('meta', newMetaData);

      const beforeMeta = sliceArray(fileBuffer, udtaAtom.dataOffset, metaAtom.offset);
      const afterMeta = sliceArray(
        fileBuffer,
        metaAtom.offset + metaAtom.size,
        udtaAtom.offset + udtaAtom.size
      );
      const newUdtaData = concatArrays(beforeMeta, newMeta, afterMeta);
      const newUdta = createAtom('udta', newUdtaData);

      const beforeUdta = sliceArray(fileBuffer, moovAtom.dataOffset, udtaAtom.offset);
      const afterUdta = sliceArray(
        fileBuffer,
        udtaAtom.offset + udtaAtom.size,
        moovAtom.offset + moovAtom.size
      );

      newMoovData = concatArrays(beforeUdta, newUdta, afterUdta);
    }
  }

  // Create new moov atom
  const newMoov = createAtom('moov', newMoovData);

  // Calculate size delta (how much moov grew)
  const oldMoovSize = moovAtom.size;
  const newMoovSize = newMoov.length;
  const sizeDelta = newMoovSize - oldMoovSize;

  // CRITICAL: Update chunk offset tables before rebuilding file
  if (sizeDelta !== 0) {
    const originalMoovEnd = moovAtom.offset + oldMoovSize;
    updateChunkOffsets(newMoov, sizeDelta, originalMoovEnd);
  }

  // Rebuild entire file
  const beforeMoov = sliceArray(fileBuffer, 0, moovAtom.offset);
  const afterMoov = sliceArray(fileBuffer, moovAtom.offset + moovAtom.size);

  return concatArrays(beforeMoov, newMoov, afterMoov);
}

/**
 * Inject stem metadata into moov/udta/stem and patch chunk offsets.
 * Buffer-in / buffer-out. Algorithm preserved from the original injectStemAtom.
 * @param {Uint8Array} inputBuffer
 * @param {Uint8Array} stemData - stem metadata bytes
 * @returns {Uint8Array}
 */
export function injectStemAtomCore(inputBuffer, stemData) {
  let fileBuffer = inputBuffer;

  // Find moov atom
  const atoms = parseAtoms(fileBuffer, 0);
  const moovAtom = findAtom(atoms, 'moov');
  if (!moovAtom) {
    throw new Error('No moov atom found');
  }

  // Store original moov end position - this is where mdat starts
  const originalMoovEnd = moovAtom.offset + moovAtom.size;

  // Find or create udta atom within moov
  const moovChildren = parseAtoms(fileBuffer, moovAtom.dataOffset, moovAtom.size - 8);
  const udtaAtom = findAtom(moovChildren, 'udta');

  let udtaPos, udtaSize, newMoovSize;

  if (!udtaAtom) {
    // Create new udta atom at end of moov
    udtaPos = moovAtom.offset + moovAtom.size;
    const udtaHeader = new Uint8Array(8);
    writeUInt32BE(udtaHeader, 8, 0); // size
    writeString(udtaHeader, 'udta', 4);

    const beforeUdta = sliceArray(fileBuffer, 0, udtaPos);
    const afterUdta = sliceArray(fileBuffer, udtaPos);
    fileBuffer = concatArrays(beforeUdta, udtaHeader, afterUdta);

    udtaSize = 8;
    newMoovSize = moovAtom.size + 8;
    writeUInt32BE(fileBuffer, newMoovSize, moovAtom.offset);
  } else {
    udtaPos = udtaAtom.offset;
    udtaSize = udtaAtom.size;
    newMoovSize = moovAtom.size;
  }

  // Create stem atom
  const stemAtomSize = 8 + stemData.length;
  const stemAtom = new Uint8Array(stemAtomSize);
  writeUInt32BE(stemAtom, stemAtomSize, 0);
  writeString(stemAtom, 'stem', 4);
  stemAtom.set(stemData, 8);

  // Insert stem atom at end of udta
  const insertPos = udtaPos + udtaSize;
  const beforeStem = sliceArray(fileBuffer, 0, insertPos);
  const afterStem = sliceArray(fileBuffer, insertPos);
  const newFileBuffer = concatArrays(beforeStem, stemAtom, afterStem);

  // Update udta size
  const newUdtaSize = udtaSize + stemAtomSize;
  writeUInt32BE(newFileBuffer, newUdtaSize, udtaPos);

  // Update moov size
  newMoovSize += stemAtomSize;
  writeUInt32BE(newFileBuffer, newMoovSize, moovAtom.offset);

  // CRITICAL: Update chunk offset tables (stco/co64)

  // Extract the moov atom, patch offsets, copy back.
  const moovBuffer = sliceArray(newFileBuffer, moovAtom.offset, moovAtom.offset + newMoovSize);
  updateChunkOffsetsForStem(moovBuffer, stemAtomSize, originalMoovEnd);
  newFileBuffer.set(moovBuffer, moovAtom.offset);

  return newFileBuffer;
}

/**
 * Inject an atom into moov/udta/meta/ilst, creating the chain as needed and
 * patching chunk offsets. Buffer-in / buffer-out. Algorithm preserved from the
 * original injectAtomToIlst.
 * @param {Uint8Array} inputBuffer
 * @param {Uint8Array} atomData - complete atom (size+type+data) to inject
 * @returns {Uint8Array}
 */
export function injectAtomToIlstCore(inputBuffer, atomData) {
  let fileBuffer = inputBuffer;

  // Find moov atom
  const atoms = parseAtoms(fileBuffer, 0);
  const moovAtom = findAtom(atoms, 'moov');
  if (!moovAtom) {
    throw new Error('No moov atom found');
  }

  const originalMoovEnd = moovAtom.offset + moovAtom.size;

  // Find or create udta > meta > ilst chain
  const moovChildren = parseAtoms(fileBuffer, moovAtom.dataOffset, moovAtom.size - 8);
  const udtaAtom = findAtom(moovChildren, 'udta');

  let udtaPos, udtaSize;
  if (!udtaAtom) {
    // Create udta at end of moov
    udtaPos = moovAtom.offset + moovAtom.size;
    const udtaHeader = new Uint8Array(8);
    writeUInt32BE(udtaHeader, 8, 0);
    writeString(udtaHeader, 'udta', 4);

    const beforeUdta = sliceArray(fileBuffer, 0, udtaPos);
    const afterUdta = sliceArray(fileBuffer, udtaPos);
    fileBuffer = concatArrays(beforeUdta, udtaHeader, afterUdta);

    udtaSize = 8;
    const newMoovSize = moovAtom.size + 8;
    writeUInt32BE(fileBuffer, newMoovSize, moovAtom.offset);
  } else {
    udtaPos = udtaAtom.offset;
    udtaSize = udtaAtom.size;
  }

  // Find or create meta within udta
  const udtaChildren = parseAtoms(fileBuffer, udtaPos + 8, udtaSize - 8);
  const metaAtom = findAtom(udtaChildren, 'meta');

  let metaPos, metaSize;
  if (!metaAtom) {
    // Create meta at end of udta
    metaPos = udtaPos + udtaSize;

    const metaVersion = new Uint8Array(4); // version/flags = 0

    const hdlrData = new Uint8Array([
      0x00, 0x00, 0x00, 0x00, // Version/flags
      0x00, 0x00, 0x00, 0x00, // Pre-defined
      0x6d, 0x64, 0x69, 0x72, // Handler type: 'mdir'
      0x61, 0x70, 0x70, 0x6c, // Reserved: 'appl'
      0x00, 0x00, 0x00, 0x00, // Reserved
      0x00, 0x00, 0x00, 0x00, // Reserved
      0x00, // Name (empty)
    ]);
    const hdlr = createAtom('hdlr', hdlrData);

    const metaContent = concatArrays(metaVersion, hdlr);
    const meta = createAtom('meta', metaContent);

    const beforeMeta = sliceArray(fileBuffer, 0, metaPos);
    const afterMeta = sliceArray(fileBuffer, metaPos);
    fileBuffer = concatArrays(beforeMeta, meta, afterMeta);

    metaSize = meta.length;

    // Update udta size
    const newUdtaSize = udtaSize + metaSize;
    writeUInt32BE(fileBuffer, newUdtaSize, udtaPos);

    // Update moov size
    const currentMoovSize = readUInt32BE(fileBuffer, moovAtom.offset);
    writeUInt32BE(fileBuffer, currentMoovSize + metaSize, moovAtom.offset);
  } else {
    metaPos = metaAtom.offset;
    metaSize = metaAtom.size;
  }

  // Find or create ilst within meta
  const metaChildren = parseAtoms(fileBuffer, metaPos + 12, metaSize - 12); // Skip size+type+version+hdlr
  const ilstAtom = findAtom(metaChildren, 'ilst');

  let insertPos;
  if (!ilstAtom) {
    // Create ilst at end of meta
    insertPos = metaPos + metaSize;

    const ilst = createAtom('ilst', atomData);

    const beforeIlst = sliceArray(fileBuffer, 0, insertPos);
    const afterIlst = sliceArray(fileBuffer, insertPos);
    fileBuffer = concatArrays(beforeIlst, ilst, afterIlst);

    const ilstSize = ilst.length;

    // Update meta size
    const newMetaSize = metaSize + ilstSize;
    writeUInt32BE(fileBuffer, newMetaSize, metaPos);

    // Update udta size
    const currentUdtaSize = readUInt32BE(fileBuffer, udtaPos);
    writeUInt32BE(fileBuffer, currentUdtaSize + ilstSize, udtaPos);

    // Update moov size
    const currentMoovSize = readUInt32BE(fileBuffer, moovAtom.offset);
    const sizeDelta = ilstSize;
    writeUInt32BE(fileBuffer, currentMoovSize + sizeDelta, moovAtom.offset);

    // Update chunk offsets
    const newMoovSize = currentMoovSize + sizeDelta;
    const moovBuffer = sliceArray(fileBuffer, moovAtom.offset, moovAtom.offset + newMoovSize);
    updateChunkOffsetsForStem(moovBuffer, sizeDelta, originalMoovEnd);
    fileBuffer.set(moovBuffer, moovAtom.offset);
  } else {
    // Check if an atom of the same type already exists in ilst
    // Use latin1 (char-code) read because MP4 atom types use byte 0xA9 for ©.
    const atomType = readString(atomData, 4, 4);
    const ilstChildren = parseAtoms(fileBuffer, ilstAtom.offset + 8, ilstAtom.size - 8);

    let existingAtom = null;

    // For freeform atoms (----), need to match by namespace+name
    if (atomType === '----') {
      const newAtomNamespace = extractFreeformNamespace(atomData);
      const newAtomName = extractFreeformName(atomData);

      existingAtom = ilstChildren.find((child) => {
        if (child.type !== '----') return false;
        const childData = sliceArray(fileBuffer, child.offset, child.offset + child.size);
        const childNamespace = extractFreeformNamespace(childData);
        const childName = extractFreeformName(childData);
        const matches = childNamespace === newAtomNamespace && childName === newAtomName;

        return matches;
      });
    } else {
      // For standard atoms, match by type
      existingAtom = ilstChildren.find((child) => child.type === atomType);
    }

    let sizeDelta;

    if (existingAtom) {
      // Replace existing atom

      const beforeAtom = sliceArray(fileBuffer, 0, existingAtom.offset);
      const afterAtom = sliceArray(fileBuffer, existingAtom.offset + existingAtom.size);
      fileBuffer = concatArrays(beforeAtom, atomData, afterAtom);

      sizeDelta = atomData.length - existingAtom.size;
    } else {
      // Add atom to end of existing ilst
      insertPos = ilstAtom.offset + ilstAtom.size;

      const beforeAtom = sliceArray(fileBuffer, 0, insertPos);
      const afterAtom = sliceArray(fileBuffer, insertPos);
      fileBuffer = concatArrays(beforeAtom, atomData, afterAtom);

      sizeDelta = atomData.length;
    }

    // Update ilst size
    writeUInt32BE(fileBuffer, ilstAtom.size + sizeDelta, ilstAtom.offset);

    // Update meta size
    writeUInt32BE(fileBuffer, metaSize + sizeDelta, metaPos);

    // Update udta size
    const currentUdtaSize = readUInt32BE(fileBuffer, udtaPos);
    writeUInt32BE(fileBuffer, currentUdtaSize + sizeDelta, udtaPos);

    // Update moov size and chunk offsets
    const currentMoovSize = readUInt32BE(fileBuffer, moovAtom.offset);
    const newMoovSize = currentMoovSize + sizeDelta;
    writeUInt32BE(fileBuffer, newMoovSize, moovAtom.offset);

    const moovBuffer = sliceArray(fileBuffer, moovAtom.offset, moovAtom.offset + newMoovSize);
    updateChunkOffsetsForStem(moovBuffer, sizeDelta, originalMoovEnd);
    fileBuffer.set(moovBuffer, moovAtom.offset);
  }

  return fileBuffer;
}
