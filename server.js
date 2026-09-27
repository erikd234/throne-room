// Throne Room: a local server that runs one real Claude Agent SDK session per
// worker and streams their state to the isometric office in public/index.html.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import net from 'node:net';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Codex } from '@openai/codex-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import crypto from 'node:crypto';
import { loadQmConfig, qmClient } from './qm.js';
import { gbrainClient } from './brain.js';

const run = promisify(execFile);
const PORT = +process.env.PORT || 4777;
const HOME = process.env.THRONE_HOME || path.join(os.homedir(), '.throne-room');
const PROOF_DIR = path.join(HOME, 'proof');
const UPLOAD_DIR = path.join(HOME, 'uploads');
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const PLUGIN_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'plugin');
const STATE_FILE = path.join(HOME, 'state.json');
const PUBLIC = path.join(path.dirname(new URL(import.meta.url).pathname), 'public');
fs.mkdirSync(PROOF_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const FAKE = process.env.THRONE_FAKE === '1';
const FAKE_SPEED = +process.env.THRONE_FAKE_SPEED || 1;
const POLL_MS = +process.env.THRONE_POLL_MS || (FAKE ? 1500 : 45000);
const DESK_COUNT = 18;
// If this server was started from inside a Claude Code session, don't let
// workers inherit that host session's wiring; they should use your own login.
const BASE_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_AGENT_SDK_.*|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.*)$/.test(k) &&
  !(k === 'ANTHROPIC_BASE_URL' && process.env.CLAUDE_CODE_DESKTOP_APP_VERSION)));
// git and gh shims on every worker's PATH: any agent (Claude or Codex) is blocked from
// pushing, opening PRs, or merging. The server's own git/gh calls use the real binaries.
const SHIM_DIR = path.join(HOME, 'shims');
function which(bin) {
  for (const d of (process.env.PATH || '').split(':')) { const f = path.join(d, bin); try { fs.accessSync(f, fs.constants.X_OK); if (!f.startsWith(SHIM_DIR)) return f; } catch {} }
  return bin;
}
fs.mkdirSync(SHIM_DIR, { recursive: true });
const SUBCMD = `sub=""; sub2=""; skip=0
for a in "$@"; do
  if [ "$skip" = 1 ]; then skip=0; continue; fi
  if [ -n "$sub" ]; then case "$a" in -*) ;; *) sub2="$a"; break;; esac; continue; fi
  case "$a" in -C|-c|-R|--repo|--git-dir|--work-tree|--namespace|--exec-path) skip=1;; -*) ;; *) sub="$a";; esac
done`;
fs.writeFileSync(path.join(SHIM_DIR, 'git'), `#!/bin/sh\n# Throne Room: workers can't push. The boss publishes from the throne.\n${SUBCMD}\nif [ "$sub" = "push" ]; then echo "throne: git push is disabled for workers. Commit to your branch; the boss opens the PR from the throne." >&2; exit 1; fi\nexec "${which('git')}" "$@"\n`, { mode: 0o755 });
fs.writeFileSync(path.join(SHIM_DIR, 'gh'), `#!/bin/sh\n# Throne Room: workers can't open PRs, merge, release, or delete repos.\n${SUBCMD}\ncase "$sub $sub2" in "pr create"|"pr merge"|"pr ready"|"release "*|"repo delete"|"repo create") echo "throne: gh $sub $sub2 is disabled for workers. The boss does that from the throne." >&2; exit 1;; esac\nexec "${which('gh')}" "$@"\n`, { mode: 0o755 });
// Codex runs commands in a login shell, and macOS's /etc/zprofile (path_helper) moves
// system dirs ahead of the shims. A Throne ZDOTDIR loads the user's own zsh files, then
// puts the shims back in front.
const ZDOT = path.join(HOME, 'zdotdir');
fs.mkdirSync(ZDOT, { recursive: true });
const realZ = process.env.ZDOTDIR || os.homedir();
for (const f of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
  const tail = f === '.zshenv' || f === '.zlogin' ? '' : `\ncase ":$PATH:" in *":${SHIM_DIR}:"*) PATH="${SHIM_DIR}:\${PATH//${SHIM_DIR}:/}";; *) PATH="${SHIM_DIR}:$PATH";; esac\nexport PATH\n`;
  fs.writeFileSync(path.join(ZDOT, f), `[ -f "${realZ}/${f}" ] && ZDOTDIR="${realZ}" source "${realZ}/${f}"\nZDOTDIR="${ZDOT}"${tail}\n`);
}
const WORKER_ENV = { ...BASE_ENV, PATH: `${SHIM_DIR}:${BASE_ENV.PATH || ''}`, ZDOTDIR: ZDOT, THRONE_WORKER: '1' };
const LINE_PHASES = new Set(['asking', 'done', 'pr_ready', 'pr_failing']);
// Workers run with permissions bypassed inside their worktree. Anything that
// publishes or merges goes through the throne instead.
const DENY = [
  'AskUserQuestion',
  'Bash(git push:*)', 'Bash(git push)',
  'Bash(gh pr create:*)', 'Bash(gh pr merge:*)', 'Bash(gh pr ready:*)',
  'Bash(gh repo delete:*)', 'Bash(gh release:*)',
];
const ROLE_BRIEF = {
  engineer: 'You are an engineer.',
  designer: 'You are a product designer who also writes the UI code for your designs.',
  qa: 'You are a QA engineer. You test flows end to end, find bugs, and fix or document them.',
  researcher: 'You are a researcher. You investigate and write up findings; you change code only if asked.',
};

/* ---------------- state ---------------- */
const state = load();
function load() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const w of s.workers) {
      if (w.phase === 'working' || w.phase === 'asking') {
        w.phase = 'paused';
        w.question = null;
        pushLog(w, 'The server restarted. Resume me to continue.', 'warn');
      }
    }
    s.rules = s.rules || [];
    return s;
  } catch {
    return { seq: 0, workers: [], repos: [], merged: 0, rules: [] };
  }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(state, strip, 2), () => {}), 300);
}
const strip = (k, v) => (k.startsWith('_') ? undefined : v);
const byId = id => state.workers.find(w => w.id === id);
function pushLog(w, text, cls = '') {
  w.log = w.log || [];
  w.log.push({ t: Date.now(), text: String(text).slice(0, 300), cls });
  if (w.log.length > 60) w.log.shift();
}
function chatPush(w, msg) {
  w.chat = w.chat || [];
  const m = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), ...msg };
  w.chat.push(m);
  if (w.chat.length > 400) w.chat.splice(0, w.chat.length - 400);
  changed();
  return m;
}
const MEDIA = { '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.m4v': 'video' };
const kindOf = f => MEDIA[path.extname(f).toLowerCase()] || 'file';
function setPhase(w, phase) {
  if (LINE_PHASES.has(phase) && !LINE_PHASES.has(w.phase)) w.lineSince = Date.now();
  w.phase = phase;
  changed();
}

/* ---------------- websocket fan-out ---------------- */
const sockets = new Set();
let bcastTimer = null;
function changed() {
  save();
  if (bcastTimer) return;
  bcastTimer = setTimeout(() => {
    bcastTimer = null;
    const msg = JSON.stringify({ type: 'state', state, gbrain: GBRAIN, qm: QM_UP }, strip);
    for (const s of sockets) s.readyState === 1 && s.send(msg);
  }, 120);
}
function emit(obj) {
  const msg = JSON.stringify(obj);
  for (const s of sockets) s.readyState === 1 && s.send(msg);
}

