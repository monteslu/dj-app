/**
 * WaveformBand — the full-width scrolling waveforms across the top (Mixxx/Serato/
 * Traktor signature). Both decks' waveforms stacked + beat-aligned, each with a
 * fixed center playhead. Plus a thin full-track overview strip per deck. Reads
 * peaks from the deck-state store + position/bpm from the control bus, rendered
 * via rAF onto canvases (no React re-render per frame).
 */

import { memo, useEffect, useRef } from 'react';
import { drawScrolling, DEFAULT_COLORS } from '@internal-dj/waveform';
import { deck as deckGroup, DeckKeys } from '@internal-dj/control-bus';
import { useDj } from '../dj-context.js';
import { getDeckTrack } from '../deck-state.js';

const DeckLane = memo(function DeckLane({
  deckIndex,
  framesPerPx,
}: {
  deckIndex: number;
  framesPerPx: number;
}): React.JSX.Element {
  const { bus } = useDj();
  const scrollRef = useRef<HTMLCanvasElement>(null);
  const g = deckGroup(deckIndex + 1);

  // Size the canvas backing store only when the element actually resizes (via a
  // ResizeObserver), NOT every frame — reading getBoundingClientRect + setting
  // canvas.width per rAF forces a layout reflow + clears the canvas, which causes
  // the choppiness. Setting .width also resets the context, so do it sparingly.
  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const fit = () => {
      const w = Math.floor(c.clientWidth);
      if (w && c.width !== w) c.width = w;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const canvas = scrollRef.current;
      if (canvas) {
        const st = getDeckTrack(deckIndex);
        if (st.peaks) {
          const frames = bus.get(g, DeckKeys.trackSamples);
          const fraction = bus.get(g, DeckKeys.playPosition);
          const fileBpm = bus.get(g, DeckKeys.fileBpm);
          const framesPerBeat = fileBpm > 0 ? (60 / fileBpm) * 48000 : 0;
          const fbf = bus.get(g, DeckKeys.firstBeatFrame);
          drawScrolling(canvas, st.peaks.detail, fraction * frames, framesPerPx, DEFAULT_COLORS, {
            firstBeatFrame: fbf >= 0 ? fbf : 0,
            framesPerBeat,
          });
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
});

export function WaveformBand(): React.JSX.Element {
  return (
    <section className="waveform-band" aria-label="Waveforms">
      <DeckLane deckIndex={0} framesPerPx={90} />
      <DeckLane deckIndex={1} framesPerPx={90} />
    </section>
  );
}
