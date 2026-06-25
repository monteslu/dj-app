/**
 * OverviewStrip — the full-track minimap shown next to the platter (Mixxx/Serato
 * style): the whole song's waveform with a position marker + hotcue ticks. Click
 * to seek anywhere in the track. The scrolling "now playing" view lives in the
 * top WaveformBand; this is the overall-position display.
 */

import { useEffect, useRef } from 'react';
import { drawOverview, DEFAULT_COLORS } from '@internal-dj/waveform';
import {
  deck as deckGroup,
  DeckKeys,
  hotcuePositionKey,
  hotcueEnabledKey,
} from '@internal-dj/control-bus';
import { useDj } from '../dj-context.js';
import { getDeckTrack } from '../deck-state.js';

const HOTCUE_COLORS = ['#ff5a5a', '#ffb84d', '#4ade80', '#37b6ff', '#a78bfa', '#f472b6', '#42d4f4', '#f2f2ff'];

export function OverviewStrip({ deckIndex }: { deckIndex: number }): React.JSX.Element {
  const { bus, engine } = useDj();
  const ref = useRef<HTMLCanvasElement>(null);
  const g = deckGroup(deckIndex + 1);

  // Size the canvas only on real resize (not per frame — that reflows + clears).
  useEffect(() => {
    const c = ref.current;
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
      const c = ref.current;
      if (c) {
        const st = getDeckTrack(deckIndex);
        const frames = bus.get(g, DeckKeys.trackSamples);
        const fraction = bus.get(g, DeckKeys.playPosition);
        if (st.peaks && frames > 0) {
          const markers = [];
          for (let n = 1; n <= 8; n++) {
            if (bus.get(g, hotcueEnabledKey(n)) > 0.5) {
              const p = bus.get(g, hotcuePositionKey(n));
              if (p >= 0) markers.push({ fraction: p / frames, color: HOTCUE_COLORS[(n - 1) % 8]! });
            }
          }
          drawOverview(c, st.peaks.overview, fraction, DEFAULT_COLORS, { markers });
        } else {
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#0b0e14';
            ctx.fillRect(0, 0, c.width, c.height);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bus, g, deckIndex]);

  const onSeek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    engine.seekFraction(deckIndex, Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  return (
    <canvas
      ref={ref}
      className="overview-strip"
      height={30}
      onClick={onSeek}
      title="Full track — click to seek"
    />
  );
}
