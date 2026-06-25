import { test } from '@playwright/test';
import { writeFileSync } from 'fs';
test('diag', async ({ page }) => {
  await page.goto('/browser.html?demo&gl');
  await page.waitForFunction(()=>!!(globalThis as any).__dj,{timeout:10000});
  const r = await page.evaluate(async()=>{
    const dj=(globalThis as any).__dj; const api=(globalThis as any).dj;
    await dj.engine.start(); const ctx=dj.engine.audioContext; if(ctx.state!=='running')await ctx.resume();
    const file=await api.readTrackById(1); const decoded=await ctx.decodeAudioData(file.data.slice(0));
    dj.engine.loadTrack(0,decoded);
    await new Promise(r=>setTimeout(r,200));
    const snap=(k)=>dj.bus.get('[Channel1]',k);
    const before={trackSamples:snap('track_samples'),trackLoaded:snap('track_loaded'),rate:snap('rate'),rateRange:snap('rate_range'),rateDir:snap('rate_direction'),rateRatio:snap('rate_ratio'),pos:snap('playposition')};
    dj.bus.set('[Channel1]','play',1);
    await new Promise(r=>setTimeout(r,800));
    const after={rateRatio:snap('rate_ratio'),pos:snap('playposition'),play:snap('play')};
    return {before,after,ctxState:ctx.state,dur:decoded.duration};
  });
  writeFileSync('/tmp/diag.json',JSON.stringify(r,null,2));
});
