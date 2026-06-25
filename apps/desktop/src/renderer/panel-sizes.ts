/**
 * Panel sizing persistence — the splitter writes a manual console height that
 * survives reloads (localStorage). A manual size overrides the layout preset's
 * default ratio; switching presets clears the manual override so the preset takes
 * effect. Kept tiny + framework-free so the splitter can call it directly.
 */

const KEY = 'dj-panel-console-h';

export function getConsoleHeight(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function setConsoleHeight(px: number): void {
  try {
    localStorage.setItem(KEY, String(Math.round(px)));
  } catch {
    /* ignore */
  }
}

export function clearConsoleHeight(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Apply a saved manual console height to the .app element (if any). */
export function applyConsoleHeight(app: HTMLElement): void {
  const h = getConsoleHeight();
  if (h && h > 0) {
    app.style.setProperty('--console-h', `${h}px`);
  } else {
    app.style.removeProperty('--console-h');
  }
}
