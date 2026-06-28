/**
 * Canonical stem palette — ONE source of truth for the 4 stem colors (NI-Stems order:
 * drums / bass / other / vocals). Was duplicated 5× across 4 files in 3 formats (hex,
 * [r,g,b], "r,g,b"); everything now imports from here so a theme can recolor stems in one
 * place. Each entry exposes every format the consumers need.
 *
 * NOTE: stem colors are part of the theme. When the theming system can override them, this
 * stays the DEFAULT (Nightclub) palette; a theme supplies replacements in the same shape.
 */

export interface StemColor {
  name: string;
  hex: string;
  rgb: readonly [number, number, number];
  /** "r,g,b" — for CSS rgba() string building in the canvas renderer. */
  csv: string;
}

function mk(name: string, r: number, g: number, b: number): StemColor {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return { name, hex: `#${h(r)}${h(g)}${h(b)}`, rgb: [r, g, b], csv: `${r},${g},${b}` };
}

/** Drums / Bass / Other / Vocals — index = NI-Stems order. */
export const STEM_COLORS: readonly StemColor[] = [
  mk('DRUMS', 255, 93, 93), // #ff5d5d
  mk('BASS', 255, 210, 77), // #ffd24d
  mk('OTHER', 93, 255, 158), // #5dff9e
  mk('VOCAL', 93, 184, 255), // #5db8ff
] as const;
