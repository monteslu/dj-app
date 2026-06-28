/**
 * RateControl — tempo nudge (pitch-bend), Mixxx's rate_temp_up/down (+ _small).
 *
 * Holding a nudge button temporarily speeds up / slows down the deck so you can pull a
 * drifting beat back into phase, then snaps back when released. We express the nudge as
 * `rate_temp`, a signed delta the worklet ADDS to the computed speed (so it bends on top
 * of the pitch fader and sync without disturbing either). Press → set rate_temp; release
 * → clear it. Multiple buttons held sum (up+down cancels), matching Mixxx.
 *
 * Coarse/fine steps mirror Mixxx's defaults (RateTempCoarse 4%, RateTempFine 1% of the
 * effective rate), expressed here directly in speed-ratio units.
 */

import { DeckKeys, deck as deckGroup, type ControlBus } from '@dj/control-bus';

const COARSE = 0.04; // +4% speed while held (Mixxx RateTempCoarse default)
const FINE = 0.01; // +1% (RateTempFine / _small)
const PERM_COARSE = 0.01; // permanent rate-slider step (Mixxx RatePermCoarse default 1%)
const PERM_FINE = 0.0005; // _small permanent step
const BPM_STEP = 1; // beats_adjust_faster/slower: +/-1 BPM to the stored tempo

export interface RateControlDeps {
  bus: ControlBus;
  numDecks: number;
}

export class RateControl {
  private readonly offs: Array<() => void> = [];
  // Per-deck active nudges so up+down (or coarse+fine) combine correctly.
  private readonly held: Array<{ up: number; down: number }> = [];

  constructor(private readonly deps: RateControlDeps) {
    const { numDecks } = deps;
    for (let d = 0; d < numDecks; d++) {
      this.held[d] = { up: 0, down: 0 };
      const g = deckGroup(d + 1);
      this.bind(g, d, DeckKeys.rateTempUp, 'up', COARSE);
      this.bind(g, d, DeckKeys.rateTempDown, 'down', COARSE);
      this.bind(g, d, DeckKeys.rateTempUpSmall, 'up', FINE);
      this.bind(g, d, DeckKeys.rateTempDownSmall, 'down', FINE);
      // Permanent pitch step: nudge the rate slider and KEEP it (momentary pulse).
      this.pulse(g, DeckKeys.ratePermUp, () => this.permRate(g, PERM_COARSE));
      this.pulse(g, DeckKeys.ratePermDown, () => this.permRate(g, -PERM_COARSE));
      this.pulse(g, DeckKeys.ratePermUpSmall, () => this.permRate(g, PERM_FINE));
      this.pulse(g, DeckKeys.ratePermDownSmall, () => this.permRate(g, -PERM_FINE));
      // beats_adjust_*: nudge the track's stored BPM (the beatgrid tempo).
      this.pulse(g, DeckKeys.beatsAdjustFaster, () => this.adjustBpm(g, BPM_STEP));
      this.pulse(g, DeckKeys.beatsAdjustSlower, () => this.adjustBpm(g, -BPM_STEP));
    }
  }

  /** Momentary control: fire on a nonzero value, then reset to 0 so it re-triggers. */
  private pulse(g: string, key: string, fn: () => void): void {
    this.offs.push(
      this.deps.bus.connect(g, key, (v) => {
        if (v > 0.5) {
          fn();
          this.deps.bus.set(g, key, 0);
        }
      }),
    );
  }

  /** Permanently move the rate slider by `step` (clamped to [-1, 1]). */
  private permRate(g: string, step: number): void {
    const next = Math.max(-1, Math.min(1, this.deps.bus.get(g, DeckKeys.rate) + step));
    this.deps.bus.set(g, DeckKeys.rate, next);
  }

  /** Nudge the track's stored BPM by `deltaBpm` (keeps it positive). */
  private adjustBpm(g: string, deltaBpm: number): void {
    const bpm = this.deps.bus.get(g, DeckKeys.fileBpm);
    if (bpm > 0) this.deps.bus.set(g, DeckKeys.fileBpm, Math.max(1, bpm + deltaBpm));
  }

  /** A nudge button: while value>0 contribute +step to up/down; recompute rate_temp. */
  private bind(g: string, d: number, key: string, dir: 'up' | 'down', step: number): void {
    this.offs.push(
      this.deps.bus.connect(g, key, (v) => {
        // A button can repeat; track its contribution as present (step) or absent (0).
        this.held[d]![dir] = v > 0.5 ? Math.max(this.held[d]![dir], step) : 0;
        this.apply(g, d);
      }),
    );
  }

  private apply(g: string, d: number): void {
    const h = this.held[d]!;
    this.deps.bus.set(g, DeckKeys.rateTemp, h.up - h.down);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
