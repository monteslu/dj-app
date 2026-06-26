/**
 * ControllerSettings — MIDI device picker + mapping loader. Lists Web MIDI input
 * devices and the available mappings, and loads a mapping onto a device. The
 * mappings run through the real Mixxx .midi.xml parser + script runtime, so a
 * mapping calls engine.scratchEnable/Tick/Disable etc. and drives the audio.
 */

import { useEffect, useState } from 'react';
import { useDj } from '../dj-context.js';
import { GENERIC_MIDI_XML, GENERIC_MIDI_JS } from '../mappings/generic-midi.js';


interface MixxxMapping {
  file: string;
  name: string;
  author: string;
}

export function ControllerSettings({
  onClose,
  embedded = false,
}: {
  onClose?: () => void;
  embedded?: boolean;
}): React.JSX.Element {
  const { controllers } = useDj();
  const [inputs, setInputs] = useState<string[]>([]);
  const [device, setDevice] = useState<string>('');
  const [mappings, setMappings] = useState<MixxxMapping[]>([]);
  const [selected, setSelected] = useState<string>('generic');
  const [status, setStatus] = useState<string>('');
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { inputs } = await controllers.init();
        if (!live) return;
        setInputs(inputs);
        setDevice(inputs[0] ?? '');
        if (inputs.length === 0) setStatus('No MIDI input devices found. Plug in a controller.');
        // Load the full Mixxx mapping catalog (144 controllers).
        const list = await window.dj.controllersList();
        if (live) setMappings(list);
      } catch {
        if (live) {
          setSupported(false);
          setStatus('Web MIDI is not available in this environment.');
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [controllers]);

  const load = () => {
    void (async () => {
      try {
        if (selected === 'generic') {
          controllers.loadMapping(GENERIC_MIDI_XML, GENERIC_MIDI_JS, device || undefined, device || undefined);
          setStatus(`Loaded "Generic MIDI"${device ? ` on ${device}` : ''}.`);
          return;
        }
        const m = mappings.find((x) => x.file === selected);
        const res = await controllers.loadMixxxMapping(selected, true);
        setStatus(
          res
            ? `Loaded "${res.name}"${device ? ` on ${device}` : ''}.`
            : `Failed to load ${m?.name ?? selected}.`,
        );
      } catch (e) {
        setStatus(`Failed: ${String(e)}`);
      }
    })();
  };

  const body = (
    <>
        {!embedded && (
          <div className="modal-header">
            <h2>🎛 MIDI Controllers</h2>
            <button className="tiny" onClick={onClose}>
              ✕
            </button>
          </div>
        )}
        <p className="modal-note">
          Pick a MIDI device and a mapping. Mappings use Mixxx&apos;s <code>.midi.xml</code> format
          and run the original controller JS, so jog-wheel scratch and all controls drive the deck.
        </p>

        {supported && (
          <div className="bus-routes">
            <div className="bus-route">
              <label>
                <span className="bus-label">MIDI device</span>
                <span className="bus-hint">Web MIDI input</span>
              </label>
              <select value={device} onChange={(e) => setDevice(e.target.value)}>
                {inputs.length === 0 && <option value="">(none detected)</option>}
                {inputs.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>
            <div className="bus-route">
              <label>
                <span className="bus-label">Mapping</span>
                <span className="bus-hint">{mappings.length} Mixxx controllers</span>
              </label>
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="generic">Generic MIDI (built-in)</option>
                {mappings.map((m) => (
                  <option key={m.file} value={m.file}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="start-audio" onClick={load} disabled={!supported}>
            Load mapping
          </button>
          {status && <span className="bus-hint">{status}</span>}
        </div>
    </>
  );

  if (embedded) {
    return <div className="controller-settings embedded">{body}</div>;
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {body}
      </div>
    </div>
  );
}
