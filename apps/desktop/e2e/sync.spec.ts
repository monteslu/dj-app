import { test, expect } from '@playwright/test';

// Drives the REAL audio engine + SyncController (the browser dev server now serves
// the AudioWorklet). Loads two same-BPM tracks off-phase, enables SYNC on the
// follower, and asserts the snap actually fired: the follower's beat phase matches
// the leader's. This is the runtime path the user exercises with the SYNC button.

test('SYNC snaps the follower onto the leader beat grid', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/browser.html?demo&gl');
  await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__dj, { timeout: 10_000 });

  const result = await page.evaluate(async () => {
    const dj = (globalThis as Record<string, unknown>).__dj as {
      engine: { start: () => Promise<void> };
      bus: { set: (g: string, k: string, v: number) => void; get: (g: string, k: string) => number };
    };
    await dj.engine.start();

    const SR = 48000;
    const bpm = 124;
    const total = SR * 200;
    const fpb = (60 / bpm) * SR;
    dj.bus.set('[Master]', 'samplerate', SR);
    for (const g of ['[Channel1]', '[Channel2]']) {
      dj.bus.set(g, 'file_bpm', bpm);
      dj.bus.set(g, 'track_samples', total);
      dj.bus.set(g, 'beat_first_frame', 0);
    }
    // leader on a beat; follower 0.4 beat off
    dj.bus.set('[Channel1]', 'playposition', (fpb * 10) / total);
    dj.bus.set('[Channel2]', 'playposition', (fpb * 10 + fpb * 0.4) / total);
    dj.bus.set('[Channel1]', 'play', 1);

    const phase = (g: string) => {
      const beats = (dj.bus.get(g, 'playposition') * total) / fpb;
      return beats - Math.floor(beats);
    };
    const beforeRaw = Math.abs(phase('[Channel1]') - phase('[Channel2]'));
    const before = Math.min(beforeRaw, 1 - beforeRaw);

    dj.bus.set('[Channel2]', 'sync_enabled', 1); // → snap
    await new Promise((r) => setTimeout(r, 150));

    const afterRaw = Math.abs(phase('[Channel1]') - phase('[Channel2]'));
    const after = Math.min(afterRaw, 1 - afterRaw);
    return { before, after };
  });

  expect(result.before, 'follower started off-phase').toBeGreaterThan(0.2);
  expect(result.after, `phase error after SYNC: ${result.after}`).toBeLessThan(0.02);
});
