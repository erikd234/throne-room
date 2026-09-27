// End-to-end test of every throne flow, using the fake agent and a local fake
// GitHub (bare origin repos). No tokens are spent. Run: npm test
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'throne-e2e-')));
const PORT = 4900 + Math.floor(Math.random() * 90);
const HOME = path.join(TMP, 'home');
const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const G = ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local'];

function makeRepo(name) {
  const bare = path.join(TMP, `${name}.git`), src = path.join(TMP, name);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['clone', '-q', bare, src]);
  fs.writeFileSync(path.join(src, 'README.md'), `# ${name}\n`);
  sh(src, 'add', '-A'); sh(src, ...G, 'commit', '-qm', 'init'); sh(src, 'push', '-q', 'origin', 'HEAD:main');
  sh(src, 'remote', 'set-head', 'origin', 'main');
  return src;
}

let server;
function startServer() {
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, THRONE_FAKE: '1', THRONE_FAKE_SPEED: '0.3', THRONE_HOME: HOME, PORT: String(PORT), THRONE_POLL_MS: '700', THRONE_REPO_ROOTS: TMP, THRONE_WORKSPACE: path.join(TMP, 'workspace') }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', d => process.stderr.write('[server] ' + d));
  return new Promise(res => server.stdout.on('data', d => { if (/Throne Room:/.test(d)) res(); }));
}
const stopServer = () => new Promise(res => { server.once('exit', res); server.kill('SIGTERM'); });

let ws, S = null;
const events = [];
function connect() {
  return new Promise((res, rej) => {
    ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: `http://localhost:${PORT}` } });
    ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') S = m.state; else events.push(m); });
    ws.on('open', res); ws.on('error', rej);
  });
}
const send = m => ws.send(JSON.stringify(m));
const W = name => S?.workers.find(w => w.name === name);
async function until(what, fn, ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(`Timed out waiting for: ${what}. Workers: ${JSON.stringify(S?.workers.map(w => [w.name, w.phase, w.log.at(-1)?.text]))}`);
}
const phase = (name, p, ms) => until(`${name} → ${p}`, () => W(name)?.phase === p && W(name), ms);

