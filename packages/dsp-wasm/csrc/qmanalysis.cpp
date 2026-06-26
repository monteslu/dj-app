/*
 * qmanalysis.cpp — Mixxx's ACTUAL analysis algorithms (Queen Mary DSP) compiled to
 * WASM. Replaces our hand-rolled JS key (Goertzel) + C autocorrelation beat detector.
 *
 *   KEY:  GetKeyMode (Constant-Q chromagram + key-profile correlation)
 *   BEAT: DetectionFunction (spectral onset) → TempoTrackV2 (DP beat tracking) →
 *         actual beat positions (not a constant grid)
 *   DOWNBEATS: DownBeat → which beats are bar starts (we had NO downbeat detection)
 *
 * Flow mirrors Mixxx's analyzerqueenmarykey.cpp / analyzerqueenmarybeats.cpp: window
 * the mono mix at the analyzer's block/hop size, feed each window to the detector.
 *
 * C-callable exports (no name mangling) for the JS wrapper. Compiled via emscripten
 * C++ -O3 -msimd128.
 */

#include <vector>
#include <cmath>
#include <cstring>
#include <cstdlib>
#include <algorithm>

#include "qm-dsp/dsp/keydetection/GetKeyMode.h"
#include "qm-dsp/dsp/onsets/DetectionFunction.h"
#include "qm-dsp/dsp/tempotracking/TempoTrackV2.h"
#include "qm-dsp/dsp/tempotracking/DownBeat.h"
#include "qm-dsp/maths/MathUtilities.h"

