/**
 * WaveformBand — the full-width scrolling waveforms across the top (Mixxx/Serato/
 * Traktor signature). Both decks' waveforms stacked + beat-aligned, each with a
 * fixed center playhead. Plus a thin full-track overview strip per deck. Reads
 * peaks from the deck-state store + position/bpm from the control bus, rendered
 * via rAF onto canvases (no React re-render per frame).
 */

import { useEffect, useRef } from 'react';
import { drawScrolling, DEFAULT_COLORS } from '@internal-dj/waveform';
import { deck as deckGroup, DeckKeys } from '@internal-dj/control-bus';
import { useDj } from '../dj-context.js';
import { getDeckTrack } from '../deck-state.js';

function DeckLane({ deckIndex, framesPerPx }: { deckIndex: number; framesPerPx: number }): React.JSX.Element {
  const { bus } = useDj();
  const scrollRef = useRef<HTMLCanvasElement>(null);
  const g = deckGroup(deckIndex + 1);

  useEffect(() => {
    let raf = 0;
    const resize = () => {
      const c = scrollRef.current;
      if (c) {
        const r = c.getBoundingClientRect();
        if (r.width && c.width !== Math.floor(r.width)) c.width = Math.floor(r.width);
      }
    };
    const tick = () => {
      resize();
      const st = getDeckTrack(deckIndex);
      const frames = bus.get(g, DeckKeys.trackSamples);
      const fraction = bus.get(g, DeckKeys.playPosition);
      const positionFrames = fraction * frames;
      const fileBpm = bus.get(g, DeckKeys.fileBpm);
      const framesPerBeat = fileBpm > 0 ? (60 / fileBpm) * 48000 : 0;

      if (scrollRef.current && st.peaks) {
        const fbf = bus.get(g, DeckKeys.firstBeatFrame);
        drawScrolling(scrollRef.current, st.peaks.detail, positionFrames, framesPerPx, DEFAULT_COLORS, {
          firstBeatFrame: fbf >= 0 ? fbf : 0,
          framesPerBeat,
        });
      } else if (scrollRef.current) {
        const ctx = scrollRef.current.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#080b10';
          ctx.fillRect(0, 0, scrollRef.current.width, scrollRef.current.height);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bus, g, deckIndex, framesPerPx]);

  return (
    <div className={`wf-lane deck-${deckIndex === 0 ? 'a' : 'b'}`}>
      <canvas ref={scrollRef} className="wf-scroll" height={90} />
    </div>
  );
}

export function WaveformBand(): React.JSX.Element {
  return (
    <section className="waveform-band" aria-label="Waveforms">
      <DeckLane deckIndex={0} framesPerPx={90} />
      <DeckLane deckIndex={1} framesPerPx={90} />
    </section>
  );
}
