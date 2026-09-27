// Throne as a QM surface: signed source requests to a QM core, async turns, and the
// run event stream (AG-UI style SSE). QM owns sessions, scopes, memory routing, and
// sandboxes; Throne owns the room.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const b64u = buf => Buffer.from(buf).toString('base64url');

export function loadQmConfig() {
  const dir = process.env.QM_DIR || path.join(os.homedir(), 'dev', 'qm');
  const envFile = path.join(dir, '.env');
  if (!fs.existsSync(envFile)) return null;
  const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  if (!env.CORE_SIGNING_SECRET || !env.PORTAL_IDENTITY_SECRET) return null;
  return {
    core: process.env.QM_CORE_URL || 'http://localhost:8081',
    admin: process.env.QM_ADMIN_URL || 'http://localhost:8129/admin',
    signingSecret: env.CORE_SIGNING_SECRET,
    identitySecret: env.PORTAL_IDENTITY_SECRET,
  };
}

export function qmClient(cfg) {
  const kid = crypto.createHmac('sha256', cfg.identitySecret).update('qm-signing-key-id').digest('base64url').slice(0, 8);
  function identity(principal, name) {
    const header = b64u(JSON.stringify({ alg: 'HS256', kid }));
    const payload = b64u(JSON.stringify({ p: principal, ...(name ? { n: name } : {}), exp: Date.now() + 60_000 }));
    const sig = crypto.createHmac('sha256', cfg.identitySecret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${sig}`;
  }
  function headers(method, pathWithQuery, raw, principal, name) {
    const ts = Math.floor(Date.now() / 1000);
    const sig = 'v0=' + crypto.createHmac('sha256', cfg.signingSecret).update(`v0:${ts}:${method}\n${pathWithQuery}\n${raw}`).digest('hex');
    return { 'x-timestamp': String(ts), 'x-signature': sig, 'x-portal-identity': identity(principal, name), ...(raw ? { 'content-type': 'application/json' } : {}) };
  }
  async function call(method, p, body, principal, name) {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const r = await fetch(cfg.core + p, { method, headers: headers(method, p, raw, principal, name), ...(raw ? { body: raw } : {}) });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!r.ok) throw new Error(`QM ${method} ${p} → ${r.status}: ${text.slice(0, 300)}`);
    return json;
  }
  return {
    health: async () => { try { const r = await fetch(cfg.core + '/healthz'); return r.status < 500; } catch { return false; } },
    adminSessionUrl: id => `${cfg.admin}/history/s/${id}`,
    // Queue a turn and return its run id right away.
    turn: ({ principal, name, threadRef, text, header, conversation }) => call('POST', '/v1/turns', {
      surface: 'web',
      actor: { externalId: principal, ...(name ? { displayName: name } : {}) },
      conversation: conversation ? { ...conversation, threadRef } : { kind: 'dm', threadRef },
      liveActor: true,
      deliveryTarget: threadRef,
      text,
      origin: { kind: 'human' },
      addressed: true,
      async: true,
      idempotencyKey: crypto.randomUUID(),
      ...(header ? { conversationHeader: header } : {}),
    }, principal, name),
    // Team scopes: a project is a shared QM scope; turns in it use conversation {kind:'group', channelRef:`web-project-<id>`}.
    createProject: (principal, name) => call('POST', '/v1/projects', { principalId: principal, name }, principal),
    addProjectMember: (id, principal, member) => call('POST', `/v1/projects/${encodeURIComponent(id)}/members`, { principalId: principal, memberId: member }, principal),
    run: (runId, principal) => call('GET', `/v1/runs/${encodeURIComponent(runId)}`, undefined, principal),
    session: (id, principal) => call('GET', `/v1/sessions/${encodeURIComponent(id)}?viewer=${encodeURIComponent(principal)}&tailTurns=2`, undefined, principal),
    // Stream a run's events until it finishes. onEvent gets parsed AG-UI objects.
    async stream(runId, principal, onEvent, signal) {
      const p = `/v1/runs/${encodeURIComponent(runId)}/events`;
      const r = await fetch(cfg.core + p, { headers: { ...headers('GET', p, '', principal), accept: 'text/event-stream' }, signal });
      if (!r.ok) throw new Error(`QM stream ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const dec = new TextDecoder(); let buf = '';
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n');
          if (!data) continue;
          let ev; try { ev = JSON.parse(data); } catch { continue; }
          await onEvent(ev);
          if (ev.type === 'RUN_FINISHED') return;
        }
      }
    },
  };
}
