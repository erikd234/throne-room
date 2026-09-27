// Real end-to-end test: real Claude and Codex workers (spends tokens), local repos
// with a bare origin (the fake GitHub), every core flow. Run: npm run test:real
// Pick agents with AGENTS=claude,codex (default both).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import WebSocket from 'ws';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'throne-real-')));
const PORT = 4800 + Math.floor(Math.random() * 90);
const HOME = path.join(TMP, 'home');
const AGENTS = (process.env.AGENTS || 'claude,codex').split(',');
const STEP = 12 * 60 * 1000;
const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const G = ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local'];

function makeRepo(name) {
  const bare = path.join(TMP, `${name}.git`), src = path.join(TMP, name);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['clone', '-q', bare, src], { stdio: 'ignore' });
  fs.writeFileSync(path.join(src, 'calc.js'), 'export const add = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(src, 'package.json'), '{"type":"module","scripts":{"test":"node --test"}}\n');
  const sk = path.join(src, '.claude', 'skills', 'secret-word');
  fs.mkdirSync(sk, { recursive: true });
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: secret-word\ndescription: Replies with the studio secret word. Use when the boss asks for the secret word.\n---\n\nWhen this skill is used, reply with exactly this text and nothing else: THRONE-SKILL-OK\n');
  sh(src, 'add', '-A'); sh(src, ...G, 'commit', '-qm', 'init'); sh(src, 'push', '-q', 'origin', 'HEAD:main');
  sh(src, 'remote', 'set-head', 'origin', 'main');
  return src;
}
function png(w, h, [r, g, b]) {
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, THRONE_HOME: HOME, PORT: String(PORT), THRONE_POLL_MS: '2000' }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', d => fs.appendFileSync(path.join(TMP, 'server.err'), d));
await new Promise(res => server.stdout.on('data', d => { if (/Throne Room:/.test(d)) res(); }));
let S = null; const events = [];
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: `http://localhost:${PORT}` } });
ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') S = m.state; else events.push(m); });
await new Promise(r => ws.on('open', r));
const send = m => ws.send(JSON.stringify(m));
const W = n => S?.workers.find(w => w.name === n);
async function until(what, fn, ms = STEP) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 250)); }
  throw new Error(`Timed out: ${what}`);
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const upload = async (name, bytes) => (await fetch(`http://127.0.0.1:${PORT}/upload`, { method: 'POST', headers: { 'x-filename': name, origin: `http://localhost:${PORT}` }, body: bytes })).json();
console.log(`Real e2e: agents=${AGENTS.join(',')} port=${PORT} dir=${TMP}`);

