/**
 * LibraryControl — the controller-facing library browser (Mixxx [Library]/[Playlist]
 * controls). Controllers navigate the track list and load tracks through named bus
 * controls; this owns the selection index and reacts to them:
 *
 *   SelectTrackKnob / MoveVertical (±N)  → move the highlight by N rows
 *   SelectNextTrack / SelectPrevTrack    → ±1 row
 *   MoveUp / MoveDown                    → ±1 row
 *   LoadSelectedTrack                    → load highlighted track into the first stopped deck
 *   LoadSelectedTrackAndPlay             → load + play
 *   LoadSelectedIntoFirstStopped         → same as LoadSelectedTrack (explicit)
 *
 * The selection lives on the bus (selected_index) so the Library UI mirrors it and the
 * controller + mouse stay in sync. 121 of the 144 bundled mappings need this — it's the
 * gate to using a controller at all.
 *
 * Registered for BOTH [Library] and [Playlist] groups (old mappings address the track
 * list via [Playlist]).
 */

import {
  LIBRARY,
  PLAYLIST,
  LibraryKeys,
  deck as deckGroup,
  type ControlBus,
  type Group,
} from '@dj/control-bus';

export interface LibraryControlDeps {
  bus: ControlBus;
  /** Number of decks (for per-deck LoadSelectedTrack wiring). */
  numDecks: number;
  /** Number of rows currently in the (filtered/sorted) track list. */
  trackCount: () => number;
  /** Load the track at list index `i` into deck `deckIndex`; play if `play`. */
  loadIndexToDeck: (i: number, deckIndex: number, play: boolean) => void;
  /** Index of the first stopped deck to load into (Mixxx loads to the focused deck). */
  firstStoppedDeck: () => number;
}

export class LibraryControl {
  private readonly offs: Array<() => void> = [];

  constructor(private readonly deps: LibraryControlDeps) {
    // Track-list navigation lives on [Library] + [Playlist] (old mappings use either).
    for (const g of [LIBRARY, PLAYLIST]) {
      this.wire(g);
    }
    // PER-DECK load: real mappings (incl. DJ2GO2) drive LoadSelectedTrack on the DECK
    // group "[ChannelN]" to mean "load the highlighted track INTO deck N" — not [Library].
    for (let d = 0; d < deps.numDecks; d++) {
      const g = deckGroup(d + 1);
      this.pulse(g, LibraryKeys.loadSelectedTrack, () => this.load(d, false));
      this.pulse(g, LibraryKeys.loadSelectedIntoFirstStopped, () => this.load(d, false));
      this.pulse(g, LibraryKeys.loadSelectedTrackAndPlay, () => this.load(d, true));
    }
  }

  /** Current highlighted row, clamped to the list. */
  get selected(): number {
    const n = this.deps.trackCount();
    if (n <= 0) return 0;
    const i = Math.round(this.deps.bus.get(LIBRARY, LibraryKeys.selectedIndex));
    return Math.max(0, Math.min(n - 1, i));
  }

  private setSelected(i: number): void {
    const n = this.deps.trackCount();
    const clamped = n <= 0 ? 0 : Math.max(0, Math.min(n - 1, i));
    // Keep both groups' selection in lockstep so [Library] and [Playlist] agree.
    this.deps.bus.set(LIBRARY, LibraryKeys.selectedIndex, clamped);
    this.deps.bus.set(PLAYLIST, LibraryKeys.selectedIndex, clamped);
  }

  private move(delta: number): void {
    if (delta) this.setSelected(this.selected + delta);
  }

  private load(deckIndex: number, play: boolean): void {
    const n = this.deps.trackCount();
    if (n <= 0 || deckIndex < 0) return;
    this.deps.loadIndexToDeck(this.selected, deckIndex, play);
  }

  private wire(g: Group): void {
    // Relative knob: value is a SIGNED delta (1 / 127=-1 style is decoded by the mapping
    // before it reaches us; here a positive value = down N, negative = up N). We read the
    // raw value as the delta and self-reset.
    this.pulse(g, LibraryKeys.selectTrackKnob, (v) => this.move(signedDelta(v)));
    this.pulse(g, LibraryKeys.moveVertical, (v) => this.move(signedDelta(v)));
    this.pulse(g, LibraryKeys.selectNextTrack, () => this.move(1));
    this.pulse(g, LibraryKeys.selectPrevTrack, () => this.move(-1));
    this.pulse(g, LibraryKeys.moveDown, () => this.move(1));
    this.pulse(g, LibraryKeys.moveUp, () => this.move(-1));
    this.pulse(g, LibraryKeys.loadSelectedTrack, () => this.load(this.deps.firstStoppedDeck(), false));
    this.pulse(g, LibraryKeys.loadSelectedIntoFirstStopped, () =>
      this.load(this.deps.firstStoppedDeck(), false),
    );
    this.pulse(g, LibraryKeys.loadSelectedTrackAndPlay, () =>
      this.load(this.deps.firstStoppedDeck(), true),
    );
    // GoToItem on the track list = load to first stopped deck (Mixxx loads/expands).
    this.pulse(g, LibraryKeys.goToItem, () => this.load(this.deps.firstStoppedDeck(), false));
  }

  /** Momentary control: fire on a nonzero value, then reset to 0 so it re-triggers. */
  private pulse(g: Group, key: string, fn: (v: number) => void): void {
    this.offs.push(
      this.deps.bus.connect(g, key, (v) => {
        if (v !== 0) {
          fn(v);
          this.deps.bus.set(g, key, 0);
        }
      }),
    );
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}

/** Decode a relative-encoder value to a signed step. Mappings send either a small signed
 * integer (e.g. +1/-1, or +3) OR Mixxx's two's-complement-ish 1..63 = +, 65..127 = -.
 * Treat >64 as negative (value-128), else as-is. 0 never reaches here. */
function signedDelta(v: number): number {
  if (v > 64 && v <= 127) return v - 128;
  return v;
}
