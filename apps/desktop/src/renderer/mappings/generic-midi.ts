/**
 * A built-in "Generic MIDI" 2-deck mapping for common controllers, in Mixxx's
 * .midi.xml format (so it loads through the exact same parser + runtime as any
 * stock Mixxx mapping). Covers play/cue, volume, 3-band EQ, crossfader, and
 * jog-wheel scratch. Real Mixxx controller mappings (Pioneer DDJ, Xone, etc.) can
 * be dropped in the same way — this is just a sensible default so a basic MIDI
 * controller works out of the box.
 *
 * Channel 1 (status 0x90/0xB0) → deck 1; channel 2 (0x91/0xB1) → deck 2.
 */

export const GENERIC_MIDI_XML = `<?xml version="1.0" encoding="utf-8"?>
<MixxxControllerPreset schemaVersion="1" mixxxVersion="2.4">
  <info>
    <name>Generic MIDI (built-in)</name>
    <description>Basic 2-deck mapping: play/cue, volume, EQ, crossfader, jog scratch.</description>
  </info>
  <controller id="Generic MIDI">
    <scriptfiles>
      <file filename="generic.js" functionprefix="Generic"/>
    </scriptfiles>
    <controls>
      <!-- transport: note-on -->
      <control><group>[Channel1]</group><key>play</key><status>0x90</status><midino>0x0B</midino><options><normal/></options></control>
      <control><group>[Channel1]</group><key>cue_default</key><status>0x90</status><midino>0x0C</midino><options><normal/></options></control>
      <control><group>[Channel2]</group><key>play</key><status>0x91</status><midino>0x0B</midino><options><normal/></options></control>
      <control><group>[Channel2]</group><key>cue_default</key><status>0x91</status><midino>0x0C</midino><options><normal/></options></control>
      <!-- faders + EQ: CC -->
      <control><group>[Channel1]</group><key>volume</key><status>0xB0</status><midino>0x07</midino><options><normal/></options></control>
      <control><group>[Channel1]</group><key>filterHigh</key><status>0xB0</status><midino>0x10</midino><options><normal/></options></control>
      <control><group>[Channel1]</group><key>filterMid</key><status>0xB0</status><midino>0x11</midino><options><normal/></options></control>
      <control><group>[Channel1]</group><key>filterLow</key><status>0xB0</status><midino>0x12</midino><options><normal/></options></control>
      <control><group>[Channel2]</group><key>volume</key><status>0xB1</status><midino>0x07</midino><options><normal/></options></control>
      <control><group>[Channel2]</group><key>filterHigh</key><status>0xB1</status><midino>0x10</midino><options><normal/></options></control>
      <control><group>[Channel2]</group><key>filterMid</key><status>0xB1</status><midino>0x11</midino><options><normal/></options></control>
      <control><group>[Channel2]</group><key>filterLow</key><status>0xB1</status><midino>0x12</midino><options><normal/></options></control>
      <control><group>[Master]</group><key>crossfader</key><status>0xB0</status><midino>0x08</midino><options><normal/></options></control>
      <!-- jog wheels → script (scratch) -->
      <control><group>[Channel1]</group><key>Generic.jog1</key><status>0xB0</status><midino>0x0A</midino><options><script-binding/></options></control>
      <control><group>[Channel2]</group><key>Generic.jog2</key><status>0xB1</status><midino>0x0A</midino><options><script-binding/></options></control>
    </controls>
    <outputs/>
  </controller>
</MixxxControllerPreset>`;

// The script: jog-wheel scratch using the Mixxx engine.scratch* API (the same
// path the audio engine implements). Relative-encoder convention: 0x01..0x3f =
// forward, 0x7f..0x41 = reverse (two's-complement-ish around 0x40).
export const GENERIC_MIDI_JS = `
var Generic = {};
Generic.init = function () {};
Generic.shutdown = function () {};

function genericJogDelta(value) {
  return value < 0x40 ? value : value - 0x80; // -64..63
}
Generic.scratchJog = function (deck, value) {
  var delta = genericJogDelta(value);
  if (!engine.isScratching(deck)) {
    // 128 ticks/rev, 33⅓ rpm, standard alpha/beta filter
    engine.scratchEnable(deck, 128, 33 + 1 / 3, 1 / 8, (1 / 8) / 32);
  }
  engine.scratchTick(deck, delta);
  // auto-release shortly after the wheel stops (Mixxx pattern uses a timer; we
  // disable on a near-zero tick to keep this dependency-free)
  if (delta === 0) engine.scratchDisable(deck);
};
Generic.jog1 = function (channel, control, value) { Generic.scratchJog(1, value); };
Generic.jog2 = function (channel, control, value) { Generic.scratchJog(2, value); };
`;
