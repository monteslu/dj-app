import { describe, it, expect } from 'vitest';
import { nameTokens, isVirtualPort, matchPort } from './controller-service.js';

// Regression tests for the controller auto-connect / device matching that failed in the
// field with a Numark DJ2GO2 Touch: the mapping is named "Numark DJ2GO2 Touch" but the
// OS device is "DJ2GO2 Touch MIDI 1", and ALSA also exposes a "Midi Through Port-0"
// virtual loopback that auto-connect wrongly grabbed.

const port = (name: string) => ({ name });

describe('nameTokens', () => {
  it('keeps identity tokens, drops noise words + pure numbers', () => {
    expect(nameTokens('DJ2GO2 Touch MIDI 1')).toEqual(['dj2go2', 'touch']);
    expect(nameTokens('Numark DJ2GO2 Touch')).toEqual(['numark', 'dj2go2', 'touch']);
    expect(nameTokens('Midi Through Port-0')).toEqual(['through']);
  });
});

describe('isVirtualPort', () => {
  it('flags ALSA/IAC/loopback virtual ports', () => {
    expect(isVirtualPort('Midi Through Port-0')).toBe(true);
    expect(isVirtualPort('IAC Driver Bus 1')).toBe(true);
    expect(isVirtualPort('loopMIDI Port')).toBe(true);
  });
  it('does NOT flag real controllers', () => {
    expect(isVirtualPort('DJ2GO2 Touch MIDI 1')).toBe(false);
    expect(isVirtualPort('Numark DJ2GO2 Touch')).toBe(false);
    expect(isVirtualPort(null)).toBe(false);
  });
});

describe('matchPort', () => {
  const ports = [port('Midi Through Port-0'), port('DJ2GO2 Touch MIDI 1')];

  it('binds a mapping name to the real OS device via shared tokens (the field bug)', () => {
    // "Numark DJ2GO2 Touch" shares dj2go2+touch with "DJ2GO2 Touch MIDI 1" → match.
    expect(matchPort(ports, 'Numark DJ2GO2 Touch')?.name).toBe('DJ2GO2 Touch MIDI 1');
  });

  it('prefers an exact (case-insensitive) name when present', () => {
    expect(matchPort(ports, 'dj2go2 touch midi 1')?.name).toBe('DJ2GO2 Touch MIDI 1');
  });

  it('picks the candidate with the most shared tokens', () => {
    const many = [port('DJ2GO2 Touch MIDI 1'), port('Numark DJ2GO2 Touch Deck')];
    // "Numark DJ2GO2 Touch" shares 3 tokens with the second, 2 with the first.
    expect(matchPort(many, 'Numark DJ2GO2 Touch')?.name).toBe('Numark DJ2GO2 Touch Deck');
  });

  it('returns null when nothing shares an identity token', () => {
    expect(matchPort([port('Launchpad Mini')], 'Numark DJ2GO2 Touch')).toBeNull();
  });

  it('does not match purely on noise words', () => {
    // Only shared token would be "midi"/"port" (noise) → no match.
    expect(matchPort([port('Some Other MIDI Port 2')], 'Generic MIDI')).toBeNull();
  });
});