extern "C" {

/* ---- results, read back by JS after qm_analyze ---- */
static double g_bpm = 0;
static int g_first_beat_frame = 0;
static double g_confidence = 0;
static int g_key = 0; /* qm key index 1..24 (1-12 major C..B, 13-24 minor) */
static std::vector<int> g_beat_frames;     /* every detected beat, in source frames */
static std::vector<int> g_downbeat_frames; /* the bar-start beats, in source frames */

double qm_bpm() { return g_bpm; }
int qm_first_beat_frame() { return g_first_beat_frame; }
double qm_confidence() { return g_confidence; }
int qm_key() { return g_key; }
int qm_beat_count() { return (int)g_beat_frames.size(); }
int qm_beat_frame(int i) { return (i >= 0 && i < (int)g_beat_frames.size()) ? g_beat_frames[i] : -1; }
int qm_downbeat_count() { return (int)g_downbeat_frames.size(); }
int qm_downbeat_frame(int i) {
  return (i >= 0 && i < (int)g_downbeat_frames.size()) ? g_downbeat_frames[i] : -1;
}

void* qm_malloc(int bytes) { return malloc((size_t)bytes); }
void qm_free(void* p) { free(p); }

/* Mixxx constants (analyzerqueenmarybeats.cpp). */
static const double kStepSecs = 0.01161;       /* detection function step */
static const double kMaxBinSizeHz = 50.0;      /* → window size */
static const float kTuningFreqHz = 440.0f;

/*
 * Run BOTH analyses over planar mono-able stereo.
 *   src_l/src_r : channels (length frames). Mono: src_r == src_l.
 *   frames, sample_rate
 * Writes the g_* results.
 */
void qm_analyze(const float* src_l, const float* src_r, int frames, int sample_rate) {
  g_beat_frames.clear();
  g_downbeat_frames.clear();
  g_bpm = 0; g_first_beat_frame = 0; g_confidence = 0; g_key = 0;
  if (frames <= 0) return;

  const double sr = (double)sample_rate;

  /* =================== BEAT (DetectionFunction → TempoTrackV2) =================== */
  int stepSize = (int)(sr * kStepSecs);
  if (stepSize < 1) stepSize = 1;
  int windowSize = MathUtilities::nextPowerOfTwo((int)(sr / kMaxBinSizeHz));
  if (windowSize < stepSize) windowSize = stepSize;

  DFConfig dfConfig;
  dfConfig.DFType = DF_COMPLEXSD;
  dfConfig.stepSize = stepSize;
  dfConfig.frameLength = windowSize;
  dfConfig.dbRise = 3;
  dfConfig.adaptiveWhitening = false;
  dfConfig.whiteningRelaxCoeff = -1;
  dfConfig.whiteningFloor = -1;
  DetectionFunction df(dfConfig);

  std::vector<double> dfResults;
  {
    /* window the mono mix and feed each frame */
    std::vector<double> win(windowSize, 0.0);
    int pos = 0;
    while (pos + windowSize <= frames) {
      for (int i = 0; i < windowSize; i++) {
        win[i] = 0.5 * ((double)src_l[pos + i] + (double)src_r[pos + i]);
      }
      dfResults.push_back(df.processTimeDomain(win.data()));
      pos += stepSize;
    }
  }

  /* trim trailing zeros + skip first 2 (vamp convention, analyzerqueenmarybeats) */
  size_t nonZero = dfResults.size();
  while (nonZero > 0 && dfResults[nonZero - 1] <= 0.0) nonZero--;
  std::vector<double> dfv;
  for (size_t i = 2; i < nonZero; i++) dfv.push_back(dfResults[i]);

  std::vector<double> beats; /* beat positions, in DF-step units */
  if (dfv.size() > 4) {
    std::vector<int> beatPeriod(dfv.size());
    TempoTrackV2 tt((float)sr, stepSize);
    tt.calculateBeatPeriod(dfv, beatPeriod);
    tt.calculateBeats(dfv, beatPeriod, beats);
  }

  /* convert beat positions (DF steps) → source frames (+ half step, as Mixxx does) */
  for (double b : beats) {
    int frame = (int)(b * stepSize + stepSize / 2);
    if (frame >= 0 && frame < frames) g_beat_frames.push_back(frame);
  }

  if (g_beat_frames.size() >= 2) {
    g_first_beat_frame = g_beat_frames[0];
    /* median inter-beat interval → BPM (robust to outliers) */
    std::vector<double> ibi;
    for (size_t i = 1; i < g_beat_frames.size(); i++) {
      ibi.push_back((double)(g_beat_frames[i] - g_beat_frames[i - 1]));
    }
    std::sort(ibi.begin(), ibi.end());
    double medIbi = ibi[ibi.size() / 2];
    double rawBpm = medIbi > 0 ? (60.0 * sr / medIbi) : 0.0;
    /* Octave-fold into a standard DJ range. TempoTrackV2's Rayleigh weighting centers
     * near 120, so slow tracks can come back tracked at 2× (eighth-notes). Fold by
     * ×½ / ×2 into [76, 152) — the common single-octave window DJ software uses. */
    while (rawBpm >= 152.0) rawBpm /= 2.0;
    while (rawBpm > 0.0 && rawBpm < 76.0) rawBpm *= 2.0;
    g_bpm = floor(rawBpm * 100.0 + 0.5) / 100.0;
    /* confidence: consistency of inter-beat intervals (1 = perfectly steady) */
    double mean = 0; for (double v : ibi) mean += v; mean /= ibi.size();
    double var = 0; for (double v : ibi) { double d = v - mean; var += d * d; }
    var /= ibi.size();
    double cv = mean > 0 ? sqrt(var) / mean : 1.0;
    g_confidence = cv < 0 ? 0 : (cv > 1 ? 0 : 1.0 - cv);
  }

  /* =================== DOWNBEATS (DownBeat) =================== */
  if (g_beat_frames.size() >= 4) {
    /* DownBeat decimates the mono mix (by decimationFactor) and uses the spectral
     * difference across each beat's bar position to find bar starts. pushAudioBlock
     * expects exactly `stepSize` (m_increment) frames per call, mirroring how the
     * detection-function windowing advanced. Beats are passed in DF-step units. */
    DownBeat down((float)sr, /*decimationFactor*/ 16, stepSize);
    down.setBeatsPerBar(4);
    std::vector<float> blk(stepSize);
    int pos = 0;
    while (pos + stepSize <= frames) {
      for (int i = 0; i < stepSize; i++) blk[i] = 0.5f * (src_l[pos + i] + src_r[pos + i]);
      down.pushAudioBlock(blk.data());
      pos += stepSize;
    }
    size_t dsLen = 0;
    const float* dsAudio = down.getBufferedAudio(dsLen);
    std::vector<double> beatSteps(beats.begin(), beats.end());
    std::vector<int> downbeats; /* INDICES into the beat list that start a bar */
    down.findDownBeats(dsAudio, dsLen, beatSteps, downbeats);
    for (int idx : downbeats) {
      if (idx >= 0 && idx < (int)g_beat_frames.size()) {
        g_downbeat_frames.push_back(g_beat_frames[idx]);
      }
    }
  }

  /* =================== KEY (GetKeyMode) =================== */
  {
    GetKeyMode::Config kcfg(sample_rate, kTuningFreqHz);
    kcfg.frameOverlapFactor = 1;
    kcfg.decimationFactor = 8;
    GetKeyMode keyMode(kcfg);
    int blockSize = keyMode.getBlockSize();
    int hopSize = keyMode.getHopSize();
    if (hopSize < 1) hopSize = 1;

    int counts[25]; /* qm key 1..24 */
    memset(counts, 0, sizeof(counts));
    std::vector<double> win(blockSize, 0.0);
    int pos = 0;
    while (pos + blockSize <= frames) {
      for (int i = 0; i < blockSize; i++) {
        win[i] = 0.5 * ((double)src_l[pos + i] + (double)src_r[pos + i]);
      }
      int k = keyMode.process(win.data());
      if (k >= 1 && k <= 24) counts[k]++;
      pos += hopSize;
    }
    int bestK = 0, bestC = -1;
    for (int k = 1; k <= 24; k++) if (counts[k] > bestC) { bestC = counts[k]; bestK = k; }
    g_key = bestK;
  }
}

} /* extern "C" */
