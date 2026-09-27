// Department areas: each area is a real QM team scope (a project) with a block of desks.
// Hiring seats a worker in their role's area, and QM workers there run turns in that project.
import fs from 'node:fs';
import path from 'node:path';

// Desk blocks by index into DESKS (public/index.html) for the seeded areas.
const SEED_DESKS = { engineering: [0, 1, 2, 3, 4, 5, 6, 7, 8], marketing: [9, 10], support: [11, 12], events: [13, 14, 15] };
const ROLE_AREA = { engineer: 'engineering', support: 'support', marketing: 'marketing', sales: 'marketing', events: 'events', ops: 'finance', finance: 'finance' };
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

export default api => {
  const { state, ACTIONS, HIRE, DESK_COUNT, emit, changed, BOSSES } = api;
  if (!state.areas) {
    let company = {}; try { company = JSON.parse(fs.readFileSync(path.join(api.EXAMPLE || '', 'company.json'), 'utf8')); } catch {}
    state.areas = (company.areas || []).filter(a => SEED_DESKS[a.id])
      .map(a => ({ id: a.id, name: a.name, color: a.color, desks: SEED_DESKS[a.id], qmProject: null }));
  }
  const inArea = new Set(), areaOfDesk = d => state.areas.find(a => a.desks.includes(d));
  const reindex = () => { inArea.clear(); state.areas.forEach(a => a.desks.forEach(d => inArea.add(d))); };
  reindex();

  // Each area gets its own QM project (team scope). Both bosses are members.
  const pending = new Map();
  function ensureProject(a) {
    if (a.qmProject || api.FAKE || !api.QM || !api.QM_UP) return Promise.resolve(a.qmProject);
    if (pending.has(a.id)) return pending.get(a.id);
    const p = (async () => {
      const { project } = await api.QM.createProject(BOSSES.erik.id, `Throne · ${a.name}`);
      for (const b of Object.values(BOSSES)) if (b.id !== BOSSES.erik.id) await api.QM.addProjectMember(project.id, BOSSES.erik.id, b.id).catch(e => console.log(`Area ${a.name}: could not add ${b.name}: ${e.message}`));
      a.qmProject = project.id; changed();
      console.log(`Area ${a.name} → QM project ${project.id}.`);
      return project.id;
    })().catch(e => { console.log(`Area ${a.name}: QM project failed: ${e.message}`); return null; }).finally(() => pending.delete(a.id));
    pending.set(a.id, p);
    return p;
  }
  const sync = () => state.areas.forEach(ensureProject);
  setInterval(sync, 5000).unref(); setTimeout(sync, 1500).unref();

  HIRE.pickDesk = (role, used) => {
    const a = state.areas.find(x => x.id === (ROLE_AREA[role] || role));
    const free = ds => ds.find(d => !used.has(d)) ?? -1;
    let d = a ? free(a.desks) : -1;
    if (d < 0) d = free([...Array(DESK_COUNT).keys()].filter(i => !inArea.has(i)));
    return d;
  };
  HIRE.onHire = w => {
    const a = areaOfDesk(w.desk);
    w.area = a?.id || null;
    if (a?.qmProject && w.agent === 'qm') w.qmConversation = { kind: 'group', channelRef: `web-project-${a.qmProject}` };
  };

  ACTIONS.newArea = async m => {
    const name = String(m.name || '').trim().slice(0, 24);
    if (!name) throw new Error('Name the area first.');
    const color = /^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : '#2EAD6B';
    let id = slug(name) || 'area', n = 2;
    while (state.areas.some(a => a.id === id)) id = `${slug(name)}-${n++}`;
    const used = new Set(state.workers.map(w => w.desk));
    const desks = [...Array(DESK_COUNT).keys()].filter(i => !inArea.has(i) && !used.has(i)).slice(0, 4);
    if (!desks.length) throw new Error('No free desks left for a new area.');
    const a = { id, name, color, desks, qmProject: null, created: Date.now() };
    state.areas.push(a); reindex();
    await ensureProject(a);
    if (!api.FAKE && api.QM_UP && !a.qmProject) { state.areas.splice(state.areas.indexOf(a), 1); reindex(); throw new Error('QM could not create the area project.'); }
    changed();
    emit({ type: 'areaCreated', area: a });
  };
};
