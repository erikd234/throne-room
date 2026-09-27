// Talk first → Send away: a `talking` hire stands at the front of the line, its chat opens with a
// live "What we've agreed" card (w.agreed), and Send away (⌘↵) sends `sendAway` so they walk to their desk.
(() => {
  const T = window.__throne, { esc, send, byId, $ } = T;
  T.LINE_PHASES.add('talking');
  T.TAG_TEXT.talking = 'Talking';
  T.PHASE_TEXT.talking = 'Talking it through · nobody starts until you send them';
  T.ICON.talking = ['…', '#7C5CFF'];
  const st = document.createElement('style');
  st.textContent = `.tag.talking{background:#7C5CFF}
.tf-badge{margin-left:auto;background:#E9E1FF;cursor:default;white-space:nowrap}
.tf-badge + .x{margin-left:6px}
.tf-card{margin:10px 12px 0;background:#F3ECE0;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:7px;flex-shrink:0;max-height:38%;overflow:auto}
.tf-card h4{margin:0;font:600 15px var(--display)}
.tf-row{display:grid;grid-template-columns:18px 72px 1fr;gap:8px;align-items:start;font:800 13px/1.35 var(--sans)}
.tf-box{width:17px;height:17px;border-radius:5px;box-sizing:border-box;border:2px dashed #B8AFA0;display:grid;place-items:center;color:#fff;font:900 10px var(--sans);margin-top:1px}
.tf-box.on{border:0;background:var(--mint)} .tf-box.on.mem{background:#7C5CFF}
.tf-k{font:800 10.5px/17px var(--sans);text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.tf-v{color:var(--ink);overflow-wrap:anywhere} .tf-v.off{color:#9A91A8}
.tf-go{flex-shrink:0;display:flex;gap:10px;align-items:center;border-top:2px dashed #E4DBCB;padding:10px 12px;background:var(--paper)}
.tf-go .btn{font-size:17px;white-space:nowrap} .tf-go kbd{font:900 11px var(--sans);opacity:.6;margin-left:4px}
.tf-go span{font:800 12px var(--sans);color:var(--muted)}`;
  document.head.appendChild(st);
  const card = document.createElement('div'); card.className = 'tf-card'; card.hidden = true;
  const go = document.createElement('div'); go.className = 'tf-go'; go.hidden = true;
  $('#dhead').after(card); $('#composer').after(go);
  const mac = /Mac|iP(hone|ad)/.test(navigator.platform);
  const sendAway = id => { const w = byId(id); if (w && w.phase === 'talking') send({type:'sendAway', id}); };
  go.addEventListener('click', e => { if (e.target.closest('[data-tf-go]')) sendAway(T.peek()); });
  addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || T.peek() == null || !$('#scrim').hidden) return;
    const w = byId(T.peek()); if (!w || w.phase !== 'talking') return;
    e.preventDefault(); e.stopImmediatePropagation(); sendAway(w.id);
  }, true);
  const row = (k, v, mem) => `<div class="tf-row"><span class="tf-box ${v ? 'on' : ''} ${mem ? 'mem' : ''}">${v ? (mem ? 'G' : '✓') : ''}</span><span class="tf-k">${k}</span><span class="tf-v ${v ? '' : 'off'}">${v ? esc(v) : '…'}</span></div>`;
  let sig = '';
  function paint(){
    const w = T.peek() != null ? byId(T.peek()) : null, on = !!(w && w.phase === 'talking') && !$('#drawer').hidden;
    const h3 = $('#dhead h3');
    if (h3){ const b = h3.querySelector('.tf-badge'); if (on && !b) h3.querySelector('.x')?.insertAdjacentHTML('beforebegin', '<span class="chip tf-badge">Talking · not working yet</span>'); else if (!on && b) b.remove(); }
    if (on) $('#dactions [data-act=open]')?.remove();
    const a = (on && w.agreed) || {}, s = JSON.stringify([on, w && w.id, w && w.name, a, w && w.thinking]);
    if (s === sig) return; sig = s;
    card.hidden = go.hidden = !on;
    if (!on) return;
    const mem = Array.isArray(a.memory) ? a.memory.filter(Boolean).join(' · ') : a.memory || '';
    card.innerHTML = `<h4>What we’ve agreed</h4>${row('Goal', a.goal)}${row('Memory', mem, true)}${row('Proof', a.proof)}${row('Hands off', a.handsOff)}`;
    go.innerHTML = `<button class="btn gold" data-tf-go>Send ${esc(w.name)} away <kbd>${mac ? '⌘' : 'Ctrl'}↵</kbd></button><span>${w.thinking ? `${esc(w.name)} is thinking…` : 'Nobody starts until you send them.'}</span>`;
  }
  T.onDrawTop(paint);
  const seen = new Set();
  T.on('state', m => {
    const me = m.me || T.me;
    for (const w of m.state.workers || []){
      if (w.phase !== 'talking'){ seen.delete(w.id); continue; }
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      if (!w.owner || !me || w.owner === me.id) setTimeout(() => { if ($('#scrim').hidden) T.openChat(w.id); }, 0);
    }
  });
  T.on('sentAway', m => { const sp = T.sprites.get(m.id); if (sp) T.say(sp, 'On my way!', 1.6); });
})();
