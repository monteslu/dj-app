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

/**
 * Begin a splitter drag: resize the console (decks) vs library by dragging.
 * Writes --console-h live, persists the final size. Returns nothing — wires its
 * own global pointer listeners and cleans them up on release. The interaction
 * logic lives here (not in the JSX), paired with the persistence above.
 */
export function startConsoleResize(app: HTMLElement, capture?: (id: number) => void, pointerId?: number): void {
  if (pointerId != null) capture?.(pointerId);
  let lastH = 0;
  const move = (ev: PointerEvent) => {
    const rect = app.getBoundingClientRect();
    const top = app.querySelector('.waveform-band')?.getBoundingClientRect().bottom ?? rect.top;
    lastH = Math.max(140, Math.min(rect.bottom - 120, ev.clientY) - top);
    app.style.setProperty('--console-h', `${lastH}px`);
  };
  const up = () => {
    if (lastH > 0) setConsoleHeight(lastH);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
