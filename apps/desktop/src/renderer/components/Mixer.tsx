/**
 * Mixer — the center section between the two decks. M1: the crossfader + master
 * gain. EQ/volume live on each deck for now. Decks 1/2 are oriented left/right so
 * the crossfader actually blends them.
 */

import { useEffect } from 'react';
import { MASTER, MasterKeys, deck as deckGroup, DeckKeys } from '@internal-dj/control-bus';
import { useControl, useControlValue, useDj } from '../dj-context.js';
import { Knob } from './Knob.js';
import { GainFader } from './Faders.js';
import { VuMeterBar } from './VuMeterBar.js';

export function Mixer(): React.JSX.Element {
  const { bus } = useDj();
  const [xfader, setXfader] = useControl(MASTER, MasterKeys.crossfader);
  const [smartFader, setSmartFader] = useControl(MASTER, MasterKeys.smartFaderEnabled);
  const sfTargetBpm = useControlValue(MASTER, MasterKeys.smartFaderTargetBpm);
  const sfActive = useControlValue(MASTER, MasterKeys.smartFaderActive) > 0.5;

  // Orient deck 1 left, deck 2 right so the crossfader blends them.
  useEffect(() => {
    bus.set(deckGroup(1), DeckKeys.orientation, 0); // left
    bus.set(deckGroup(2), DeckKeys.orientation, 2); // right
  }, [bus]);

  return (
    <section className="mixer" aria-label="Mixer">
      <div className="mixer-master">
        <Knob group={MASTER} ckey={MasterKeys.gain} label="MAIN" min={0} max={5} center={1} big />
      </div>

      {/* channel gain faders, above the crossfader (per Luis) */}
      <div className="mixer-gains">
        <GainFader deckIndex={0} />
        <VuMeterBar deckIndex={0} />
        <VuMeterBar deckIndex={1} />
        <GainFader deckIndex={1} />
      </div>

      <div className="mixer-xfader">
        <span className="xfader-end a">A</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.001}
          value={xfader}
          onChange={(e) => setXfader(Number(e.target.value))}
          className="xfader-slider"
          onDoubleClick={() => setXfader(0)}
          aria-label="Crossfader"
        />
        <span className="xfader-end b">B</span>
      </div>

      <button
        className={`smartfader-btn ${smartFader > 0.5 ? 'active' : ''}`}
        onClick={() => setSmartFader(smartFader > 0.5 ? 0 : 1)}
        title="Smart Fader: crossfader blends the two decks' tempo"
      >
        SMART{sfActive && sfTargetBpm > 0 ? ` ${sfTargetBpm.toFixed(0)}` : ''}
      </button>
    </section>
  );
}
