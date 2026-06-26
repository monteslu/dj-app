import { describe, it, expect } from 'vitest';
import { OutputProducer } from './producer.js';
import { OutputConsumer } from './consumer.js';
import type { OutputTransport, OutFrame } from './contract.js';

/** In-memory loopback transport: send() delivers synchronously to all onFrame subs.
 *  (BroadcastChannel/WebSocket aren't in Node; this tests the contract + producer +
 *  consumer logic, which is the real unit under test.) */
function loopback(): OutputTransport {
  const subs = new Set<(f: OutFrame) => void>();
  return {
    name: 'loopback',
    send: (f) => subs.forEach((cb) => cb(f)),
    onFrame: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    close: () => subs.clear(),
  };
}

describe('output bus producer → transport → consumer', () => {
  it('delivers audio frames; consumer exposes the latest samples', () => {
    const t = loopback();
    const prod = new OutputProducer(t);
    const display = new OutputConsumer(t, { id: 'd1' });

    prod.pushAudio(new Uint8Array([10, 20, 30, 128]), 48000);
    expect([...display.latestAudio()!]).toEqual([10, 20, 30, 128]);

    // newest wins
    prod.pushAudio(new Uint8Array([1, 2, 3, 4]), 48000);
    expect([...display.latestAudio()!]).toEqual([1, 2, 3, 4]);
  });

  it('delivers metadata to every display', () => {
    const t = loopback();
    const prod = new OutputProducer(t);
    const a = new OutputConsumer(t, { id: 'a' });
    const b = new OutputConsumer(t, { id: 'b' });
    prod.publishMeta(
      [{ loaded: true, playing: true, title: 'Song', bpm: 128, key: '8A', positionSec: 12, durationSec: 200 }],
      0,
      1000,
    );
    expect(a.latestMeta()?.decks[0]?.title).toBe('Song');
    expect(b.latestMeta()?.decks[0]?.bpm).toBe(128);
  });

  it('control directives are ADDRESSABLE — displays can differ', () => {
    const t = loopback();
    const prod = new OutputProducer(t);
    const a = new OutputConsumer(t, { id: 'a', groups: ['stage'] });
    const b = new OutputConsumer(t, { id: 'b', groups: ['booth'] });

    // default before any control
    expect(a.directive().mode).toBe('random');

    // target a specific display
    prod.control({ scope: 'display', id: 'a' }, { mode: 'preset', name: 'Fractopia' });
    expect(a.directive()).toEqual({ mode: 'preset', name: 'Fractopia' });
    expect(b.directive().mode).toBe('random'); // b unaffected — they CAN differ

    // target a group
    prod.control({ scope: 'group', group: 'booth' }, { mode: 'series', names: ['x', 'y'] });
    expect(b.directive().mode).toBe('series');
    expect(a.directive()).toEqual({ mode: 'preset', name: 'Fractopia' }); // a still its own

    // target all
    prod.control({ scope: 'all' }, { mode: 'off' });
    expect(a.directive().mode).toBe('off');
    expect(b.directive().mode).toBe('off');
  });
});