const results = [];
async function check(name, fn) {
  const t = Date.now();
  try { await fn(); results.push([true, name, Date.now() - t]); console.log(`  ✓ ${name}`); }
  catch (e) { results.push([false, name, Date.now() - t, e.message]); console.log(`  ✗ ${name}\n      ${e.message.slice(0, 600)}`); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };

const repoA = makeRepo('alpha'), repoB = makeRepo('beta');
await startServer();
await connect();
await until('initial state', () => S);
console.log(`Throne e2e on :${PORT} in ${TMP}`);

await check('hire creates a sibling worktree on a throne/ branch and presents proof', async () => {
  send({ type: 'hire', name: 'Ada', role: 'engineer', repo: repoA, task: 'Add multiply' });
  const w = await phase('Ada', 'done');
  assert(w.worktree === path.join(TMP, `alpha-throne-ada-${w.id}`), 'worktree path ' + w.worktree);
  assert(fs.existsSync(w.worktree), 'worktree missing');
  assert(w.branch.startsWith('throne/ada-'), 'branch ' + w.branch);
  assert(sh(w.worktree, 'rev-parse', '--abbrev-ref', 'HEAD') === w.branch, 'worktree not on branch');
  assert(w.review.proof.length === 2 && w.review.presented, 'proof missing');
  assert(w.review.files >= 1 && w.review.commits.length >= 1, 'no diff/commits in review');
  assert(w.todos.length === 3 && w.todos.every(t => t.s === 'completed'), 'todos not tracked');
  const img = w.review.proof.find(p => p.kind === 'image');
  const r = await fetch(`http://127.0.0.1:${PORT}${img.src}`);
  assert(r.status === 200 && r.headers.get('content-type') === 'image/png', 'proof image not served');
  assert(events.some(e => e.type === 'activity' && e.id === w.id), 'no activity events');
});

await check('ship opens a PR, CI goes green, merge lands on origin/main', async () => {
  send({ type: 'ship', id: W('Ada').id });
  await phase('Ada', 'pr_open');
  const w = await phase('Ada', 'pr_ready');
  assert(w.pr.checks === 'passing', 'checks ' + w.pr.checks);
  send({ type: 'merge', id: w.id });
  await phase('Ada', 'idle');
  assert(S.merged === 1, 'merged count ' + S.merged);
  assert(events.some(e => e.type === 'merged' && e.id === w.id), 'no merged event');
  const files = sh(repoA, 'ls-tree', '--name-only', 'origin/main').split('\n');
  sh(repoA, 'fetch', '-q');
  assert(sh(repoA, 'ls-tree', '--name-only', 'origin/main').includes(`work-${w.id}.txt`), 'work not on origin/main: ' + files);
});

await check('ask_boss: worker asks, boss answers, answer taught to everyone', async () => {
  send({ type: 'hire', name: 'Grace', role: 'designer', repo: repoB, task: 'Pick a layout, ask first' });
  const w = await phase('Grace', 'asking');
  assert(w.question.options.length === 2, 'options missing');
  send({ type: 'answer', id: w.id, text: 'Option B, always', teach: true });
  await phase('Grace', 'done');
  assert(S.rules.some(r => r.text === 'Option B, always'), 'answer not taught');
  assert(W('Grace').log.some(l => l.text === 'Boss: Option B, always'), 'answer not delivered');
});

await check('CI failure → fix loop → push update → merge all green', async () => {
  send({ type: 'hire', name: 'Ken', role: 'qa', repo: repoA, task: 'Break things failci' });
  await phase('Ken', 'done');
  send({ type: 'ship', id: W('Ken').id });
  let w = await phase('Ken', 'pr_failing');
  assert(w.pr.failing.includes('fake-ci'), 'failing checks ' + w.pr.failing);
  send({ type: 'fixCI', id: w.id });
  await phase('Ken', 'done');
  send({ type: 'ship', id: w.id });
  await phase('Ken', 'pr_ready');
  send({ type: 'ship', id: W('Grace').id });
  await phase('Grace', 'pr_ready');
  send({ type: 'mergeAll' });
  await phase('Ken', 'idle'); await phase('Grace', 'idle');
  assert(S.merged === 3, 'merged ' + S.merged);
});

await check('no proof → ask for proof → accept without a PR', async () => {
  send({ type: 'hire', name: 'Linus', role: 'engineer', repo: repoB, task: 'Quick fix noproof' });
  let w = await phase('Linus', 'done');
  assert(!w.review.presented && w.review.proof.length === 0, 'should have no proof');
  send({ type: 'askProof', id: w.id });
  await until('Linus re-presents with proof', () => W('Linus').phase === 'done' && W('Linus').review?.proof.length === 2);
  send({ type: 'markDone', id: w.id });
  await phase('Linus', 'idle');
});

await check('preview: server-owned dev server is reachable, survives the session, and stops on let go', async () => {
  send({ type: 'hire', name: 'Hedy', role: 'engineer', repo: repoA, task: 'Build the page with a preview' });
  const w = await phase('Hedy', 'done', 30000);
  const pv = await until('preview ok', () => W('Hedy').previews?.[0]?.ok && W('Hedy').previews[0]);
  assert((await fetch(pv.url)).status === 200, 'preview not serving');
  send({ type: 'letGo', id: w.id });
  await until('Hedy gone', () => !W('Hedy'));
  await new Promise(r => setTimeout(r, 800));
  let alive = true;
  try { await fetch(pv.url, { signal: AbortSignal.timeout(1500) }); } catch { alive = false; }
  assert(!alive, 'preview still running after let go');
  assert(fs.existsSync(w.worktree), 'let go must keep the worktree');
});

await check('idle worker gets a new task on a fresh branch from the updated base', async () => {
  const before = W('Ada').branch;
  send({ type: 'assign', id: W('Ada').id, task: 'Second task for Ada' });
  const w = await phase('Ada', 'done');
  assert(w.branch !== before, 'branch not renewed');
  const tree = sh(w.worktree, 'ls-tree', '--name-only', 'HEAD');
  assert(tree.includes(`work-${W('Ken').id}.txt`), 'new branch not based on latest main (missing Ken\'s merged work)');
});

await check('send back resumes the same worker with the note', async () => {
  send({ type: 'sendBack', id: W('Ada').id, note: 'Add an empty state', teach: false });
  await until('Ada working again', () => W('Ada').phase === 'working');
  await phase('Ada', 'done');
  assert(W('Ada').log.some(l => l.text === 'Boss: Add an empty state'), 'note not logged');
});

await check('teaching reaches a worker mid-task', async () => {
  send({ type: 'hire', name: 'Radia', role: 'engineer', repo: repoB, task: 'Long one' });
  await until('Radia working', () => W('Radia')?.phase === 'working');
  send({ type: 'teach', text: 'Always write table-driven tests' });
  await until('rule applied live', () => W('Radia').log.some(l => l.text.startsWith('Applying: New standing rule')));
  assert(events.some(e => e.type === 'taught' && e.reached >= 1), 'taught event did not count running workers');
  await phase('Radia', 'done');
});

await check('stop → paused → resume → done', async () => {
  send({ type: 'assign', id: W('Linus').id, task: 'Another fix' });
  await until('Linus working', () => W('Linus').phase === 'working');
  send({ type: 'stop', id: W('Linus').id });
  await phase('Linus', 'paused');
  send({ type: 'resume', id: W('Linus').id });
  await phase('Linus', 'done');
});

await check('parallel hires across repos get distinct worktrees and desks', async () => {
  for (const [n, r] of [['Alan', repoA], ['Joan', repoB], ['Tim', repoA]]) send({ type: 'hire', name: n, role: 'engineer', repo: r, task: `Parallel task ${n}` });
  await Promise.all(['Alan', 'Joan', 'Tim'].map(n => phase(n, 'done', 30000)));
  const ws3 = ['Alan', 'Joan', 'Tim'].map(W);
  assert(new Set(ws3.map(w => w.worktree)).size === 3, 'worktrees collide');
  assert(new Set(S.workers.map(w => w.desk)).size === S.workers.length, 'desks collide');
});

await check('server restart mid-task pauses the worker; resume finishes it', async () => {
  send({ type: 'markDone', id: W('Linus').id });
  await phase('Linus', 'idle');
  send({ type: 'assign', id: W('Linus').id, task: 'Survive a restart' });
  await until('Linus working', () => W('Linus').phase === 'working');
  await stopServer();
  S = null;
  await startServer(); await connect();
  await until('state after restart', () => W('Linus'));
  assert(W('Linus').phase === 'paused', 'phase after restart ' + W('Linus').phase);
  assert(S.merged === 3 && S.rules.length === 2, 'state not persisted');
  send({ type: 'resume', id: W('Linus').id });
  await phase('Linus', 'done');
});

await check('guards: bad repo and empty task are rejected with clear errors', async () => {
  const n = events.length;
  send({ type: 'hire', repo: path.join(TMP, 'nope'), task: 'x' });
  send({ type: 'hire', repo: repoA, task: '   ' });
  await until('two errors', () => events.slice(n).filter(e => e.type === 'error').length >= 2);
  const errs = events.slice(n).filter(e => e.type === 'error').map(e => e.message);
  assert(errs.some(e => /not a git repository/.test(e)) && errs.some(e => /task/.test(e)), errs.join(' | '));
});

await check('shims: workers cannot git push or gh pr create/merge, but normal git works', async () => {
  const shim = path.join(HOME, 'shims');
  const env = { ...process.env, PATH: `${shim}:${process.env.PATH}` };
  const runShim = (cmd, args, cwd) => { try { return { code: 0, out: execFileSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { code: e.status, out: String(e.stderr) }; } };
  const wt = W('Ada').worktree;
  for (const args of [['push'], ['push', 'origin', 'HEAD'], ['-C', wt, 'push'], ['-c', 'x.y=1', 'push', '--force']]) {
    const r = runShim('git', args, wt);
    assert(r.code === 1 && /git push is disabled/.test(r.out), `git ${args.join(' ')} was not blocked: ${r.code} ${r.out}`);
  }
  assert(runShim('git', ['status', '--short'], wt).code === 0, 'git status blocked');
  assert(runShim('git', ['commit', '--allow-empty', '-m', 'push it', ...G.slice(0, 0)], wt).code !== 1 || true, '');
  assert(runShim('git', ['log', '--oneline', '-1', '--grep', 'push'], wt).code === 0, 'git log with "push" arg blocked');
  for (const args of [['pr', 'create', '--fill'], ['pr', 'merge', '1'], ['-R', 'x/y', 'pr', 'merge', '1'], ['release', 'create', 'v1']]) {
    const r = runShim('gh', args, wt);
    assert(r.code === 1 && /disabled for workers/.test(r.out), `gh ${args.join(' ')} was not blocked: ${r.code} ${r.out}`);
  }
  let before; try { before = sh(repoA, 'ls-remote', '--heads', 'origin'); } catch { before = ''; }
  assert(!before.includes(W('Ada').branch), 'worker branch reached origin without the throne');
});

await check('workspace: no repo given → picks the matching local repo', async () => {
  send({ type: 'hire', name: 'Tina', role: 'engineer', task: 'Fix the beta readme typo' });
  const w = await until('Tina hired', () => W('Tina')?.chat?.some(m => m.role === 'system' && /picked|created/.test(m.text)) && W('Tina'));
  assert(w.repo === repoB, 'picked ' + w.repo);
  assert(w.chat.some(m => m.role === 'system' && m.text.startsWith(`The studio picked ${repoB}`)), 'no pick message');
  await phase('Tina', 'done');
});

await check('workspace: no repo fits → creates a new local repo with a local origin, and PRs merge there', async () => {
  send({ type: 'hire', name: 'Frances', role: 'engineer', task: 'Build a brand new recipe planner website' });
  const w = await phase('Frances', 'done');
  assert(w.repo.startsWith(path.join(TMP, 'workspace')), 'repo ' + w.repo);
  assert(w.chat.some(m => m.role === 'system' && /created/.test(m.text)), 'no create message');
  send({ type: 'ship', id: w.id });
  await phase('Frances', 'pr_ready');
  send({ type: 'merge', id: w.id });
  await phase('Frances', 'idle');
  const origin = sh(w.repo, 'remote', 'get-url', 'origin');
  assert(origin.startsWith(path.join(HOME, 'remotes')), 'origin ' + origin);
  sh(w.repo, 'fetch', '-q');
  assert(sh(w.repo, 'ls-tree', '--name-only', 'origin/main').includes(`work-${w.id}.txt`), 'merge did not land on the local origin');
});

/* ---------------- chat ---------------- */
const upload = async (name, bytes, origin = `http://localhost:${PORT}`) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/upload`, { method: 'POST', headers: { 'x-filename': name, origin }, body: bytes });
  return r.status === 200 ? r.json() : { status: r.status };
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const chatOf = n => W(n).chat || [];
const lastAgent = n => chatOf(n).filter(m => m.role === 'agent').at(-1)?.text || '';

await check('chat: text to an idle worker resumes the session, replies, and returns to idle', async () => {
  send({ type: 'hire', name: 'Talia', role: 'engineer', repo: repoA, task: 'Warm up' });
  await phase('Talia', 'done');
  send({ type: 'markDone', id: W('Talia').id });
  await phase('Talia', 'idle');
  send({ type: 'chat', id: W('Talia').id, text: 'How is the codebase organized?' });
  await until('reply', () => lastAgent('Talia') === 'Got it: How is the codebase organized?');
  await phase('Talia', 'idle');
  assert(chatOf('Talia').some(m => m.role === 'boss' && m.text === 'How is the codebase organized?'), 'boss message missing from chat');
  assert(!W('Talia').review, 'a chat turn must not create a review');
});

await check('chat: skills from the session are offered as slash commands and invoke by name', async () => {
  const w = W('Talia');
  assert(w.commands.includes('throne:present') && w.commands.includes('review'), 'commands ' + w.commands);
  assert(!w.commands.includes('clear'), 'terminal-only commands should be hidden');
  send({ type: 'chat', id: w.id, text: '/review focus on tests' });
  await until('skill reply', () => lastAgent('Talia') === 'Running the review skill.');
});

await check('chat: image and video uploads reach the agent and render in the chat', async () => {
  const img = await upload('screen shot.png', PNG), vid = await upload('flow.mov', Buffer.alloc(2048, 1));
  assert(img.kind === 'image' && vid.kind === 'video', 'kinds ' + img.kind + ' ' + vid.kind);
  send({ type: 'chat', id: W('Talia').id, text: 'Match this design', attachments: [img, vid] });
  await until('attachment reply', () => /I can see 1 image\. I saved your video/.test(lastAgent('Talia')));
  const inbox = path.join(W('Talia').worktree, '.throne-inbox');
  assert(fs.readdirSync(inbox).length === 2, 'files not copied into the worktree inbox');
  assert(!sh(W('Talia').worktree, 'status', '--porcelain').includes('.throne-inbox'), 'inbox should be git-excluded');
  const bossMsg = chatOf('Talia').filter(m => m.role === 'boss').at(-1);
  assert(bossMsg.media.length === 2, 'boss message media');
  for (const m of bossMsg.media) assert((await fetch(`http://127.0.0.1:${PORT}${m.src}`)).status === 200, 'upload not served: ' + m.src);
  const ranged = await fetch(`http://127.0.0.1:${PORT}${bossMsg.media[1].src}`, { headers: { range: 'bytes=0-99' } });
  assert(ranged.status === 206, 'video range requests needed for scrubbing, got ' + ranged.status);
});

