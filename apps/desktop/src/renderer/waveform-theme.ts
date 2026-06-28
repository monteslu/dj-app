/**
 * Bridges the CSS theme tokens → the canvas waveform renderer (which can't read CSS vars).
 * Reads the live `--` colors off the .app element and builds a WaveformColors object; the
 * controllers call themedWaveformColors() and re-read it on theme change so the waveform
 * recolors with the rest of the UI.
 */

import { DEFAULT_COLORS, type WaveformColors } from '@dj/waveform';
import { getTheme } from './theme.js';

let cache: WaveformColors = DEFAULT_COLORS;
let cachedFor = '__none__';

function cssVar(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
}

/** Build WaveformColors from the current theme's CSS tokens (cached per theme id). */
export function themedWaveformColors(): WaveformColors {
  const theme = getTheme();
  if (theme === cachedFor) return cache;

  const app = document.querySelector('.app');
  if (!app) return DEFAULT_COLORS; // before mount → defaults
  const s = getComputedStyle(app);

  const accent = cssVar(s, '--accent') || DEFAULT_COLORS.wave;
  const accent2 = cssVar(s, '--accent-2') || DEFAULT_COLORS.played;
  const sunken = cssVar(s, '--sunken') || DEFAULT_COLORS.background;
  const sunken2 = cssVar(s, '--sunken-2') || '#06090e';
  const edge = cssVar(s, '--edge') || DEFAULT_COLORS.axis;
  const danger = cssVar(s, '--danger') || DEFAULT_COLORS.playhead;
  const play = cssVar(s, '--play') || '#4ade80';
  const textFaint = cssVar(s, '--text-faint') || '#7d8696';

  cache = {
    background: sunken,
    bgDeep: sunken2,
    wave: accent,
    played: accent2,
    playhead: danger,
    axis: edge,
    // beat ticks: a translucent version of the faint text so they read on any bg
    beat: rgbaFrom(textFaint, 0.4) ?? DEFAULT_COLORS.beat!,
    measure: danger,
    loopActive: rgbaFrom(play, 0.18) ?? DEFAULT_COLORS.loopActive!,
    loopInactive: rgbaFrom(textFaint, 0.12) ?? DEFAULT_COLORS.loopInactive!,
  };
  cachedFor = theme;
  return cache;
}

/** Convert a #rrggbb (or #rgb) hex to an rgba() string at the given alpha. Returns null for
 *  non-hex inputs (caller falls back to a default). */
function rgbaFrom(hex: string, alpha: number): string | null {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
