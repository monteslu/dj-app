/**
 * Vertical faders — tempo (pitch) faders that sit on the OUTER edges of the deck
 * row (like real DJ gear), and channel gain faders that sit above the crossfader.
 * Both are styled vertical range inputs bound to the control bus.
 */

import { deck as deckGroup, DeckKeys } from '@dj/control-bus';
import { useControl } from '../dj-context.js';

/** Outer-edge tempo/pitch fader for a deck. */
export function TempoFader({
  deckIndex,
  side,
}: {
  deckIndex: number;
  side: 'left' | 'right';
}): React.JSX.Element {
  const g = deckGroup(deckIndex + 1);
  const [rate, setRate] = useControl(g, DeckKeys.rate);
  const [rateDir] = useControl(g, DeckKeys.rateDirection);
  const [rateRange] = useControl(g, DeckKeys.rateRange);
  const dir = rateDir >= 0 ? 1 : -1;
  // Bind the slider value DIRECTLY to `rate` (min -1, max +1). The fader CSS is
  // vertical-lr + rtl, so max sits at the TOP. With the Mixxx default rate_dir = -1,
  // speed = 1 + rate*range*(-1), so rate +1 = SLOWER and rate -1 = FASTER. That puts
  // - (slower) at the top and + (faster) at the bottom — matching real CDJ/turntable
  // faders and the DJ2GO2 hardware (Mixxx default "down increases speed").
  // Tempo % shown (faster = positive). speed = 1 + rate*range*dir, so the % change is
  // (speed-1)*100 = rate*range*dir*100. With rate_dir -1: rate -1 (fader at bottom/+) →
  // +range → faster, displayed as a positive %.
  const pct = rate * dir * (rateRange || 0.1) * 100;
  return (
    <div className={`tempo-fader ${side}`} aria-label={`Deck ${deckIndex + 1} tempo`}>
      <span className="fader-cap">TEMPO</span>
      <input
        type="range"
        className="vfader"
        min={-1}
        max={1}
        step={0.001}
        value={rate}
        onChange={(e) => setRate(Number(e.target.value))}
        onDoubleClick={() => setRate(0)}
        title={`Tempo / pitch fader (deck ${deckIndex + 1}). Down = faster, up = slower (CDJ/turntable style). Double-click to reset to 0%.`}
      />
      <span className="fader-val">
        {pct >= 0 ? '+' : ''}
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

/** Channel volume/gain fader (sits above the crossfader in the mixer). */
export function GainFader({ deckIndex }: { deckIndex: number }): React.JSX.Element {
  const g = deckGroup(deckIndex + 1);
  const [vol, setVol] = useControl(g, DeckKeys.volume);
  return (
    <div className={`gain-fader deck-${deckIndex === 0 ? 'a' : 'b'}`}>
      <input
        type="range"
        className="vfader"
        min={0}
        max={1}
        step={0.005}
        value={vol}
        onChange={(e) => setVol(Number(e.target.value))}
        title={`Channel ${deckIndex + 1} volume fader`}
      />
    </div>
  );
}
