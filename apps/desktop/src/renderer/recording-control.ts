/**
 * RecordingControl — bridges the [Recording] bus controls to the RecordingService, so a
 * controller's REC button (toggle_recording) and the on-screen button drive the SAME
 * state. Publishes [Recording],status (1=recording) so both the UI and controller LEDs
 * reflect reality. toggle_recording is a pulse: start if idle, stop+save if recording.
 */

import { RECORDING, RecordingKeys, type ControlBus } from '@dj/control-bus';

export interface RecordingControlDeps {
  bus: ControlBus;
  start: () => Promise<void>;
  stopAndSave: () => Promise<unknown>;
  isRecording: () => boolean;
  /** Ensure the audio engine is started before recording (recording taps the master). */
  ensureStarted: () => Promise<void>;
}

export class RecordingControl {
  private readonly offs: Array<() => void> = [];
  private busy = false;

  constructor(private readonly deps: RecordingControlDeps) {
    this.publish();
    this.offs.push(
      deps.bus.connect(RECORDING, RecordingKeys.toggleRecording, (v) => {
        if (v > 0.5) {
          void this.toggle();
          deps.bus.set(RECORDING, RecordingKeys.toggleRecording, 0); // pulse reset
        }
      }),
    );
  }

  /** Start if idle, stop+save if recording. Guards against re-entrancy during save. */
  async toggle(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.deps.isRecording()) {
        await this.deps.stopAndSave();
      } else {
        await this.deps.ensureStarted();
        await this.deps.start();
      }
    } catch {
      /* swallow — a failed start/stop shouldn't wedge the control */
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  /** Reflect the live recording state on the bus (UI + LEDs read it). */
  publish(): void {
    this.deps.bus.set(RECORDING, RecordingKeys.status, this.deps.isRecording() ? 1 : 0);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
