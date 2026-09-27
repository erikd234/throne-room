// Records real footage of the running Throne (QM + GBrain) for the demo film.
// Usage: node test/record-real.mjs [proof|brain|join|hire|all]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(new URL('../video/package.json', import.meta.url));
const { chromium } = require('playwright');
const OUT = new URL('../video/real/', import.meta.url).pathname;
const URL_ = 'http://localhost:4777';
const which = process.argv[2] || 'all';
fs.mkdirSync(OUT, { recursive: true });

async function clip(name, fn) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } } });
  const page = await ctx.newPage();
  await page.goto(URL_);
  await page.waitForSelector('#conn:text("Connected")');
  await page.waitForTimeout(800);
  const t0 = Date.now();
  try { await fn(page, browser); } finally {
    const vid = page.video();
    await ctx.close(); await browser.close();
    const webm = await vid.path();
    const mp4 = path.join(OUT, `${name}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.6', '-i', webm, '-vf', 'fps=30,scale=1920:1080', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', mp4]);
    fs.rmSync(webm);
    console.log(`${name}.mp4 (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}
const pause = (p, ms) => p.waitForTimeout(ms);

if (which === 'all' || which === 'join') await clip('real_multiplayer', async (page, browser) => {
  await pause(page, 1500);
  const bill = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const bp = await bill.newPage(); await bp.goto(URL_ + '/?as=bill');
  await pause(page, 5000);
  await page.click('.line li[data-act="peek"]').catch(() => {});
  await bp.click('.line li[data-act="peek"]').catch(() => {});
  await pause(page, 3000);
  await bill.close();
});

if (which === 'all' || which === 'proof') await clip('real_proof', async page => {
  await page.click('.line li[data-act="peek"]');
  await pause(page, 3500);
  await page.click('#transcript button[data-act="open"]');
  await pause(page, 5000);
  const accept = page.locator('#modal button[data-act="markDone"], #modal button[data-act="ship"]').first();
  await accept.hover(); await pause(page, 800); await accept.click();
  await pause(page, 2500);
});

if (which === 'all' || which === 'brain') await clip('real_brain', async page => {
  await page.keyboard.press('b');
  await pause(page, 1200);
  await page.fill('#brain-in', 'Every customer reply links to help.parrot.app');
  await pause(page, 600);
  await page.click('button[data-act="teach"]');
  await pause(page, 1800);
  await page.click('button[data-act="later"]');
  await pause(page, 3500);
});

if (which === 'all' || which === 'hire') await clip('real_hire', async page => {
  await page.keyboard.press('h');
  await pause(page, 800);
  await page.click('label:has(#role-support)');
  await page.click('label:has(#agent-qm)');
  await page.fill('#task', 'A learner asks if they can switch from Spanish to Japanese without losing their streak. Check the rules in the brain and draft the reply.');
  await pause(page, 1000);
  const before = await page.evaluate(() => Math.max(0, ...window.__throne.state().workers.map(w => w.id)));
  await page.click('button[data-act="dohire"]');
  const id = await page.waitForFunction(b => { const ws = window.__throne.state().workers.filter(w => w.id > b); return ws.length && ws[0].id; }, before).then(h => h.jsonValue());
  await pause(page, 6000);
  await page.evaluate(i => window.__throne.openChat(i), id);
  await page.waitForFunction(() => /Waiting to present|Free for a new task/.test(document.querySelector('#dhead')?.textContent || ''), null, { timeout: 120000 }).catch(() => {});
  await pause(page, 4000);
});
