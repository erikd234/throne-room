// Company memory: playbooks, decisions, people, lessons from GBrain, plus real per-worker playbook use from recall events.
const TABS = { playbooks: 'playbooks/', decisions: 'decisions/', people: 'people/', lessons: 'lessons/' };
export function parsePlaybook(body = '') {
  const m = body.match(/<!-- playbook\n([\s\S]*?)\n-->/), meta = m ? m[1] : '', steps = [];
  let cur = null, inSteps = false;
  for (const line of meta.split('\n')) {
    if (/^steps:\s*$/.test(line)) { inSteps = true; continue; }
    if (inSteps && /^\S/.test(line)) inSteps = false;
    if (!inSteps) continue;
    const kv = line.match(/^\s*(-\s+)?(\w+):\s*"?(.*?)"?\s*$/);
    if (!kv) continue;
    if (kv[1]) steps.push(cur = {});
    if (cur) cur[kv[2]] = kv[3];
  }
  const get = k => (meta.match(new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1] || '').trim();
  return { steps, learnedFrom: get('learned_from'), updated: get('updated') };
}
const clean = b => b.replace(/<!-- playbook[\s\S]*?-->/, '').trim();
export default api => {
  const { state, ACTIONS, CONNECT, BRAIN_CACHE, emit, byId } = api;
  state.playbookUse = state.playbookUse || {};
  const usage = () => Object.fromEntries(Object.entries(state.playbookUse).map(([sl, u]) => [sl, Object.values(u)]));
  api.onEmit(o => {
    if (o.type !== 'recall' || !o.id) return;
    const w = byId(o.id); if (!w) return;
    let hit = false;
    for (const sl of o.slugs || []) if (sl.startsWith('playbooks/')) {
      const u = state.playbookUse[sl] = state.playbookUse[sl] || {};
      u[w.id] = { id: w.id, name: w.name, role: w.role, at: Date.now() }; hit = true;
    }
    if (hit) setTimeout(() => emit({ type: 'playbookUse', use: usage() }));
  });
  const memory = () => {
    const out = { pages: BRAIN_CACHE.size, use: usage() };
    for (const [k, pre] of Object.entries(TABS)) out[k] = [...BRAIN_CACHE.values()].filter(pg => pg.slug.startsWith(pre)).sort((a, b) => b.at - a.at).map(pg => {
      const x = { slug: pg.slug, title: pg.title, text: clean(pg.body || pg.text || '').slice(0, 600), at: pg.at };
      return k === 'playbooks' ? { ...x, ...parsePlaybook(pg.body) } : x;
    });
    return out;
  };
  ACTIONS.memory = (m, ws) => ws.send(JSON.stringify({ type: 'memory', ...memory() }));
  CONNECT.push(() => ({ playbookUse: usage() }));
};
