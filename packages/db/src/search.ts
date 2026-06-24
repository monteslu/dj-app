/**
 * Search query parser (Mixxx SearchQueryParser analog, 05-library-and-data.md §3).
 * Parses a query string into a WHERE clause + bound parameters. Supports:
 *   - bare terms → match across artist/title/album/genre
 *   - field:value (with aliases): artist/a, title/t, album/al, genre/g, bpm/b,
 *     year/y, comment/cm, key/k
 *   - numeric comparisons: bpm:>120, year:<2010, bpm:120-130
 *   - quoted phrases: artist:"com truise"
 *   - negation: -genre:house
 *   - OR within a field group is implicit across space-separated terms = AND
 *
 * Returns PARAMETERIZED SQL (never string-interpolated values) — the bound
 * params array pairs with `?` placeholders.
 */

export interface SqlFragment {
  where: string;
  params: unknown[];
}

const TEXT_FIELDS: Record<string, string> = {
  artist: 'artist',
  a: 'artist',
  title: 'title',
  t: 'title',
  album: 'album',
  al: 'album',
  genre: 'genre',
  g: 'genre',
  comment: 'comment',
  cm: 'comment',
  key: 'key',
  k: 'key',
};

const NUMERIC_FIELDS: Record<string, string> = {
  bpm: 'bpm',
  b: 'bpm',
  year: 'year',
  y: 'year',
  rating: 'rating',
  r: 'rating',
  bitrate: 'bitrate',
};

/** Split a query into terms, keeping quoted phrases together. */
function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const re = /-?\w+:"[^"]*"|-?"[^"]*"|-?\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

function parseNumericComparison(field: string, raw: string): SqlFragment | null {
  // operators: > >= < <= = , range lo-hi
  const opMatch = raw.match(/^(>=|<=|>|<|=)(.+)$/);
  if (opMatch) {
    const op = opMatch[1]!;
    const v = Number(opMatch[2]);
    if (Number.isNaN(v)) return null;
    return { where: `${field} ${op} ?`, params: [v] };
  }
  const rangeMatch = raw.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const lo = Number(rangeMatch[1]);
    const hi = Number(rangeMatch[2]);
    if (Number.isNaN(lo) || Number.isNaN(hi)) return null;
    return { where: `${field} BETWEEN ? AND ?`, params: [lo, hi] };
  }
  const v = Number(raw);
  if (Number.isNaN(v)) return null;
  // exact-ish: for bpm, a small tolerance window feels natural
  if (field === 'bpm') {
    return { where: `${field} BETWEEN ? AND ?`, params: [v - 0.5, v + 0.5] };
  }
  return { where: `${field} = ?`, params: [v] };
}

function unquote(s: string): string {
  return s.replace(/^"|"$/g, '');
}

/** Parse one term into a fragment, or null to ignore. */
function parseTerm(token: string): SqlFragment | null {
  let negate = false;
  let t = token;
  if (t.startsWith('-')) {
    negate = true;
    t = t.slice(1);
  }

  const colon = t.indexOf(':');
  if (colon > 0) {
    const field = t.slice(0, colon).toLowerCase();
    const value = unquote(t.slice(colon + 1));
    if (NUMERIC_FIELDS[field]) {
      const frag = parseNumericComparison(NUMERIC_FIELDS[field], value);
      if (frag) {
        return negate ? { where: `NOT (${frag.where})`, params: frag.params } : frag;
      }
      return null;
    }
    if (TEXT_FIELDS[field]) {
      const col = TEXT_FIELDS[field];
      const frag: SqlFragment = { where: `${col} LIKE ?`, params: [`%${value}%`] };
      return negate ? { where: `(${col} IS NULL OR ${col} NOT LIKE ?)`, params: [`%${value}%`] } : frag;
    }
    // unknown field → treat whole token as a bare term
  }

  // Bare term: match across the main text fields.
  const v = unquote(t);
  const cols = ['artist', 'title', 'album', 'genre'];
  const where = '(' + cols.map((c) => `${c} LIKE ?`).join(' OR ') + ')';
  const params = cols.map(() => `%${v}%`);
  return negate ? { where: `NOT ${where}`, params } : { where, params };
}

/** Parse a full query into a combined WHERE fragment (terms AND-ed). */
export function parseSearch(query: string): SqlFragment {
  const tokens = tokenize(query.trim());
  const frags = tokens.map(parseTerm).filter((f): f is SqlFragment => f !== null);
  if (frags.length === 0) {
    return { where: '1', params: [] };
  }
  return {
    where: frags.map((f) => `(${f.where})`).join(' AND '),
    params: frags.flatMap((f) => f.params),
  };
}
