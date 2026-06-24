/**
 * Metaknob link math (Mixxx EffectKnobParameterSlot::onEffectMetaParameterChanged
 * analog, 06-ui-controllers-effects.md §3.7). Pure functions: given the metaknob
 * (0..1) and a parameter's link type, compute the parameter's 0..1 value. This is
 * sparse event-driven JS (runs on knob moves, not per-sample) — orchestration,
 * not heavy lifting.
 *
 * The Filter trick: LPF = linkedLeft (neutral at metaknob 0, sweeps as knob → 0.5),
 * HPF = linkedRight (neutral at metaknob 1, sweeps as knob 0.5 → 1). One knob
 * sweeps lowpass → neutral → highpass.
 */

import type { LinkType, EffectParamManifest } from './effect-types.js';

/**
 * Compute a parameter's normalized (0..1) value from the metaknob position.
 * Returns null if the param isn't linked (caller leaves it at its manual value).
 */
export function metaknobToParam(
  meta: number,
  link: LinkType,
  m: EffectParamManifest,
  inverted = false,
): number | null {
  const neutral = m.neutral ?? normalizedDefault(m);
  let p: number;
  switch (link) {
    case 'none':
      return null;
    case 'linked':
      // Full sweep: param goes 0→1 across the whole knob.
      p = meta;
      break;
    case 'linkedLeft':
      // Active over the LEFT half. At meta 0.5..1 the param sits at neutral; as
      // the knob moves 0.5→0 the param sweeps neutral→0 (e.g. LPF cutoff closing).
      p = meta >= 0.5 ? neutral : neutral * (meta / 0.5);
      break;
    case 'linkedRight':
      // Active over the RIGHT half. At meta 0..0.5 the param sits at neutral; as
      // the knob moves 0.5→1 the param sweeps neutral→1 (e.g. HPF cutoff opening).
      p = meta <= 0.5 ? neutral : neutral + (1 - neutral) * ((meta - 0.5) / 0.5);
      break;
    case 'linkedLeftRight':
      // V-shape: neutral at center, sweeps toward an extreme at both ends.
      p = neutral + (1 - neutral) * (Math.abs(meta - 0.5) * 2);
      break;
    default:
      return null;
  }
  return inverted ? 1 - clamp01(p) : clamp01(p);
}

function normalizedDefault(m: EffectParamManifest): number {
  const span = m.max - m.min;
  return span === 0 ? 0 : (m.default - m.min) / span;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
