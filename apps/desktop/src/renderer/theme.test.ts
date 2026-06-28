import { describe, it, expect, beforeEach, vi } from 'vitest';

// Theme module: validation + persistence. localStorage is stubbed (node env).

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
}

describe('theme', () => {
  beforeEach(() => {
    stubLocalStorage();
    vi.resetModules();
  });

  it('defaults to the first theme', async () => {
    const { getTheme, THEMES } = await import('./theme.js');
    expect(getTheme()).toBe(THEMES[0]!.id);
  });

  it('setTheme persists + getTheme reflects it', async () => {
    const { setTheme, getTheme } = await import('./theme.js');
    setTheme('daylight');
    expect(getTheme()).toBe('daylight');
    expect(localStorage.getItem('dj-theme')).toBe('daylight');
  });

  it('ignores an unknown theme id', async () => {
    const { setTheme, getTheme, THEMES } = await import('./theme.js');
    setTheme('not-a-theme');
    expect(getTheme()).toBe(THEMES[0]!.id);
  });

  it('restores a persisted theme on load', async () => {
    localStorage.setItem('dj-theme', 'graphite');
    const { getTheme } = await import('./theme.js');
    expect(getTheme()).toBe('graphite');
  });
});
