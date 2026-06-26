/**
 * Low-level byte primitives.
 *
 * The ONE place for byte/buffer ops in stem-mp4. Everything is Uint8Array /
 * DataView based and works identically in Node and the browser — no Node
 * Buffer, no `fs`. Every other module reuses this single vocabulary instead of
 * re-implementing buffer manipulation.
 */

/**
 * Helper: Read big-endian uint32 from Uint8Array
 */
export function readUInt32BE(data, offset) {
  return (
    ((data[offset] << 24) >>> 0) +
    (data[offset + 1] << 16) +
    (data[offset + 2] << 8) +
    data[offset + 3]
  );
}

/**
 * Helper: Read big-endian uint64 from Uint8Array (as Number)
 */
export function readBigUInt64BE(data, offset) {
  const high = readUInt32BE(data, offset);
  const low = readUInt32BE(data, offset + 4);
  return high * 0x100000000 + low;
}

/**
 * Helper: Write big-endian uint64 to Uint8Array (value as Number)
 */
export function writeBigUInt64BE(data, value, offset) {
  const high = Math.floor(value / 0x100000000);
  const low = value % 0x100000000;
  writeUInt32BE(data, high, offset);
  writeUInt32BE(data, low >>> 0, offset + 4);
}

/**
 * Helper: Read uint8 from Uint8Array
 */
export function readUInt8(data, offset) {
  return data[offset];
}

/**
 * Write a signed 8-bit integer into a Uint8Array.
 */
export function writeInt8(data, value, offset) {
  data[offset] = value & 0xff; // two's complement wrap, matches Buffer.writeInt8
}

/**
 * Helper: Read latin1 string from Uint8Array
 */
export function readString(data, offset, length) {
  let str = '';
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(data[offset + i]);
  }
  return str;
}

/**
 * Helper: Write big-endian uint32 to Uint8Array
 */
export function writeUInt32BE(data, value, offset) {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}

/**
 * Helper: Write big-endian uint16 to Uint8Array
 */
export function writeUInt16BE(data, value, offset) {
  data[offset] = (value >>> 8) & 0xff;
  data[offset + 1] = value & 0xff;
}

/**
 * Helper: Write latin1 string to Uint8Array
 */
export function writeString(data, str, offset) {
  for (let i = 0; i < str.length; i++) {
    data[offset + i] = str.charCodeAt(i);
  }
}

/**
 * Helper: Concatenate multiple Uint8Arrays
 */
export function concatArrays(...arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Helper: Create a slice of Uint8Array
 */
export function sliceArray(data, start, end) {
  return data.slice(start, end);
}

/**
 * Normalize input to Uint8Array
 * Accepts:
 * - Uint8Array (works everywhere)
 * - ArrayBuffer (works everywhere, e.g., from fetch)
 * - Node.js Buffer (Node.js only)
 * @param {Uint8Array|ArrayBuffer|Buffer} data
 * @returns {Uint8Array}
 */
export function toUint8Array(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  // Node.js Buffer (has .buffer property pointing to underlying ArrayBuffer)
  if (data && data.buffer instanceof ArrayBuffer) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error('Expected Uint8Array, ArrayBuffer, or Node.js Buffer');
}

// ============================================================================
// Text encode/decode (UTF-8), isomorphic.
// ============================================================================

const _hasTextEncoder = typeof TextEncoder !== 'undefined';
const _hasTextDecoder = typeof TextDecoder !== 'undefined';
const _textEncoder = _hasTextEncoder ? new TextEncoder() : null;
const _textDecoder = _hasTextDecoder ? new TextDecoder('utf-8') : null;

/**
 * Encode a JS string to UTF-8 bytes (isomorphic).
 */
export function utf8Encode(str) {
  if (_textEncoder) return _textEncoder.encode(str);
  // Fallback (extremely old environments): manual UTF-8 encoder.
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const hi = code;
      const lo = str.charCodeAt(++i);
      code = 0x10000 + ((hi & 0x3ff) << 10) + (lo & 0x3ff);
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(out);
}

/**
 * Decode UTF-8 bytes (a Uint8Array view/slice) to a JS string (isomorphic).
 */
export function utf8Decode(data) {
  if (_textDecoder) return _textDecoder.decode(data);
  // Fallback manual UTF-8 decoder.
  let str = '';
  let i = 0;
  while (i < data.length) {
    const b = data[i++];
    if (b < 0x80) {
      str += String.fromCharCode(b);
    } else if (b >= 0xc0 && b < 0xe0) {
      str += String.fromCharCode(((b & 0x1f) << 6) | (data[i++] & 0x3f));
    } else if (b >= 0xe0 && b < 0xf0) {
      str += String.fromCharCode(((b & 0x0f) << 12) | ((data[i++] & 0x3f) << 6) | (data[i++] & 0x3f));
    } else {
      const cp =
        ((b & 0x07) << 18) |
        ((data[i++] & 0x3f) << 12) |
        ((data[i++] & 0x3f) << 6) |
        (data[i++] & 0x3f);
      const off = cp - 0x10000;
      str += String.fromCharCode(0xd800 + (off >> 10), 0xdc00 + (off & 0x3ff));
    }
  }
  return str;
}
