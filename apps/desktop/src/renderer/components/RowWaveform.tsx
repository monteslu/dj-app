/**
 * RowWaveform — the tiny per-row overview waveform in the library table
 * (rekordbox / VirtualDJ style). These are STATIC (no playhead movement), so per
 * Luis's perf note we render each once to an image (OffscreenCanvas → data URL)
 * and cache it, then show a plain <img> — no per-frame canvas redraw for dozens
 * of rows. Shows a spinner while the track is being analyzed.
 */

import { useEffect, useState } from 'react';
import { drawOverview, DEFAULT_COLORS, type PeakData } from '@internal-dj/waveform';

const W = 120;
const H = 26;

// process-wide cache: trackId → rendered data URL (or '' = no waveform yet)
const cache = new Map<number, string>();

function renderPeaks(peaks: Uint8Array): string {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(W, H)
      : Object.assign(document.createElement('canvas'), { width: W, height: H });
  // drawOverview wants a PeakData; build a minimal one from the cached bytes.
  const data: PeakData = {
    length: peaks.length,
    peaks,
    framesPerBucket: 1,
    frames: peaks.length,
  };
  // fraction 0 (no playhead emphasis needed for a static thumbnail)
  drawOverview(canvas as unknown as HTMLCanvasElement, data, 0, DEFAULT_COLORS);
  if (canvas instanceof HTMLCanvasElement) return canvas.toDataURL('image/png');
  // OffscreenCanvas path: convert to blob URL synchronously isn't possible, so
  // fall back to a data URL via a 2D readback.
  const ctx = (canvas as OffscreenCanvas).getContext('2d')!;
  const img = ctx.getImageData(0, 0, W, H);
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  return tmp.toDataURL('image/png');
}

export function RowWaveform({
  trackId,
  analyzing,
  done,
}: {
  trackId: number;
  analyzing: boolean;
  done: boolean;
}): React.JSX.Element {
  const [url, setUrl] = useState<string>(() => cache.get(trackId) ?? '');

  useEffect(() => {
    let cancelled = false;
    // a freshly-analyzed track has new peaks → bust any empty cache entry
    if (done && cache.get(trackId) === '') cache.delete(trackId);
    if (cache.has(trackId)) {
      setUrl(cache.get(trackId)!);
      return;
    }
    // demo mode: synthesize peaks so the mini-waves are visible in screenshots
    if (new URLSearchParams(location.search).has('demo')) {
      const peaks = new Uint8Array(120);
      for (let i = 0; i < 120; i++) {
        peaks[i] = Math.floor((0.4 + 0.6 * Math.abs(Math.sin(i * 0.3 + trackId))) * 255);
      }
      const u = renderPeaks(peaks);
      cache.set(trackId, u);
      setUrl(u);
      return;
    }
    void window.dj.libraryWaveform(trackId).then((peaks) => {
      if (cancelled) return;
      if (peaks && peaks.length > 0) {
        const u = renderPeaks(peaks);
        cache.set(trackId, u);
        setUrl(u);
      } else {
        setUrl('');
      }
    });
    return () => {
      cancelled = true;
    };
    // re-fetch when this track just finished analyzing (peaks now exist)
  }, [trackId, done]);

  if (analyzing) {
    return (
      <span className="rowwave rowwave-analyzing" title="Analyzing…">
        <span className="spin" />
      </span>
    );
  }
  if (url) {
    return <img className="rowwave" src={url} width={W} height={H} alt="" draggable={false} />;
  }
  return <span className="rowwave rowwave-empty" title="Not analyzed yet" />;
}
