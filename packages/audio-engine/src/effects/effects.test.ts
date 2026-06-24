import { describe, it, expect } from 'vitest';
import { metaknobToParam } from './metaknob.js';
import { denormalize, normalize, type EffectParamManifest } from './effect-types.js';
import { BUILTIN_EFFECTS, getEffect } from './builtin-effects.js';

const linearParam: EffectParamManifest = {
  key: 'x',
  label: 'X',
  min: 0,
  max: 10,
  default: 5,
  defaultLink: 'none',
};

const logParam: EffectParamManifest = {
  key: 'f',
  label: 'F',
  min: 20,
  max: 20000,
  default: 1000,
  defaultLink: 'none',
  scale: 'log',
};

describe('denormalize/normalize', () => {
  it('linear maps 0..1 onto [min,max]', () => {
    expect(denormalize(0, linearParam)).toBe(0);
    expect(denormalize(1, linearParam)).toBe(10);
    expect(denormalize(0.5, linearParam)).toBe(5);
    expect(normalize(5, linearParam)).toBeCloseTo(0.5);
  });

  it('log maps exponentially (good for frequency)', () => {
    expect(denormalize(0, logParam)).toBeCloseTo(20, 0);
    expect(denormalize(1, logParam)).toBeCloseTo(20000, 0);
    // midpoint is the geometric mean, not the arithmetic
    expect(denormalize(0.5, logParam)).toBeCloseTo(Math.sqrt(20 * 20000), -1);
    expect(normalize(denormalize(0.3, logParam), logParam)).toBeCloseTo(0.3, 5);
  });
});

describe('metaknobToParam (the Filter trick)', () => {
  const lpf: EffectParamManifest = {
    key: 'lpf',
    label: 'LPF',
    min: 20,
    max: 22000,
    default: 22000,
    defaultLink: 'linkedLeft',
    neutral: 1, // open (no filtering) at neutral
  };
  const hpf: EffectParamManifest = {
    key: 'hpf',
    label: 'HPF',
    min: 20,
    max: 22000,
    default: 20,
    defaultLink: 'linkedRight',
    neutral: 0, // open (no filtering) at neutral
  };

  it('linkedLeft (LPF): neutral on the right half, closes on the left', () => {
    // meta 0.5..1 → neutral (1, fully open)
    expect(metaknobToParam(0.75, 'linkedLeft', lpf)).toBeCloseTo(1);
    expect(metaknobToParam(0.5, 'linkedLeft', lpf)).toBeCloseTo(1);
    // meta 0 → fully closed (0)
    expect(metaknobToParam(0, 'linkedLeft', lpf)).toBeCloseTo(0);
    // meta 0.25 → halfway closed
    expect(metaknobToParam(0.25, 'linkedLeft', lpf)).toBeCloseTo(0.5);
  });

  it('linkedRight (HPF): neutral on the left half, opens on the right', () => {
    expect(metaknobToParam(0.25, 'linkedRight', hpf)).toBeCloseTo(0); // neutral
    expect(metaknobToParam(0.5, 'linkedRight', hpf)).toBeCloseTo(0);
    expect(metaknobToParam(1, 'linkedRight', hpf)).toBeCloseTo(1); // full
    expect(metaknobToParam(0.75, 'linkedRight', hpf)).toBeCloseTo(0.5);
  });

  it('one metaknob sweeps lowpass → neutral → highpass', () => {
    // far left: LPF closing, HPF neutral
    expect(metaknobToParam(0, 'linkedLeft', lpf)!).toBeLessThan(0.5);
    expect(metaknobToParam(0, 'linkedRight', hpf)!).toBeCloseTo(0);
    // center: both neutral (full open / full closed-out = no effect)
    expect(metaknobToParam(0.5, 'linkedLeft', lpf)!).toBeCloseTo(1);
    expect(metaknobToParam(0.5, 'linkedRight', hpf)!).toBeCloseTo(0);
    // far right: LPF neutral, HPF opening
    expect(metaknobToParam(1, 'linkedLeft', lpf)!).toBeCloseTo(1);
    expect(metaknobToParam(1, 'linkedRight', hpf)!).toBeGreaterThan(0.5);
  });

  it('none returns null (param stays manual)', () => {
    expect(metaknobToParam(0.5, 'none', linearParam)).toBeNull();
  });

  it('linked is a full sweep', () => {
    expect(metaknobToParam(0, 'linked', linearParam)).toBe(0);
    expect(metaknobToParam(1, 'linked', linearParam)).toBe(1);
  });

  it('inverted flips the result', () => {
    expect(metaknobToParam(0, 'linked', linearParam, true)).toBe(1);
  });
});

describe('builtin effect registry', () => {
  it('exposes the starter set', () => {
    const ids = BUILTIN_EFFECTS.map((e) => e.manifest.id);
    expect(ids).toContain('filter');
    expect(ids).toContain('echo');
    expect(ids).toContain('reverb');
    expect(ids).toContain('distortion');
    expect(ids).toContain('bitcrusher');
  });

  it('getEffect resolves by id', () => {
    expect(getEffect('echo')?.manifest.name).toBe('Echo');
    expect(getEffect('nope')).toBeUndefined();
  });

  it('every effect has well-formed params', () => {
    for (const e of BUILTIN_EFFECTS) {
      for (const p of e.manifest.params) {
        expect(p.max).toBeGreaterThan(p.min);
        expect(p.default).toBeGreaterThanOrEqual(p.min);
        expect(p.default).toBeLessThanOrEqual(p.max);
      }
    }
  });
});
