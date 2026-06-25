import { test, expect } from '@playwright/test';

// Guards the RENDERER's frame budget, isolated from Electron's compositor. The
// renderer hits a steady 60fps in Chromium (verified); if a change regresses the
// render loop (extra rAF work, per-frame allocations, a slow draw), this catches
// it. NOTE: this measures our code, NOT the Electron/Wayland present path — those
// are separate problems (the ~30fps seen in the Electron app is the compositor).

test('renderer sustains ~60fps with both lanes drawing', async ({ page }) => {
  const perf: { fps: number; jank: number; frames: number }[] = [];
  page.on('console', (m) => {
    const t = m.text();
    const fps = t.match(/\[perf\] ([\d.]+) fps/);
    const jank = t.match(/jank\(>33ms\) (\d+) of (\d+)/);
    if (fps && jank) {
      perf.push({ fps: +fps[1]!, jank: +jank[1]!, frames: +jank[2]! });
    }
  });

  await page.goto('/browser.html?demo&gl');
  await page.waitForSelector('.wf-scroll');
  await page.waitForTimeout(10_000); // ~3 perf windows; first one warms up

  // drop the first (warm-up) window, judge the steady-state ones
  const steady = perf.slice(1);
  expect(steady.length, 'collected perf windows').toBeGreaterThanOrEqual(1);

  const avgFps = steady.reduce((a, w) => a + w.fps, 0) / steady.length;
  const totalJank = steady.reduce((a, w) => a + w.jank, 0);
  const totalFrames = steady.reduce((a, w) => a + w.frames, 0);

  // Headless Chromium caps at the display rate (60). Allow slack for CI noise but
  // catch a real regression (e.g. dropping to 30).
  expect(avgFps, `steady-state fps (windows: ${steady.map((w) => w.fps).join(',')})`).toBeGreaterThan(50);
  // jank should be rare in steady state
  expect(totalJank / totalFrames, 'jank fraction').toBeLessThan(0.1);
});
