import { describe, it, expect, beforeEach } from 'vitest';
import { ControlBus, standardControls, deck as deckGroup, DeckKeys } from '@dj/control-bus';
import { RateControl } from './rate-control.js';

// Tempo nudge (Mixxx rate_temp_up/down + _small). Holding a button adds a temp delta to
// the deck speed (rate_temp), which the worklet adds on top of the pitch fader; release
// clears it. ~55 mappings use these as pitch-bend buttons.

function setup() {
  const bus = new ControlBus();
  for (const c of standardControls(2)) bus.define(c);
  const ctl = new RateControl({ bus, numDecks: 2 });
  const g = deckGroup(1);
  return { bus, ctl, g, temp: () => bus.get(g, DeckKeys.rateTemp) };
}

describe('RateControl (tempo nudge)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('press rate_temp_up adds a positive temp; release clears it', () => {
    s.bus.set(s.g, DeckKeys.rateTempUp, 1);
    expect(s.temp()).toBeCloseTo(0.04, 5); // +4% coarse
    s.bus.set(s.g, DeckKeys.rateTempUp, 0);
    expect(s.temp()).toBe(0); // snaps back
  });

  it('press rate_temp_down adds a negative temp', () => {
    s.bus.set(s.g, DeckKeys.rateTempDown, 1);
    expect(s.temp()).toBeCloseTo(-0.04, 5);
    s.bus.set(s.g, DeckKeys.rateTempDown, 0);
    expect(s.temp()).toBe(0);
  });

  it('_small variants are finer (1%)', () => {
    s.bus.set(s.g, DeckKeys.rateTempUpSmall, 1);
    expect(s.temp()).toBeCloseTo(0.01, 5);
    s.bus.set(s.g, DeckKeys.rateTempUpSmall, 0);
    s.bus.set(s.g, DeckKeys.rateTempDownSmall, 1);
    expect(s.temp()).toBeCloseTo(-0.01, 5);
  });

  it('up + down held together cancel out', () => {
    s.bus.set(s.g, DeckKeys.rateTempUp, 1);
    s.bus.set(s.g, DeckKeys.rateTempDown, 1);
    expect(s.temp()).toBeCloseTo(0, 5);
    // release down → only up remains
    s.bus.set(s.g, DeckKeys.rateTempDown, 0);
    expect(s.temp()).toBeCloseTo(0.04, 5);
  });

  it('is per-deck (deck 2 nudge does not touch deck 1)', () => {
    s.bus.set(deckGroup(2), DeckKeys.rateTempUp, 1);
    expect(s.bus.get(deckGroup(2), DeckKeys.rateTemp)).toBeCloseTo(0.04, 5);
    expect(s.temp()).toBe(0); // deck 1 unaffected
  });

  it('rate_perm_up/down permanently move the rate slider (and self-reset)', () => {
    s.bus.set(s.g, DeckKeys.ratePermUp, 1);
    expect(s.bus.get(s.g, DeckKeys.rate)).toBeCloseTo(0.01, 5);
    expect(s.bus.get(s.g, DeckKeys.ratePermUp)).toBe(0); // pulse reset
    s.bus.set(s.g, DeckKeys.ratePermUp, 1);
    expect(s.bus.get(s.g, DeckKeys.rate)).toBeCloseTo(0.02, 5); // accumulates
    s.bus.set(s.g, DeckKeys.ratePermDown, 1);
    expect(s.bus.get(s.g, DeckKeys.rate)).toBeCloseTo(0.01, 5);
  });

  it('rate_perm clamps to [-1, 1]', () => {
    s.bus.set(s.g, DeckKeys.rate, 0.999);
    s.bus.set(s.g, DeckKeys.ratePermUp, 1); // would exceed 1
    expect(s.bus.get(s.g, DeckKeys.rate)).toBe(1);
  });

  it('beats_adjust_faster/slower nudge the stored BPM', () => {
    s.bus.set(s.g, DeckKeys.fileBpm, 128);
    s.bus.set(s.g, DeckKeys.beatsAdjustFaster, 1);
    expect(s.bus.get(s.g, DeckKeys.fileBpm)).toBe(129);
    s.bus.set(s.g, DeckKeys.beatsAdjustSlower, 1);
    expect(s.bus.get(s.g, DeckKeys.fileBpm)).toBe(128);
  });
});
