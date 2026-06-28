import { describe, it, expect, beforeEach } from 'vitest';
import { ControlBus, standardControls, RECORDING, RecordingKeys } from '@dj/control-bus';
import { RecordingControl } from './recording-control.js';

// [Recording] toggle_recording → RecordingService, with status published so the UI button
// and a controller's REC button share one state.

function setup() {
  const bus = new ControlBus();
  for (const c of standardControls(2)) bus.define(c);
  let recording = false;
  let started = false;
  let saves = 0;
  const ctl = new RecordingControl({
    bus,
    start: async () => {
      recording = true;
    },
    stopAndSave: async () => {
      recording = false;
      saves++;
    },
    isRecording: () => recording,
    ensureStarted: async () => {
      started = true;
    },
  });
  return {
    bus,
    ctl,
    status: () => bus.get(RECORDING, RecordingKeys.status),
    rec: () => recording,
    startedFlag: () => started,
    saves: () => saves,
  };
}

describe('RecordingControl', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('toggle_recording starts recording (and the engine) + publishes status', async () => {
    s.bus.set(RECORDING, RecordingKeys.toggleRecording, 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.rec()).toBe(true);
    expect(s.startedFlag()).toBe(true);
    expect(s.bus.get(RECORDING, RecordingKeys.toggleRecording)).toBe(0); // pulse reset
  });

  it('toggling again stops + saves', async () => {
    await s.ctl.toggle(); // start
    expect(s.rec()).toBe(true);
    await s.ctl.toggle(); // stop+save
    expect(s.rec()).toBe(false);
    expect(s.saves()).toBe(1);
    expect(s.status()).toBe(0);
  });

  it('status reflects recording state', async () => {
    await s.ctl.toggle();
    expect(s.status()).toBe(1);
  });
});
