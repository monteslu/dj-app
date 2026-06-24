/**
 * Beats — the beatgrid model (Mixxx Beats analog, 05-library-and-data.md §2.3).
 * Positions are SOURCE FRAMES (seconds = frame / sampleRate). M5 supports the
 * constant-tempo case: a BPM + a first-beat frame offset; that's what the
 * autocorrelation detector produces and what 95% of dance music needs. Variable
 * tempo (a beat-position list) can extend this later.
 *
 * Immutable; scaling/translating returns a new Beats (matches Mixxx).
 */

export class Beats {
  /**
   * @param bpm        beats per minute (>0)
   * @param firstBeatFrame frame of the first beat (the grid anchor)
   * @param sampleRate frames per second
   */
  constructor(
    readonly bpm: number,
    readonly firstBeatFrame: number,
    readonly sampleRate: number,
  ) {}

  /** Frames between consecutive beats. */
  get framesPerBeat(): number {
    return (60 / this.bpm) * this.sampleRate;
  }

  /** Frame of the Nth beat (N may be negative or fractional). */
  beatFrame(n: number): number {
    return this.firstBeatFrame + n * this.framesPerBeat;
  }

  /** The (fractional) beat index at a given frame. */
  beatIndexAt(frame: number): number {
    return (frame - this.firstBeatFrame) / this.framesPerBeat;
  }

  /** Frame of the nearest beat to `frame`. */
  nearestBeat(frame: number): number {
    return this.beatFrame(Math.round(this.beatIndexAt(frame)));
  }

  /** Frame of the next beat at or after `frame`. */
  nextBeat(frame: number): number {
    return this.beatFrame(Math.ceil(this.beatIndexAt(frame) - 1e-9));
  }

  /** Frame of the previous beat at or before `frame`. */
  prevBeat(frame: number): number {
    return this.beatFrame(Math.floor(this.beatIndexAt(frame) + 1e-9));
  }

  /** Frame `nBeats` beats from `frame` (snapped to the grid from the prev beat). */
  framesFromBeats(frame: number, nBeats: number): number {
    return this.prevBeat(frame) + nBeats * this.framesPerBeat;
  }

  /**
   * Beat distance at a frame: fraction in [0,1) of the way from the previous beat
   * to the next (0 == on a beat). This is what the sync engine compares between
   * decks.
   */
  beatDistance(frame: number): number {
    const idx = this.beatIndexAt(frame);
    const frac = idx - Math.floor(idx);
    return frac < 0 ? frac + 1 : frac;
  }

  /** A new grid with a different BPM (same anchor). */
  withBpm(bpm: number): Beats {
    return new Beats(bpm, this.firstBeatFrame, this.sampleRate);
  }

  /** A new grid translated by `frames` (nudge the whole grid). */
  translate(frames: number): Beats {
    return new Beats(this.bpm, this.firstBeatFrame + frames, this.sampleRate);
  }

  /** A new grid scaled by `factor` (e.g. 2 = double BPM, 0.5 = half). */
  scale(factor: number): Beats {
    return new Beats(this.bpm * factor, this.firstBeatFrame, this.sampleRate);
  }

  /** Plain serializable form (versioned blob storage in the DB later). */
  toJSON(): { bpm: number; firstBeatFrame: number; sampleRate: number } {
    return { bpm: this.bpm, firstBeatFrame: this.firstBeatFrame, sampleRate: this.sampleRate };
  }

  static fromJSON(o: { bpm: number; firstBeatFrame: number; sampleRate: number }): Beats {
    return new Beats(o.bpm, o.firstBeatFrame, o.sampleRate);
  }
}
