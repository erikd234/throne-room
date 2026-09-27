// Dev helper: capture 1920x1080 frames of the live room after an action, for tuning visuals.
// Usage: node test/frames.mjs <name> "<js to run in page>" t1,t2,... [?as=bill]
import { createRequire } from 'node:module';
const require = createRequire((process.env.THRONE_PLAYWRIGHT_DIR || (process.env.HOME + '/dev/throne-room/video')) + '/package.json');
const { chromium } = require('playwright');
const [name = 'f', js = '', times = '1', q = ''] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto((process.env.THRONE_URL || 'http://localhost:4777') + '/' + q); await p.waitForSelector('#conn:text("Connected")'); await p.waitForTimeout(1200);
if (js) await p.evaluate(js);
let last = 0;
for (const t of times.split(',').map(Number)) { await p.waitForTimeout((t - last) * 1000); last = t; const f = `${process.env.THRONE_FRAMES || '/tmp/throne-frames'}/${name}-${t}.png`; await p.screenshot({ path: f }); console.log(f); }
await b.close();
