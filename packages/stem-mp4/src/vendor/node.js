/**
 * Node-only filesystem path wrappers.
 *
 * This is the ONE file in stem-mp4 that touches the filesystem. Each function is
 * a thin wrapper around the isomorphic *Buffer cores in atoms.js: it lazily
 * imports `fs/promises`, reads the file, calls the core, and writes it back. In
 * an environment without a filesystem (e.g. the browser) the lazy import fails
 * and a clear error points the caller at the *Buffer variant.
 *
 * The lazy import keeps this module side-effect free: importing it (directly or
 * transitively via atoms.js) never pulls in `fs` until a path-based function is
 * actually called.
 */

import { toUint8Array } from './bytes.js';
import {
  writeKaraAtomBuffer,
  writeVpchAtomBuffer,
  writeKonsAtomBuffer,
  addNiStemsMetadataBuffer,
  addMusicalKeyBuffer,
  addStandardMetadataBuffer,
  addTrackNumberBuffer,
  readKaraAtomBuffer,
  getKaraokeFeaturesBuffer,
  readNiStemsMetadataBuffer,
  dumpAtomTreeBuffer,
} from './atoms.js';

/**
 * Lazily and safely import Node's fs/promises. Returns the module in Node, or
 * throws a clear, actionable error in environments without a filesystem
 * (e.g. the browser), telling the caller to use the *Buffer variant.
 */
async function getFs(bufferVariantName) {
  try {
    const mod = await import('fs/promises');
    return mod.default || mod;
  } catch {
    throw new Error(
      `No filesystem available (browser?) — use ${bufferVariantName}(uint8, ...) instead of the path-based API.`
    );
  }
}

/**
 * Read a file path to a Uint8Array (Node only). Throws a clear error elsewhere.
 */
async function readFileToUint8(filePath, bufferVariantName) {
  const fs = await getFs(bufferVariantName);
  const data = await fs.readFile(filePath);
  return toUint8Array(data);
}

// ============================================================================
// Karaoke data (kara) atom — JSON
// ============================================================================

/**
 * Write kara (Karaoke Data) atom to MP4 file (Node path API).
 * @param {string} filePath - Path to MP4 file
 * @param {Object} karaData - Karaoke data to write (will be JSON-encoded)
 */
export async function writeKaraAtom(filePath, karaData) {
  const fileBuffer = await readFileToUint8(filePath, 'writeKaraAtomBuffer');
  const out = writeKaraAtomBuffer(fileBuffer, karaData);
  const fs = await getFs('writeKaraAtomBuffer');
  await fs.writeFile(filePath, out);
}

// ============================================================================
// Vocal pitch (vpch) atom — binary
// ============================================================================

/**
 * Write vpch (Vocal Pitch) atom to MP4 file (Node path API).
 * @param {string} filePath - Path to MP4 file
 * @param {Object} pitchData - Pitch data object with sampleRate and data array
 */
export async function writeVpchAtom(filePath, pitchData) {
  const fileBuffer = await readFileToUint8(filePath, 'writeVpchAtomBuffer');
  const out = writeVpchAtomBuffer(fileBuffer, pitchData);
  const fs = await getFs('writeVpchAtomBuffer');
  await fs.writeFile(filePath, out);
}

// ============================================================================
// Karaoke onsets (kons) atom — binary
// ============================================================================

/**
 * Write kons (Karaoke Onsets) atom to MP4 file (Node path API).
 * @param {string} filePath - Path to MP4 file
 * @param {Array<number>} onsetsData - Array of onset times in seconds
 */
export async function writeKonsAtom(filePath, onsetsData) {
  const fileBuffer = await readFileToUint8(filePath, 'writeKonsAtomBuffer');
  const out = writeKonsAtomBuffer(fileBuffer, onsetsData);
  const fs = await getFs('writeKonsAtomBuffer');
  await fs.writeFile(filePath, out);
}

// ============================================================================
// NI Stems metadata (moov/udta/stem) — JSON
// ============================================================================

/**
 * Read NI Stems metadata from MP4 file (Node path API).
 * @param {string} filePath - Path to MP4 file
 * @returns {Promise<Object|null>} Stems metadata object or null if not found
 */
export async function readNiStemsMetadata(filePath) {
  const fileBuffer = await readFileToUint8(filePath, 'readNiStemsMetadataBuffer');
  return readNiStemsMetadataBuffer(fileBuffer);
}

/**
 * Add NI Stems metadata to MP4 file (Node path API).
 * @param {string} filePath - Path to MP4 file
 * @param {Array<string>} stemNames - Array of stem names (default: Drums, Bass, Other, Vocals)
 */
