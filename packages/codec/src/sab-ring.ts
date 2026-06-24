/**
 * SabRing — a single-producer/single-consumer lock-free ring buffer over a
 * SharedArrayBuffer (the sidechain pattern, 04-audio-engine.md §7). The recorder
 * worklet (producer) writes interleaved float samples; a Worker (consumer) drains
 * them to accumulate/encode. No allocation, no locks on the audio thread.
 *
 * Layout: an Int32 header [writeIndex, readIndex, droppedCount] + a Float32 data
 * region of `capacity` samples (power-of-two for cheap masking).
 */

const HDR_WRITE = 0;
const HDR_READ = 1;
const HDR_DROPPED = 2;
const HDR_INTS = 4;

export interface SabRingViews {
  header: Int32Array;
  data: Float32Array;
  capacity: number;
}

/** Allocate a ring for `capacity` floats (rounded up to a power of two). */
export function allocateRing(capacity: number): { buffer: SharedArrayBuffer; views: SabRingViews } {
  const cap = nextPow2(capacity);
  const headerBytes = HDR_INTS * 4;
  const buffer = new SharedArrayBuffer(headerBytes + cap * 4);
  return { buffer, views: wrapRing(buffer, cap) };
}

export function wrapRing(buffer: SharedArrayBuffer, capacity: number): SabRingViews {
  const header = new Int32Array(buffer, 0, HDR_INTS);
  const data = new Float32Array(buffer, HDR_INTS * 4, capacity);
  return { header, data, capacity };
}

/** Producer: write `n` samples from `src`. On overflow, drop + bump the counter. */
export function ringWrite(r: SabRingViews, src: Float32Array, n: number): void {
  const mask = r.capacity - 1;
  const write = Atomics.load(r.header, HDR_WRITE);
  const read = Atomics.load(r.header, HDR_READ);
  const free = r.capacity - (write - read);
  if (n > free) {
    Atomics.add(r.header, HDR_DROPPED, n);
    return; // drop this block rather than blocking the audio thread
  }
  for (let i = 0; i < n; i++) {
    r.data[(write + i) & mask] = src[i]!;
  }
  Atomics.store(r.header, HDR_WRITE, write + n);
}

/** Consumer: read up to `out.length` samples. Returns the count read. */
export function ringRead(r: SabRingViews, out: Float32Array): number {
  const mask = r.capacity - 1;
  const write = Atomics.load(r.header, HDR_WRITE);
  const read = Atomics.load(r.header, HDR_READ);
  const available = write - read;
  const n = Math.min(available, out.length);
  for (let i = 0; i < n; i++) {
    out[i] = r.data[(read + i) & mask]!;
  }
  Atomics.store(r.header, HDR_READ, read + n);
  return n;
}

export function ringDropped(r: SabRingViews): number {
  return Atomics.load(r.header, HDR_DROPPED);
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) {
    p <<= 1;
  }
  return p;
}