const results = [];
async function scenario(agent) {
  const name = agent === 'claude' ? 'Ada' : 'Linus', repo = makeRepo(`calc-${agent}`);
  const log = (...a) => console.log(`[${agent}]`, ...a);
  const idle = () => !['working', 'setup'].includes(W(name)?.phase);
  const chatLen = () => (W(name).chat || []).length;
  async function ask(text, attachments, match, ms = STEP) {
    const n = chatLen();
    send({ type: 'chat', id: W(name).id, text, attachments });
    await until(`${name} to start on "${text.slice(0, 40)}"`, () => W(name).phase === 'working' || chatLen() > n + 1, 60000).catch(() => {});
    await until(`${name} to answer "${text.slice(0, 40)}"`, () => idle() && W(name).chat.slice(n).some(m => m.role === 'agent'), ms);
    const replies = W(name).chat.slice(n).filter(m => m.role === 'agent');
    const all = replies.map(m => m.text).join('\n');
    if (match) assert(match.test(all), `reply did not match ${match}: ${all.slice(0, 400)}`);
    return { all, replies };
  }
  async function check(label, fn) {
    const t = Date.now();
    try { await fn(); results.push([true, agent, label]); log(`✓ ${label} (${((Date.now() - t) / 1000).toFixed(0)}s)`); }
    catch (e) { results.push([false, agent, label, e.message]); log(`✗ ${label}: ${e.message.slice(0, 500)}`); }
  }

  await check('hire → asks the boss → answer → tests, preview, and proof', async () => {
    send({ type: 'hire', name, role: 'engineer', agent, repo, task: 'Add a multiply(a, b) export to calc.js and a node:test test file covering add and multiply. Before writing any code, use your ask_boss tool to ask whether the test file should be named calc.test.js or test/calc.test.js, offering exactly those two options. After the tests pass, start a preview with your start_preview tool using the command `python3 -m http.server $PORT` and the label "Calc files". Then run npm test and present the real output as proof.' });
    const w = await until('question', () => W(name)?.phase === 'asking' && W(name));
    assert(w.question.options.length === 2, 'options ' + JSON.stringify(w.question));
    log('question:', w.question.q);
    if (agent === 'claude') send({ type: 'answer', id: w.id, text: w.question.options[0] });
    else send({ type: 'chat', id: w.id, text: w.question.options[0] });
    const d = await until('done', () => ['done', 'error'].includes(W(name).phase) && W(name));
    assert(d.phase === 'done', 'ended in ' + d.phase + ': ' + d.log.slice(-3).map(l => l.text).join(' | '));
    const test = d.review.proof.find(p => p.kind === 'test' || p.kind === 'log');
    assert(d.review.presented && test && /pass|ok/i.test(test.output || ''), 'no real test proof: ' + JSON.stringify(d.review.proof).slice(0, 300));
    assert(d.review.files >= 2, 'expected >= 2 files changed, got ' + d.review.files);
    const pv = d.previews?.[0];
    assert(pv && pv.ok && (await fetch(pv.url)).status === 200, 'preview not serving: ' + JSON.stringify(d.previews));
    await until('preview in services catalog', () => (S.services || []).some(s => s.workerId === d.id && s.owner === 'preview'), 20000);
    let heads = ''; try { heads = sh(repo, 'ls-remote', '--heads', 'origin'); } catch {}
    assert(!heads.includes('throne/'), 'worker pushed on its own: ' + heads);
    log(`cost so far $${d.costUsd.toFixed(2)}`);
  });

  await check('chat: attached image reaches the agent', async () => {
    const img = await upload('swatch.png', png(64, 64, [230, 20, 20]));
    await ask('What single color fills the attached image? Reply with just the color name.', [img], /red/i);
  });

  await check('chat: /skill invokes a repo skill', async () => {
    const w = W(name);
    assert((w.commands || []).includes('secret-word'), 'secret-word not in commands: ' + (w.commands || []).slice(0, 30).join(','));
    await ask('/secret-word', [], /THRONE-SKILL-OK/);
  });

  await check('safety: the agent itself cannot push', async () => {
    const { all } = await ask('Run exactly this shell command and tell me the error it prints: git push origin HEAD', []);
    assert(/disabled|throne|not allowed|denied|blocked|permission/i.test(all), 'agent did not report a block: ' + all.slice(0, 300));
    let heads = ''; try { heads = sh(repo, 'ls-remote', '--heads', 'origin'); } catch {}
    assert(!heads.includes('throne/'), 'push reached origin: ' + heads);
  });

  await check('show_boss: agent shows an image in the chat', async () => {
    const n = chatLen();
    await ask('Use python3 (stdlib only: zlib and struct) to write a small solid blue PNG to .throne-proof/blue.png in your worktree, then show it to me with your show_boss tool.', []);
    const shown = W(name).chat.slice(n).find(m => m.role === 'agent' && m.media?.length);
    assert(shown && shown.media[0].kind === 'image', 'no image shown');
    assert((await fetch(`http://127.0.0.1:${PORT}${shown.media[0].src}`)).status === 200, 'shown image not served');
  });

  await check('services: a server the agent starts itself is cataloged and stoppable', async () => {
    const port = 4950 + (agent === 'claude' ? 1 : 2) + Math.floor(Math.random() * 40);
    await ask(`Start \`python3 -m http.server ${port}\` from your worktree as a detached background process that keeps running after your command returns (for example: nohup python3 -m http.server ${port} > /tmp/throne-svc-${port}.log 2>&1 &). Then tell me the URL.`, []);
    const svc = await until('agent service in catalog', () => (S.services || []).find(s => s.workerId === W(name).id && s.ports.includes(port)), 30000);
    assert(svc.owner === 'agent', 'owner ' + svc.owner);
    send({ type: 'killService', pid: svc.pid });
    await until('service stopped', () => !(S.services || []).some(s => s.pid === svc.pid), 20000);
  });

  await check('brain: a taught rule changes the next reply', async () => {
    send({ type: 'teach', text: `${name}-check: end every chat reply with the word PINEAPPLE.` });
    await until('rule stored', () => S.rules.some(r => r.text.startsWith(`${name}-check`)), 5000);
    await ask('Say hello in one short sentence.', [], /PINEAPPLE/);
  });

  await check('ship → PR → green → merge lands on origin/main', async () => {
    send({ type: 'markDone', id: W(name).id });
    await until('idle', () => W(name).phase === 'idle', 20000).catch(() => {});
    // markDone skipped the PR; do a small task that we then ship
    send({ type: 'assign', id: W(name).id, task: 'Add a subtract(a, b) export to calc.js with a node:test test. Run npm test and present the real output as proof. Commit your work.' });
    const d = await until('done', () => ['done', 'error'].includes(W(name).phase) && W(name).task.startsWith('Add a subtract') && W(name));
    assert(d.phase === 'done', 'ended in ' + d.phase);
    send({ type: 'ship', id: d.id });
    await until('pr green', () => W(name).phase === 'pr_ready', 120000);
    send({ type: 'merge', id: d.id });
    await until('merged', () => W(name).phase === 'idle', 60000);
    sh(repo, 'fetch', '-q');
    const src = execFileSync('git', ['-C', repo, 'show', 'origin/main:calc.js'], { encoding: 'utf8' });
    assert(/subtract/.test(src), 'subtract not on origin/main');
  });

  log(`total cost $${(W(name)?.costUsd || 0).toFixed(2)}, turns ${W(name)?.turns || 0}`);
}

await Promise.all(AGENTS.map(a => scenario(a)));
for (const w of S.workers) send({ type: 'letGo', id: w.id });
await new Promise(r => setTimeout(r, 1500));
server.kill('SIGTERM');
const failed = results.filter(r => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
for (const f of failed) console.log(`  ✗ [${f[1]}] ${f[2]}: ${f[3].slice(0, 300)}`);
console.log(`Artifacts kept in ${TMP}`);
process.exit(failed.length ? 1 : 0);
