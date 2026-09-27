// node capture.mjs shots t1 t2 ...   -> shots/t_<t>.png
// node capture.mjs frames [fps]      -> out/frames/%05d.jpg for the whole film
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const [mode, ...rest] = process.argv.slice(2);
const url = 'file://' + path.resolve('film.html') + '?capture';
let browser;
try { browser = await chromium.launch(); }
catch { browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }); }
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));
await page.goto(url);
await page.evaluate(() => window.fontsReady);
await page.waitForTimeout(600);
const end = await page.evaluate(() => window.FILM_END);
const stage = page.locator('#stage');
if (mode === 'shots') {
  const cues = await page.evaluate(() => Object.fromEntries(CUES.map(c => [c.id, c.t])));
  for (const spec of rest) {
    const [id, off] = spec.includes('+') ? spec.split('+') : [spec, '0'];
    const t = isNaN(+id) ? cues[id] + +off : +id;
    await page.evaluate(t => window.renderAt(t), t);
    await stage.screenshot({ path: `shots/${spec.replace(/[^\w.+-]/g, '_')}.png` });
  }
  console.log('end', end);
} else {
  const fps = +(rest[0] || 30), n = Math.min(+(process.env.TO || 1e9), Math.ceil(end * fps));
  const from = +(process.env.FROM || 0);
  if (!from) { fs.rmSync('out/frames', { recursive: true, force: true }); fs.mkdirSync('out/frames', { recursive: true }); }
  const t0 = Date.now();
  for (let i = from; i < n; i++) {
    await page.evaluate(t => window.renderAt(t), i / fps);
    await stage.screenshot({ path: `out/frames/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
    if (i % 300 === 0) console.log(`${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  console.log('done', n, 'frames');
}
await browser.close();
