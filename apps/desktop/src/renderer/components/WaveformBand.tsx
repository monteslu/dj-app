/**
 * WaveformBand — the full-width scrolling waveforms across the top (Mixxx/Serato/
 * Traktor signature). Both decks' waveforms stacked + beat-aligned, each with a
 * fixed center playhead. Plus a thin full-track overview strip per deck. Reads
 * peaks from the deck-state store + position/bpm from the control bus, rendered
 * via rAF onto canvases (no React re-render per frame).
 */

import { memo, useEffect, useRef } from 'react';
import { useDj } from '../dj-context.js';
import { WaveformLaneController } from '../waveform-lane.js';

// Thin shell: mount a canvas, hand it to the controller (which owns all the GPU
// render logic + rAF loop). No render logic in the JSX.
const DeckLane = memo(function DeckLane({
  deckIndex,
  framesPerPx,
}: {
  deckIndex: number;
  framesPerPx: number;
}): React.JSX.Element {
  const { bus } = useDj();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctrl = new WaveformLaneController(canvasRef.current, bus, deckIndex, framesPerPx);
    return () => ctrl.dispose();
  }, [bus, deckIndex, framesPerPx]);

  return (
    <div className={`wf-lane deck-${deckIndex === 0 ? 'a' : 'b'}`}>
      <canvas ref={canvasRef} className="wf-scroll" height={90} />
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
