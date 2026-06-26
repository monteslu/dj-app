/**
 * BroadcastChannelTransport — same-browser, web-standard, NO server / NO signaling.
 * Frames are posted on a named BroadcastChannel; any same-origin tab/window listening
 * on that name receives them. This is the simplest "second screen in another tab/window"
 * transport — the producer (dj-app tab) sends, a display tab subscribes.
 *
 * Semantics: BroadcastChannel is reliable+ordered, so audio frames aren't truly lossy
 * here — but a slow display just processes the newest it can; the producer never blocks.
 * For genuinely lossy realtime across machines, a WebSocket/RTC transport is used
 * instead (same interface).
 *
 * Transferables: BroadcastChannel uses structured clone (it COPIES, can't transfer), so
 * the audio Uint8Array is copied per send. That copy is on the producer side (a few KB)
 * — still nothing on the display's main thread until it chooses to render.
 */

import type { OutputTransport, OutFrame } from '../contract.js';

export class BroadcastChannelTransport implements OutputTransport {
  readonly name = 'broadcast-channel';
  private ch: BroadcastChannel;
  private readonly subs = new Set<(f: OutFrame) => void>();

  constructor(channelName = 'dj-output-bus') {
    this.ch = new BroadcastChannel(channelName);
    this.ch.onmessage = (e: MessageEvent<OutFrame>) => {
      const frame = e.data;
      for (const cb of this.subs) cb(frame);
    };
  }

  send(frame: OutFrame): void {
    // structured clone copies the bytes; fine for same-browser. (No transfer list on
    // BroadcastChannel.) The producer reuses its audio buffer, so this copy is required.
    this.ch.postMessage(frame);
  }

  onFrame(cb: (f: OutFrame) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  close(): void {
    this.subs.clear();
    this.ch.close();
  }
}
