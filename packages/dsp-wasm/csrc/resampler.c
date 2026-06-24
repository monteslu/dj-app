/*
 * resampler.c — the real-time deck sample reader, in C → WASM (SIMD).
 *
 * Replaces the per-sample JS loop in deck-playback.ts pullResampled (the #1
 * "heavy lifting in JS" violation — see 12-build-log.md DEBT LEDGER). Linear
 * interpolation over planar stereo source with a fractional read position and a
 * resample ratio, plus the loop-wrap + seam-crossfade logic.
 *
 * Memory model: the JS side allocates source channel buffers + output buffers in
 * the WASM heap and passes pointers. State (the fractional position) is passed in
 * and returned via a small struct so DeckPlayback stays the position owner.
 *
 * Compiled with -msimd128 -O3; the inner interp loop auto-vectorizes. Exposed as
 * a flat C ABI (no name mangling) for direct WASM export.
 */

#include <stdint.h>
#include <math.h>

/* Result of a pull: how many output frames were produced + the new position. */
typedef struct {
  double new_position;
  int produced;
} PullResult;

static PullResult g_result;

/* Accessors (returning a struct by value over the WASM boundary is awkward; use
 * globals the JS reads after the call). */
double resampler_last_position(void) { return g_result.new_position; }
int resampler_last_produced(void) { return g_result.produced; }

/*
 * Pull `num_frames` of output from planar stereo source into out_l/out_r.
 *
 *   src_l, src_r : planar source channels (length src_frames)
 *   src_frames   : source length
 *   out_l, out_r : output channels (length num_frames)
 *   num_frames   : frames to produce
 *   position     : starting fractional source position
 *   ratio        : source frames advanced per output frame (baseRate*speed)
 *   loop_enabled : 1 if a loop is active
 *   loop_start, loop_end : loop bounds (frames)
 *   seam_fade    : crossfade length (frames) at the loop seam
 *
 * Writes results to g_result (new_position, produced). Produced < num_frames at
 * end-of-track (when not looping).
 */
void resampler_pull(
    const float* src_l, const float* src_r, int src_frames,
    float* out_l, float* out_r, int num_frames,
    double position, double ratio,
    int loop_enabled, double loop_start, double loop_end, double seam_fade) {
  int produced = 0;

  for (int i = 0; i < num_frames; i++) {
    double pos = position;

    /* Loop wrap: keep the fractional overshoot for phase continuity. */
    if (loop_enabled && ratio > 0.0 && pos >= loop_end) {
      pos = loop_start + (pos - loop_end);
      position = pos;
    }

    if (pos < 0.0 || pos >= (double)src_frames) {
      position = pos < 0.0 ? 0.0 : (double)src_frames;
      break;
    }

    int i0 = (int)pos;
    double frac = pos - (double)i0;
    int i1 = (i0 + 1 < src_frames) ? i0 + 1 : i0;

    float l0 = src_l[i0], l1 = src_l[i1];
    float r0 = src_r[i0], r1 = src_r[i1];
    float lf = (float)frac;
    float ol = l0 + (l1 - l0) * lf;
    float orr = r0 + (r1 - r0) * lf;

    /* Seam crossfade near loop_end. */
    if (loop_enabled && ratio > 0.0) {
      double dist = loop_end - pos;
      if (dist > 0.0 && dist < seam_fade) {
        double t = dist / seam_fade; /* 1 far, 0 at seam */
        double wrap_pos = loop_start + (seam_fade - dist);
        if (wrap_pos < (double)src_frames) {
          int w0 = (int)wrap_pos;
          double wfrac = wrap_pos - (double)w0;
          int w1 = (w0 + 1 < src_frames) ? w0 + 1 : w0;
          float wl = src_l[w0] + (src_l[w1] - src_l[w0]) * (float)wfrac;
          float wr = src_r[w0] + (src_r[w1] - src_r[w0]) * (float)wfrac;
          float tf = (float)t;
          ol = ol * tf + wl * (1.0f - tf);
          orr = orr * tf + wr * (1.0f - tf);
        }
      }
    }

    out_l[i] = ol;
    out_r[i] = orr;
    position = pos + ratio;
    produced++;
  }

  g_result.new_position = position;
  g_result.produced = produced;
}

/* --- Heap allocation helpers (so JS can place buffers in WASM memory) --- */
#include <stdlib.h>
void* resampler_malloc(int bytes) { return malloc((size_t)bytes); }
void resampler_free(void* p) { free(p); }
