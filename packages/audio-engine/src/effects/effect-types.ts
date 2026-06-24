/**
 * Effects framework types (Mixxx EffectManifest/EffectProcessor analog,
 * 06-ui-controllers-effects.md §3). Effects are NATIVE Web Audio nodes — their
 * DSP runs in the browser's optimized C++, not JS, so they satisfy the
 * "zero heavy lifting in JS" rule for free. Only effects with no native analog
 * become AudioWorklet+WASM (none in the M8 starter set).
 *
 * An EffectInstance wraps an input→[dsp]→output subgraph and exposes parameters
 * + a metaknob link (the routing/link math is sparse event-driven JS = fine).
 */

/** How a parameter links to the unit metaknob (Mixxx LinkType). */
export type LinkType = 'none' | 'linked' | 'linkedLeft' | 'linkedRight' | 'linkedLeftRight';

export interface EffectParamManifest {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  /** Default metaknob link (the Filter trick: LPF=linkedLeft, HPF=linkedRight). */
  defaultLink: LinkType;
  /** Map a 0..1 param to the audio value (e.g. log for frequency). */
  scale?: 'linear' | 'log';
  /** Neutral point on the 0..1 scale (where the param has no effect). */
  neutral?: number;
}

export interface EffectManifest {
  id: string;
  name: string;
  params: EffectParamManifest[];
  /** Whether the effect adds dry signal to wet internally (vs the unit doing it). */
  addDryToWet?: boolean;
}

/**
 * A live effect instance: a Web Audio subgraph (input → DSP → output) plus its
 * parameter setters. Created by an EffectFactory for a given AudioContext.
 */
export interface EffectInstance {
  readonly manifest: EffectManifest;
  /** Node to connect the deck signal into. */
  readonly input: AudioNode;
  /** Node carrying the processed (wet) signal out. */
  readonly output: AudioNode;
  /** Set a parameter by key, value in the manifest's [min,max]. */
  setParam(key: string, value: number): void;
  /** Release nodes. */
  dispose(): void;
}

/** Factory: build an effect instance for a context. */
export type EffectFactory = (ctx: BaseAudioContext) => EffectInstance;

/** A registered effect: manifest + factory. */
export interface RegisteredEffect {
  manifest: EffectManifest;
  create: EffectFactory;
}

/** Map a 0..1 normalized value to [min,max] with optional log scaling. */
export function denormalize(p: number, m: EffectParamManifest): number {
  const t = p < 0 ? 0 : p > 1 ? 1 : p;
  if (m.scale === 'log') {
    const lo = Math.log(Math.max(1e-6, m.min));
    const hi = Math.log(m.max);
    return Math.exp(lo + t * (hi - lo));
  }
  return m.min + t * (m.max - m.min);
}

/** Inverse of denormalize. */
export function normalize(v: number, m: EffectParamManifest): number {
  if (m.scale === 'log') {
    const lo = Math.log(Math.max(1e-6, m.min));
    const hi = Math.log(m.max);
    return (Math.log(Math.max(1e-6, v)) - lo) / (hi - lo);
  }
  const span = m.max - m.min;
  return span === 0 ? 0 : (v - m.min) / span;
}
