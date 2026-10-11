// Long-run soak: node test/soak.mjs [minutes=20] [timescale=10000]
// Needs the server running (npm start) and playwright-core + a Chromium
// (npx playwright-core install chromium). Forces GC before each sample and
// checks that JS heap and GPU resources stay flat.
import { chromium } from 'playwright-core';

const minutes = Number(process.argv[2]) || 20;
const timescale = Number(process.argv[3]) || 10000;
const url = `http://localhost:${process.env.PORT || 8090}/?timescale=${timescale}&reset=1`;

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.click('#start-button');
const cdp = await page.context().newCDPSession(page);

const rows = [];
const sample = async (min) => {
  await cdp.send('HeapProfiler.collectGarbage');
  const r = await page.evaluate(() => {
    const f = window.__formsDecay;
    return {
      heapMB: performance.memory.usedJSHeapSize / 1048576,
      damage: f.damage,
      days: f.clock.elapsedDays(),
      mutations: f.rules.applied,
      fps: f.fps,
      gpu: f.gpu,
      bits: f.audioStats && f.audioStats.bits,
      audio: Tone.getContext().state,
      dom: document.getElementsByTagName('*').length,
    };
  });
  rows.push({ min, ...r });
  console.log(
    `${String(min).padStart(4)} min | days ${r.days.toFixed(1).padStart(5)} | dmg ${r.damage.toFixed(3)} | mut ${String(r.mutations).padStart(3)}` +
    ` | heap ${r.heapMB.toFixed(2)} MB | geo ${r.gpu.geometries} tex ${r.gpu.textures} prog ${r.gpu.programs}` +
    ` | dom ${r.dom} | ${r.audio} | bits ${r.bits && r.bits.toFixed(1)} | fps ${r.fps.toFixed(0)}`,
  );
};

await page.waitForTimeout(15000);
await sample(0);
for (let m = 1; m <= minutes; m++) {
  await page.waitForTimeout(60000);
  await sample(m);
}

const warm = rows.slice(2);
const heaps = warm.map((r) => r.heapMB);
const geos = warm.map((r) => r.gpu.geometries);
const half = Math.floor(heaps.length / 2);
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const drift = avg(heaps.slice(half)) - avg(heaps.slice(0, half));
console.log(`\nheap: min ${Math.min(...heaps).toFixed(2)} max ${Math.max(...heaps).toFixed(2)} MB, 2nd-half minus 1st-half avg ${drift.toFixed(2)} MB`);
console.log(`geometries: min ${Math.min(...geos)} max ${Math.max(...geos)}; textures max ${Math.max(...warm.map((r) => r.gpu.textures))}`);
console.log(`page errors: ${errors.length}${errors.length ? '\n' + errors.slice(0, 5).join('\n') : ''}`);
const ok = drift < 1.5 && Math.max(...geos) < 30 && errors.length === 0;
console.log(ok ? 'SOAK PASS' : 'SOAK FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
