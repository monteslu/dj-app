import { describe, it, expect, beforeEach } from 'vitest';
import { LibraryDb } from './library-db.js';
import { parseSearch } from './search.js';
import { CueType } from './types.js';

describe('parseSearch', () => {
  it('empty query matches all', () => {
    expect(parseSearch('').where).toBe('1');
  });

  it('bare term searches across text fields', () => {
    const f = parseSearch('truise');
    expect(f.where).toContain('artist LIKE ?');
    expect(f.where).toContain('OR');
    expect(f.params).toEqual(['%truise%', '%truise%', '%truise%', '%truise%']);
  });

  it('field:value with alias', () => {
    const f = parseSearch('a:daft');
    expect(f.where).toBe('(artist LIKE ?)');
    expect(f.params).toEqual(['%daft%']);
  });

  it('quoted phrase keeps spaces', () => {
    const f = parseSearch('artist:"com truise"');
    expect(f.params).toEqual(['%com truise%']);
  });

  it('numeric comparison', () => {
    expect(parseSearch('bpm:>120').where).toContain('bpm > ?');
    expect(parseSearch('year:<2010').params).toEqual([2010]);
  });

  it('numeric range', () => {
    const f = parseSearch('bpm:120-130');
    expect(f.where).toContain('BETWEEN');
    expect(f.params).toEqual([120, 130]);
  });

  it('bpm exact gets a tolerance window', () => {
    const f = parseSearch('bpm:128');
    expect(f.params).toEqual([127.5, 128.5]);
  });

  it('negation', () => {
    const f = parseSearch('-genre:house');
    expect(f.where).toContain('NOT LIKE');
  });

  it('multiple terms are AND-ed', () => {
    const f = parseSearch('a:daft bpm:>120');
    expect(f.where).toContain(' AND ');
  });
});

describe('LibraryDb', () => {
  let db: LibraryDb;

  beforeEach(() => {
    db = new LibraryDb(':memory:');
  });

  function addTrack(over: Partial<Parameters<LibraryDb['upsertTrack']>[0]> = {}) {
    return db.upsertTrack({
      location: '/music/' + (over.title ?? 'x') + '.mp3',
      artist: 'Artist',
      title: 'Title',
      album: 'Album',
      genre: 'House',
      duration: 240,
      bpm: 0,
      ...over,
    } as never);
  }

  it('inserts and queries a track', () => {
    const id = addTrack({ title: 'Song A', artist: 'Daft Punk' });
    const rows = db.queryTracks();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(id);
    expect(rows[0]!.artist).toBe('Daft Punk');
  });

  it('upsert is idempotent by location', () => {
    const a = addTrack({ title: 'Same', location: '/music/same.mp3' });
    const b = addTrack({ title: 'Same', location: '/music/same.mp3' });
    expect(a).toBe(b);
    expect(db.countTracks()).toBe(1);
  });

  it('searches by field', () => {
    addTrack({ title: 'Around', artist: 'Daft Punk', location: '/m/1.mp3' });
    addTrack({ title: 'Strobe', artist: 'Deadmau5', location: '/m/2.mp3' });
    const rows = db.queryTracks({ search: 'a:daft' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Around');
  });

  it('sorts and pages', () => {
    addTrack({ title: 'B', artist: 'Bbb', location: '/m/b.mp3' });
    addTrack({ title: 'A', artist: 'Aaa', location: '/m/a.mp3' });
    addTrack({ title: 'C', artist: 'Ccc', location: '/m/c.mp3' });
    const asc = db.queryTracks({ sortColumn: 'artist' });
    expect(asc.map((t) => t.artist)).toEqual(['Aaa', 'Bbb', 'Ccc']);
    const paged = db.queryTracks({ sortColumn: 'artist', limit: 1, offset: 1 });
    expect(paged[0]!.artist).toBe('Bbb');
  });

  it('stores analysis results', () => {
    const id = addTrack({ location: '/m/an.mp3' });
    db.setAnalysis(id, { bpm: 128.5, firstBeatFrame: 1024, key: 'Am' });
    const rows = db.queryTracks();
    expect(rows[0]!.bpm).toBe(128.5);
    expect(rows[0]!.firstBeatFrame).toBe(1024);
    expect(rows[0]!.key).toBe('Am');
  });

  it('stores and reads cues', () => {
    const id = addTrack({ location: '/m/cue.mp3' });
    db.setCues(id, [
      { type: CueType.HotCue, position: 1000, length: 0, hotcue: 1, label: 'drop', color: 0xff0000 },
      { type: CueType.MainCue, position: 0, length: 0, hotcue: -1, label: null, color: null },
    ]);
    const cues = db.getCues(id);
    expect(cues).toHaveLength(2);
    expect(cues.find((c) => c.hotcue === 1)?.label).toBe('drop');
  });

  it('manages crates', () => {
    const t1 = addTrack({ location: '/m/c1.mp3', title: 'T1' });
    const t2 = addTrack({ location: '/m/c2.mp3', title: 'T2' });
    const crate = db.createCrate('Favorites');
    db.addToCrate(crate, t1);
    db.addToCrate(crate, t2);
    db.addToCrate(crate, t1); // dup ignored
    expect(db.listCrates()[0]!.count).toBe(2);
    expect(db.crateTracks(crate)).toHaveLength(2);
  });

  it('manages playlists with ordering', () => {
    const t1 = addTrack({ location: '/m/p1.mp3' });
    const t2 = addTrack({ location: '/m/p2.mp3' });
    const pl = db.createPlaylist('Set 1');
    db.addToPlaylist(pl, t1);
    db.addToPlaylist(pl, t2);
    expect(db.listPlaylists()).toHaveLength(1);
  });

  it('increments play count', () => {
    const id = addTrack({ location: '/m/play.mp3' });
    db.incrementPlayCount(id);
    db.incrementPlayCount(id);
    expect(db.queryTracks()[0]!.timesPlayed).toBe(2);
  });

  it('tracks directories', () => {
    db.addDirectory('/music');
    db.addDirectory('/music'); // dup ignored
    db.addDirectory('/more');
    expect(db.listDirectories().sort()).toEqual(['/more', '/music']);
  });
});
