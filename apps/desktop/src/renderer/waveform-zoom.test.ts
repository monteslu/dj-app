import { describe, it, expect } from 'vitest';
import { ZOOM_PRESETS, framesPerPxForZoom } from './waveform-lane.js';

// The fixed zoom presets: a small set of frames-per-pixel scales the user cycles.
// Higher index = more frames/px = zoomed OUT (more of the track on screen).
describe('waveform zoom presets', () => {
  it('has a few ascending fixed scales', () => {
    expect(ZOOM_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ZOOM_PRESETS.length; i++) {
      expect(ZOOM_PRESETS[i]!).toBeGreaterThan(ZOOM_PRESETS[i - 1]!);
    }
  });

  it('maps an index to its preset and clamps out-of-range', () => {
    expect(framesPerPxForZoom(0)).toBe(ZOOM_PRESETS[0]);
    expect(framesPerPxForZoom(ZOOM_PRESETS.length - 1)).toBe(ZOOM_PRESETS.at(-1));
    expect(framesPerPxForZoom(-5)).toBe(ZOOM_PRESETS[0]); // clamp low
    expect(framesPerPxForZoom(999)).toBe(ZOOM_PRESETS.at(-1)); // clamp high
    expect(framesPerPxForZoom(1.4)).toBe(ZOOM_PRESETS[1]); // rounds
  });

  it('zooming out shows more frames per pixel', () => {
    expect(framesPerPxForZoom(4)).toBeGreaterThan(framesPerPxForZoom(0));
  });
});