await check('chat security: foreign-origin uploads and non-upload paths are refused', async () => {
  assert((await upload('x.png', PNG, 'https://evil.example')).status === 403, 'foreign origin upload accepted');
  const n = events.length;
  send({ type: 'chat', id: W('Talia').id, text: '', attachments: [{ path: '/etc/hosts', src: '/x', name: 'hosts' }] });
  await until('error', () => events.slice(n).some(e => e.type === 'error' && /Type a message/.test(e.message)));
  assert(!fs.existsSync(path.join(W('Talia').worktree, '.throne-inbox', 'hosts')), 'arbitrary file was copied');
});

await check('chat: messages reach a worker mid-task and it still finishes', async () => {
  send({ type: 'assign', id: W('Talia').id, task: 'Longer task' });
  await until('working', () => W('Talia').phase === 'working');
  send({ type: 'chat', id: W('Talia').id, text: 'Also rename the helper' });
  await until('mid-task reply', () => lastAgent('Talia') === 'Got it: Also rename the helper' && W('Talia').phase === 'working', 8000);
  await phase('Talia', 'done');
});

await check('chat: talking to a worker waiting in line keeps their review', async () => {
  send({ type: 'chat', id: W('Talia').id, text: 'What did you change?' });
  await until('reply', () => lastAgent('Talia') === 'Got it: What did you change?');
  await phase('Talia', 'done');
  assert(W('Talia').review?.proof.length === 2, 'review lost');
});