/* ---------------- git / gh helpers ---------------- */
const expand = p => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
async function git(cwd, ...args) {
  const { stdout } = await run('git', ['-C', cwd, ...args], { maxBuffer: 50e6 });
  return stdout.trim();
}
async function gh(cwd, ...args) {
  const { stdout } = await run('gh', args, { cwd, maxBuffer: 20e6 });
  return stdout.trim();
}
async function baseRef(top) {
  try { await git(top, 'fetch', '--quiet', 'origin'); } catch {}
  try { return await git(top, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'); } catch {}
  for (const b of ['origin/main', 'origin/master']) {
    try { await git(top, 'rev-parse', '--verify', '--quiet', b); return b; } catch {}
  }
  return await git(top, 'rev-parse', '--abbrev-ref', 'HEAD');
}
/* ---------------- the studio brain: a dedicated keyless GBrain shared by every worker and boss ---------------- */
// One long-lived `gbrain serve` owns the brain (PGLite takes one process at a time).
// Workers read it through Throne's brain tools, so every read can be drawn as a beam.
let GBRAIN = false;
const GB_ENV = { ...process.env, GBRAIN_HOME: process.env.THRONE_GBRAIN_HOME || path.join(HOME, 'gbrain'), GBRAIN_NO_BANNER: '1' };
const gbCli = async (...args) => (await run('gbrain', args, { env: GB_ENV, cwd: os.tmpdir(), timeout: 30000, maxBuffer: 10e6 })).stdout;
const BR = gbrainClient(GB_ENV);
const yq = t => JSON.stringify(String(t)); // YAML-safe scalar
// In-memory mirror of the brain (pages and links) so recall and the wall are instant; GBrain stays the source of truth.
const BRAIN_CACHE = new Map();
const GRAPH = { links: [] };
const KINDS = [['people/', 'person'], ['projects/', 'repo'], ['throne/rules/', 'rule'], ['throne/work/', 'work'], ['decisions/', 'decision'], ['lessons/', 'lesson'], ['playbooks/', 'playbook'], ['reference/', 'reference']];
const pageKind = sl => (KINDS.find(([pre]) => sl.startsWith(pre)) || [0, 'note'])[1];
const nodeOf = pg => ({ slug: pg.slug, title: pg.title, kind: pageKind(pg.slug), at: pg.at || 0 });
const linkKey = (a, b) => `${a}\u0000${b}`;
const LINKS = new Set();
function cacheLink(from, to) {
  if (from === to || LINKS.has(linkKey(from, to))) return false;
  LINKS.add(linkKey(from, to)); GRAPH.links.push([from, to]); return true;
}
function graphPayload() { return { nodes: [...BRAIN_CACHE.values()].map(nodeOf), links: GRAPH.links }; }
const bodyOf = pg => String(pg?.compiled_truth ?? '').trim();
(async () => {
  try {
    await run('which', ['gbrain']);
    fs.mkdirSync(GB_ENV.GBRAIN_HOME, { recursive: true });
    try { await gbCli('list', '--limit', '1'); } catch { await gbCli('init', '--pglite', '--no-embedding'); }
    await BR.connect();
    GBRAIN = true; console.log(`GBrain studio brain ready at ${GB_ENV.GBRAIN_HOME}.`);
    await loadGraph();
    if (!FAKE && process.env.THRONE_SEED !== '0') await seedBrain().catch(e => console.log('GBrain seed failed:', e.message));
    await refreshWall();
    changed();
  } catch (e) { console.log('GBrain not available: using the built-in brain only. ' + (e.message || '').split('\n')[0]); }
})();
async function loadGraph() {
  const pages = await BR.call('list_pages', { limit: 5000, sort: 'updated_asc' });
  for (const pg of Array.isArray(pages) ? pages : []) {
    const full = await BR.call('get_page', { slug: pg.slug }).catch(() => null);
    const body = bodyOf(full);
    BRAIN_CACHE.set(pg.slug, { slug: pg.slug, title: pg.title || pg.slug, text: body.split('\n')[0].slice(0, 400), body, at: Date.parse(pg.updated_at) || 0 });
  }
  for (const sl of BRAIN_CACHE.keys()) {
    const out = await BR.call('get_links', { slug: sl }).catch(() => []);
    for (const l of Array.isArray(out) ? out : []) { const to = l.to_slug || l.to || l.slug; if (to && BRAIN_CACHE.has(to)) cacheLink(sl, to); }
  }
  console.log(`GBrain graph: ${BRAIN_CACHE.size} pages, ${GRAPH.links.length} links.`);
}
// Write a page and wire it into the graph. Returns the links that were added.
async function brainPut(slugName, title, body, tags, links = []) {
  const at = Date.now(), isNew = !BRAIN_CACHE.has(slugName);
  BRAIN_CACHE.set(slugName, { slug: slugName, title, text: body.split('\n')[0].slice(0, 400), body, at });
  const added = [];
  if (GBRAIN) {
    try { await BR.call('put_page', { slug: slugName, content: `---\ntitle: ${yq(title)}\ntags: [${['throne', ...tags].join(', ')}]\n---\n${body}\n`, ingested_via: 'throne' }); }
    catch (e) { console.log('GBrain write failed:', (e.message || '').slice(0, 200)); return []; }
    for (const to of [...new Set(links)]) {
      if (!BRAIN_CACHE.has(to) || to === slugName || LINKS.has(linkKey(slugName, to))) continue;
      try { await BR.call('add_link', { from: slugName, to, link_type: 'related', link_source: 'throne' }); if (cacheLink(slugName, to)) added.push(to); } catch {}
    }
  } else for (const to of links) if (BRAIN_CACHE.has(to) && cacheLink(slugName, to)) added.push(to);
  emit({ type: 'node', node: nodeOf(BRAIN_CACHE.get(slugName)), links: added, isNew, pages: BRAIN_CACHE.size });
  return added;
}
async function brainDelete(sl) {
  BRAIN_CACHE.delete(sl);
  GRAPH.links = GRAPH.links.filter(([a, b]) => a !== sl && b !== sl);
  LINKS.clear(); GRAPH.links.forEach(([a, b]) => LINKS.add(linkKey(a, b)));
  if (GBRAIN) await BR.call('delete_page', { slug: sl }).catch(() => {});
  emit({ type: 'unnode', slug: sl, pages: BRAIN_CACHE.size });
}
const STOP = new Set('the and for our you are but not can did they even though check brain draft reply says with that this from have your what when will into they them then than been were about which their there would could should after before only just more also make made each other some such very over most need does done able'.split(' '));
const termsOf = q => [...new Set(String(q).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(t => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t)).map(t => t.length > 4 ? t.replace(/(ing|ed|es|s)$/, '') : t))];
async function brainSearch(q, n = 4, { exclude = [] } = {}) {
  if (!String(q).trim()) return [];
  const terms = termsOf(q);
  if (BRAIN_CACHE.size) {
    return [...BRAIN_CACHE.values()].filter(pg => !exclude.includes(pg.slug)).map(pg => {
      const title = pg.title.toLowerCase(), hay = `${title} ${pg.body}`.toLowerCase();
      return { slug: pg.slug, title: pg.title, text: pg.text || pg.title, score: terms.reduce((a, t) => a + (title.includes(t) ? 2 : hay.includes(t) ? 1 : 0), 0) };
    }).filter(x => x.score > 1 || (terms.length <= 2 && x.score > 0)).sort((a, b) => b.score - a.score).slice(0, n);
  }
  if (!GBRAIN) return [];
  const out = await BR.call('search', { query: String(q).slice(0, 200), limit: n }).catch(() => []);
  return (Array.isArray(out) ? out : []).map(r => ({ slug: r.slug, title: r.title, text: r.chunk_text || r.title, score: r.score }));
}
async function recall(w, text) {
  const found = await brainSearch(`${w.task} ${text}`, 5);
  const rulesHits = state.rules.map(r => ({ slug: `throne/rules/${r.id}`, title: `Rule: ${r.text}`, text: r.text }));
  const seen = new Set(), all = [...found, ...rulesHits].filter(x => !seen.has(x.slug) && seen.add(x.slug));
  if (all.length) {
    w._recalled = [...new Set([...(w._recalled || []), ...all.map(x => x.slug)])].slice(-12);
    chatPush(w, { role: 'system', text: `Recalled from the studio brain (GBrain): ${all.map(x => x.text.slice(0, 80)).join(' · ')}`, recall: all.map(x => x.slug) });
    emit({ type: 'recall', id: w.id, slugs: all.map(x => x.slug) });
    pushLog(w, `Read ${all.length} page${all.length > 1 ? 's' : ''} from the studio brain.`);
  }
  return all;
}
// Worker-facing brain tools: search and read go through the server, so the room sees every read.
function brainTools(w) {
  return [
    { name: 'brain_search', description: 'Search the studio brain (GBrain): the shared memory of every worker and boss. Use it before you start and whenever you need a convention, a past decision, or how something was done before.',
      shape: { query: z.string() },
      run: async ({ query: q }) => {
        const hits = await brainSearch(q, 5);
        if (hits.length) { w._recalled = [...new Set([...(w._recalled || []), ...hits.map(h => h.slug)])].slice(-12); emit({ type: 'recall', id: w.id, slugs: hits.map(h => h.slug) }); pushLog(w, `Searched the studio brain: ${q}`); }
        return ok(hits.length ? hits.map(h => `- ${h.slug}: ${h.title}\n  ${h.text.slice(0, 300)}`).join('\n') : 'Nothing in the brain about that yet.');
      } },
    { name: 'brain_read', description: 'Read one studio brain page by slug (from brain_search).',
      shape: { slug: z.string() },
      run: async ({ slug: sl }) => {
        const pg = BRAIN_CACHE.get(sl);
        if (!pg) return fail(`No brain page ${sl}.`);
        emit({ type: 'recall', id: w.id, slugs: [sl] });
        return ok(`# ${pg.title}\n\n${pg.body.slice(0, 8000)}`);
      } },
  ];
}
async function brainWall() {
  return [...BRAIN_CACHE.values()].filter(pg => pg.slug.startsWith('throne/')).sort((a, b) => b.at - a.at).slice(0, 60)
    .map(pg => ({ slug: pg.slug, title: pg.title, date: new Date(pg.at || Date.now()).toISOString().slice(0, 10) }));
}
// Load a company pack (examples/<name>) into the studio brain: markdown pages with
// frontmatter and [[wikilinks]], written as GBrain pages and links. Runs once per brain.
const EXAMPLE = process.env.THRONE_EXAMPLE === '0' ? null : path.join(ROOT, 'examples', process.env.THRONE_EXAMPLE || 'parrot-works');
function readPack(dir) {
  const pages = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.md')) pages.push(f); } };
  walk(dir);
  return pages.map(f => {
    const raw = fs.readFileSync(f, 'utf8'), fm = raw.match(/^---\n([\s\S]*?)\n---\n?/), meta = fm ? fm[1] : '';
    const sl = path.relative(dir, f).replace(/\.md$/, '').split(path.sep).join('/');
    const title = (meta.match(/^title:\s*"?(.*?)"?\s*$/m)?.[1] || sl.split('/').pop()).trim();
    const tags = (meta.match(/^tags:\s*\[(.*)\]/m)?.[1] || '').split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    const body = raw.slice(fm ? fm[0].length : 0).trim();
    return { slug: sl, title, tags, meta, body, links: [...new Set([...raw.matchAll(/\[\[([^\]|#]+)/g)].map(m => m[1].trim()))] };
  });
}
async function seedBrain() {
  if (state.brainSeeded || !EXAMPLE || !fs.existsSync(path.join(EXAMPLE, 'brain'))) return;
  const t = Date.now(), pack = readPack(path.join(EXAMPLE, 'brain'));
  for (const pg of pack) await brainPut(pg.slug, pg.title, pg.body + (pg.meta.includes('steps:') ? `\n\n<!-- playbook\n${pg.meta}\n-->` : ''), pg.tags.filter(x => x !== 'throne'));
  for (const pg of pack) if (pg.links.length) await brainPut(pg.slug, pg.title, BRAIN_CACHE.get(pg.slug).body, pg.tags.filter(x => x !== 'throne'), pg.links);
  let company = {}; try { company = JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'company.json'), 'utf8')); } catch {}
  for (const r of company.rules || []) if (!state.rules.some(x => x.text === r.text)) {
    const b = Object.values(BOSSES).find(x => x.name === r.from || x.id === r.from) || BOSSES.erik;
    state.rules.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: r.text, at: Date.now(), from: b.name, fromId: b.id, label: ruleLabel(r.text), knownBy: [] });
  }
  for (const r of state.rules) {
    const related = (await brainSearch(r.text, 3)).map(h => h.slug).filter(x => !x.startsWith('throne/rules/'));
    await brainPut(`throne/rules/${r.id}`, `Rule: ${r.text.slice(0, 60)}`, `${r.text}\n\nTaught by ${r.from}. Applies to every worker.`, ['rule'], [`people/${slug(r.from || 'erik')}`, ...related]);
  }
  state.brainSeeded = Date.now(); changed();
  console.log(`Loaded ${path.basename(EXAMPLE)} into the studio brain: ${BRAIN_CACHE.size} pages, ${GRAPH.links.length} links in ${((Date.now() - t) / 1000).toFixed(1)}s.`);
}

/* ---------------- QM: the org harness behind Throne ---------------- */
const QM_CFG = loadQmConfig();
const QM = QM_CFG ? qmClient(QM_CFG) : null;
let QM_UP = false;
const qmPing = async () => { const up = QM ? await QM.health() : false; if (up !== QM_UP) { QM_UP = up; console.log(up ? `QM core reachable at ${QM_CFG.core}.` : 'QM core not reachable.'); changed(); } };
qmPing(); setInterval(qmPing, 10000);

/* ---------------- bosses (multiplayer) ---------------- */
const BOSSES = { erik: { id: 'erik', name: 'Erik', color: '#E7B12F' }, bill: { id: 'bill', name: 'Bill Land', color: '#34B386' } };
const online = new Map(); // ws -> { boss, viewing }
function presence() {
  const by = new Map();
  for (const p of online.values()) { const cur = by.get(p.boss.id); by.set(p.boss.id, { ...p.boss, viewing: p.viewing ?? cur?.viewing ?? null }); }
  return [...by.values()];
}
const bossOf = ws => online.get(ws)?.boss || BOSSES.erik;
const rulesText = () => state.rules.length
  ? 'Standing rules from the boss. They apply to every worker and override your defaults:\n' + state.rules.map(r => `- ${r.text}`).join('\n')
  : 'The boss has not set any standing rules yet.';
// A short label for the desk bubbles: the rule's first clause.
function ruleLabel(text) {
  let t = String(text).split(/[.;:!\n]| - | — /)[0].replace(/^(new rule|rule|always|please)[:,]?\s*/i, '').trim();
  if (t.length > 30) t = t.slice(0, 30).replace(/\s+\S*$/, '') + '…';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function teach(text, from = 'boss') {
  const who = typeof from === 'object' ? from : (Object.values(BOSSES).find(b => b.name === from) || { id: 'erik', name: String(from) });
  text = String(text || '').trim();
  if (!text) throw new Error('Type something to teach.');
  const rule = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: text.slice(0, 500), at: Date.now(), from: who.name, fromId: who.id, label: ruleLabel(text), knownBy: [] };
  state.rules.push(rule);
  const sl = `throne/rules/${rule.id}`;
  const desks = state.workers.filter(w => w.desk != null && w.phase !== 'setup');
  emit({ type: 'taught', text: rule.text, reached: desks.filter(w => w._input).length, from: who.name, fromId: who.id, ruleId: rule.id, slug: sl, label: rule.label, desks: desks.length });
  (async () => {
    const related = (await brainSearch(text, 3, { exclude: [sl] })).map(h => h.slug);
    await brainPut(sl, `Rule: ${rule.text.slice(0, 60)}`, `${rule.text}\n\nTaught by ${who.name} in Throne on ${new Date(rule.at).toISOString().slice(0, 10)}. Applies to every worker.`, ['rule'], [`people/${slug(who.name)}`, ...related]);
    refreshWall();
    // Deliver it desk by desk: running sessions get it in their live input, and every
    // later turn carries it in the standing rules.
    for (const w of desks) {
      await new Promise(r => setTimeout(r, FAKE ? 30 : 450));
      if (!state.workers.includes(w) || !state.rules.includes(rule)) continue;
      if (w._input) w._input.push(`New standing rule from ${who.name} for every worker: "${rule.text}". Apply it to your current work where it's relevant, then continue.`);
      pushLog(w, 'Learned a new rule: ' + rule.text, 'boss');
      rule.knownBy.push(w.id);
      emit({ type: 'knows', id: w.id, ruleId: rule.id, label: rule.label, count: rule.knownBy.length, of: desks.length });
      changed();
    }
  })().catch(e => console.log('teach failed:', e.message));
  changed();
  return rule;
}
// A streaming prompt so rules taught mid-task reach sessions that are already running.
function inputQueue(first) {
  const q = [first];
  let wake = null, closed = false;
  return {
    push(t) { if (!closed) { q.push(t); wake?.(); } },
    close() { closed = true; wake?.(); },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (q.length) yield { type: 'user', message: { role: 'user', content: q.shift() }, parent_tool_use_id: null, session_id: '' };
        if (closed) return;
        await new Promise(r => { wake = r; });
        wake = null;
      }
    },
  };
}
// Serialize git setup per repo: concurrent `git worktree add` calls race on git's locks.
const repoLocks = new Map();
function withRepoLock(repo, fn) {
  const prev = repoLocks.get(repo) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  repoLocks.set(repo, next.catch(() => {}));
  return next;
}
async function excludeProof(wt) {
  const ex = path.resolve(wt, await git(wt, 'rev-parse', '--git-path', 'info/exclude'));
  fs.mkdirSync(path.dirname(ex), { recursive: true });
  const cur = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8') : '';
  const add = ['.throne-proof/', '.throne-inbox/'].filter(l => !cur.split('\n').includes(l));
  if (add.length) fs.appendFileSync(ex, (cur && !cur.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n');
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/* ---------------- workspace: find the right repo for a task, or create one ---------------- */
const WORKSPACE = expand(process.env.THRONE_WORKSPACE || path.join(os.homedir(), 'dev', 'throne-workspace'));
const REPO_ROOTS = (process.env.THRONE_REPO_ROOTS || path.join(os.homedir(), 'dev')).split(':').map(expand);
function scanRepos() {
  const found = new Map();
  const visit = (dir, depth) => {
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some(e => e.name === '.git' && e.isDirectory())) { found.set(dir, true); return; }
    if (depth <= 0) return;
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && !/-throne-/.test(e.name)) visit(path.join(dir, e.name), depth - 1);
  };
  for (const root of [...REPO_ROOTS, WORKSPACE]) visit(root, 2);
  return [...found.keys()].map(dir => {
    const read = f => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
    let pkg = {}; try { pkg = JSON.parse(read('package.json') || '{}'); } catch {}
    const readme = read('README.md').replace(/[#*`>\[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    return { path: dir, name: path.basename(dir), about: [pkg.description, readme].filter(Boolean).join(' · ').slice(0, 300) };
  });
}
const words = t => [...new Set(String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(x => x.length > 2))];
function heuristicPick(task, repos) {
  const tw = words(task);
  const scored = repos.map(r => { const hay = `${r.name} ${r.path} ${r.about}`.toLowerCase(); return { r, score: tw.filter(t => hay.includes(t)).length + (tw.some(t => r.name.toLowerCase().includes(t)) ? 3 : 0) }; }).sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 3 ? { repo: scored[0].r, reason: `Its name and README match the task.` } : null;
}
async function modelPick(task, repos) {
  if (FAKE || !repos.length) return undefined;
  const list = repos.slice(0, 80).map((r, i) => `${i}. ${r.name} (${r.path})${r.about ? ' - ' + r.about.slice(0, 160) : ''}`).join('\n');
  let out = '';
  const q = query({ prompt: `A worker was hired with this task:\n"${task}"\n\nLocal repositories:\n${list}\n\nPick the repository this task belongs in. If none clearly fits, choose a new repository. Reply with only JSON: {"choice": <number or "new">, "name": "<kebab-case name if new>", "reason": "<one short sentence>"}`,
    options: { model: 'claude-haiku-4-5', maxTurns: 1, settingSources: [], disallowedTools: ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'TodoWrite', 'NotebookEdit', 'AskUserQuestion'], env: WORKER_ENV } });
  try { for await (const m of q) if (m.type === 'result') out = m.result || ''; } catch { return undefined; }
  const j = (() => { try { return JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] || ''); } catch { return null; } })();
  if (!j) return undefined;
  if (j.choice === 'new') return { repo: null, name: j.name, reason: j.reason || '' };
  const r = repos[+j.choice];
  return r ? { repo: r, reason: j.reason || '' } : undefined;
}
async function createRepo(name, task) {
  const nm = slug(name || task).slice(0, 40) || `project-${Date.now().toString(36)}`;
  let dir = path.join(WORKSPACE, nm), n = 2;
  while (fs.existsSync(dir)) dir = path.join(WORKSPACE, `${nm}-${n++}`);
  const remote = path.join(HOME, 'remotes', `${path.basename(dir)}.git`);
  fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(path.dirname(remote), { recursive: true });
  await run('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  await run('git', ['init', '-q', '-b', 'main', dir]);
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${path.basename(dir)}\n\nCreated by Throne for: ${task}\n`);
  await git(dir, 'add', '-A');
  await git(dir, '-c', 'user.name=Throne', '-c', 'user.email=throne@local', 'commit', '-q', '-m', 'Start project');
  await git(dir, 'remote', 'add', 'origin', remote);
  await git(dir, 'push', '-q', 'origin', 'HEAD:main');
  await git(dir, 'remote', 'set-head', 'origin', 'main');
  return dir;
}
async function pickRepo(task) {
  const repos = scanRepos();
  const m = await modelPick(task, repos);
  const choice = m === undefined ? heuristicPick(task, repos) : m;
  if (choice?.repo) return { path: choice.repo.path, reason: choice.reason, created: false };
  return { path: await createRepo(choice?.name, task), reason: choice?.reason || 'Nothing in your repos matched the task.', created: true };
}

/* ---------------- worker actions ---------------- */
async function hire({ role = 'engineer', name, repo, task, skills: extraSkills, agent = 'claude' }, boss = BOSSES.erik) {
  if (!['claude', 'codex', 'qm'].includes(agent)) throw new Error('Pick Claude, Codex, or QM.');
  if (!task || !task.trim()) throw new Error('Give the worker a task first.');
  if (agent === 'qm') return hireQm({ role, name, task, boss });
  let picked = null;
  if (!repo || !repo.trim()) { picked = await pickRepo(task); repo = picked.path; }
  let top;
  try { top = await git(expand(repo.trim()), 'rev-parse', '--show-toplevel'); }
  catch { throw new Error(`${repo} is not a git repository.`); }
  // Claim a desk synchronously, right before the worker is added, so parallel hires can't collide.
  const used = new Set(state.workers.map(w => w.desk));
  let desk = -1;
  for (let i = 0; i < DESK_COUNT; i++) if (!used.has(i)) { desk = i; break; }
  if (desk < 0) throw new Error('Every desk is taken. Let someone go first.');
  const id = ++state.seq;
  const w = {
    id, name: name || NAMES[(id - 1) % NAMES.length], role, desk, agent,
    repo: top, repoName: path.basename(top), task: task.trim(), created: Date.now(),
    phase: 'setup', log: [], todos: [], toolCount: 0, costUsd: 0, outTokens: 0,
    sessionId: null, question: null, review: null, pr: null, shipped: 0, hiredBy: boss.name, owner: boss.id,
  };
  state.workers.push(w);
  state.repos = [top, ...state.repos.filter(r => r !== top)].slice(0, 50);
  pushLog(w, `Hired as ${role} for ${w.repoName}.`);
  changed();
  try {
    await withRepoLock(top, async () => {
      w.base = await baseRef(top);
      w.branch = `throne/${slug(w.name)}-${id}-${slug(w.task).slice(0, 24)}`;
      w.worktree = path.join(path.dirname(top), `${w.repoName}-throne-${slug(w.name)}-${id}`);
      await git(top, 'worktree', 'add', '-b', w.branch, w.worktree, w.base);
    });
    await excludeProof(w.worktree);
    pushLog(w, `Worktree ready on ${w.branch} from ${w.base}.`);
  } catch (e) {
    pushLog(w, 'Could not set up a worktree: ' + e.message, 'warn');
    setPhase(w, 'error');
    return w;
  }
  const skills = (Array.isArray(extraSkills) ? extraSkills : []).filter(x => /^[\w:.-]+$/.test(x));
  chatPush(w, { role: 'boss', text: w.task, by: boss.name });
  if (picked) chatPush(w, { role: 'system', text: picked.created ? `No existing repo fit, so the studio created ${picked.path}. ${picked.reason}` : `The studio picked ${picked.path}. ${picked.reason}` });
  const mem = await recall(w, '');
  if (mem.length) w.task_memory = mem.map(x => x.text);
  if (skills.length) chatPush(w, { role: 'system', text: 'Skills applied: ' + skills.map(x => '/' + x).join(', ') });
  if (agent === 'codex') {
    const all = await listSkills(top, 'codex');
    w.commands = all.map(x => x.name); w.skillNames = w.commands;
    const picked = skills.map(n => all.find(x => x.name === n)).filter(Boolean);
    startSession(w, `${w.task}${picked.length ? `\n\nFor this task, read and follow these skills: ${picked.map(x => `${x.name} (${x.path})`).join(', ')}.` : ''}`);
  } else {
    startSession(w, `${w.task}\n\nBefore you start, load the throne:present skill so you know how to show me your work.${skills.length ? ` Then use these skills for this task: ${skills.map(x => '/' + x).join(', ')}.` : ''}`);
  }
  return w;
}

async function askBoss(w, { question, options }) {
  w.question = { q: question, options: options || [] };
  pushLog(w, 'Asking the boss: ' + question, 'ask');
  chatPush(w, { role: 'question', text: question, options: options || [] });
  setPhase(w, 'asking');
  const answer = await new Promise(res => { w._answer = res; });
  w._answer = null;
  w.question = null;
  pushLog(w, 'Boss: ' + answer, 'boss');
  if (!w._answeredInChat) chatPush(w, { role: 'boss', text: answer });
  w._answeredInChat = false;
  setPhase(w, 'working');
  return answer;
}
function publishFile(w, p) {
  const src = path.isAbsolute(p) ? p : path.join(w.worktree, p);
  if (!fs.existsSync(src)) throw new Error(`File not found: ${src}. Capture it first, then try again.`);
  const dir = path.join(PROOF_DIR, String(w.id), String(Date.now()));
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(src));
  fs.copyFileSync(src, dest);
  return '/proof/' + path.relative(PROOF_DIR, dest).split(path.sep).map(encodeURIComponent).join('/');
}
function showBoss(w, { text, files, links }) {
  const media = (files || []).map(f => ({ kind: kindOf(f.path), src: publishFile(w, f.path), name: f.title || path.basename(f.path) }));
  chatPush(w, { role: 'agent', text: text || '', media, links: (links || []).filter(l => /^https?:\/\//.test(l.url)) });
  pushLog(w, 'Showed the boss: ' + (text || media.map(m => m.name).join(', ')).slice(0, 120));
}
function presentWork(w, { summary, proof }) {
  const kept = [];
  for (const p of proof) {
    const item = { ...p };
    if ((p.kind === 'image' || p.kind === 'video') && p.path) {
      item.src = publishFile(w, p.path);
    }
    if (item.output) item.output = item.output.slice(-6000);
    kept.push(item);
  }
  w._presented = { summary: summary.slice(0, 6000), proof: kept };
  learn(w, summary);
  chatPush(w, { role: 'present', text: summary.slice(0, 6000), proof: kept });
  pushLog(w, `Packed ${kept.length} piece${kept.length === 1 ? '' : 's'} of proof for the boss.`);
}

// Every finished piece of work becomes a GBrain page, wired to who asked, where it
// happened, what the worker read, and related pages.
async function learn(w, summary) {
  const sl = `throne/work/${slug(w.name)}-${w.id}-${Date.now().toString(36)}`;
  const boss = `people/${slug(BOSSES[w.owner]?.name || w.hiredBy || 'erik')}`;
  const repo = w.agent === 'qm' ? null : `projects/${slug(w.repoName || '')}`;
  const related = (await brainSearch(`${w.task} ${summary.slice(0, 400)}`, 3, { exclude: [sl] })).map(h => h.slug).filter(x => !x.startsWith('throne/work/'));
  const links = [boss, ...(repo ? [repo] : []), ...(w._recalled || []).slice(-3), ...related];
  const added = await brainPut(sl, `${w.name} (${w.role}): ${w.task.slice(0, 60)}`, `Task from ${w.hiredBy}: ${w.task}\n\nOutcome:\n${summary.slice(0, 2000)}`, ['work', w.role], links);
  emit({ type: 'learned', id: w.id, slug: sl, links: added });
  refreshWall();
}

/* ---------------- previews (server-owned so they outlive the session) ---------------- */
const freePort = () => new Promise((res, rej) => { const srv = net.createServer(); srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); }); srv.on('error', rej); });
async function reachable(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); if (r.status < 500) return true; } catch {}
    await new Promise(r => setTimeout(r, 700));
  }
  return false;
}
async function startPreview(w, { label, command, url, port }) {
  w.previews = w.previews || [];
  const pv = { id: Date.now().toString(36), label: label || 'Preview', url: url || '', command: command || '', started: Date.now() };
  if (command) {
    port = port || await freePort();
    pv.url = url || `http://localhost:${port}`;
    const logFile = path.join(HOME, 'previews', `${w.id}-${pv.id}.log`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const fd = fs.openSync(logFile, 'a');
    const child = spawn('bash', ['-lc', command], { cwd: w.worktree, detached: true, stdio: ['ignore', fd, fd], env: { ...WORKER_ENV, PORT: String(port) } });
    child.unref();
    pv.pid = child.pid; pv.log = logFile; pv.port = port;
  }
  w.previews.push(pv);
  pushLog(w, `Preview "${pv.label}" at ${pv.url}`);
  changed();
  const ok = pv.url ? await reachable(pv.url, command ? 90000 : 15000) : false;
  pv.ok = ok;
  chatPush(w, { role: 'preview', text: pv.label, links: [{ url: pv.url, label: pv.label }], ok, previewId: pv.id });
  return pv;
}
function stopPreviews(w, id) {
  for (const pv of (w.previews || []).filter(p => !id || p.id === id)) {
    if (pv.pid) { try { process.kill(-pv.pid, 'SIGTERM'); } catch {} }
  }
  w.previews = (w.previews || []).filter(p => id && p.id !== id);
  changed();
}
function shutdown() {
  state.workers.forEach(w => stopPreviews(w));
  clearTimeout(saveTimer);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, strip, 2));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Worker tools, defined once and offered to Claude (in-process MCP) and Codex (MCP over HTTP).
const ok = text => ({ content: [{ type: 'text', text }] });
const fail = text => ({ content: [{ type: 'text', text }], isError: true });
function throneTools(w) {
  return [
    ...brainTools(w),
    { name: 'ask_boss', description: 'Ask the boss a question when you need a decision you cannot make yourself. Blocks until the boss answers. Keep it to one clear question.',
      shape: { question: z.string(), options: z.array(z.string()).max(4).optional() },
      run: async args => ok(`The boss answered: ${await askBoss(w, args)}`) },
    { name: 'present_work', description: 'Present finished work to the boss. Call this exactly once, as your final step, with proof that the task is done.',
      shape: {
        summary: z.string().describe('What you did and why, in a few short paragraphs.'),
        proof: z.array(z.object({
          kind: z.enum(['image', 'video', 'test', 'log', 'link']),
          title: z.string(),
          path: z.string().optional().describe('Absolute path to an image or video file you captured.'),
          command: z.string().optional().describe('For tests and logs: the exact command you ran.'),
          output: z.string().optional().describe('For tests and logs: the real output, trimmed to the relevant tail.'),
          url: z.string().optional(),
        })).min(1),
      },
      run: async args => { try { presentWork(w, args); } catch (e) { return fail(e.message); } return ok('Presented. You can stop now; the boss will review it.'); } },
    { name: 'show_boss', description: 'Show the boss something in their chat right now without ending your task: a short message with screenshots, recordings, and links.',
      shape: {
        text: z.string().describe('One or two sentences on what they are looking at.'),
        files: z.array(z.object({ path: z.string().describe('Absolute path to an image or video.'), title: z.string().optional() })).optional(),
        links: z.array(z.object({ url: z.string(), label: z.string() })).optional(),
      },
      run: async args => { try { showBoss(w, args); } catch (e) { return fail(e.message); } return ok('Shown to the boss.'); } },
    { name: 'start_preview', description: 'Start a long-running preview (dev server, web app) that the boss can click into. The throne runs it, so it keeps running after your session ends. Pass a shell command that serves on $PORT, or pass url for something already running (for example a URL printed by ./launch).',
      shape: { label: z.string(), command: z.string().optional(), url: z.string().optional(), port: z.number().optional() },
      run: async args => {
        const pv = await startPreview(w, args);
        return pv.ok ? ok(`Preview is up at ${pv.url}.`) : fail(`Preview registered at ${pv.url || '(no url)'} but it did not respond yet.${pv.log ? ' Log: ' + pv.log : ''}`);
      } },
  ];
}
function proofServer(w) {
  return createSdkMcpServer({ name: 'throne', version: '1.0.0', instructions: 'Tools for talking to the boss who assigned your task.',
    tools: throneTools(w).map(t => tool(t.name, t.description, t.shape, t.run)) });
}
async function handleMcpHttp(req, res, w) {
  const server = new McpServer({ name: 'throne', version: '1.0.0' }, { instructions: 'Tools for talking to the boss who assigned your task.' });
  for (const t of throneTools(w)) server.registerTool(t.name, { description: t.description, inputSchema: t.shape }, t.run);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  let body = '';
  req.on('data', c => { body += c; });
  await new Promise(r => req.on('end', r));
  await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
}

const toolRef = (w, n) => (w.agent === 'codex' ? `the throne MCP tool ${n}` : `mcp__throne__${n}`);
const appendPrompt = w => `
You are ${w.name}, a worker in the boss's software studio. ${ROLE_BRIEF[w.role] || ''}
You work alone in your own git worktree (${w.worktree}) on branch ${w.branch}, based on ${w.base}. Work autonomously.

Rules:
- Commit your work to your branch with clear messages. Never push, open PRs, or merge; the boss does that from the throne.
- If you need a decision only the boss can make, call ${toolRef(w, 'ask_boss')}. Do not stop to ask in plain text.
- When you are done, call ${toolRef(w, 'present_work')} exactly once with a summary and PROOF that it works:
  - Anything visual (UI, app screens, web pages): real screenshots or a short screen recording. Save files under ${w.worktree}/.throne-proof/ and pass absolute paths. Use whatever fits the project: the iOS Simulator (xcrun simctl io booted screenshot / recordVideo), a headless browser, etc.
  - Backend, scripts, libraries: the exact test or verification command and its real output (kind "test"), and curl responses or logs where useful.
  - Research: key sources as links plus the written findings.
  Never invent output. If you could not verify something, say so plainly in the summary.
- Add .throne-proof/ to .git/info/exclude so proof files are never committed.
- If the work has something the boss can click through (a web app, admin page, API docs), call ${toolRef(w, 'start_preview')} so it keeps running for review. Use the project's own launcher when it has one.
${GBRAIN ? `
Shared brain: every worker in the studio shares one GBrain memory. Search it with ${toolRef(w, 'brain_search')} and read pages with ${toolRef(w, 'brain_read')}.
- Before you start, search what the brain knows about this repo and task.
- Put anything durable you learned (a convention, a gotcha, a decision) in your present_work summary; the studio writes it to the brain.` : ''}

${w.agent === 'codex' ? `How to present your work: read and follow ${path.join(PLUGIN_DIR, 'skills', 'present', 'SKILL.md')} (it names Claude tools like mcp__throne__show_boss; for you those are the throne MCP tools with the same names).
You can also show the boss screenshots and links mid-task with the throne MCP tool show_boss.` : ''}

${rulesText()}${w.task_memory?.length ? `\n\nFrom the studio brain (GBrain), read before you start:\n${w.task_memory.map(t => `- ${t}`).join('\n')}` : ''}`;

/* ---------------- fake agent (THRONE_FAKE=1): exercises every flow without tokens ---------------- */
function pngBytes(width, height, [r, g, b]) {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function fakeText(content) { return typeof content === 'string' ? content : content.filter(b => b.type === 'text').map(b => b.text).join('\n'); }
async function fakeChatReply(w, content) {
  const text = fakeText(content).split('\n\nThe boss attached')[0].trim();
  const images = typeof content === 'string' ? 0 : content.filter(b => b.type === 'image').length;
  const videos = (fakeText(content).match(/\(video;/g) || []).length;
  let reply = text.startsWith('/') ? `Running the ${text.slice(1).split(/\s/)[0]} skill.` : `Got it: ${text}`;
  if (images) reply += ` I can see ${images} image${images > 1 ? 's' : ''}.`;
  if (videos) reply += ` I saved your video${videos > 1 ? 's' : ''} and can pull frames from ${videos > 1 ? 'them' : 'it'}.`;
  await handle(w, { type: 'assistant', message: { content: [{ type: 'text', text: reply }] } });
  if (/show me/i.test(text)) {
    const dir = path.join(w.worktree, '.throne-proof'); fs.mkdirSync(dir, { recursive: true });
    const img = path.join(dir, `show-${Date.now()}.png`); fs.writeFileSync(img, pngBytes(200, 120, [52, 179, 134]));
    showBoss(w, { text: 'Here is the current screen.', files: [{ path: img, title: 'Current screen' }], links: [{ url: 'https://example.com/docs', label: 'Docs' }] });
  }
  if (/spawn service/i.test(text)) {
    const port = await freePort();
    const child = spawn('python3', ['-m', 'http.server', String(port)], { cwd: w.worktree, detached: true, stdio: 'ignore' });
    child.unref();
    await handle(w, { type: 'assistant', message: { content: [{ type: 'text', text: `Started a server on port ${port}.` }] } });
  }
}
async function fakeRun(w, prompt, ac) {
  await handle(w, { type: 'system', subtype: 'init', slash_commands: ['throne:present', 'review', 'compact', 'clear'], terminal_slash_commands: ['clear'], skills: ['throne:present'], session_id: `fake-${w.id}` });
  if (w._chatTurn) {
    await new Promise(r => setTimeout(r, 300 * FAKE_SPEED));
    await fakeChatReply(w, prompt);
    await handle(w, { type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.001, num_turns: 1, session_id: `fake-${w.id}` });
    return;
  }
  const sleep = ms => new Promise((res, rej) => { const t = setTimeout(res, ms * FAKE_SPEED); ac.signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }); });
  const step = async (name, input) => { await sleep(600); await handle(w, { type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } }); };
  const todos = s => ({ todos: ['Read the code', 'Make the change', 'Verify it works'].map((c, i) => ({ content: c, status: i < s ? 'completed' : i === s ? 'in_progress' : 'pending' })) });
  const task = w.task || '';
  prompt = fakeText(prompt);
  await step('TodoWrite', todos(0));
  await step('Read', { file_path: path.join(w.worktree, 'README.md') });
  if (/\bask\b/i.test(task) && !w._fakeAsked) { w._fakeAsked = true; await askBoss(w, { question: `Should ${w.name} take option A or option B?`, options: ['Option A', 'Option B'] }); }
  await step('TodoWrite', todos(1));
  await step('Edit', { file_path: path.join(w.worktree, 'work.txt') });
  fs.appendFileSync(path.join(w.worktree, `work-${w.id}.txt`), `${new Date().toISOString()} ${prompt.split('\n')[0]}\n`);
  const failFile = path.join(w.worktree, '.fail-ci');
  if (/failci/i.test(task) && !/CI failed/.test(prompt)) fs.writeFileSync(failFile, '1'); else if (fs.existsSync(failFile)) fs.rmSync(failFile);
  await git(w.worktree, 'add', '-A');
  await git(w.worktree, '-c', 'user.name=Throne Fake', '-c', 'user.email=fake@throne.local', 'commit', '-q', '-m', `fake: ${task.slice(0, 60)}`).catch(() => {});
  await step('Bash', { command: 'node --test', description: 'Running the tests' });
  if (/preview/i.test(task) && !(w.previews || []).length) await startPreview(w, { label: 'Fake site', command: 'python3 -m http.server "$PORT"' });
  await step('TodoWrite', todos(3));
  if (!/noproof/i.test(task) || /present_work/.test(prompt)) {
    const dir = path.join(w.worktree, '.throne-proof'); fs.mkdirSync(dir, { recursive: true });
    const img = path.join(dir, `screen-${Date.now()}.png`); fs.writeFileSync(img, pngBytes(320, 180, [79, 141, 245]));
    presentWork(w, { summary: `Fake ${w.name} finished: ${task}`, proof: [
      { kind: 'image', title: 'Screenshot of the change', path: img },
      { kind: 'test', title: 'Unit tests', command: 'node --test', output: 'ok 1 - add\nok 2 - multiply\n# pass 2\n# fail 0' },
    ] });
  }
  await handle(w, { type: 'result', subtype: 'success', is_error: false, result: `Fake run done for: ${task}`, total_cost_usd: 0.01, num_turns: 4, session_id: `fake-${w.id}` });
}

/* ---------------- Codex workers ---------------- */
function codexInput(w, content) {
  if (typeof content === 'string') return content;
  if (content.codex) return content.codex;
  return content.claude ?? '';
}
function codexRulesPrefix(w) {
  const fresh = state.rules.filter(r => !(w.rulesSeen || []).includes(r.id));
  w.rulesSeen = state.rules.map(r => r.id);
  return fresh.length ? `New standing rules from the boss:\n${fresh.map(r => `- ${r.text}`).join('\n')}\n\n` : '';
}
function withPrefix(input, prefix) {
  if (!prefix) return input;
  if (typeof input === 'string') return prefix + input;
  return [{ type: 'text', text: prefix + (input.find(x => x.type === 'text')?.text || '') }, ...input.filter(x => x.type !== 'text')];
}
async function codexRun(w, prompt, ac) {
  w.mcpToken = w.mcpToken || crypto.randomBytes(18).toString('hex');
  const codex = new Codex({
    env: WORKER_ENV,
    config: {
      mcp_servers: {
        throne: { url: `http://127.0.0.1:${PORT}/mcp/${w.id}/${w.mcpToken}`, tool_timeout_sec: 86400, startup_timeout_sec: 30 },
      },
    },
  });
  const opts = { workingDirectory: w.worktree, sandboxMode: 'danger-full-access', approvalPolicy: 'never', skipGitRepoCheck: true, networkAccessEnabled: true };
  const thread = w.sessionId ? codex.resumeThread(w.sessionId, opts) : codex.startThread(opts);
  const pending = [];
  w._input = { push: t => pending.push(t), close() {} };
  let input = codexInput(w, prompt);
  if (!w.sessionId) { input = withPrefix(input, `${appendPrompt(w)}\n\n---\n\n`); w.rulesSeen = state.rules.map(r => r.id); }
  else input = withPrefix(input, codexRulesPrefix(w));
  let lastText = '', turns = 0;
  while (input) {
    turns++;
    const { events } = await thread.runStreamed(input, { signal: ac.signal });
    for await (const ev of events) {
      const r = await handleCodex(w, ev);
      if (r?.text) lastText = r.text;
      if (r?.failed) throw new Error(r.failed);
    }
    // Messages that arrived mid-turn go in as the next turn.
    if (pending.length) {
      const parts = pending.splice(0).map(c => codexInput(w, c));
      const text = parts.map(p => typeof p === 'string' ? p : p.find(x => x.type === 'text')?.text || '').join('\n\n');
      const imgs = parts.flatMap(p => typeof p === 'string' ? [] : p.filter(x => x.type === 'local_image'));
      input = withPrefix(imgs.length ? [{ type: 'text', text }, ...imgs] : text, codexRulesPrefix(w));
    } else input = null;
  }
  await handle(w, { type: 'result', subtype: 'success', is_error: false, result: lastText, total_cost_usd: 0, num_turns: turns, session_id: w.sessionId });
}
function describeCodex(w, it) {
  if (it.type === 'command_execution') return `$ ${String(it.command).replace(/^\/bin\/(ba|z)sh -lc /, '').slice(0, 100)}`;
  if (it.type === 'file_change') return 'Editing ' + it.changes.map(c => rel(w, c.path)).join(', ').slice(0, 100);
  if (it.type === 'mcp_tool_call') return it.server === 'throne' ? ({ ask_boss: 'Walking over to ask the boss', present_work: 'Packing up proof for the boss', show_boss: 'Showing the boss something', start_preview: 'Starting a preview' }[it.tool] || it.tool) : `${it.server} ${it.tool}`;
  if (it.type === 'web_search') return `Searching the web: ${it.query}`;
  return it.type;
}
async function handleCodex(w, ev) {
  if (ev.type === 'thread.started') { w.sessionId = ev.thread_id; changed(); return; }
  if (ev.type === 'turn.completed') { w.outTokens += ev.usage?.output_tokens || 0; changed(); return; }
  if (ev.type === 'turn.failed') return { failed: ev.error?.message || 'Codex turn failed' };
  if (ev.type === 'error') return { failed: ev.message || 'Codex error' };
  const it = ev.item;
  if (!it) return;
  if (it.type === 'todo_list') { w.todos = it.items.map(t => ({ c: t.text, s: t.completed ? 'completed' : 'pending' })); const firstOpen = w.todos.find(t => t.s === 'pending'); if (firstOpen) firstOpen.s = 'in_progress'; changed(); return; }
  if (ev.type !== 'item.started' && ev.type !== 'item.completed') return;
  if (it.type === 'agent_message' && ev.type === 'item.completed' && it.text?.trim()) {
    pushLog(w, it.text.trim().split('\n')[0].slice(0, 200), 'say');
    chatPush(w, { role: 'agent', text: it.text.trim().slice(0, 20000) });
    return { text: it.text };
  }
  if (['command_execution', 'file_change', 'mcp_tool_call', 'web_search'].includes(it.type) && ev.type === 'item.started' || (it.type === 'file_change' && ev.type === 'item.completed')) {
    if (it.type === 'file_change' && ev.type === 'item.started') return;
    w.toolCount++;
    const text = describeCodex(w, it);
    pushLog(w, text);
    if (!(it.type === 'mcp_tool_call' && it.server === 'throne')) chatPush(w, { role: 'tool', text, tool: it.type });
    emit({ type: 'activity', id: w.id, text });
  }
  if (it.type === 'error' && ev.type === 'item.completed') { pushLog(w, it.message, 'warn'); chatPush(w, { role: 'system', text: it.message }); }
}

/* ---------------- QM staff: every worker is a QM session in its boss's scope ---------------- */
const STAFF = {
  support: 'You are a customer support specialist. You answer customers clearly and kindly, investigate issues, and escalate what needs a human.',
  ops: 'You are an operations generalist. You handle finance, scheduling, vendors, and internal logistics.',
  sales: 'You are a sales and partnerships rep. You research prospects and draft outreach.',
  events: 'You are an events coordinator. You plan logistics, schedules, and communications for events.',
  engineer: 'You are an engineer. You write and verify code in your sandbox.',
  designer: 'You are a product designer.', qa: 'You are a QA engineer.', researcher: 'You are a researcher.',
};
function qmHeader(w, memory) {
  return [
    `You are ${w.name}, a ${w.role} on the boss's team, working in Throne (a QM surface). ${STAFF[w.role] || ''}`,
    'The boss manages many workers from Throne. Skip onboarding and setup chatter. Work autonomously; use your sandbox for anything you can verify.',
    'If you need a decision only the boss can make, end your message with a line "QUESTION: <one question>" and a line "OPTIONS: <option A> | <option B>".',
    'When the task is complete, give a short report with the evidence (the commands you ran and what they printed), then end with the line "STATUS: DONE".',
    rulesText(),
    memory.length ? `From the studio brain (GBrain), read before you start:\n${memory.map(m => `- ${m.text}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}
async function hireQm({ role, name, task, boss }) {
  if (!QM || !QM_UP) throw new Error('QM is not running. Start it with: cd ~/dev/qm && HARNESS=codex npm run dev-instance:web');
  const used = new Set(state.workers.map(w => w.desk));
  let desk = -1;
  for (let i = 0; i < DESK_COUNT; i++) if (!used.has(i)) { desk = i; break; }
  if (desk < 0) throw new Error('Every desk is taken. Let someone go first.');
  const id = ++state.seq;
  const w = {
    id, name: name || NAMES[(id - 1) % NAMES.length], role: role || 'support', desk, agent: 'qm',
    repo: null, repoName: `QM · ${boss.name.split(' ')[0]}`, task: task.trim(), created: Date.now(),
    phase: 'setup', log: [], todos: [], toolCount: 0, costUsd: 0, outTokens: 0,
    sessionId: null, question: null, review: null, pr: null, shipped: 0, hiredBy: boss.name, owner: boss.id,
    qmThread: `web:${boss.id}:throne-${id}-${Date.now().toString(36)}`, commands: [], skillNames: [],
  };
  state.workers.push(w);
  pushLog(w, `Hired by ${boss.name} as a QM ${w.role}. Their session lives in ${boss.name}'s QM scope.`);
  chatPush(w, { role: 'boss', text: w.task, by: boss.name });
  changed();
  startSession(w, w.task);
  return w;
}
function describeQm(ev) {
  const a = ev.args || {};
  switch (ev.toolCallName) {
    case 'execute': return `$ ${String(a.command || '').slice(0, 100)}`;
    case 'memory': return a.action === 'read' ? 'Reading their QM notebook' : 'Writing to their QM notebook';
    case 'skills': return `Reading skill: ${a.name || a.action || ''}`;
    case 'web_search': case 'search': return `Searching: ${a.query || ''}`;
    default: return `${ev.toolCallName}${a.action ? ' ' + a.action : ''}`;
  }
}
async function qmRun(w, prompt, ac) {
  const boss = BOSSES[w.owner] || BOSSES.erik;
  const toText = c => typeof c === 'string' ? c : (typeof c?.claude === 'string' ? c.claude : (c?.claude || c || []).filter?.(b => b.type === 'text').map(b => b.text).join('\n') || '');
  const pending = [];
  w._input = { push: t => pending.push(toText(t)), close() {} };
  let input = toText(prompt), reply = '', turns = 0;
  const execs = new Map(), proof = [];
  while (input) {
    turns++;
    const memory = await recall(w, input);
    const q = await QM.turn({ principal: boss.id, name: boss.name, threadRef: w.qmThread, text: input, header: qmHeader(w, memory) });
    w.qmRunId = q.runId;
    let failed = null;
    await QM.stream(q.runId, boss.id, async ev => {
      if (ev.type === 'TOOL_CALL_START') {
        w.toolCount++;
        execs.set(ev.toolCallId, ev);
        const text = describeQm(ev);
        pushLog(w, text);
        chatPush(w, { role: 'tool', text, tool: ev.toolCallName });
        emit({ type: 'activity', id: w.id, text });
        if (ev.toolCallName === 'memory') emit({ type: 'recall', id: w.id, slugs: ['qm-notebook'] });
      } else if (ev.type === 'TOOL_CALL_RESULT') {
        const start = execs.get(ev.toolCallId);
        if (start?.toolCallName === 'execute') proof.push({ kind: 'log', title: start.args?.purpose || 'Sandbox command', command: start.args?.command || '', output: String(ev.content || '').slice(-3000) });
      } else if (ev.type === 'CUSTOM' && ev.name === 'run') {
        const v = ev.value || {};
        if (v.status === 'done' && v.result) { reply = v.result.reply || ''; w.sessionId = v.result.sessionId || w.sessionId; w.qmSessionUrl = v.result.adminUrl || w.qmSessionUrl; if (v.result.status && v.result.status !== 'ok') failed = `QM turn ended with ${v.result.status}`; }
        else if (['failed', 'error', 'cancelled'].includes(v.status)) failed = v.error || `QM run ${v.status}`;
      }
    }, ac.signal);
    if (failed) throw new Error(failed);
    const clean = reply.replace(/^\s*(QUESTION:.*|OPTIONS:.*)\s*$/gm, '').replace(/\s*·?\s*STATUS: DONE\s*/g, '\n').trim();
    if (clean) { chatPush(w, { role: 'agent', text: clean }); pushLog(w, clean.split('\n')[0].slice(0, 200), 'say'); }
    input = pending.length ? pending.splice(0).join('\n\n') : null;
  }
  const qm = reply.match(/^QUESTION:\s*(.+)$/m);
  if (qm) {
    w.question = { q: qm[1].trim(), options: (reply.match(/^OPTIONS:\s*(.+)$/m)?.[1] || '').split('|').map(x => x.trim()).filter(Boolean).slice(0, 4) };
    chatPush(w, { role: 'question', text: w.question.q, options: w.question.options });
    pushLog(w, 'Asking the boss: ' + w.question.q, 'ask');
    setPhase(w, 'asking');
    return;
  }
  const done = /STATUS: DONE/.test(reply);
  if (done || !w._chatTurn) {
    w._chatTurn = false;
    const summary = reply.replace(/\s*·?\s*STATUS: DONE\s*/g, '\n').trim();
    presentWork(w, { summary, proof: proof.length ? proof.slice(-4) : [{ kind: 'log', title: 'QM session', command: '', output: `Session ${w.sessionId}` }] });
  }
  await handle(w, { type: 'result', subtype: 'success', is_error: false, result: reply, total_cost_usd: 0, num_turns: turns, session_id: w.sessionId });
}

function startSession(w, prompt, opts = {}) {
  if (w._running) return;
  w._running = true;
  w._presented = null;
  w._chatTurn = !!opts.chat;
  if (opts.chat) w._restPhase = w.phase;
  setPhase(w, 'working');
  const ac = new AbortController();
  w._ac = ac;
  (async () => {
    try {
      if (FAKE) {
        w._input = { push: t => { if (typeof t === 'string' && t.startsWith('New standing rule')) { pushLog(w, 'Applying: ' + t.slice(0, 120), 'boss'); emit({ type: 'activity', id: w.id, text: 'Applying the new rule' }); } else fakeChatReply(w, t?.claude ?? t).catch(() => {}); }, close() {} };
        await fakeRun(w, prompt?.claude ?? prompt, ac);
        return;
      }
      if (w.agent === 'codex') { await codexRun(w, prompt, ac); return; }
      if (w.agent === 'qm') { await qmRun(w, prompt, ac); return; }
      const input = inputQueue(prompt.claude ?? prompt);
      w._input = input;
      const q = query({
        prompt: input,
        options: {
          cwd: w.worktree,
          resume: w.sessionId || undefined,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          disallowedTools: DENY,
          settingSources: ['user', 'project', 'local'],
          systemPrompt: { type: 'preset', preset: 'claude_code', append: appendPrompt(w) },
          mcpServers: { throne: proofServer(w) },
          plugins: [{ type: 'local', path: PLUGIN_DIR }],
          env: WORKER_ENV,
          abortController: ac,
        },
      });
      for await (const m of q) await handle(w, m);
    } catch (e) {
      if (!ac.signal.aborted) { pushLog(w, 'Session crashed: ' + e.message, 'warn'); setPhase(w, 'error'); }
    } finally {
      w._running = false;
      w._ac = null;
      w._input = null;
      changed();
    }
  })();
}

const rel = (w, p) => (p && w.worktree && p.startsWith(w.worktree) ? p.slice(w.worktree.length + 1) : p || '');
function describe(w, b) {
  const i = b.input || {};
  switch (b.name) {
    case 'Read': return `Reading ${rel(w, i.file_path)}`;
    case 'Edit': case 'MultiEdit': return `Editing ${rel(w, i.file_path)}`;
    case 'Write': return `Writing ${rel(w, i.file_path)}`;
    case 'Bash': return i.description ? i.description : `$ ${String(i.command || '').slice(0, 90)}`;
    case 'Grep': return `Searching for "${String(i.pattern || '').slice(0, 40)}"`;
    case 'Glob': return `Looking for ${i.pattern}`;
    case 'WebSearch': return `Searching the web: ${i.query}`;
    case 'WebFetch': return `Reading ${i.url}`;
    case 'Task': case 'Agent': return `Handing off: ${i.description || 'a subtask'}`;
    case 'TodoWrite': return 'Updating my plan';
    case 'mcp__throne__ask_boss': return 'Walking over to ask the boss';
    case 'mcp__throne__present_work': return 'Packing up proof for the boss';
    default: return b.name.replace(/^mcp__/, '').replace(/__/g, ' ');
  }
}

async function handle(w, m) {
  if (m.session_id && !w.sessionId) w.sessionId = m.session_id;
  if (m.type === 'system' && m.subtype === 'init') {
    w.commands = (m.slash_commands || []).filter(c => !(m.terminal_slash_commands || []).includes(c));
    w.skillNames = m.skills || [];
    changed();
    return;
  }
  if (m.type === 'assistant' && m.message?.content) {
    const u = m.message.usage;
    if (u) w.outTokens += u.output_tokens || 0;
    for (const b of m.message.content) {
      if (b.type === 'tool_use') {
        w.toolCount++;
        if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
          w.todos = b.input.todos.map(t => ({ c: t.content, s: t.status }));
        }
        const text = describe(w, b);
        pushLog(w, text);
        if (!b.name.startsWith('mcp__throne__')) chatPush(w, { role: 'tool', text, tool: b.name });
        emit({ type: 'activity', id: w.id, text });
      } else if (b.type === 'text' && b.text?.trim()) {
        pushLog(w, b.text.trim().split('\n')[0].slice(0, 200), 'say');
        chatPush(w, { role: 'agent', text: b.text.trim().slice(0, 20000) });
      }
    }
    changed();
  } else if (m.type === 'result') {
    w._input?.close();
    w.costUsd += m.total_cost_usd || 0;
    w.turns = (w.turns || 0) + (m.num_turns || 0);
    if (w._ac?.signal.aborted) return;
    if (m.is_error || m.subtype !== 'success') {
      pushLog(w, 'Stopped with an error: ' + (m.result || m.subtype), 'warn');
      chatPush(w, { role: 'system', text: 'Stopped with an error: ' + (m.result || m.subtype) });
      setPhase(w, 'error');
      return;
    }
    if (w._chatTurn && !w._presented) {
      const rest = w._restPhase;
      setPhase(w, ['done', 'pr_open', 'pr_ready', 'pr_failing'].includes(rest) ? rest : 'idle');
      return;
    }
    w.review = await makeReview(w, m.result || '');
    pushLog(w, w.review.proof.length ? 'Done. Bringing proof to the boss.' : 'Done, but I brought no proof.');
    setPhase(w, 'done');
  }
}

async function makeReview(w, resultText) {
  const p = w._presented;
  const r = { summary: p?.summary || resultText.slice(0, 6000), proof: p?.proof || [], presented: !!p, at: Date.now() };
  try {
    await git(w.worktree, 'add', '-A', '-N');
    const short = await git(w.worktree, 'diff', '--shortstat', w.base);
    r.files = +(short.match(/(\d+) files? changed/)?.[1] || 0);
    r.add = +(short.match(/(\d+) insertion/)?.[1] || 0);
    r.del = +(short.match(/(\d+) deletion/)?.[1] || 0);
    r.stat = (await git(w.worktree, 'diff', '--stat=100', w.base)).split('\n').slice(-16).join('\n');
    r.commits = (await git(w.worktree, 'log', '--oneline', `${w.base}..HEAD`)).split('\n').filter(Boolean).slice(0, 20);
  } catch (e) {
    r.files = 0; r.add = 0; r.del = 0; r.stat = ''; r.commits = [];
  }
  return r;
}

/* ---------------- GitHub, or a local fake when origin isn't on GitHub ---------------- */
async function isFakeRemote(wt) {
  if (process.env.THRONE_FAKE_GH === '1') return true;
  try { return !/github\.com/.test(await git(wt, 'remote', 'get-url', 'origin')); } catch { return true; }
}
const fakePRs = () => (state.fakePRs = state.fakePRs || {});
async function prCreate(w, title, body) {
  const baseBranch = w.base.replace(/^origin\//, '');
  if (!(await isFakeRemote(w.worktree))) {
    const url = await gh(w.worktree, 'pr', 'create', '--head', w.branch, '--base', baseBranch, '--title', title, '--body', body);
    return { number: +(url.match(/\/pull\/(\d+)/)?.[1] || 0), url: url.split('\n').pop() };
  }
  const n = (state.fakePrSeq = (state.fakePrSeq || 0) + 1);
  fakePRs()[n] = { branch: w.branch, base: baseBranch, state: 'OPEN', pushedAt: Date.now() };
  return { number: n, url: `http://localhost:${PORT}/fake-pr/${n}` };
}
async function prView(w) {
  if (!(await isFakeRemote(w.worktree))) return JSON.parse(await gh(w.worktree, 'pr', 'view', String(w.pr.number), '--json', 'state,statusCheckRollup,url'));
  const pr = fakePRs()[w.pr.number];
  if (!pr) return { state: 'CLOSED' };
  const running = Date.now() - pr.pushedAt < 3000 * FAKE_SPEED;
  let failed = false;
  try { await git(w.worktree, 'cat-file', '-e', 'HEAD:.fail-ci'); failed = true; } catch {}
  return { state: pr.state, url: w.pr.url, statusCheckRollup: [{ name: 'fake-ci', status: running ? 'IN_PROGRESS' : 'COMPLETED', conclusion: running ? null : failed ? 'FAILURE' : 'SUCCESS' }] };
}
async function prMerge(w) {
  if (!(await isFakeRemote(w.worktree))) {
    try { await gh(w.worktree, 'pr', 'merge', String(w.pr.number), '--squash'); return 'merged'; }
    catch { await gh(w.worktree, 'pr', 'merge', String(w.pr.number), '--squash', '--auto'); return 'queued'; }
  }
  const pr = fakePRs()[w.pr.number];
  await git(w.worktree, 'fetch', '-q', 'origin');
  await git(w.worktree, '-c', 'user.name=Throne Fake', '-c', 'user.email=fake@throne.local', 'rebase', '-q', `origin/${pr.base}`);
  await git(w.worktree, 'push', '-q', 'origin', `HEAD:refs/heads/${pr.base}`);
  pr.state = 'MERGED';
  return 'merged';
}

async function ship(w) {
  if (w.phase !== 'done') throw new Error(`${w.name} has nothing ready to ship.`);
  const wt = w.worktree;
  const dirty = await git(wt, 'status', '--porcelain');
  if (dirty) {
    await git(wt, 'add', '-A');
    await git(wt, 'commit', '-m', `${w.task.slice(0, 68)}\n\nBuilt by ${w.name} in Throne Room.\n\nCo-Authored-By: Claude <noreply@anthropic.com>`);
  }
  const ahead = await git(wt, 'rev-list', '--count', `${w.base}..HEAD`);
  if (+ahead === 0) throw new Error('There are no changes to put in a PR. Mark it done instead.');
  await git(wt, 'push', '-u', 'origin', w.branch);
  if (!w.pr) {
    const body = `${w.review.summary}\n\n${w.review.proof.filter(p => p.kind === 'test' || p.kind === 'log').map(p => `**${p.title}**\n\`\`\`\n$ ${p.command || ''}\n${(p.output || '').slice(-1500)}\n\`\`\``).join('\n\n')}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)`;
    const pr = await prCreate(w, w.task.slice(0, 120), body);
    w.pr = { ...pr, checks: 'pending', failing: [] };
    pushLog(w, `Opened PR #${pr.number}.`);
  } else {
    if (fakePRs()[w.pr.number]) fakePRs()[w.pr.number].pushedAt = Date.now();
    pushLog(w, `Pushed an update to PR #${w.pr.number}.`);
    w.pr.checks = 'pending';
  }
  w.review = null;
  setPhase(w, 'pr_open');
  setTimeout(() => pollPR(w), POLL_MS / 2);
}

