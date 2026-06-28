/**
 * control-coverage.mjs — audit Mixxx control-key coverage.
 *
 * Every Mixxx mapping (res/controllers) drives the deck/master via named ControlObjects
 * referenced by (group, key) strings — directly in the .midi.xml `<key>` of non-script
 * controls, and in the device scripts via engine.getValue/setValue/... + midi-components
 * inKey/outKey. This is the COMMON INTERFACE: support every key the mappings use and the
 * controllers' DJ features all work.
 *
 * This tool enumerates every distinct control key the bundled mappings reference, counts
 * how many mappings use each (impact), and marks whether our engine IMPLEMENTS behavior
 * for it (vs. the bus merely storing the value with nothing reacting). Output is a
 * ranked gap list — the burndown for "better than Mixxx".
 *
 * Usage: node scripts/control-coverage.mjs [--all]   (--all shows implemented too)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CTRL = join(here, '../apps/desktop/resources/controllers');
const ENGINE = join(here, '../packages/audio-engine/src');

// --- 1. Extract every control key each mapping references -------------------------
// key → Set of mapping basenames that use it.
const usage = new Map();
// key → true if it's used as an OUTPUT (LED feedback: outKey / engine.makeConnection /
// the deck reads it to light a pad). Output controls need the engine to PUBLISH them.
const outputKeys = new Set();
const note = (key, file, isOutput = false) => {
  if (!key || key.length > 64) return;
  if (!usage.has(key)) usage.set(key, new Set());
  usage.get(key).add(file);
  if (isOutput) outputKeys.add(key);
};

// Normalize indexed/group keys to a FAMILY so e.g. hotcue_1_activate, hotcue_2_activate
// collapse to hotcue_N_activate (one behavior to implement covers all N).
const family = (k) =>
  k
    .replace(/hotcue_\d+/g, 'hotcue_N')
    .replace(/beatloop_[\d.]+/g, 'beatloop_X')
    .replace(/beatjump_[\d.]+/g, 'beatjump_X')
    .replace(/_\d+(_|$)/g, '_N$1');

const files = readdirSync(CTRL);
for (const f of files) {
  if (f.endsWith('.midi.xml')) {
    const xml = readFileSync(join(CTRL, f), 'utf8');
    // direct <key>name</key> on a control (skip script-prefixed dotted keys)
    for (const m of xml.matchAll(/<key>([^<]+)<\/key>/g)) {
      const k = m[1].trim();
      if (!k.includes('.') && !k.includes('[')) note(family(k), f);
    }
  } else if (f.endsWith('.js')) {
    const js = readFileSync(join(CTRL, f), 'utf8');
    // engine.getValue/setValue/getParameter/setParameter(group, "key"
    for (const m of js.matchAll(
      /engine\.(?:get|set)(?:Value|Parameter)\([^,]+,\s*["']([a-zA-Z][a-zA-Z0-9_]*)["']/g,
    )) {
      note(family(m[1]), f);
    }
    // makeConnection = the engine must PUBLISH this control for LED feedback → OUTPUT.
    for (const m of js.matchAll(/engine\.makeConnection\([^,]+,\s*["']([a-zA-Z][a-zA-Z0-9_]*)["']/g)) {
      note(family(m[1]), f, true);
    }
    // midi-components: inKey = input, outKey = output (LED), key = both.
    for (const m of js.matchAll(/inKey\s*[:=]\s*["']([a-zA-Z][a-zA-Z0-9_]*)["']/g)) note(family(m[1]), f);
    for (const m of js.matchAll(/outKey\s*[:=]\s*["']([a-zA-Z][a-zA-Z0-9_]*)["']/g))
      note(family(m[1]), f, true);
    for (const m of js.matchAll(/\bkey\s*[:=]\s*["']([a-zA-Z][a-zA-Z0-9_]*)["']/g)) note(family(m[1]), f);
  }
}

// --- 2. What does our engine IMPLEMENT behavior for? -----------------------------
// A control is "implemented" if some engine source SUBSCRIBES to it (reacts), not just
// if the bus defines it. Heuristic: the key string (or its family stem) appears in an
// engine control/worklet/sync file outside of keys.ts/standard-controls.ts/tests.
const engineSrc = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      engineSrc.push(readFileSync(p, 'utf8'));
    }
  }
};
walk(ENGINE);
// Also count the renderer controls (some live there) + control-bus consumers.
walk(join(here, '../apps/desktop/src/renderer'));
const haystack = engineSrc.join('\n');

// Authoritative wired-key set: the engine references controls via CONSTANTS
// (DeckKeys.cueDefault, EffectKeys.param1, ...), not raw strings, so a literal/stem
// grep misses them. Resolve every `XKeys.Y` the engine source references to its string
// value (parsed from keys.ts) — those strings are the controls we actually handle.
const keysSrc = readFileSync(join(here, '../packages/control-bus/src/keys.ts'), 'utf8');
const constToString = new Map(); // "DeckKeys.cueDefault" → "cue_default"
{
  // Parse `name: 'value'` entries inside each `export const XKeys = { ... }` block.
  for (const block of keysSrc.matchAll(/export const (\w+Keys)\s*=\s*\{([\s\S]*?)\n\}/g)) {
    const ns = block[1];
    for (const e of block[2].matchAll(/(\w+):\s*["']([^"']+)["']/g)) {
      constToString.set(`${ns}.${e[1]}`, e[2]);
    }
  }
}
const wiredStrings = new Set();
for (const ref of haystack.matchAll(/(\w+Keys\.\w+)/g)) {
  const s = constToString.get(ref[1]);
  if (s) wiredStrings.add(s);
}
// Plus any controls referenced as raw strings in engine code (e.g. dynamic keys).
for (const m of haystack.matchAll(/["']([a-z][a-z0-9_]{2,})["']/g)) wiredStrings.add(m[1]);

// Map a control family back to a stem to search for in engine code.
const implemented = (fam) => {
  // Authoritative: the (de-familied) key string is in the wired set.
  const direct = fam
    .replace(/hotcue_N/, 'hotcue_1')
    .replace(/beatloop_X/, 'beatloop_4')
    .replace(/beatjump_X/, 'beatjump');
  if (wiredStrings.has(fam) || wiredStrings.has(direct)) return true;
  // hotcue_N_* / beatloop_X_* families use key-BUILDER functions (hotcueActivateKey(n),
  // beatloopToggleKey(size)), not constants — detect by the builder name in engine source.
  const HELPER = {
    hotcue_N_activate: 'hotcueActivateKey',
    hotcue_N_clear: 'hotcueClearKey',
    hotcue_N_set: 'hotcueSetKey',
    hotcue_N_enabled: 'hotcueEnabledKey',
    hotcue_N_position: 'hotcuePositionKey',
    beatloop_X_toggle: 'beatloopToggleKey',
    beatloop_X_activate: 'beatloopActivateKey',
  };
  if (HELPER[fam] && haystack.includes(HELPER[fam])) return true;
  const stem = fam
    .replace(/_N(_|$)/g, '$1')
    .replace(/hotcue_N/, 'hotcue')
    .replace(/beatloop_X/, 'beatloop')
    .replace(/beatjump_X/, 'beatjump')
    .replace(/_$/, '');
  // camelCase variant our DeckKeys often use (sync_enabled → syncEnabled)
  const camel = stem.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return haystack.includes(`"${stem}"`) || haystack.includes(`'${stem}'`) ||
    new RegExp(`\\b${camel}\\b`).test(haystack) ||
    haystack.includes(stem);
};

// --- 3. Report -------------------------------------------------------------------
const showAll = process.argv.includes('--all');
const rows = [...usage.entries()]
  .map(([key, set]) => ({
    key,
    count: set.size,
    impl: implemented(key),
    output: outputKeys.has(key),
  }))
  .sort((a, b) => b.count - a.count);

// Inputs (controller→app behaviors) vs outputs (app→controller LED feedback) are
// different work; report them separately so "inputs AND outputs" is visible.
const missingIn = rows.filter((r) => !r.impl && !r.output);
const missingOut = rows.filter((r) => !r.impl && r.output);
const done = rows.filter((r) => r.impl);

console.log(`\nControl-key coverage across ${files.filter((f) => f.endsWith('.midi.xml')).length} mappings`);
console.log(`  distinct control families referenced: ${rows.length}`);
console.log(
  `  implemented: ${done.length}   missing INPUTS: ${missingIn.length}   missing OUTPUTS(LED): ${missingOut.length}\n`,
);
console.log('MISSING INPUTS (controller -> app behavior, ranked by mappings):');
console.log('  uses  control');
for (const r of missingIn) console.log(`  ${String(r.count).padStart(4)}  ${r.key}`);
console.log('\nMISSING OUTPUTS (app -> controller LED feedback, ranked):');
for (const r of missingOut) console.log(`  ${String(r.count).padStart(4)}  ${r.key}`);
if (showAll) {
  console.log('\nIMPLEMENTED:');
  for (const r of done) console.log(`  ${String(r.count).padStart(4)}  ${r.key}`);
}
