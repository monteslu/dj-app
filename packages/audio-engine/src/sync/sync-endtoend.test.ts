import { describe, it, expect } from 'vitest';
import { ControlBus, standardControls, deck as deckGroup, DeckKeys } from '@dj/control-bus';
import { SyncController } from './sync-controller.js';
import { makeGrid, beatDistance, computeSnapTarget } from './beatgrid.js';

const SR = 48000;

// END-TO-END runtime test of the REAL SyncController (fake engine, no AudioContext):
// press SYNC on two DIFFERENT-BPM decks and assert the AUDIO positions are
// measure-aligned, the follower runs at the matched tempo, and they STAY locked
// over playback. Then drive the exact render grid math from the same positions to
// prove the VISUAL downbeats line up too — so audio and visual agree.

describe('SYNC end-to-end: different BPM decks lock audibly AND visually', () => {
  it('beat-aligns the audio + keeps the visual beat grids snapped over time', () => {
    const bus = new ControlBus();
    for (const c of standardControls(2)) bus.define(c);
    const pos = [0, 0];
    const rate = [1, 1];
    const total = SR * 300;
    const ctl = new SyncController({
      bus,
      numDecks: 2,
      sampleRate: SR,
      setRateRatio: (d, r) => {
        rate[d] = r === 0 ? 1 : r;
        bus.set(deckGroup(d + 1), DeckKeys.rateRatio, rate[d]!);
      },
      positionFrames: (d) => pos[d]!,
      trackFrames: () => total,
      seekFrames: (d, f) => {
        pos[d] = f;
      },
    });
    const g1 = deckGroup(1);
    const g2 = deckGroup(2);
    const leaderBpm = 128;
    const followerBpm = 120;

    bus.set(g1, DeckKeys.fileBpm, leaderBpm);
    bus.set(g1, DeckKeys.firstBeatFrame, 0);
    bus.set(g1, DeckKeys.play, 1);
    bus.set(g2, DeckKeys.fileBpm, followerBpm);
    bus.set(g2, DeckKeys.firstBeatFrame, 0);
    bus.set(g2, DeckKeys.play, 1);

    const lg = makeGrid(leaderBpm, 0, SR)!;
    const fg = makeGrid(followerBpm, 0, SR)!;
    const lFpb = lg.framesPerBeat;
    const fFpb = fg.framesPerBeat;

    // leader on a beat; follower deliberately OFF by ~0.4 beat — SNAP should jump it
    // onto the leader's exact beat.
    pos[0] = lFpb * 16;
    pos[1] = fFpb * 18 + fFpb * 0.4; // 0.4 beat off

    const beforeErr = Math.abs(beatDistance(lg, pos[0]) - beatDistance(fg, pos[1]));
    expect(Math.min(beforeErr, 1 - beforeErr), 'starts off-beat').toBeGreaterThan(0.2);

    // press SYNC: the controller matches tempo; the worklet does the phase snap on
    // its own exact position. Simulate that snap here with the same pure function.
    bus.set(g2, DeckKeys.syncEnabled, 1);
    pos[1] = computeSnapTarget(lg, pos[0], fg, pos[1]);

    // AUDIO: effective tempo matches AND the follower is now on the leader's BEAT.
    expect(followerBpm * rate[1]!, 'follower effective BPM == leader').toBeCloseTo(leaderBpm, 3);
    const phaseErr = Math.abs(beatDistance(lg, pos[0]) - beatDistance(fg, pos[1]));
    expect(Math.min(phaseErr, 1 - phaseErr), 'snapped onto the leader beat').toBeLessThan(0.01);

    // RENDER math (what the lane draws): nearest-BEAT screen-x for each deck.
    const baseFpp = 512;
    const W = 1200;
    const cx = W / 2;
    const beatX = (p: number, fpb: number, fpp: number) => {
      const nearest = Math.round(p / fpb);
      return cx + (nearest * fpb - p) / fpp;
    };

    const dt = 1 / 60;
    let maxVisual = 0;
    let maxAudioPhase = 0;
    for (let t = 0; t < 240; t++) {
      pos[0] += rate[0]! * SR * dt;
      pos[1] += rate[1]! * SR * dt;
      ctl.tick();
      const pe = Math.abs(beatDistance(lg, pos[0]) - beatDistance(fg, pos[1]));
      maxAudioPhase = Math.max(maxAudioPhase, Math.min(pe, 1 - pe));
      const lx = beatX(pos[0], lFpb, baseFpp * rate[0]!);
      const fx = beatX(pos[1], fFpb, baseFpp * rate[1]!);
      maxVisual = Math.max(maxVisual, Math.abs(lx - fx));
    }

    expect(maxAudioPhase, `audio beat drift over playback: ${maxAudioPhase.toFixed(4)}`).toBeLessThan(0.01);
    expect(maxVisual, `visual beat mismatch: ${maxVisual.toFixed(2)}px`).toBeLessThan(2);
  });
});
