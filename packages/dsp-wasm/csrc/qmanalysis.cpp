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

/* =================================================================================
 * BeatUtils::calculateBpm — ported VERBATIM from Mixxx src/track/beatutils.cpp so our
 * BPM matches Mixxx exactly (constant-region detection + ironing + musical rounding).
 * This is what fixes the octave/2× errors a naive median-IBI produces. Operates on
 * the beat positions (in frames). ================================================= */
} /* close extern "C" for the C++ helpers below */

namespace {
constexpr double kMaxSecsPhaseError = 0.025;
constexpr double kMaxSecsPhaseErrorSum = 0.1;
constexpr int kMaxOutliersCount = 1;
constexpr int kMinRegionBeatCount = 16;

struct ConstRegion { double firstBeat; double beatLength; };

double bu_trySnap(double minBpm, double centerBpm, double maxBpm, double fraction) {
  double snap = round(centerBpm * fraction) / fraction;
  return (snap > minBpm && snap < maxBpm) ? snap : 0.0; /* 0 = no snap */
}

double bu_roundBpmWithinRange(double minBpm, double centerBpm, double maxBpm) {
  double s = bu_trySnap(minBpm, centerBpm, maxBpm, 1.0); if (s) return s;
  if (centerBpm < 85.0) { s = bu_trySnap(minBpm, centerBpm, maxBpm, 2.0); if (s) return s; }
  if (centerBpm > 127.0) { s = bu_trySnap(minBpm, centerBpm, maxBpm, 2.0 / 3.0); if (s) return s; }
  s = bu_trySnap(minBpm, centerBpm, maxBpm, 3.0); if (s) return s;
  s = bu_trySnap(minBpm, centerBpm, maxBpm, 12.0); if (s) return s;
  return centerBpm;
}

/* retrieveConstRegions (beatutils.cpp) — coarse beats (frames) → constant regions. */
std::vector<ConstRegion> bu_retrieveConstRegions(const std::vector<double>& cb, double sr) {
  std::vector<ConstRegion> regions;
  if (cb.size() < 2) return regions;
  const double maxPhaseError = kMaxSecsPhaseError * sr;
  const double maxPhaseErrorSum = kMaxSecsPhaseErrorSum * sr;
  int leftIndex = 0;
  int rightIndex = (int)cb.size() - 1;
  while (leftIndex < (int)cb.size() - 1) {
    double meanBeatLength = (cb[rightIndex] - cb[leftIndex]) / (rightIndex - leftIndex);
    int outliers = 0;
    double ironedBeat = cb[leftIndex];
    double phaseErrorSum = 0;
    int i = leftIndex + 1;
    for (; i <= rightIndex; ++i) {
      ironedBeat += meanBeatLength;
      double phaseError = ironedBeat - cb[i];
      phaseErrorSum += phaseError;
      if (fabs(phaseError) > maxPhaseError) {
        outliers++;
        if (outliers > kMaxOutliersCount || i == leftIndex + 1) break;
      }
      if (fabs(phaseErrorSum) > maxPhaseErrorSum) break;
    }
    if (i > rightIndex) {
      double regionBorderError = 0;
      if (rightIndex > leftIndex + 2) {
        double firstBeatLength = cb[leftIndex + 1] - cb[leftIndex];
        double lastBeatLength = cb[rightIndex] - cb[rightIndex - 1];
        regionBorderError = fabs(firstBeatLength + lastBeatLength - (2 * meanBeatLength));
      }
      if (regionBorderError < maxPhaseError / 2) {
        regions.push_back({cb[leftIndex], meanBeatLength});
        leftIndex = rightIndex;
        rightIndex = (int)cb.size() - 1;
        continue;
      }
    }
    rightIndex--;
  }
  regions.push_back({cb.back(), 0});
  return regions;
}

/* makeConstBpm (beatutils.cpp) — pick the longest constant region, extend to similar
 * regions at start/end, then round within the phase-error range. Returns BPM. */
double bu_makeConstBpm(const std::vector<ConstRegion>& cr, double sr) {
  if (cr.empty()) return 0;
  int midRegion = 0;
  double longestLen = 0, longestBeatLen = 0;
  for (int i = 0; i < (int)cr.size() - 1; ++i) {
    double len = cr[i + 1].firstBeat - cr[i].firstBeat;
    if (len > longestLen) { longestLen = len; longestBeatLen = cr[i].beatLength; midRegion = i; }
  }
  if (longestLen == 0) return 0;
  int longestNumBeats = (int)((longestLen / longestBeatLen) + 0.5);
  if (longestNumBeats < 1) return 0;
  double lenMin = longestBeatLen - ((kMaxSecsPhaseError * sr) / longestNumBeats);
  double lenMax = longestBeatLen + ((kMaxSecsPhaseError * sr) / longestNumBeats);
  int startRegion = midRegion;
  /* extend toward the start */
  for (int i = 0; i < midRegion; ++i) {
    double len = cr[i + 1].firstBeat - cr[i].firstBeat;
    int nb = (int)((len / cr[i].beatLength) + 0.5);
    if (nb < kMinRegionBeatCount) continue;
    double tMin = cr[i].beatLength - ((kMaxSecsPhaseError * sr) / nb);
    double tMax = cr[i].beatLength + ((kMaxSecsPhaseError * sr) / nb);
    if (longestBeatLen > tMin && longestBeatLen < tMax) {
      double newLen = cr[midRegion + 1].firstBeat - cr[i].firstBeat;
      double blMin = std::max(lenMin, tMin), blMax = std::min(lenMax, tMax);
      int maxNb = (int)round(newLen / blMin), minNb = (int)round(newLen / blMax);
      if (minNb != maxNb) continue;
      double newBeatLen = newLen / minNb;
      if (newBeatLen > lenMin && newBeatLen < lenMax) {
        longestLen = newLen; longestBeatLen = newBeatLen; longestNumBeats = minNb;
        lenMin = longestBeatLen - ((kMaxSecsPhaseError * sr) / longestNumBeats);
        lenMax = longestBeatLen + ((kMaxSecsPhaseError * sr) / longestNumBeats);
        startRegion = i;
        break;
      }
    }
  }
  /* extend toward the end */
  for (int i = (int)cr.size() - 2; i > midRegion; --i) {
    double len = cr[i + 1].firstBeat - cr[i].firstBeat;
    int nb = (int)((len / cr[i].beatLength) + 0.5);
    if (nb < kMinRegionBeatCount) continue;
    double tMin = cr[i].beatLength - ((kMaxSecsPhaseError * sr) / nb);
    double tMax = cr[i].beatLength + ((kMaxSecsPhaseError * sr) / nb);
    if (longestBeatLen > tMin && longestBeatLen < tMax) {
      double newLen = cr[i + 1].firstBeat - cr[startRegion].firstBeat;
      double blMin = std::max(lenMin, tMin), blMax = std::min(lenMax, tMax);
      int maxNb = (int)round(newLen / blMin), minNb = (int)round(newLen / blMax);
      if (minNb != maxNb) continue;
      double newBeatLen = newLen / minNb;
      if (newBeatLen > lenMin && newBeatLen < lenMax) {
        longestLen = newLen; longestBeatLen = newBeatLen; longestNumBeats = minNb;
        break;
      }
    }
  }
  lenMin = longestBeatLen - ((kMaxSecsPhaseError * sr) / longestNumBeats);
  lenMax = longestBeatLen + ((kMaxSecsPhaseError * sr) / longestNumBeats);
  double minBpm = 60.0 * sr / lenMax;
  double maxBpm = 60.0 * sr / lenMin;
  double centerBpm = 60.0 * sr / longestBeatLen;
  return bu_roundBpmWithinRange(minBpm, centerBpm, maxBpm);
}

/* BeatUtils::calculateBpm entry. cb = beat positions in frames. */
double bu_calculateBpm(const std::vector<double>& cb, double sr) {
  if (cb.size() < 2) return 0;
  if ((int)cb.size() < kMinRegionBeatCount) {
    /* calculateAverageBpm fallback */
    return 60.0 * (cb.size() - 1) * sr / (cb.back() - cb.front());
  }
  return bu_makeConstBpm(bu_retrieveConstRegions(cb, sr), sr);
}
} /* anonymous namespace */

extern "C" {

/*
 * Run BOTH analyses over a MONO mix (the caller downmixes — qm only ever uses the
 * mono mix, so taking one buffer halves the per-track WASM memory vs two channels).
 *   mono   : downmixed samples (length frames)
 *   frames, sample_rate
 * Writes the g_* results.
 */
void qm_analyze(const float* mono, int frames, int sample_rate) {
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
        win[i] = (double)mono[pos + i];
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
    /* BPM via Mixxx's BeatUtils::calculateBpm (constant-region detection + musical
     * rounding) — identical to Mixxx, no naive median-IBI octave errors. */
    std::vector<double> beatFramesD(g_beat_frames.begin(), g_beat_frames.end());
    g_bpm = floor(bu_calculateBpm(beatFramesD, sr) * 100.0 + 0.5) / 100.0;
    /* confidence: consistency of inter-beat intervals (1 = perfectly steady) */
    std::vector<double> ibi;
    for (size_t i = 1; i < g_beat_frames.size(); i++)
      ibi.push_back((double)(g_beat_frames[i] - g_beat_frames[i - 1]));
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
      for (int i = 0; i < stepSize; i++) blk[i] = mono[pos + i];
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
        win[i] = (double)mono[pos + i];
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