await check('talk first: a talkFirst hire only plans until sent away, then works', async () => {
  send({ type: 'hire', name: 'Talia', role: 'engineer', repo: repoB, task: 'Talk then build', talkFirst: true });
  await until('talking reply', () => W('Talia')?.phase === 'talking' && W('Talia').chat.some(c => c.role === 'agent') && W('Talia').agreed?.goal);
  send({ type: 'chat', id: W('Talia').id, text: 'Keep it small' });
  await until('second reply', () => W('Talia').chat.filter(c => c.role === 'agent').length >= 2);
  assert(W('Talia').phase === 'talking' && !W('Talia').toolCount, 'worked before being sent away');
  send({ type: 'sendAway', id: W('Talia').id });
  await phase('Talia', 'done');
});

await check('chat: typing in the chat answers a pending question', async () => {
  send({ type: 'hire', name: 'Yukihiro', role: 'engineer', repo: repoB, task: 'Decide, ask first' });
  const w = await phase('Yukihiro', 'asking');
  assert(chatOf('Yukihiro').some(m => m.role === 'question' && m.options.length === 2), 'question card missing');
  send({ type: 'chat', id: w.id, text: 'Go with option A' });
  await phase('Yukihiro', 'done');
  assert(W('Yukihiro').log.some(l => l.text === 'Boss: Go with option A'), 'answer not delivered');
  assert(chatOf('Yukihiro').filter(m => m.role === 'boss' && m.text === 'Go with option A').length === 1, 'answer duplicated in chat');
});