async function pollPR(w) {
  if (!w.pr || !['pr_open', 'pr_ready', 'pr_failing'].includes(w.phase)) return;
  try {
    const j = await prView(w);
    w.pr.url = j.url;
    if (j.state === 'MERGED') return markMerged(w);
    if (j.state === 'CLOSED') { pushLog(w, `PR #${w.pr.number} was closed.`, 'warn'); w.pr = null; return setPhase(w, 'idle'); }
    const checks = j.statusCheckRollup || [];
    const res = c => (c.conclusion || c.state || c.status || '').toUpperCase();
    const failing = checks.filter(c => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(res(c))).map(c => c.name || c.context);
    const pending = checks.some(c => ['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'WAITING', ''].includes(res(c)) && !c.conclusion);
    w.pr.failing = failing;
    w.pr.checks = failing.length ? 'failing' : pending ? 'pending' : 'passing';
    const next = failing.length ? 'pr_failing' : pending ? 'pr_open' : 'pr_ready';
    if (next !== w.phase) {
      pushLog(w, next === 'pr_ready' ? `PR #${w.pr.number} is green.` : next === 'pr_failing' ? `CI failed on PR #${w.pr.number}: ${failing.join(', ')}` : 'Waiting on CI.', next === 'pr_failing' ? 'warn' : '');
      setPhase(w, next);
    } else changed();
  } catch (e) {
    pushLog(w, 'Could not read the PR: ' + e.message.split('\n')[0], 'warn');
  }
}
setInterval(() => state.workers.forEach(w => pollPR(w)), POLL_MS);

async function merge(w) {
  if (w.phase !== 'pr_ready' || !w.pr) throw new Error(`${w.name}'s PR is not green yet.`);
  if ((await prMerge(w)) === 'queued') {
    pushLog(w, `PR #${w.pr.number} is queued to merge.`);
    return setPhase(w, 'pr_open');
  }
  markMerged(w);
}
function markMerged(w) {
  pushLog(w, `Merged PR #${w.pr.number} into ${w.base.replace(/^origin\//, '')}.`, 'boss');
  emit({ type: 'merged', id: w.id });
  state.merged++;
  w.shipped++;
  w.lastPr = w.pr;
  w.pr = null;
  stopPreviews(w);
  setPhase(w, 'idle');
}

async function assign(w, task) {
  if (!['idle', 'error', 'paused'].includes(w.phase)) throw new Error(`${w.name} is busy.`);
  if (!task?.trim()) throw new Error('Give them a task first.');
  if (w.phase === 'idle' && w.worktree) {
    try { await git(w.worktree, 'fetch', '--quiet', 'origin'); } catch {}
    if (await git(w.worktree, 'status', '--porcelain')) throw new Error(`${w.name}'s worktree has uncommitted changes. Resume them or ship first.`);
    w.branch = `throne/${slug(w.name)}-${w.id}-${slug(task).slice(0, 24)}-${Date.now().toString(36).slice(-4)}`;
    await git(w.worktree, 'checkout', '-b', w.branch, w.base);
  }
  w.task = task.trim();
  w.todos = []; w.toolCount = 0; w.review = null;
  pushLog(w, 'New task: ' + w.task, 'boss');
  startSession(w, `New task from the boss: ${w.task}\n\nYou are now on a fresh branch ${w.branch} from ${w.base}.`);
}

/* ---------------- chat ---------------- */
async function buildContent(w, text, atts) {
  const inbox = path.join(w.worktree, '.throne-inbox');
  fs.mkdirSync(inbox, { recursive: true });
  const blocks = [], notes = [];
  for (const a of atts) {
    const dest = path.join(inbox, path.basename(a.path));
    fs.copyFileSync(a.path, dest);
    const kind = kindOf(dest), size = fs.statSync(dest).size;
    const mt = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[path.extname(dest).toLowerCase()];
    if (kind === 'image' && mt && size < 5e6) blocks.push({ type: 'image', source: { type: 'base64', media_type: mt, data: fs.readFileSync(dest).toString('base64') } });
    notes.push(`- ${dest} (${kind}${kind === 'video' ? '; to look at it, extract frames with ffmpeg' : ''})`);
  }
  const body = (text || '(no message)') + (notes.length ? `\n\nThe boss attached files, saved in your worktree:\n${notes.join('\n')}` : '');
  const imgPaths = atts.map(a => path.join(inbox, path.basename(a.path))).filter(f => kindOf(f) === 'image');
  return {
    claude: blocks.length ? [{ type: 'text', text: body }, ...blocks] : body,
    codex: imgPaths.length ? [{ type: 'text', text: body }, ...imgPaths.map(p => ({ type: 'local_image', path: p }))] : body,
  };
}
async function chat(w, m) {
  if (!w) throw new Error('That worker is gone.');
  if (w.agent !== 'qm' && (!w.worktree || w.phase === 'setup')) throw new Error(`${w.name} is still setting up.`);
  const text = String(m.text || '').trim();
  const atts = (m.attachments || []).filter(a => a && typeof a.path === 'string' && path.resolve(a.path).startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(a.path));
  if (!text && !atts.length) throw new Error('Type a message or attach something.');
  chatPush(w, { role: 'boss', text, by: m._boss?.name, media: atts.map(a => ({ kind: kindOf(a.path), src: a.src, name: a.name })) });
  if (w.agent === 'qm') {
    const note = atts.length ? `\n\n(The boss attached ${atts.map(a => a.name).join(', ')} in Throne.)` : '';
    if (w._running && w._input) { w._input.push(text + note); return; }
    const answering = w.phase === 'asking';
    if (answering) { w.question = null; if (m.teach) teach(text, m._boss); }
    startSession(w, text + note, { chat: !answering && !['working'].includes(w.phase) });
    return;
  }
  pushLog(w, 'Boss: ' + (text || `${atts.length} attachment(s)`), 'boss');
  if (w.phase === 'asking' && w._answer && !atts.length) { w._answeredInChat = true; w._answer(text); return; }
  let msg = text;
  if (w.agent === 'codex' && /^\/[\w:.-]+/.test(text)) {
    const name = text.slice(1).split(/\s/)[0], sk = (await listSkills(w.repo, 'codex')).find(x => x.name === name);
    if (sk) msg = `Use the "${name}" skill: read ${sk.path} and follow it.${text.slice(name.length + 1).trim() ? ' ' + text.slice(name.length + 1).trim() : ''}`;
  }
  const content = await buildContent(w, msg, atts);
  if (w._running && w._input) { w._input.push(w.agent === 'codex' ? content : content.claude); return; }
  startSession(w, content, { chat: true });
}

/* ---------------- services catalog: listening processes that live in a worker's worktree ---------------- */
async function scanServices() {
  const out = async (cmd, args) => { try { return (await run(cmd, args, { maxBuffer: 20e6 })).stdout; } catch (e) { return e.stdout || ''; } };
  const procs = new Map(); let cur = null;
  for (const line of (await out('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'])).split('\n')) {
    const k = line[0], v = line.slice(1);
    if (k === 'p') { cur = { pid: +v, ports: new Set() }; procs.set(cur.pid, cur); }
    else if (k === 'c' && cur) cur.name = v;
    else if (k === 'n' && cur) { const port = +(v.match(/:(\d+)$/) || [])[1]; if (port) cur.ports.add(port); }
  }
  const services = [];
  if (procs.size) {
    let pid = null;
    for (const line of (await out('lsof', ['-a', '-d', 'cwd', '-p', [...procs.keys()].join(','), '-Fpn'])).split('\n')) {
      if (line[0] === 'p') pid = +line.slice(1); else if (line[0] === 'n' && procs.has(pid)) procs.get(pid).cwd = line.slice(1);
    }
    const owned = [...procs.values()].map(p => ({ p, w: state.workers.find(w => w.worktree && p.cwd && (p.cwd === w.worktree || p.cwd.startsWith(w.worktree + '/'))) })).filter(x => x.w);
    const meta = new Map();
    if (owned.length) for (const line of (await out('ps', ['-o', 'pid=,pgid=,command=', '-p', owned.map(x => x.p.pid).join(',')])).split('\n')) {
      const mm = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); if (mm) meta.set(+mm[1], { pgid: +mm[2], command: mm[3] });
    }
    for (const { p, w } of owned) {
      const md = meta.get(p.pid) || {};
      const pv = (w.previews || []).find(v => v.pid && v.pid === md.pgid);
      const ports = [...p.ports].sort((a, b) => a - b);
      services.push({ pid: p.pid, workerId: w.id, name: p.name, command: (md.command || p.name || '').slice(0, 300), ports, url: ports.length ? `http://localhost:${ports[0]}` : '', owner: pv ? 'preview' : 'agent', preview: pv?.label || null });
    }
  }
  const sig = JSON.stringify(services);
  if (sig !== JSON.stringify(state.services || [])) { state.services = services; changed(); }
  return services;
}
setInterval(() => scanServices().catch(() => {}), 4000);
async function killService(pid) {
  const svc = (await scanServices()).find(s => s.pid === +pid);
  if (!svc) throw new Error('That service is not owned by a worker.');
  try { process.kill(svc.pid, 'SIGTERM'); } catch {}
  const w = byId(svc.workerId);
  if (w) { pushLog(w, `The boss stopped ${svc.name} on port ${svc.ports.join(', ')}.`, 'boss'); if (svc.owner === 'preview') w.previews = (w.previews || []).filter(v => v.label !== svc.preview); }
  setTimeout(() => scanServices().catch(() => {}), 500);
}

