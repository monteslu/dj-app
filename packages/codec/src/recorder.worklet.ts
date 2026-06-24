/**
 * Recorder worklet — the master-bus tap (Mixxx sidechain, 04-audio-engine.md §7).
 * Sits on the master bus as a pass-through; when armed, interleaves its input and
 * writes it to a SAB ring that a Worker drains + encodes. No DSP, no allocation:
 * just copy input → ring. Recording (encode/disk) happens OFF the audio thread.
 */

/// <reference lib="webworker" />

import { wrapRing, ringWrite, type SabRingViews } from './sab-ring.js';

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

interface ArmMessage {
  type: 'arm';
  buffer: SharedArrayBuffer;
  capacity: number;
}
interface DisarmMessage {
  type: 'disarm';
}
type RecorderMessage = ArmMessage | DisarmMessage;

class RecorderProcessor extends AudioWorkletProcessor {
  private ring: SabRingViews | null = null;
  private armed = false;
  // Scratch interleave buffer (max render quantum 128 frames × 2 ch).
  private readonly scratch = new Float32Array(128 * 2);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<RecorderMessage>) => {
      const msg = e.data;
      if (msg.type === 'arm') {
        this.ring = wrapRing(msg.buffer, msg.capacity);
        this.armed = true;
      } else if (msg.type === 'disarm') {
        this.armed = false;
        this.ring = null;
      }
    };
  }

  override process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];

    // Pass-through so the node can sit inline (or be a sink — output may be empty).
    if (input && output) {
      for (let c = 0; c < output.length; c++) {
        if (input[c]) {
          output[c]!.set(input[c]!);
        }
      }
    }

    if (this.armed && this.ring && input && input.length > 0) {
      const left = input[0]!;
      const right = input[1] ?? input[0]!;
      const frames = left.length;
      const il = this.scratch;
      for (let i = 0; i < frames; i++) {
        il[i * 2] = left[i]!;
        il[i * 2 + 1] = right[i]!;
      }
      ringWrite(this.ring, il, frames * 2);
    }

    return true;
  }
}

registerProcessor('dj-recorder', RecorderProcessor);