export async function addNiStemsMetadata(filePath, stemNames = null) {
  const fileBuffer = await readFileToUint8(filePath, 'addNiStemsMetadataBuffer');
  const out = addNiStemsMetadataBuffer(fileBuffer, stemNames);
  const fs = await getFs('addNiStemsMetadataBuffer');
  await fs.writeFile(filePath, out);
}

// ============================================================================
// Track disabling (not implemented — kept for API compatibility)
// ============================================================================

/**
 * Disable specific audio tracks in MP4 file.
 * @param {string} filePath - Path to MP4 file
 * @param {Array<number>} trackIndices - Indices of tracks to disable (0-based)
 */
export async function disableTracks(_filePath, _trackIndices) {
  // TODO: Implement track disabling
}

// ============================================================================
// Musical key (----:com.apple.iTunes:initialkey) — UTF-8 text
// ============================================================================

/**
 * Add musical key metadata for DJ software (harmonic mixing) (Node path API).
 * @param {string} filePath - Path to MP4 file
 * @param {string} musicalKey - Musical key (e.g., "Am", "C#m", "5A")
 */
export async function addMusicalKey(filePath, musicalKey) {
  const fileBuffer = await readFileToUint8(filePath, 'addMusicalKeyBuffer');
  const out = addMusicalKeyBuffer(fileBuffer, musicalKey);
  const fs = await getFs('addMusicalKeyBuffer');
  await fs.writeFile(filePath, out);
}

// ============================================================================
// Standard metadata (title/artist/album/year/genre/tempo) — iTunes atoms
// ============================================================================

/**
 * Add standard MP4 metadata atoms (title, artist, album, year, genre, BPM) (Node path API).
 * @param {string} filePath - Path to MP4 file
 * @param {Object} metadata - Metadata object
 */
export async function addStandardMetadata(filePath, metadata) {
  const fileBuffer = await readFileToUint8(filePath, 'addStandardMetadataBuffer');
  const out = addStandardMetadataBuffer(fileBuffer, metadata);
  const fs = await getFs('addStandardMetadataBuffer');
  await fs.writeFile(filePath, out);
}

// ============================================================================
// Track number (trkn) atom
// ============================================================================

/**
 * Add track number metadata (Node path API).
 * @param {string} filePath - Path to MP4 file
 * @param {number|string|Object} trackInfo - Track number (int, string, or {no: X, of: Y})
 */
export async function addTrackNumber(filePath, trackInfo) {
  const fileBuffer = await readFileToUint8(filePath, 'addTrackNumberBuffer');
  const out = addTrackNumberBuffer(fileBuffer, trackInfo);
  const fs = await getFs('addTrackNumberBuffer');
  await fs.writeFile(filePath, out);
}

// ============================================================================
// Reading karaoke atoms back (no music-metadata) — parse moov/udta/meta/ilst
// ============================================================================

/**
 * Read kara (Karaoke Data) atom from MP4 file (Node path API).
 * @param {string} filePath - Path to MP4 file
 * @returns {Promise<Object|null>} Parsed kara data or null if not found
 */
export async function readKaraAtom(filePath) {
  try {
    const fileBuffer = await readFileToUint8(filePath, 'readKaraAtomBuffer');
    return readKaraAtomBuffer(fileBuffer);
  } catch (error) {
    throw new Error(`Failed to read kara atom: ${error.message}`);
  }
}

/**
 * Get karaoke features from an M4A file (Node path API).
 * @param {string} filePath - Path to MP4 file
 * @returns {Promise<Object>} Karaoke features flags
 */
export async function getKaraokeFeatures(filePath) {
  try {
    const fileBuffer = await readFileToUint8(filePath, 'getKaraokeFeaturesBuffer');
    return getKaraokeFeaturesBuffer(fileBuffer);
  } catch (error) {
    throw new Error(`Failed to get karaoke features: ${error.message}`);
  }
}

// ============================================================================
// dumpAtomTree — debug helper
// ============================================================================

/**
 * Dump the complete atom tree structure of an MP4 file (Node path API).
 * @param {string} filePath - Path to MP4 file
 * @param {number} maxDepth - Maximum depth to traverse (default: 10)
 * @returns {Promise<Array>} Array of atom objects with type, size, offset, and children
 */
export async function dumpAtomTree(filePath, maxDepth = 10) {
  const fileBuffer = await readFileToUint8(filePath, 'dumpAtomTreeBuffer');
  return dumpAtomTreeBuffer(fileBuffer, maxDepth);
}
