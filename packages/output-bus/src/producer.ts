/**
 * OutputProducer — the dj-app side of the bus. It does NOT render anything; it just
 * publishes frames over a transport:
 *   - pushAudio(samples)  → AudioFrame  (call per analysis tick / worklet readback)
 *   - publishMeta(decks)  → MetaFrame   (call on track/position change, throttled)
 *   - control(target, directive) → ControlFrame ("display 2: play random")
 *
 * The transport is injected, so the SAME producer drives a Worker, WebSocket, RTC, etc.
 * Off by default at the app level — only instantiated when emission is enabled.
 */

import type {
  OutputTransport,
  AudioFrame,
  MetaFrame,
  ControlFrame,
  DeckMeta,
  ControlTarget,
  VizDirective,
} from './contract.js';

export class OutputProducer {
  private seq = 0;
  /** Reusable audio frame buffer to avoid per-tick allocation (lossy newest-wins). */
  private audioBuf: Uint8Array | null = null;

  constructor(private transport: OutputTransport) {}

  /** Swap the transport (e.g. user switches from worker to WebSocket). */
  setTransport(transport: OutputTransport): void {
    this.transport = transport;
  }

  /**
   * Publish a block of master-bus time-domain samples (0..255, 128 = silence). The
   * caller owns `samples`; we COPY into a reused buffer so the transport can keep it
   * without aliasing the caller's analyser scratch. Lossy: if a transport is saturated
   * it drops, newest wins.
   */
  pushAudio(samples: Uint8Array, sampleRate: number): void {
    if (!this.audioBuf || this.audioBuf.length !== samples.length) {
      this.audioBuf = new Uint8Array(samples.length);
    }
    this.audioBuf.set(samples);
    const frame: AudioFrame = {
      kind: 'audio',
      samples: this.audioBuf,
      sampleRate,
      seq: this.seq++,
    };
    this.transport.send(frame);
  }

  /** Publish current per-deck metadata (throttle this to a few Hz at the call site). */
  publishMeta(decks: DeckMeta[], masterDeck: number | undefined, nowMs: number): void {
    const frame: MetaFrame = { kind: 'meta', decks, masterDeck, t: nowMs };
    this.transport.send(frame);
  }

  /** Direct a display / group / all to a visualization (the app is the conductor). */
  control(target: ControlTarget, directive: VizDirective): void {
    const frame: ControlFrame = { kind: 'control', target, directive };
    this.transport.send(frame);
  }

  close(): void {
    this.transport.close();
  }
}
