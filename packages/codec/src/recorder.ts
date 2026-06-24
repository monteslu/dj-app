/**
 * Recorder — main-thread controller for capturing the master bus to a file.
 * Creates the recorder worklet node (the sidechain tap), arms a SAB ring, drains
 * it periodically into accumulated chunks, and on stop encodes a WAV.
 *
 * The drain runs on a timer (not real-time-critical — it's a recording, latency
 * doesn't matter), reading whatever the worklet has produced. A Worker drain is a
 * later refinement; for now the ring keeps the AUDIO thread non-blocking (the
 * important invariant) and the main-thread drain just empties it.
 *
 * MP3/FLAC/Ogg are an ffmpeg-wasm post-encode of the WAV (deferred); WAV is the
 * default + the cheapest path, matching Mixxx.
 */

import { allocateRing, ringRead, ringDropped, type SabRingViews } from './sab-ring.js';
import { encodeWav, concatFloat32, type WavBitDepth } from './wav.js';

export interface RecorderOptions {
  /** URL of the bundled recorder worklet module. */
  workletUrl: string | URL;
  /** Ring capacity in samples (≈ seconds × sampleRate × 2). Default ~5s @48k. */
  ringCapacity?: number;
  bitDepth?: WavBitDepth;
}

export interface RecordingResult {
  wav: ArrayBuffer;
  durationSeconds: number;
  droppedSamples: number;
  sampleRate: number;
  channels: number;
}

export class Recorder {
  private node: AudioWorkletNode | null = null;
  private ring: SabRingViews | null = null;
  private ringBuffer: SharedArrayBuffer | null = null;
  private chunks: Float32Array[] = [];
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private recording = false;
  private startTime = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly opts: RecorderOptions,
  ) {}

  /** Load the worklet module + create the recorder node. Call once after start(). */
  async init(): Promise<AudioWorkletNode> {
    await this.ctx.audioWorklet.addModule(this.opts.workletUrl);
    this.node = new AudioWorkletNode(this.ctx, 'dj-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    return this.node;
  }

  /** The node to connect the master bus into (it passes audio through). */
  get input(): AudioWorkletNode {
    if (!this.node) {
      throw new Error('Recorder.init() not called');
    }
    return this.node;
  }

  isRecording(): boolean {
    return this.recording;
  }

  /** Start recording the master bus. */
  start(): void {
    if (this.recording || !this.node) {
      return;
    }
    const capacity = this.opts.ringCapacity ?? 48000 * 2 * 5;
    const { buffer, views } = allocateRing(capacity);
    this.ring = views;
    this.ringBuffer = buffer;
    this.chunks = [];
    this.node.port.postMessage({ type: 'arm', buffer, capacity: views.capacity });
    this.recording = true;
    this.startTime = this.ctx.currentTime;

    // Drain the ring ~20×/s into accumulated chunks.
    const scratch = new Float32Array(views.capacity);
    this.drainTimer = setInterval(() => {
      if (!this.ring) {
        return;
      }
      const n = ringRead(this.ring, scratch);
      if (n > 0) {
        this.chunks.push(scratch.slice(0, n));
      }
    }, 50);
  }

  /** Stop recording and return the encoded WAV. */
  stop(): RecordingResult {
    if (!this.recording || !this.node || !this.ring) {
      throw new Error('not recording');
    }
    // Final drain.
    const scratch = new Float32Array(this.ring.capacity);
    let n: number;
    while ((n = ringRead(this.ring, scratch)) > 0) {
      this.chunks.push(scratch.slice(0, n));
    }
    const dropped = ringDropped(this.ring);
    this.node.port.postMessage({ type: 'disarm' });
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    this.recording = false;

    const interleaved = concatFloat32(this.chunks);
    const channels = 2;
    const wav = encodeWav(interleaved, channels, this.ctx.sampleRate, this.opts.bitDepth ?? 16);
    const result: RecordingResult = {
      wav,
      durationSeconds: interleaved.length / channels / this.ctx.sampleRate,
      droppedSamples: dropped,
      sampleRate: this.ctx.sampleRate,
      channels,
    };
    this.chunks = [];
    this.ring = null;
    this.ringBuffer = null;
    return result;
  }

  dispose(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
    }
    this.node?.disconnect();
    this.node = null;
    void this.ringBuffer;
  }
}
