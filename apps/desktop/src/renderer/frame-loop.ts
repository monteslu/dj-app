/**
 * One shared requestAnimationFrame loop for the whole renderer. Every per-frame
 * consumer (waveform lanes, overviews, platters, VU meters, the SAB pump, the
 * perf monitor) subscribes here instead of starting its own rAF. A single rAF
 * driving N callbacks is cheaper and avoids any chance of competing loops getting
 * throttled independently — and makes the frame budget measurable in one place.
 */

type FrameFn = (now: number) => void;

const subs = new Set<FrameFn>();
let running = false;
let rafId = 0;

function loop(now: number): void {
  // copy to allow subscribe/unsubscribe during iteration
  for (const fn of [...subs]) {
    try {
      fn(now);
    } catch {
      /* one bad callback must not kill the loop */
    }
  }
  if (subs.size > 0) {
    rafId = requestAnimationFrame(loop);
  } else {
    running = false;
  }
}

/** Subscribe a per-frame callback. Returns an unsubscribe fn. */
export function onFrame(fn: FrameFn): () => void {
  subs.add(fn);
  if (!running) {
    running = true;
    rafId = requestAnimationFrame(loop);
  }
  return () => {
    subs.delete(fn);
    if (subs.size === 0 && running) {
      cancelAnimationFrame(rafId);
      running = false;
    }
  };
}