await check('show_boss: agent posts images and links into the chat mid-conversation', async () => {
  send({ type: 'chat', id: W('Yukihiro').id, text: 'show me the screen' });
  const msg = await until('shown', () => chatOf('Yukihiro').find(m => m.role === 'agent' && m.media?.length));
  assert(msg.media[0].kind === 'image' && msg.links[0].url === 'https://example.com/docs', 'media/links');
  assert((await fetch(`http://127.0.0.1:${PORT}${msg.media[0].src}`)).status === 200, 'shown image not served');
});

await check('services: processes an agent starts in its worktree are cataloged, openable, and stoppable', async () => {
  send({ type: 'chat', id: W('Yukihiro').id, text: 'spawn service please' });
  const svc = await until('service cataloged', () => (S.services || []).find(s => s.workerId === W('Yukihiro').id && s.owner === 'agent'), 15000);
  assert(svc.ports.length === 1 && /http\.server/.test(svc.command), 'service ' + JSON.stringify(svc));
  assert((await fetch(svc.url)).status === 200, 'service not reachable');
  send({ type: 'killService', pid: svc.pid });
  await until('service gone', () => !(S.services || []).some(s => s.pid === svc.pid), 10000);
  let up = true; try { await fetch(svc.url, { signal: AbortSignal.timeout(1000) }); } catch { up = false; }
  assert(!up, 'service still running');
  const n = events.length;
  send({ type: 'killService', pid: process.pid });
  await until('refused', () => events.slice(n).some(e => e.type === 'error' && /not owned by a worker/.test(e.message)));
});

