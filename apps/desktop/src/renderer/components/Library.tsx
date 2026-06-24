/**
 * Library — the track browser. Queries the main-process library over IPC, shows
 * a sortable/searchable table, and loads a track to a deck on double-click (or
 * via the deck buttons). Scan adds a folder.
 */

import { useCallback, useEffect, useState } from 'react';
import type { LibTrack } from '../../shared/ipc.js';
import { useDj, NUM_DECKS } from '../dj-context.js';
import { decodeArrayBuffer } from '@internal-dj/codec';
import { computePeakSet, detailBucketsForDuration } from '@internal-dj/waveform';
import { deck as deckGroup, DeckKeys } from '@internal-dj/control-bus';

type SortCol = 'artist' | 'title' | 'album' | 'bpm' | 'duration' | 'genre';

export function Library(): React.JSX.Element {
  const { engine, bus, started, start } = useDj();
  const [tracks, setTracks] = useState<LibTrack[]>([]);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('artist');
  const [sortDesc, setSortDesc] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const [dbError, setDbError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await window.dj.libraryQuery({
        search,
        sortColumn: sortCol,
        sortDesc,
        limit: 500,
      });
      setTracks(rows);
      setDbError(null);
    } catch (err) {
      // Most likely the native better-sqlite3 module needs an electron-rebuild.
      setDbError(
        'Library database unavailable. If you just installed, run: npx electron-rebuild',
      );
      console.error('library query failed:', err);
    }
  }, [search, sortCol, sortDesc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return window.dj.onScanProgress((p) => {
      setScanning(p.current === 'done' ? null : `scanning… ${p.scanned} files, ${p.added} added`);
    });
  }, []);

  const onScan = useCallback(async () => {
    setScanning('choosing folder…');
    const summary = await window.dj.libraryScan();
    setScanning(null);
    if (summary) {
      await refresh();
    }
  }, [refresh]);

  const loadToDeck = useCallback(
    async (track: LibTrack, deckIndex: number) => {
      if (!started) {
        await start();
      }
      const file = await window.dj.readTrackById(track.id);
      if (!file) {
        return;
      }
      const ctx = engine.audioContext!;
      const decoded = await decodeArrayBuffer(ctx, file.data, file.name);
      // peaks
      const all = new Float32Array(decoded.sampleBuffer);
      const channelData: Float32Array[] = [];
      for (let c = 0; c < decoded.channels; c++) {
        channelData.push(all.subarray(c * decoded.frames, (c + 1) * decoded.frames));
      }
      const dur = decoded.frames / decoded.sampleRate;
      const peaks = computePeakSet(channelData, decoded.frames, detailBucketsForDuration(dur));
      // stash peaks on a window cache the Deck reads (simple handoff for now)
      (window as unknown as { __peaks?: Record<number, unknown> }).__peaks ??= {};
      (window as unknown as { __peaks: Record<number, unknown> }).__peaks[deckIndex] = peaks;
      window.dispatchEvent(
        new CustomEvent('deck-track-loaded', { detail: { deckIndex, peaks, track } }),
      );

      engine.loadTrack(deckIndex, decoded);
      if (track.bpm > 0) {
        bus.set(deckGroup(deckIndex + 1), DeckKeys.fileBpm, track.bpm);
      }
      void window.dj.libraryIncrementPlay(track.id);
    },
    [engine, bus, started, start],
  );

  const toggleSort = (col: SortCol) => {
    if (col === sortCol) {
      setSortDesc((d) => !d);
    } else {
      setSortCol(col);
      setSortDesc(false);
    }
  };

  return (
    <section className="library" aria-label="Library">
      <div className="library-toolbar">
        <input
          type="search"
          placeholder="search  (try  a:daft  bpm:120-130 )"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="library-search"
        />
        <button onClick={onScan} disabled={!!scanning}>
          {scanning ? scanning : '+ add folder'}
        </button>
        <span className="library-count">{tracks.length} tracks</span>
        {dbError && <span className="library-error">{dbError}</span>}
      </div>

      <div className="library-table-wrap">
        <table className="library-table">
          <thead>
            <tr>
              {(['artist', 'title', 'album', 'genre', 'bpm', 'duration'] as SortCol[]).map((c) => (
                <th key={c} onClick={() => toggleSort(c)} className={sortCol === c ? 'sorted' : ''}>
                  {c.toUpperCase()}
                  {sortCol === c ? (sortDesc ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
              <th>LOAD</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => (
              <tr
                key={t.id}
                className={selected === t.id ? 'selected' : ''}
                onClick={() => setSelected(t.id)}
                onDoubleClick={() => void loadToDeck(t, 0)}
              >
                <td>{t.artist}</td>
                <td>{t.title}</td>
                <td>{t.album}</td>
                <td>{t.genre}</td>
                <td className="num">{t.bpm > 0 ? t.bpm.toFixed(0) : ''}</td>
                <td className="num">{fmtDur(t.duration)}</td>
                <td className="load-cells">
                  {Array.from({ length: NUM_DECKS }, (_, d) => (
                    <button
                      key={d}
                      className="tiny"
                      onClick={(e) => {
                        e.stopPropagation();
                        void loadToDeck(t, d);
                      }}
                      title={`Load to deck ${d + 1}`}
                    >
                      {d + 1}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function fmtDur(s: number | null): string {
  if (!s) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