/* ---------------- skill discovery for the hire dialog ---------------- */
async function listSkills(repo, agent = 'claude') {
  const dirs = [path.join(os.homedir(), agent === 'codex' ? '.codex' : '.claude', 'skills')];
  if (agent === 'codex') dirs.push(path.join(os.homedir(), '.claude', 'skills'));
  try { dirs.push(path.join(await git(expand(repo || '.'), 'rev-parse', '--show-toplevel'), '.claude', 'skills')); } catch {}
  const seen = new Map();
  for (const d of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(d); } catch { continue; }
    for (const e of entries) {
      const f = path.join(d, e, 'SKILL.md');
      if (!fs.existsSync(f)) continue;
      const head = fs.readFileSync(f, 'utf8').slice(0, 3000);
      const name = (head.match(/^name:\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '') || e;
      const description = (head.match(/^description:\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '').slice(0, 200) || '';
      if (!seen.has(name)) seen.set(name, { name, description, path: f, source: d.startsWith(os.homedir() + '/.') ? 'personal' : 'repo' });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

let WALL = [];
async function refreshWall() {
  WALL = await brainWall();
  emit({ type: 'wall', pages: WALL });
}


/* ---------------- the brain ---------------- */
async function askBrain(text, ws) {
  text = String(text || '').trim();
  if (!text) throw new Error('Ask the brain something.');
  if (QM && QM_UP) {
    const boss = bossOf(ws), hits = await brainSearch(text, 6);
    const studio = state.workers.map(w => `- ${w.name} (${w.role}, ${w.agent}) : "${w.task}" is ${w.phase}`).join('\n');
    const q = await QM.turn({ principal: boss.id, name: boss.name, threadRef: `web:${boss.id}:throne-brain`, text,
      header: `You are the studio brain in Throne, answering ${boss.name}. Answer in 2-4 short sentences using only this context; say plainly when it isn't known.\n\nStudio brain pages (GBrain):\n${hits.map(h => `- ${h.slug}: ${h.text}`).join('\n') || '(none matched)'}\n\n${rulesText()}\n\nWorkers right now:\n${studio || '(none)'}` });
    let answer = '';
    await QM.stream(q.runId, boss.id, ev => { if (ev.type === 'CUSTOM' && ev.name === 'run' && ev.value?.status === 'done') answer = ev.value.result?.reply || ''; });
    ws.send(JSON.stringify({ type: 'brainAnswer', text: answer, sources: hits.map(h => h.slug) }));
    return;
  }
  const studio = state.workers.map(w => `- ${w.name} (${w.role}) in ${w.repoName}: "${w.task}", ${w.phase}. Recent: ${(w.log || []).slice(-4).map(l => l.text).join(' | ')}${w.review?.summary ? ` Last summary: ${w.review.summary.slice(0, 400)}` : ''}`).join('\n');
  const prompt = `You are the studio's shared brain. The boss asks: ${text}

${rulesText()}

Current workers:
${studio || '(nobody hired yet)'}
${GBRAIN ? '\nSearch the shared GBrain memory (mcp__brain__brain_search) before answering.' : ''}
Answer in a few short sentences. Say plainly when the brain doesn't know. Do not use any tools other than the brain's memory tools.`;
  let answer = '';
  const q = query({
    prompt,
    options: {
      cwd: HOME,
      maxTurns: 6,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      disallowedTools: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'TodoWrite', 'AskUserQuestion'],
      settingSources: [],
      mcpServers: { brain: createSdkMcpServer({ name: 'brain', version: '1.0.0', tools: brainTools({ id: -1, task: '', log: [] }).map(t => tool(t.name, t.description, t.shape, t.run)) }) },
      env: WORKER_ENV,
    },
  });
  for await (const m of q) if (m.type === 'result') answer = m.result || (m.is_error ? 'The brain could not answer.' : '');
  ws.send(JSON.stringify({ type: 'brainAnswer', text: answer }));
}

/* ---------------- client messages ---------------- */
const ACTIONS = {
  hire: (m, ws) => hire(m, bossOf(ws)),
  answer: (m, ws) => { const w0 = byId(m.id); if (w0?.agent === 'qm') return chat(w0, { text: m.text, teach: m.teach, _boss: bossOf(ws) }); if (m.teach) teach(m.text, bossOf(ws)); const w = byId(m.id); if (!w?._answer) throw new Error('Nobody is waiting on that answer.'); w._answer(m.text); },
  ship: m => ship(byId(m.id)),
  teach: (m, ws) => { teach(m.text, bossOf(ws)); },
  chat: (m, ws) => chat(byId(m.id), { ...m, _boss: bossOf(ws) }),
  view: (m, ws) => { const p = online.get(ws); if (p) { p.viewing = m.id ?? null; emit({ type: 'presence', bosses: presence() }); } },
  killService: m => killService(m.pid),
  listSkills: (m, ws) => listSkills(m.repo, m.agent).then(skills => ws.send(JSON.stringify({ type: 'skills', repo: m.repo, skills }))),
  stopPreview: m => stopPreviews(byId(m.id), m.preview),
  forgetRule: m => { state.rules = state.rules.filter(r => r.id !== m.id); brainDelete(`throne/rules/${m.id}`).then(refreshWall); changed(); },
  askBrain: (m, ws) => askBrain(m.text, ws),
  sendBack: (m, ws) => {
    const w = byId(m.id);
    if (m.teach) teach(m.note, bossOf(ws));
    pushLog(w, 'Boss: ' + m.note, 'boss');
    w.review = null;
    startSession(w, `The boss reviewed your work and sent it back:\n\n${m.note}\n\nAddress it, then call present_work again with fresh proof.`);
  },
  askProof: m => {
    const w = byId(m.id);
    w.review = null;
    startSession(w, 'You finished without presenting proof. Verify the work now (screenshots or recordings for anything visual, real test output for backend work) and call mcp__throne__present_work.');
  },
  markDone: m => { const w = byId(m.id); w.review = null; w.shipped++; pushLog(w, 'The boss accepted it without a PR.', 'boss'); setPhase(w, 'idle'); },
  later: () => {},
  merge: m => merge(byId(m.id)),
  mergeAll: async () => { for (const w of state.workers.filter(w => w.phase === 'pr_ready')) await merge(w).catch(e => emit({ type: 'error', message: `${w.name}: ${e.message}` })); },
  fixCI: m => {
    const w = byId(m.id);
    startSession(w, `CI failed on your PR #${w.pr.number}: ${w.pr.failing.join(', ')}. Read the failures with gh pr checks ${w.pr.number} and gh run view --log-failed, fix them, commit, and call present_work again with proof the fix works.`);
  },
  assign: m => assign(byId(m.id), m.task),
  resume: m => { const w = byId(m.id); pushLog(w, 'Resuming.', 'boss'); startSession(w, 'Continue where you left off. When done, call present_work with proof.'); },
  stop: m => { const w = byId(m.id); w._ac?.abort(); w._answer = null; pushLog(w, 'The boss told me to stop.', 'boss'); setPhase(w, 'paused'); },
  letGo: m => {
    const w = byId(m.id);
    w._ac?.abort();
    stopPreviews(w);
    state.workers = state.workers.filter(o => o !== w);
    changed();
    emit({ type: 'info', message: `${w.name} left. Their worktree stays at ${w.worktree || 'n/a'}.` });
  },
};

/* ---------------- http + ws ---------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4' };
function serveFile(res, file, req) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = +range[1] || 0, end = range[2] ? +range[2] : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
}
const ROUTES = [], CONNECT = [];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/') {
    // Feature modules in public/features/*.js load after the room, through window.__throne.
    const tags = FEATURE_FILES().map(f => `<script src="/features/${f}"></script>`).join('\n');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('<!--FEATURES-->', tags));
  }
  if (url.startsWith('/features/') && FEATURE_FILES().includes(url.slice(10))) return serveFile(res, path.join(PUBLIC, 'features', url.slice(10)), req);
  for (const r of ROUTES) if (url.startsWith(r.prefix)) return r.fn(req, res, url);
  if (url.startsWith('/mcp/')) {
    const [, , id, token] = url.split('/');
    const w = byId(+id);
    const good = w && w.mcpToken && token && token.length === w.mcpToken.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(w.mcpToken));
    if (!good) { res.writeHead(403); return res.end(); }
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    return handleMcpHttp(req, res, w).catch(e => { if (!res.headersSent) { res.writeHead(500); res.end(e.message); } });
  }
  if (url === '/upload' && req.method === 'POST') {
    const origin = req.headers.origin || '';
    if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) { res.writeHead(403); return res.end(); }
    let rawName = String(req.headers['x-filename'] || 'upload'); try { rawName = decodeURIComponent(rawName); } catch {}
    const name = path.basename(rawName).replace(/[^\w.\- ]+/g, '_').slice(0, 100) || 'upload';
    const file = path.join(UPLOAD_DIR, `${Date.now().toString(36)}-${name}`);
    const out = fs.createWriteStream(file);
    let size = 0, tooBig = false;
    req.on('data', c => { size += c.length; if (size > 500e6 && !tooBig) { tooBig = true; out.destroy(); req.destroy(); fs.rm(file, () => {}); } });
    req.pipe(out);
    out.on('finish', () => {
      if (tooBig) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: file, src: '/uploads/' + encodeURIComponent(path.basename(file)), name, kind: kindOf(file), size }));
    });
    return;
  }
  if (url.startsWith('/uploads/')) {
    const file = path.normalize(path.join(UPLOAD_DIR, url.slice(9)));
    if (!file.startsWith(UPLOAD_DIR)) { res.writeHead(403); return res.end(); }
    return serveFile(res, file, req);
  }
  if (url.startsWith('/fake-pr/')) {
    const n = url.split('/')[2], pr = (state.fakePRs || {})[n];
    res.writeHead(pr ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(pr ? `<h1>Fake PR #${n}</h1><p>${pr.branch} → ${pr.base}: ${pr.state}</p>` : 'No such fake PR');
  }
  if (url.startsWith('/proof/')) {
    const file = path.normalize(path.join(PROOF_DIR, url.slice(7)));
    if (!file.startsWith(PROOF_DIR)) { res.writeHead(403); return res.end(); }
    return serveFile(res, file, req);
  }
  res.writeHead(404); res.end('Not found');
});
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  // Only accept connections from our own page.
  const origin = req.headers.origin || '';
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return ws.close();
  sockets.add(ws);
  const as = new URL(req.url, 'http://x').searchParams.get('as');
  const boss = BOSSES[as] || BOSSES.erik;
  const firstForBoss = ![...online.values()].some(p => p.boss.id === boss.id);
  online.set(ws, { boss, viewing: null });
  ws.send(JSON.stringify({ type: 'state', state, gbrain: GBRAIN, qm: QM_UP, me: boss, bosses: presence(), wall: WALL, graph: graphPayload(), ...Object.assign({}, ...CONNECT.map(fn => fn(boss))), defaults: { repo: state.repos[0] || process.env.THRONE_DEFAULT_REPO || '' } }, strip));
  emit({ type: 'presence', bosses: presence(), joined: firstForBoss ? boss : null });
  ws.on('close', () => { sockets.delete(ws); online.delete(ws); emit({ type: 'presence', bosses: presence() }); });
  ws.on('message', async raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const fn = ACTIONS[m.type];
    if (!fn) return;
    try { await fn(m, ws); changed(); }
    catch (e) { ws.send(JSON.stringify({ type: 'error', message: e.message.split('\n')[0] })); }
  });
});
// Feature modules: features/*.js export default (api) => {}. They add actions, routes,
// and connect-time payloads without touching this file.
const FEATURE_FILES = () => { try { return fs.readdirSync(path.join(PUBLIC, 'features')).filter(f => f.endsWith('.js')).sort(); } catch { return []; } };
const FEATURE_API = { state, ACTIONS, ROUTES, CONNECT, emit, changed, byId, BOSSES, BRAIN_CACHE, GRAPH, brainPut, brainSearch, recall, teach, chatPush, pushLog, bossOf, get QM() { return QM; }, get QM_UP() { return QM_UP; }, get GBRAIN() { return GBRAIN; }, BR, FAKE, HOME, ROOT, EXAMPLE };
for (const f of (() => { try { return fs.readdirSync(path.join(ROOT, 'features')).filter(f => f.endsWith('.js')).sort(); } catch { return []; } })()) {
  try { (await import(path.join(ROOT, 'features', f))).default(FEATURE_API); console.log(`Feature: ${f}`); } catch (e) { console.log(`Feature ${f} failed: ${e.message}`); }
}
server.listen(PORT, '127.0.0.1', () => console.log(`Throne Room: http://localhost:${PORT}`));

const NAMES = ['Ada', 'Linus', 'Grace', 'Ken', 'Radia', 'Guido', 'Hedy', 'Alan', 'Frances', 'Tim', 'Barbara', 'Dennis', 'Joan', 'Bjarne', 'Sophie', 'Yukihiro', 'Margaret', 'Anders'];
