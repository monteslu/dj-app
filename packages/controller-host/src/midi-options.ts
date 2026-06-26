/**
 * MIDI value transforms — the Mixxx MidiController::computeValue analog
 * (06-ui-controllers-effects.md §2.5). Applies the <options> on a direct (non-
 * script) MIDI binding to turn the raw 0..127 byte into a control value. Ported
 * to match Mixxx's behavior so direct bindings in stock mappings work.
 */

export interface MidiOptions {
  invert?: boolean;
  /** Relative/diff encoder: value is a signed delta around 64. */
  diff?: boolean;
  /** 2's-complement rotary around 64 (rot64). */
  rot64?: boolean;
  /** Spread-64 rotary. */
  spread64?: boolean;
  /** Button: any non-zero → 1. */
  button?: boolean;
  /** Switch: 0/127 → 0/1. */
  switchMode?: boolean;
  /** 14-bit (paired MSB/LSB) — combined by the router; flagged here. */
  fourteenBit?: boolean;
  /** Route to a script function instead of a control. */
  script?: boolean;
}

/**
 * Compute the new control value from a raw MIDI data byte (0..127) and the
 * current control value, applying the binding's options. `prev` is the control's
 * current value (needed for relative/diff modes).
 *
 * Returns the new value in the control's native units for absolute modes, or a
 * delta-applied value for relative modes. For potmeters Mixxx maps 0..127 to the
 * control's parameter range; here we return the normalized 0..1 for absolute and
 * let the caller setParameter, OR an absolute delta for relative. We keep it
 * simple: absolute → 0..1 parameter; relative → prevParam + delta.
 */
export function computeMidiParameter(value: number, prevParam: number, opts: MidiOptions): number {
  if (opts.button || opts.switchMode) {
    const v = value > 0 ? 1 : 0;
    return opts.invert ? 1 - v : v;
  }

  if (opts.diff) {
    // Signed delta: 1..63 = positive, 65..127 = negative (centered at 64).
    const delta = value < 64 ? value : value - 128;
    const step = delta / 127;
    return clamp01(prevParam + (opts.invert ? -step : step));
  }

  if (opts.rot64) {
    // 2's-complement around 64.
    const delta = value - 64;
    const step = delta / 127;
    return clamp01(prevParam + (opts.invert ? -step : step));
  }

  if (opts.spread64) {
    const delta = value - 64;
    const step = (delta * Math.abs(delta)) / (63 * 63); // accelerated spread
    return clamp01(prevParam + (opts.invert ? -step : step));
  }

  // Absolute: 0..127 → 0..1 parameter.
  const p = value / 127;
  return opts.invert ? 1 - p : p;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Whether these options describe a relative (delta) encoder. */
export function isRelative(opts: MidiOptions): boolean {
  return !!(opts.diff || opts.rot64 || opts.spread64);
}
