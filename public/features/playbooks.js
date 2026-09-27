// Company memory: GBrain playbooks, decisions, people, lessons, and the brain's rules. Replaces the brain modal.
(() => {
const T = window.__throne, $ = s => document.querySelector(s), esc = T.esc;
const ROLE_COL = {support:'#E4506A', ops:'#8C6BD9', engineer:'#4F8DF5', marketing:'#EE8A2E', events:'#34B386', design:'#EE77AE', finance:'#2F8F6B'};
const TEAM = {support:'#2BB5A8', review:'#4F8DF5', ship:'#4F8DF5', launch:'#FF7A59', events:'#34B386', close:'#2F8F6B', payout:'#2F8F6B', triage:'#2BB5A8'};
let rendering = false, M = null, use = {}, tab = 'playbooks', sel = null, open = false;
const css = document.createElement('style');
css.textContent = `.modal.pbm{width:min(1240px,100%);height:min(860px,calc(100% - 32px));gap:14px}
.pbm .pbh{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.pbm .pbh h2{font-size:30px;line-height:1}.pbm .pbsub{font:800 14px var(--sans);color:var(--muted)}
.pbm .tabs{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}.pbm .tabs button{font:800 13px var(--sans);border:2px solid var(--line);border-radius:999px;padding:3px 12px;background:var(--paper-2);color:var(--ink);cursor:pointer}
.pbm .tabs button.on{background:var(--ink);color:var(--paper)}
.pbm .pbgrid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;overflow:auto;align-content:start;padding:4px}
.pbm .pbc{border:3px solid var(--line);border-radius:14px;padding:12px 14px;background:var(--paper);display:flex;flex-direction:column;gap:4px;cursor:pointer;box-shadow:0 3px 0 var(--line);text-align:left;font:inherit;color:inherit}
.pbm .pbc:hover{background:#FFE9A8;outline:3px solid var(--gold);outline-offset:2px}
.pbm .pbc .t{display:flex;gap:8px;align-items:center;font:700 19px var(--display)}.pbm .dot{width:10px;height:10px;border-radius:50%;flex:none;border:2px solid var(--line)}
.pbm .pbc .m{font:800 13px var(--sans);color:#645B75}.pbm .pbc .u{font:900 14px var(--sans);color:#5B3FE0}.pbm .pbc .x{font:600 13px/1.4 var(--sans);color:var(--ink);max-height:5.6em;overflow:hidden}
.pbm .pbd{flex:1;min-height:0;border:3px solid var(--line);border-radius:16px;padding:18px 22px;background:#fff;display:flex;flex-direction:column;gap:14px;overflow:auto}
.pbm .pbd .hd{display:flex;gap:10px;align-items:center}.pbm .pbd .hd h3{margin:0;font:700 28px var(--display)}
.pbm .step{display:grid;grid-template-columns:34px 1fr;gap:12px;align-items:start}.pbm .step .n{width:34px;height:34px;border-radius:50%;background:var(--ink);color:var(--paper);display:grid;place-items:center;font:700 17px var(--display)}
.pbm .step .a{font:900 18px/1.35 var(--sans)}.pbm .step .s{font:800 13px var(--sans);color:#7C5CFF}
.pbm .who{margin-top:auto;border-top:3px dashed #E4DBCB;padding-top:12px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.pbm .who .av{width:40px;height:40px;font-size:17px;margin-left:-8px}.pbm .who .av:first-child{margin-left:0}
.pbm .empty{color:var(--muted);font-weight:700;padding:10px}`;
document.head.appendChild(css);
const ago = at => { if (!at) return ''; const d = (Date.now() - at)/1000; return d < 90 ? 'just now' : d < 3600 ? `${Math.round(d/60)} min ago` : d < 86400 ? `${Math.round(d/3600)}h ago` : new Date(at).toLocaleDateString(undefined, {day:'numeric', month:'short'}); };
const dateOf = p => p.updated ? new Date(p.updated + 'T12:00').toLocaleDateString(undefined, {day:'numeric', month:'short'}) : ago(p.at);
const usersOf = slug => (use[slug] || []).slice().sort((a, b) => b.at - a.at);
const usedBy = n => `Used by ${n} worker${n === 1 ? '' : 's'}`;
const colOf = slug => TEAM[Object.keys(TEAM).find(k => slug.includes(k))] || '#7C5CFF';
const av = u => `<span class="av" title="${esc(u.name)}" style="background:${ROLE_COL[u.role] || '#4F8DF5'}">${esc((u.name || '?')[0])}</span>`;
function card(p){
  const n = usersOf(p.slug).length;
  return `<button class="pbc" data-pm="pb" data-slug="${esc(p.slug)}"><div class="t"><span class="dot" style="background:${colOf(p.slug)}"></span>${esc(p.title)}</div>
    <div class="m">${p.steps.length} steps${p.learnedFrom ? ` · learned from ${esc(p.learnedFrom)}` : ''} · updated ${esc(dateOf(p))}</div><div class="u">${usedBy(n)}</div></button>`;
}
const page = p => `<div class="pbc" style="cursor:default"><div class="t"><span class="dot" style="background:${T.KIND_COLOR[{decisions:'decision', people:'person', lessons:'lesson'}[tab]] || '#ccc'}"></span>${esc(p.title)}</div>
  <div class="m">${esc(p.slug)} · ${esc(ago(p.at))}</div><div class="x">${esc(p.text.replace(/\[\[([^\]|]+)\]\]/g, (_, s) => s.split('/').pop().replace(/-/g, ' ')))}</div></div>`;
function detail(p){
  const us = usersOf(p.slug), last = us[0];
  return `<div class="pbd"><div class="hd"><button class="btn sm" data-pm="back">← Back</button><h3>${esc(p.title)}</h3><span class="chip" style="margin-left:auto;background:#EEE8FF;font-size:13px">Writes itself · ${esc(dateOf(p))}</span></div>
    ${p.steps.map((s, i) => `<div class="step"><span class="n">${i + 1}</span><div><div class="a">${esc(s.text || '')}</div><div class="s">${esc(s.source || '')}</div></div></div>`).join('') || '<div class="empty">No steps recorded yet.</div>'}
    <div class="who"><label style="font-size:14px">${usedBy(us.length)}</label><span style="display:flex">${us.map(av).join('')}</span>
      ${last ? `<span style="margin-left:auto;font:800 14px var(--sans);color:#645B75">last used ${esc(ago(last.at))} by ${esc(last.name)}</span>` : ''}</div></div>`;
}
function rules(){
  return `<div style="flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px"><div class="role" id="brain-status"></div><div class="chat" id="brain-chat"></div>
    <label for="brain-in">Teach everyone, or ask a question</label><textarea id="brain-in" rows="2" placeholder="Always add a screenshot of every screen you touch"></textarea>
    <div class="row"><button class="btn gold" data-act="teach">Teach everyone</button><button class="btn" data-act="askBrain">Ask the brain</button></div><p class="err" id="err" hidden></p>
    <label>Standing rules</label><ul class="rules" id="brain-rules"></ul><label>Studio brain · GBrain pages</label><ul class="wall" id="brain-wall"></ul></div>`;
}
function render(){
  const md = $('#modal'); if (!open || $('#scrim').hidden || !md.classList.contains('pbm')){ open = false; return; }
  const pbs = M?.playbooks || [], p = sel && pbs.find(x => x.slug === sel);
  let body;
  if (!M) body = '<div class="empty">Reading GBrain…</div>';
  else if (tab === 'rules') body = rules();
  else if (tab === 'playbooks') body = p ? detail(p) : `<div class="pbgrid">${pbs.map(card).join('') || '<div class="empty">No playbooks in GBrain yet.</div>'}</div>`;
  else body = `<div class="pbgrid">${(M[tab] || []).map(page).join('') || '<div class="empty">Nothing here yet.</div>'}</div>`;
  rendering = true;
  md.innerHTML = `<div class="pbh"><svg width="38" height="38" viewBox="0 0 24 24" fill="#FF6FB5" stroke="#2A2536" stroke-width="1.6"><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/></svg>
    <div><h2>Company memory</h2><div class="pbsub">GBrain · ${(M?.pages || 0).toLocaleString()} pages · ${pbs.length} playbooks</div></div>
    <div class="tabs">${['playbooks', 'decisions', 'people', 'lessons', 'rules'].map(k => `<button class="${k === tab ? 'on' : ''}" data-pm="tab" data-tab="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}<button data-pm="close" aria-label="Close">✕</button></div></div>${body}`;
  if (tab === 'rules') T.brainRules();
  rendering = false;
}
function openMemory(){
  rendering = true; T.openModal(''); rendering = false; $('#modal').classList.add('pbm'); open = true; sel = null; render(); T.send({type:'memory'});
}
T.openMemory = openMemory;
T.memory = () => ({M, use, tab, sel});
T.memoryShow = (t, s) => { tab = t || tab; sel = s || null; render(); };
document.addEventListener('click', e => {
  const b = e.target.closest('[data-pm]'); if (!b || !open) return;
  const k = b.dataset.pm;
  if (k === 'tab'){ tab = b.dataset.tab; sel = null; render(); }
  else if (k === 'pb'){ sel = b.dataset.slug; render(); }
  else if (k === 'back'){ sel = null; render(); }
  else if (k === 'close') T.closeModal();
});
new MutationObserver(() => { if ($('#scrim').hidden) open = false; }).observe($('#scrim'), {attributes:true});
new MutationObserver(() => { if (!$('#modal > .pbh')){ $('#modal').classList.remove('pbm'); open = false; } }).observe($('#modal'), {childList:true});
T.on('state', m => { if (m.playbookUse) use = m.playbookUse; });
T.on('memory', m => { M = m; use = m.use || use; render(); });
T.on('playbookUse', m => { use = m.use || {}; if (open && tab === 'playbooks') render(); });
T.on('node', m => { if (open && /^(playbooks|decisions|people|lessons)\//.test(m.node?.slug || '')) T.send({type:'memory'}); });
})();
