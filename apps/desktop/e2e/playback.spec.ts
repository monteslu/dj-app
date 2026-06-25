import { test, expect } from '@playwright/test';

// The "top waves don't move" bug: during playback the playhead must ADVANCE so the
// waveform scrolls. Loads a REAL mp3 (served from ~/Music/mp3 by vite.browser),
// starts playback, and asserts playposition climbs over ~1s. Needs the
// AudioContext to run — the config sets --autoplay-policy=no-user-gesture-required.

test('playhead advances during playback (waves scroll)', async ({ page }) => {
  await page.goto('/browser.html?demo&gl');
  await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__dj, { timeout: 10_000 });

  const r = await page.evaluate(async () => {
    const dj = (globalThis as Record<string, unknown>).__dj as {
      engine: { start: () => Promise<void>; audioContext: AudioContext | null };
      bus: { get: (g: string, k: string) => number; set: (g: string, k: string, v: number) => void };
      loadToDeck: (deck: number, file: { name: string; data: ArrayBuffer }) => Promise<void>;
    };
    const api = (globalThis as unknown as { dj: { readTrackById: (id: number) => Promise<{ name: string; data: ArrayBuffer } | null> } }).dj;

    await dj.engine.start();
    const ctx = dj.engine.audioContext!;
    if (ctx.state !== 'running') await ctx.resume();

    const file = await api.readTrackById(1); // real mp3
    await dj.loadToDeck(0, { name: file!.name, data: file!.data }); // REAL load pipeline

    dj.bus.set('[Channel1]', 'play', 1);
    const p0 = dj.bus.get('[Channel1]', 'playposition');
    await new Promise((res) => setTimeout(res, 1000));
    const p1 = dj.bus.get('[Channel1]', 'playposition');
    const samples = dj.bus.get('[Channel1]', 'track_samples');
    return { p0, p1, ctxState: ctx.state, samples, advanced: p1 - p0 };
  });

  expect(r.ctxState, 'audio context running').toBe('running');
  expect(r.samples, 'track loaded (track_samples set)').toBeGreaterThan(0);
  expect(r.advanced, `playposition advance over 1s (p0=${r.p0} p1=${r.p1})`).toBeGreaterThan(0.001);
});
