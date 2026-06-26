import { describe, it, expect } from 'vitest';
import { makeGrid, measureDistance, alignedToMeasure } from './beatgrid.js';

const SR = 48000;

// SYNC must align DOWNBEATS (measures), not just beats — otherwise beats match but
// the bars sit a beat or two apart ("bars not snapped together"). alignedToMeasure
// snaps the follower so its measure phase equals the leader's.
describe('measure (downbeat) alignment', () => {
  it('snaps the follower so its bar phase matches the leader, not just the beat', () => {
    const leader = makeGrid(128, 0, SR)!;
    const follower = makeGrid(120, 0, SR)!;
    const fpbL = leader.framesPerBeat;
    const fpbF = follower.framesPerBeat;

    // leader sitting on a downbeat (start of bar 2)
    const leaderFrame = fpbL * 4; // beat 4 = downbeat of bar 2
    const leaderMeasurePhase = measureDistance(leader, leaderFrame);
    expect(leaderMeasurePhase).toBeCloseTo(0, 5); // on a downbeat

    // follower starts mid-bar (beat 5 → 1 beat into a bar, measure phase = 0.25)
    const followerStart = fpbF * 5;
    expect(measureDistance(follower, followerStart)).toBeCloseTo(0.25, 5);

    // align → follower's MEASURE phase should now match the leader's (0)
    const aligned = alignedToMeasure(follower, followerStart, leaderMeasurePhase);
    expect(measureDistance(follower, aligned)).toBeCloseTo(leaderMeasurePhase, 5);

    // it moved the SMALLEST distance (≤ half a bar) — here back a quarter bar
    expect(Math.abs(aligned - followerStart)).toBeLessThanOrEqual(fpbF * 4 * 0.5 + 1);
  });

  it('beat-only alignment would have left them up to ~1 beat off; measure align fixes it', () => {
    const leader = makeGrid(128, 0, SR)!;
    const follower = makeGrid(120, 0, SR)!;
    // leader on a downbeat, follower 2 beats into a bar
    const leaderFrame = 0; // downbeat
    const followerStart = follower.framesPerBeat * 2; // measure phase 0.5
    const aligned = alignedToMeasure(follower, followerStart, measureDistance(leader, leaderFrame));
    // after measure align, both are on a downbeat (phase 0)
    expect(measureDistance(follower, aligned)).toBeCloseTo(0, 5);
  });
});
