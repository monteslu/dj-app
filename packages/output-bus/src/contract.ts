/**
 * Output-bus contract — the STABLE wire format dj-app emits and displays consume.
 *
 * dj-app is a pure DATA EMITTER: it renders nothing (no video, no canvas, no pixels).
 * It publishes three logically-separate streams, and a display turns them into visuals
 * on its OWN side (Butterchurn/MilkDrop, etc.). Each display is independent — they need
 * NOT show the same thing (unlike loukai's synced karaoke); the app can direct a
 * specific display, a group, or all.
 *
 * The three streams differ in rate + delivery semantics, so transports may carry them
 * on different channels (e.g. RTC: unreliable for audio, reliable for control):
 *
 *   1. AUDIO   — high-rate, LOSSY (newest wins). Master-bus time-domain bytes (Uint8,
 *                like AnalyserNode.getByteTimeDomainData). The display does its own FFT.
 *   2. META    — low-rate, RELIABLE. Track/timing/musical info (broadcast to all).
 *   3. CONTROL — event, RELIABLE, ADDRESSABLE. "play this visualization" directives,
 *                targeted at a display / group / all.
 */

/** A frame of master-bus audio for displays to react to. */
export interface AudioFrame {
  kind: 'audio';
  /** Time-domain samples 0..255 (128 = silence), like getByteTimeDomainData. */
  samples: Uint8Array;
  /** Engine sample rate (so a display can interpret timing if it wants). */
  sampleRate: number;
  /** Monotonic frame counter (lets a display detect drops; newest wins). */
  seq: number;
}

/** Low-rate metadata about what's playing (broadcast to every display). */
export interface MetaFrame {
  kind: 'meta';
  /** Per-deck now-playing + timing. Index = deck number (0-based). */
  decks: DeckMeta[];
  /** Which deck is the audible "master" (highest fader / leader), if determinable. */
  masterDeck?: number;
  /** Wall-clock-ish monotonic ms when emitted (display can estimate latency). */
  t: number;
}

export interface DeckMeta {
  loaded: boolean;
  playing: boolean;
  title?: string;
  artist?: string;
  /** Track length + current position, in SECONDS. */
  durationSec?: number;
  positionSec?: number;
  bpm?: number;
  /** Camelot key, e.g. "8A". */
  key?: string;
  /** 0..1 phase within the current beat (0 = on the beat) — for beat-synced visuals. */
  beatPhase?: number;
}

/** Where a control directive applies. */
export type ControlTarget =
  | { scope: 'all' }
  | { scope: 'display'; id: string }
  | { scope: 'group'; group: string };

/** What a display should show. Each display tracks its own — they can differ. */
export type VizDirective =
  /** A specific preset/visualization by name. */
  | { mode: 'preset'; name: string; blendSec?: number }
  /** Pick at random (optionally from a named set), re-randomizing on `everySec`. */
  | { mode: 'random'; set?: string; everySec?: number }
  /** Play an ordered series of presets, advancing on `everySec` (or on track change). */
  | { mode: 'series'; names: string[]; everySec?: number; advanceOnTrack?: boolean }
  /** Stop / blank the display. */
  | { mode: 'off' };

/** A control message: tell some display(s) which visualization to play. */
export interface ControlFrame {
  kind: 'control';
  target: ControlTarget;
  directive: VizDirective;
}

/** Anything that travels the bus. */
export type OutFrame = AudioFrame | MetaFrame | ControlFrame;

/**
 * A pluggable transport moves frames from the producer (dj-app) to consumers
 * (displays). Implementations: Worker/postMessage+SAB (same browser, no server),
 * WebSocket, RTC DataChannel, WebUSB, Electron IPC — all behind this one interface.
 *
 * The producer calls send(); a consumer subscribes via onFrame(). A transport MAY
 * special-case audio frames (high-rate, lossy) vs meta/control (reliable) internally.
 */
export interface OutputTransport {
  /** Publish a frame to consumers. Audio frames may be dropped under load (lossy). */
  send(frame: OutFrame): void;
  /** Subscribe to incoming frames (display side). Returns an unsubscribe fn. */
  onFrame(cb: (frame: OutFrame) => void): () => void;
  /** Tear down (close channels/workers/sockets). */
  close(): void;
  /** Transport name, for logging/diagnostics. */
  readonly name: string;
}
