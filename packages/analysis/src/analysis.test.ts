import { describe, it, expect } from 'vitest';
import { Beats } from './beats.js';

describe('Beats', () => {
  const b = new Beats(120, 1000, 48000); // 120bpm → 0.5s/beat → 24000 frames/beat

  it('computes framesPerBeat', () => {
    expect(b.framesPerBeat).toBe(24000);
  });

  it('finds beat frames, nearest/next/prev', () => {
    expect(b.beatFrame(0)).toBe(1000);
    expect(b.beatFrame(2)).toBe(1000 + 48000);
    expect(b.nearestBeat(1000 + 12000)).toBe(1000 + 24000); // just past halfway → next
    expect(b.nextBeat(1000)).toBe(1000); // on a beat
    expect(b.nextBeat(1001)).toBe(1000 + 24000);
    expect(b.prevBeat(1000 + 23999)).toBe(1000);
  });

  it('beatDistance is 0 on a beat and ~0.5 halfway', () => {
    expect(b.beatDistance(1000)).toBeCloseTo(0, 5);
    expect(b.beatDistance(1000 + 12000)).toBeCloseTo(0.5, 5);
  });

  it('scale/translate/withBpm return new grids', () => {
    expect(b.scale(2).bpm).toBe(240);
    expect(b.translate(500).firstBeatFrame).toBe(1500);
    expect(b.withBpm(128).bpm).toBe(128);
  });

  it('round-trips JSON', () => {
    const j = b.toJSON();
    const b2 = Beats.fromJSON(j);
    expect(b2.bpm).toBe(b.bpm);
    expect(b2.firstBeatFrame).toBe(b.firstBeatFrame);
  });
});
