/**
 * useBusRaf — run a callback on the shared frame loop for a mounted component,
 * with stable teardown. The shared primitive for the small per-frame "read the
 * bus → poke the DOM" meters/indicators, so each component doesn't hand-roll its
 * own rAF. The callback should read live state itself (not via deps).
 */

import { useEffect, useRef } from 'react';
import { onFrame } from './frame-loop.js';

export function useBusRaf(fn: () => void): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => onFrame(() => fnRef.current()), []);
}
