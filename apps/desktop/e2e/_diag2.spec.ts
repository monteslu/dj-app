import { test } from '@playwright/test';
import { writeFileSync } from 'fs';
test('diag2', async ({ page }) => {
  const logs:string[]=[];
  page.on('console',m=>logs.push(m.type()+': '+m.text().slice(0,160)));
  page.on('pageerror',e=>logs.push('PAGEERR: '+e.message.slice(0,160)));
  await page.goto('/browser.html?demo&gl');
  await page.waitForFunction(()=>!!(globalThis as any).__dj,{timeout:10000});
  const r = await page.evaluate(async()=>{
    const dj=(globalThis as any).__dj; const api=(window as any).dj;
    await dj.engine.start(); const ctx=dj.engine.audioContext; if(ctx.state!=='running')await ctx.resume();
    const file=await api.readTrackById(1);
    const decoded=await ctx.decodeAudioData(file.data.slice(0));
    dj.engine.loadTrack(0,decoded);
    await new Promise(r=>setTimeout(r,300));
    const g=(k)=>dj.bus.get('[Channel1]',k);
    return {ts:g('track_samples'),tl:g('track_loaded'),rr:g('rate_range'),rd:g('rate_direction'),ratio:g('rate_ratio'),pos:g('playposition'),dur:decoded.duration};
  }).catch(e=>({err:String(e)}));
  writeFileSync('/tmp/diag2.json',JSON.stringify({r,logs:logs.slice(0,15)},null,2));
});
