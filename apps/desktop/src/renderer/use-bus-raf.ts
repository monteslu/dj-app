/**
 * useBusRaf — run a callback on every animation frame for a mounted component,
 * with stable teardown. The shared primitive for the small per-frame "read the
 * bus → poke the DOM" meters/indicators, so each component doesn't hand-roll its
 * own rAF effect. The callback should read live state itself (not via deps).
 */

import { useEffect, useRef } from 'react';

export function useBusRaf(fn: () => void): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      fnRef.current();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}
