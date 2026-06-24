/**
 * @internal-dj/controller-host — the Mixxx-compatible controller host.
 *
 * The `engine` global API + MIDI value transforms, backed by the control bus, so
 * stock Mixxx mapping scripts run unchanged.
 */

export {
  EngineApi,
  type EngineApiOptions,
  type EngineCallback,
  type ScriptConnection,
} from './engine-api.js';
export {
  computeMidiParameter,
  isRelative,
  type MidiOptions,
} from './midi-options.js';
