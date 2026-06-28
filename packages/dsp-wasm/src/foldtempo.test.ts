import { describe, it, expect } from 'vitest';
import { foldTempo } from './qmanalysis.js';

// Octave folding corrects the beat tracker's 2x/half errors. Window [82, 164).
describe('foldTempo', () => {
  it('halves doubled tempos into the window', () => {
    expect(foldTempo(176)).toBeCloseTo(88, 5); // Piano Man
    expect(foldTempo(172)).toBeCloseTo(86, 5); // A Change Is Gonna Come
    expect(foldTempo(258)).toBeCloseTo(129, 5); // Running On Empty (2x of 129)
  });
  it('leaves in-window tempos alone', () => {
    expect(foldTempo(128)).toBe(128);
    expect(foldTempo(90)).toBe(90);
    expect(foldTempo(155)).toBe(155); // genuine fast punk stays
    expect(foldTempo(82)).toBe(82); // floor inclusive
    expect(foldTempo(163.9)).toBeCloseTo(163.9, 5); // just under ceiling
  });
  it('doubles very slow (half-time) tempos up into the window', () => {
    expect(foldTempo(60)).toBeCloseTo(120, 5); // 60 -> 120
    expect(foldTempo(40)).toBeCloseTo(160, 5); // 40 -> 80 -> 160 (both under floor)
    expect(foldTempo(81)).toBeCloseTo(162, 5); // 81 -> 162 (just under floor)
  });
  it('handles invalid input', () => {
    expect(foldTempo(0)).toBe(0);
    expect(foldTempo(-5)).toBe(-5);
    expect(foldTempo(NaN)).toBeNaN();
  });
});
