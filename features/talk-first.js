// Talk first → Send away: a new hire stands at the throne in phase `talking` and only plans.
// Every exchange updates a "What we've agreed" card (w.agreed); `sendAway` starts the real session.
const NO_TOOLS = ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'TodoWrite', 'NotebookEdit', 'AskUserQuestion'];
const PLAN_ONLY = 'PLANNING ONLY. You have NOT been sent away yet: do not execute tools, do not run commands, do not start the work. In 2-4 short sentences, say how you will approach it, what you remember that applies, what proof you will bring back, and ask about anything unclear. When the boss presses Send away you will do the work.';

export default (api) => {
  const { TALK, ACTIONS, state, byId, chatPush, pushLog, setPhase, startSession, qmHeader, recall, changed, emit, FAKE, WORKER_ENV, query, BOSSES } = api;
  const convo = w => (w.chat || []).filter(m => m.role === 'boss' || m.role === 'agent').map(m => `${m.role === 'boss' ? 'Boss' : w.name}: ${m.text}`).join('\n').slice(-6000);
  async function haiku(prompt) {
    let out = '';
    const q = query({ prompt, options: { model: 'claude-haiku-4-5', maxTurns: 1, settingSources: [], disallowedTools: NO_TOOLS, env: WORKER_ENV } });
    for await (const m of q) if (m.type === 'result') out = m.result || '';
    return out.trim();
  }
  async function reply(w, text) {
    if (FAKE) return `Planning only for now. I'll ${w.task.toLowerCase().slice(0, 80)} and bring proof back. Press Send away when it looks right.`;
    const memory = await recall(w, text);
    w._mem = [...new Set([...(w._mem || []), ...memory.map(x => x.title || x.slug)])].slice(-8);
    if (w.agent === 'qm') {
      const boss = BOSSES[w.owner] || BOSSES.erik;
      const q = await api.QM.turn({ principal: boss.id, name: boss.name, threadRef: w.qmThread, text, header: `${PLAN_ONLY}\n\n${qmHeader(w, memory)}` });
      let out = '', failed = null;
      await api.QM.stream(q.runId, boss.id, async ev => {
        if (ev.type === 'CUSTOM' && ev.name === 'run') { const v = ev.value || {}; if (v.status === 'done' && v.result) { out = v.result.reply || ''; w.sessionId = v.result.sessionId || w.sessionId; w.qmSessionUrl = v.result.adminUrl || w.qmSessionUrl; } else if (['failed', 'error', 'cancelled'].includes(v.status)) failed = v.error || `QM run ${v.status}`; }
      });
      if (failed) throw new Error(failed);
      return out.replace(/^\s*(QUESTION:|OPTIONS:)\s*/gm, '').replace(/\s*·?\s*STATUS: DONE\s*/g, '').trim();
    }
    const mem = memory.length ? `\nFrom the studio brain (GBrain):\n${memory.map(m => `- ${m.text}`).join('\n')}` : '';
    return haiku(`You are ${w.name}, a ${w.role} about to take on this task in ${w.repoName}: "${w.task}".${mem}\n\n${PLAN_ONLY}\n\nConversation so far:\n${convo(w)}\n\nReply as ${w.name}, plain text only.`);
  }
  async function extract(w) {
    if (FAKE) { w.agreed = { goal: w.task, memory: w._mem || [], proof: '', handsOff: '' }; return; }
    const out = await haiku(`A boss and a worker (${w.name}, ${w.role}) are agreeing on a task before the worker starts.\nTask: "${w.task}"\n${w._mem?.length ? `Recalled from GBrain: ${w._mem.join(' · ')}\n` : ''}\nConversation:\n${convo(w)}\n\nSummarise what they have agreed so far. Reply with only JSON: {"goal":"<one line>","memory":"<what the worker will remember/apply from GBrain or the boss, one line, or empty>","proof":"<what proof comes back, one line, or empty>","handsOff":"<what the worker must not touch or do, one line, or empty>"}`);
    const j = (() => { try { return JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] || ''); } catch { return null; } })();
    if (j && w.phase === 'talking') { w.agreed = { goal: String(j.goal || ''), memory: [...(w._mem || []), ...(j.memory ? [String(j.memory)] : [])], proof: String(j.proof || ''), handsOff: String(j.handsOff || '') }; changed(); }
  }
  async function turn(w, text) {
    if (w._talkBusy) { (w._talkQ ||= []).push(text); return; }
    w._talkBusy = true; w.thinking = true; changed();
    try {
      for (let t = text; t && w.phase === 'talking'; t = (w._talkQ || []).splice(0).join('\n\n') || null) {
        const r = await reply(w, t);
        if (w.phase !== 'talking') break;
        if (r) { chatPush(w, { role: 'agent', text: r }); pushLog(w, r.split('\n')[0].slice(0, 200), 'say'); }
        w.thinking = false; changed();
        await extract(w).catch(e => pushLog(w, 'Could not update the agreement: ' + e.message, 'warn'));
      }
    } catch (e) { chatPush(w, { role: 'system', text: `${w.name} could not reply: ${e.message}` }); }
    finally { w._talkBusy = false; w.thinking = false; changed(); }
  }
  TALK.hold = (w, prompt) => {
    w.heldPrompt = typeof prompt === 'string' ? prompt : prompt?.claude ?? String(prompt);
    w.agreed = { goal: w.task, memory: [], proof: '', handsOff: '' };
    setPhase(w, 'talking');
    pushLog(w, 'Talking with the boss first. Nothing starts until they send me away.');
    changed();
    turn(w, w.task);
  };
  TALK.chat = async (w, m) => {
    const text = String(m.text || '').trim();
    if (!text) throw new Error('Type a message first.');
    chatPush(w, { role: 'boss', text, by: m._boss?.name });
    turn(w, text);
  };
  ACTIONS.sendAway = (m, ws) => {
    const w = byId(m.id);
    if (!w) throw new Error('That worker is gone.');
    if (w.phase !== 'talking') throw new Error(`${w.name} is already on it.`);
    const a = w.agreed || {};
    const card = [['Goal', a.goal], ['Memory', (a.memory || []).join('; ')], ['Proof', a.proof], ['Hands off', a.handsOff]].filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join('\n');
    const prompt = `${w.heldPrompt || w.task}${card ? `\n\nWhat we agreed before you started:\n${card}` : ''}\n\nYou've been sent away: do the work now.`;
    w._talkQ = []; w.heldPrompt = null;
    chatPush(w, { role: 'system', text: `Sent away by ${api.bossOf(ws)?.name || 'the boss'}. ${w.name} walks to their desk and starts.` });
    pushLog(w, 'Sent away. Starting the work.');
    emit({ type: 'sentAway', id: w.id });
    setPhase(w, 'working');
    w._running = false;
    startSession(w, prompt);
  };
};
