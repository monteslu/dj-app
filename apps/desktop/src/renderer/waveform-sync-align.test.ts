import { describe, it, expect } from 'vitest';
import { framesPerPxForZoom } from './waveform-lane.js';

// Reproduce the lane's grid math for two SYNCED decks (different native BPM) and
// assert their downbeats land at the SAME screen x over time — i.e. the bars/grids
// snap together. This is pure math (no audio engine / browser), so it's reliable.

const SR = 48000;
const W = 1200;
const centerX = W / 2;
const baseFpp = framesPerPxForZoom(2);

// On-screen x of the nearest downbeat to the playhead, exactly as the shader/2D
// renderer computes it: beatX = centerX + (beatFrame - pos) / framesPerPx.
function nearestDownbeatScreenX(
  posFrames: number,
  framesPerBeat: number,
  firstBeatFrame: number,
  framesPerPx: number,
): number {
  // nearest beat index to the playhead, snapped to a downbeat (every 4 beats)
  const beat = (posFrames - firstBeatFrame) / framesPerBeat;
  const downbeat = Math.round(beat / 4) * 4;
  const beatFrame = firstBeatFrame + downbeat * framesPerBeat;
  return centerX + (beatFrame - posFrames) / framesPerPx;
}

describe('synced decks: grids snap together', () => {
  it('two different-BPM synced decks draw downbeats at the same screen x', () => {
    const leaderBpm = 128;
    const followerBpm = 120;
    const rate = leaderBpm / followerBpm; // follower synced up to the leader

    const leaderFpb = (60 / leaderBpm) * SR;
    const followerFpb = (60 / followerBpm) * SR;
    const leaderFpp = baseFpp * 1.0;
    const followerFpp = baseFpp * rate;

    // 1) beat WIDTH on screen must match (the rate-scale fix)
    const leaderBeatPx = leaderFpb / leaderFpp;
    const followerBeatPx = followerFpb / followerFpp;
    expect(followerBeatPx).toBeCloseTo(leaderBeatPx, 3);

    // 2) the MEASURE-aligned snap: leader on a downbeat, follower snapped so its
    // DOWNBEAT matches (not just a beat). Both start on a downbeat → measures align.
    let leaderPos = leaderFpb * 8; // leader downbeat (beat 8, 8%4==0)
    let followerPos = followerFpb * 12; // follower downbeat (beat 12, 12%4==0)

    // 3) advance both for ~2s of playback; downbeat screen-x must stay matched.
    const dt = 1 / 60;
    let maxMismatch = 0;
    for (let t = 0; t < 120; t++) {
      leaderPos += 1.0 * SR * dt; // leader at rate 1
      followerPos += rate * SR * dt; // follower at synced rate
      const lx = nearestDownbeatScreenX(leaderPos, leaderFpb, 0, leaderFpp);
      const fx = nearestDownbeatScreenX(followerPos, followerFpb, 0, followerFpp);
      maxMismatch = Math.max(maxMismatch, Math.abs(lx - fx));
    }
    // grids stay aligned within a pixel
    expect(maxMismatch, `downbeat screen-x mismatch: ${maxMismatch.toFixed(2)}px`).toBeLessThan(1.5);
  });
});
