import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

// Waveform lane: Canvas2D renderer. Two things matter:
//  1. it renders (not blank), and
//  2. as it scrolls, bar HEIGHTS stay frozen — horizontal movement must never
//     cause vertical distortion (the morph bug). We verify by comparing the
//     bar-height PROFILE at two playhead positions: the set of heights must match
//     (the content just slid), not change.

function heightProfile(png: PNG): number[] {
  const W = png.width;
  const H = png.height;
  const h: number[] = [];
  for (let x = 0; x < W; x++) {
    let c = 0;
    for (let y = 0; y < H; y++) {
      const i = (W * y + x) << 2;
      // count colored (bar) pixels, ignoring the dark background
      if (png.data[i]! > 45 || png.data[i + 1]! > 45 || png.data[i + 2]! > 55) c++;
    }
    h.push(c);
  }
  return h;
}

test('waveform renders', async ({ page }) => {
  await page.goto('/browser.html?demo&gl');
  await page.waitForSelector('.wf-scroll', { timeout: 10_000 });
  await page.waitForTimeout(2000);

  const lanes = await page.locator('.wf-scroll').all();
  expect(lanes.length).toBeGreaterThanOrEqual(2);
  for (const [i, lane] of lanes.entries()) {
    const png = PNG.sync.read(await lane.screenshot());
    const colors = new Set<string>();
    const y = (png.height / 2) | 0;
    for (let x = 0; x < png.width; x += 8) {
      const k = (png.width * y + x) << 2;
      colors.add(`${png.data[k]},${png.data[k + 1]},${png.data[k + 2]}`);
    }
    expect(colors.size, `lane ${i} renders content`).toBeGreaterThan(3);
  }
});

test('bar heights stay frozen while scrolling (no morph)', async ({ page }) => {
  await page.goto('/browser.html?demo&gl');
  await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__dj, { timeout: 10_000 });
  await page.evaluate(async () => {
    const dj = (globalThis as Record<string, unknown>).__dj as {
      engine: { start: () => Promise<void>; audioContext: AudioContext | null };
      bus: { set: (g: string, k: string, v: number) => void };
      loadToDeck: (d: number, f: { name: string; data: ArrayBuffer }) => Promise<void>;
    };
    const api = (globalThis as unknown as { dj: { readTrackById: (id: number) => Promise<{ name: string; data: ArrayBuffer } | null> } }).dj;
    await dj.engine.start();
    const ctx = dj.engine.audioContext!;
    if (ctx.state !== 'running') await ctx.resume();
    const f = await api.readTrackById(1);
    await dj.loadToDeck(0, { name: f!.name, data: f!.data });
    dj.bus.set('[Channel1]', 'play', 0); // paused; we set position explicitly
  });
  await page.waitForTimeout(400);

  const lane = page.locator('.wf-scroll').first();
  const ts = await page.evaluate(() => (globalThis as Record<string, unknown>).__dj as { bus: { get: (g: string, k: string) => number } });
  void ts;
  const setPos = (frac: number) =>
    page.evaluate((v) => (globalThis as Record<string, unknown> as { __dj: { bus: { set: (g: string, k: string, n: number) => void } } }).__dj.bus.set('[Channel1]', 'playposition', v), frac);
  const tsamples = await page.evaluate(() => (globalThis as Record<string, unknown> as { __dj: { bus: { get: (g: string, k: string) => number } } }).__dj.bus.get('[Channel1]', 'track_samples'));

  // two positions a few hundred source-frames apart (a small scroll)
  await setPos(0.3);
  await page.waitForTimeout(150);
  const a = heightProfile(PNG.sync.read(await lane.screenshot()));
  await setPos(0.3 + 4000 / tsamples);
  await page.waitForTimeout(150);
  const b = heightProfile(PNG.sync.read(await lane.screenshot()));

  // The SET of bar heights must be the same (content slid, heights frozen). Compare
  // sorted profiles — a true height morph shows up as a large sorted-difference.
  const sa = [...a].sort((p, q) => p - q);
  const sb = [...b].sort((p, q) => p - q);
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff += Math.abs(sa[i]! - sb[i]!);
  const avgDiff = diff / sa.length;
  expect(avgDiff, `sorted height-profile diff (>2 = morph): ${avgDiff.toFixed(2)}`).toBeLessThan(2);
});
