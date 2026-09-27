// Multiplayer hand-off: a boss hands workers to another boss. Later QM turns run under the new owner's principal.
export default api => {
  const { state, ACTIONS, BOSSES, emit, changed, byId, chatPush, pushLog, bossOf } = api;
  ACTIONS.handOff = (m, ws) => {
    const from = bossOf(ws), to = BOSSES[m.to];
    if (!to) throw new Error('No such teammate.');
    const ws2 = (m.ids || [m.id]).map(byId).filter(w => w && w.owner !== to.id);
    if (!ws2.length) throw new Error('Nobody to hand off.');
    for (const w of ws2) {
      if (w.owner && w.owner !== from.id) throw new Error(`${w.name} reports to ${BOSSES[w.owner]?.name || w.owner}, not you.`);
      (w.handoffs = w.handoffs || []).push({ from: from.id, to: to.id, at: Date.now() });
      w.owner = to.id;
      if (w.agent === 'qm') { w.qmThread = `web:${to.id}:throne-${w.id}-${Date.now().toString(36)}`; w._handoff = `${from.name} handed you to ${to.name}. You now report to ${to.name}; your work continues in ${to.name}'s QM scope. Your task: ${w.task}`; w.repoName = `QM · ${to.name.split(' ')[0]}`; }
      pushLog(w, `${from.name} handed ${w.name} to ${to.name}.`, 'boss');
      chatPush(w, { role: 'system', text: `${from.name} handed ${w.name} to ${to.name}` });
    }
    (state.handoffs = state.handoffs || []).push({ from: from.id, to: to.id, ids: ws2.map(w => w.id), at: Date.now() });
    emit({ type: 'handoff', from, to, ids: ws2.map(w => w.id), names: ws2.map(w => w.name) });
    changed();
  };
};
