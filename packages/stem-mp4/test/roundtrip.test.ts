import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  StemMp4Writer,
  extractAllTracks,
  getTrackCount,
  getTrackInfo,
  STEM_TRACK_ORDER,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
// A tiny real AAC .m4a (4s sine), used as every track so we exercise the muxer +
// extractor on genuine AAC sample tables without shipping a huge fixture.
const tone = new Uint8Array(readFileSync(join(here, 'fixtures', 'tone.m4a')));

describe('@dj/stem-mp4 write → read round-trip', () => {
  it('muxes a STEMS-4 .stem.mp4 with mixdown + 4 stems (5 audio tracks)', async () => {
    const res = await StemMp4Writer.write({
      mixdownAac: tone,
      stemsAac: { drums: tone, bass: tone, other: tone, vocals: tone },
      profile: 'STEMS-4',
      encoderDelaySamples: 1024,
      sampleRate: 44100,
      metadata: { title: 'Test', artist: 'DJ', bpm: 120 },
    });
    expect(res.success).toBe(true);
    expect(res.data.byteLength).toBeGreaterThan(tone.byteLength); // 5 tracks > 1
    expect(res.profile).toBe('STEMS-4');
    // mixdown + 4 stems = 5 audio tracks (lyrics are empty so no text track)
    expect(getTrackCount(res.data)).toBe(STEM_TRACK_ORDER.length);
  });

  it('extracts every stem back as a standalone playable M4A', async () => {
    const res = await StemMp4Writer.write({
      mixdownAac: tone,
      stemsAac: { drums: tone, bass: tone, other: tone, vocals: tone },
      profile: 'STEMS-4',
      encoderDelaySamples: 1024,
    });
    const tracks = extractAllTracks(res.data);
    expect(tracks.length).toBe(5); // mixdown + 4 stems
    for (const t of tracks) {
      expect(t.byteLength).toBeGreaterThan(0);
      // each extracted track is itself a valid single-track m4a
      expect(getTrackCount(t)).toBe(1);
    }
  });

  it('every track has the same duration (sample-aligned)', async () => {
    const res = await StemMp4Writer.write({
      mixdownAac: tone,
      stemsAac: { drums: tone, bass: tone, other: tone, vocals: tone },
      profile: 'STEMS-4',
      encoderDelaySamples: 1024,
    });
    const info = getTrackInfo(res.data);
    const durations = info.map((t) => Math.round(t.duration * 10) / 10);
    expect(new Set(durations).size).toBe(1); // all equal
  });
});
