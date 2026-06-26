/**
 * OutputConsumer — the DISPLAY side helper. A display page creates a transport, wraps it
 * here, and gets: the latest audio bytes (for its visualizer), the latest metadata, and
 * its own resolved visualization directive (honoring control messages addressed to it,
 * its group, or all). dj-app does NOT use this — it ships for whoever builds a display.
 *
 * This is deliberately tiny + render-agnostic: it does NOT touch Butterchurn or any
 * canvas. The display decides how to draw from `latestAudio()` / `latestMeta()` /
 * `directive()`.
 */

import type { OutputTransport, AudioFrame, MetaFrame, VizDirective, ControlFrame } from './contract.js';

export interface ConsumerIdentity {
  /** This display's unique id (so the app can address it directly). */
  id: string;
  /** Optional group memberships (so the app can address a group). */
  groups?: string[];
}

export class OutputConsumer {
  private audio: AudioFrame | null = null;
  private meta: MetaFrame | null = null;
  private viz: VizDirective = { mode: 'random' }; // sensible default until told otherwise
  private readonly off: () => void;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly transport: OutputTransport,
    private readonly identity: ConsumerIdentity,
  ) {
    this.off = transport.onFrame((frame) => {
      switch (frame.kind) {
        case 'audio':
          this.audio = frame;
          break;
        case 'meta':
          this.meta = frame;
          this.emit();
          break;
        case 'control':
          if (this.addressedToMe(frame)) {
            this.viz = frame.directive;
            this.emit();
          }
          break;
      }
    });
  }

  private addressedToMe(frame: ControlFrame): boolean {
    const t = frame.target;
    if (t.scope === 'all') return true;
    if (t.scope === 'display') return t.id === this.identity.id;
    if (t.scope === 'group') return (this.identity.groups ?? []).includes(t.group);
    return false;
  }

  /** Latest master-bus audio samples (or null before the first frame). */
  latestAudio(): Uint8Array | null {
    return this.audio?.samples ?? null;
  }
  /** Latest metadata (track/timing) (or null). */
  latestMeta(): MetaFrame | null {
    return this.meta;
  }
  /** This display's current visualization directive. */
  directive(): VizDirective {
    return this.viz;
  }

  /** Subscribe to meta/directive changes (not audio — poll latestAudio() per frame). */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  close(): void {
    this.off();
    this.transport.close();
    this.listeners.clear();
  }
}
