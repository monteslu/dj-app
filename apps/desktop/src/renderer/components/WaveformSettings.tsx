/**
 * WaveformSettings — the "Waveforms" preferences tab. Currently the zoom level
 * (source frames per pixel), which is global so synced decks line up. More options
 * (colors, downbeat marker visibility) can hang here as they're added.
 */

import { useState } from 'react';
import { MASTER, MasterKeys } from '@dj/control-bus';
import { useDj } from '../dj-context.js';
import { ZOOM_PRESETS } from '../waveform-lane.js';

export function WaveformSettings(): React.JSX.Element {
  const { bus } = useDj();
  const [zoom, setZoomState] = useState(() => {
    const z = bus.get(MASTER, MasterKeys.waveformZoom);
    return z >= 0 ? Math.round(z) : 2;
  });

  const setZoom = (idx: number): void => {
    setZoomState(idx);
    bus.set(MASTER, MasterKeys.waveformZoom, idx);
  };

  return (
    <div className="prefs-panel">
      <h3>Waveform</h3>
      <label className="prefs-row">
        <span>
          Zoom level
          <small>How much of the track is visible. Same on both decks so synced waves line up.</small>
        </span>
      </label>
      <input
        type="range"
        min={0}
        max={ZOOM_PRESETS.length - 1}
        step={1}
        value={zoom}
        onChange={(e) => setZoom(Number(e.target.value))}
      />
      <div className="prefs-zoom-labels">
        <span>Zoomed in</span>
        <span>Zoomed out</span>
      </div>
      <p className="prefs-note">
        Red lines on the waveform are real measure (downbeat) markers from analysis, so
        you can align bars by eye.
      </p>
    </div>
  );
}