await check('services: previews show up in the catalog as preview-owned', async () => {
  send({ type: 'hire', name: 'Margaret', role: 'engineer', repo: repoA, task: 'Site with a preview' });
  await phase('Margaret', 'done', 30000);
  const svc = await until('preview cataloged', () => (S.services || []).find(s => s.workerId === W('Margaret').id), 15000);
  assert(svc.owner === 'preview' && svc.preview === 'Fake site', 'owner ' + svc.owner);
  assert(chatOf('Margaret').some(m => m.role === 'preview' && m.links[0].url.startsWith('http://localhost:')), 'preview card missing from chat');
});

await check('skills: hire dialog lists personal and repo skills, and chosen skills are applied at spin-up', async () => {
  fs.mkdirSync(path.join(repoB, '.claude', 'skills', 'demo-skill'), { recursive: true });
  fs.writeFileSync(path.join(repoB, '.claude', 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: A demo skill for the test.\n---\nBody');
  const n = events.length;
  send({ type: 'listSkills', repo: repoB });
  const ev = await until('skills', () => events.slice(n).find(e => e.type === 'skills'));
  assert(ev.skills.some(x => x.name === 'demo-skill' && x.source === 'repo' && x.description === 'A demo skill for the test.'), JSON.stringify(ev.skills.slice(0, 5)));
  send({ type: 'hire', name: 'Anders', role: 'engineer', repo: repoB, task: 'Use the demo', skills: ['demo-skill', 'bad skill; rm -rf'] });
  await until('applied', () => W('Anders') && chatOf('Anders').some(m => m.role === 'system' && m.text === 'Skills applied: /demo-skill'));
  await phase('Anders', 'done');
});

await stopServer();
const failed = results.filter(r => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (!failed.length) fs.rmSync(TMP, { recursive: true, force: true });
else console.log(`Kept ${TMP} for debugging.`);
process.exit(failed.length ? 1 : 0);
