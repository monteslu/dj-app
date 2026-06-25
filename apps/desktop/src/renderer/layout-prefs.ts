/**
 * Layout preferences — density + a few layout presets, CSS-driven and persisted.
 * Beyond Mixxx's fixed skins: instant one-click layouts via data-attributes that
 * the stylesheet reads, no per-skin files. Stored in localStorage.
 */

import { useCallback, useSyncExternalStore } from 'react';

export type Density = 'comfortable' | 'compact';
export type LayoutPreset = 'performance' | 'library' | 'minimal';

export interface LayoutPrefs {
  density: Density;
  preset: LayoutPreset;
}

const KEY = 'dj-layout-prefs';
const DEFAULTS: LayoutPrefs = { density: 'comfortable', preset: 'performance' };

let current: LayoutPrefs = load();
const listeners = new Set<() => void>();

function load(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LayoutPrefs>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

/** Apply prefs to the document root as data-attributes the CSS keys off of. */
export function applyPrefs(p: LayoutPrefs): void {
  const el = document.querySelector('.app') as HTMLElement | null;
  if (el) {
    el.dataset.density = p.density;
    el.dataset.layout = p.preset;
  }
}

export function setPrefs(patch: Partial<LayoutPrefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  applyPrefs(current);
  for (const l of listeners) l();
}

export function getPrefs(): LayoutPrefs {
  return current;
}

export function useLayoutPrefs(): LayoutPrefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getPrefs,
  );
}

/** Convenience hook returning prefs + setters. */
export function useLayoutControls() {
  const prefs = useLayoutPrefs();
  const toggleDensity = useCallback(() => {
    setPrefs({ density: getPrefs().density === 'compact' ? 'comfortable' : 'compact' });
  }, []);
  const setPreset = useCallback((preset: LayoutPreset) => setPrefs({ preset }), []);
  return { prefs, toggleDensity, setPreset };
}
