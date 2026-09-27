// Areas: tinted floor zones around each area's desks, a signpost, and "+ New area" (shots 02, 14a, 14b).
(() => {
const T = window.__throne, { iso, poly, rr, esc, send, openModal, closeModal, DESKS, DESK_LIFT } = T;
const PALETTE = ['#2EAD6B', '#4F8DF5', '#E4506A', '#8C6BD9', '#F29D38', '#EE77AE', '#3AA0C9'];
let lastT = 0; const born = new Map(); // area id -> seconds since its areaCreated arrived (animations only run for live creations)
const hexA = (hex, a) => { const n = parseInt(String(hex || '#2EAD6B').slice(1), 16); return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a})`; };
const P = (t, a, b) => Math.max(0, Math.min(1, (t - a)/(b - a))), eout = k => 1 - (1 - k)**3;
const back = k => k <= 0 ? 0 : k >= 1 ? 1 : 1 + 2.7*(k - 1)**3 + 1.7*(k - 1)**2;
const areas = () => (T.state().areas || []);
const rectOf = ds => {
  const d = ds.map(i => DESKS[i]).filter(Boolean); if (!d.length) return null;
  return [Math.min(...d.map(q => q.x)) - .6, Math.min(...d.map(q => q.y)) - .5, Math.max(...d.map(q => q.x)) + 1.6, Math.max(...d.map(q => q.y)) + 1.7];
};
const quad = ([x0, y0, x1, y1]) => [iso(x0,y0), iso(x1,y0), iso(x1,y1), iso(x0,y1)];
// The ghost "+ New area" tile sits over the front desks nobody has claimed yet.
const ghostRect = () => { const used = new Set(areas().flatMap(a => a.desks || [])); return rectOf([14,15,16,17].filter(i => !used.has(i))); };

function drawZone(a, t){
  const r = rectOf(a.desks || []); if (!r) return;
  const k = t == null ? 1 : eout(P(t, 0, .7)), ctx = T.ctx, pts = quad(r);
  poly(pts, hexA(a.color, .2*k + (t == null ? 0 : .25*Math.max(0, 1 - t/1.2)*k)));
  ctx.globalAlpha = k; ctx.setLineDash([9, 6]); poly(pts, null, hexA(a.color, .85), 2.5); ctx.setLineDash([]); ctx.globalAlpha = 1;
}
function drawSign(a, t){
  const r = rectOf(a.desks || []); if (!r) return;
  const k = t == null ? 1 : back(P(t, .35, .9)); if (k <= 0) return;
  const ctx = T.ctx, sx = r[0] + .35, sy = r[1] + .35, base = iso(sx, sy), top = iso(sx, sy, 64*k), b = iso(sx, sy, 80*k);
  ctx.strokeStyle = '#6B4A34'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
  ctx.save(); ctx.translate(b.x, b.y); ctx.scale(k, k);
  ctx.font = '700 17px Fredoka, sans-serif'; const w = ctx.measureText(a.name).width + 30;
  ctx.fillStyle = a.color || '#2EAD6B'; ctx.strokeStyle = '#2A2536'; ctx.lineWidth = 3; rr(-w/2, -17, w, 34, 9); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(a.name, 0, 1); ctx.textBaseline = 'alphabetic';
  ctx.restore();
}
function drawGhost(){
  const r = ghostRect(), btn = document.getElementById('area-new'); if (!r){ btn.hidden = true; return; }
  const ctx = T.ctx, pts = quad(r);
  poly(pts, 'rgba(255,255,255,.28)'); ctx.setLineDash([10, 7]); poly(pts, null, '#FFFFFF', 3); ctx.setLineDash([]);
  const c = iso((r[0] + r[2])/2, (r[1] + r[3])/2), m = ctx.getTransform(), dpr = devicePixelRatio || 1;
  btn.hidden = false; btn.style.left = (m.a*c.x + m.c*c.y + m.e)/dpr + 'px'; btn.style.top = (m.b*c.x + m.d*c.y + m.f)/dpr + 'px';
  btn.style.transform = `translate(-50%,-50%) scale(${Math.max(.6, Math.min(1.3, m.a/dpr))})`;
}
T.onDrawFloor(() => {
  const now = performance.now()/1000, dt = Math.min(.05, now - (lastT || now)); lastT = now;
  for (const [id, t] of born) born.set(id, t + dt);
  const list = areas();
  list.forEach(a => drawZone(a, born.get(a.id)));
  drawGhost();
  // desks drop in, one after another, once the zone has faded up
  for (const k in DESK_LIFT) delete DESK_LIFT[k];
  list.forEach(a => { const t = born.get(a.id); if (t == null) return; if (t > 3){ born.delete(a.id); return; }
    (a.desks || []).forEach((i, n) => { const q = P(t, .5 + n*.12, .95 + n*.12); if (q < 1) DESK_LIFT[i] = q <= 0 ? 160 : 160*(1 - q)**2 - Math.sin(q*Math.PI)*(q > .7 ? 6 : 0); }); });
});
T.onDraw(() => areas().forEach(a => drawSign(a, born.get(a.id))));
T.on('areaCreated', m => { if (m.area) born.set(m.area.id, 0); });

const st = document.createElement('style');
st.textContent = `#area-new{position:fixed;z-index:3;border:3px solid #2A2536;background:#FFFCF6;border-radius:24px;padding:8px 20px;font:700 20px Fredoka,sans-serif;color:#2A2536;cursor:pointer;white-space:nowrap}
#area-new:hover{background:#FFF3D6} .area-sw{display:flex;gap:8px;margin:8px 0 14px} .area-sw button{width:30px;height:30px;border-radius:50%;border:3px solid transparent;cursor:pointer}
.area-sw button[aria-pressed=true]{border-color:#2A2536} #area-name{width:100%;box-sizing:border-box;font:600 16px var(--sans,sans-serif);padding:8px 10px;border:2px solid #2A2536;border-radius:9px}`;
document.head.appendChild(st);
const btn = document.createElement('button'); btn.id = 'area-new'; btn.hidden = true; btn.textContent = '+ New area';
document.body.appendChild(btn);
btn.addEventListener('click', () => {
  let color = PALETTE[0];
  openModal(`<h2>New area</h2><label for="area-name">Name</label><input id="area-name" value="Finance" autofocus maxlength="32">
    <label>Color</label><div class="area-sw">${PALETTE.map(c => `<button type="button" data-c="${c}" style="background:${c}" aria-label="${c}" aria-pressed="${c === color}"></button>`).join('')}</div>
    <div class="row"><button class="btn" data-act="cancel">Cancel</button><button class="btn go" data-act="create">Create area</button></div>`);
  const m = document.getElementById('modal'), name = m.querySelector('#area-name'); name.select();
  m.querySelectorAll('.area-sw button').forEach(b => b.onclick = () => { color = b.dataset.c; m.querySelectorAll('.area-sw button').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  const go = () => { const n = name.value.trim(); if (!n) return name.focus(); send({type:'newArea', name:n, color}); closeModal(); };
  m.querySelector('[data-act=create]').onclick = go; m.querySelector('[data-act=cancel]').onclick = closeModal;
  name.onkeydown = e => { if (e.key === 'Enter') go(); };
});
})();
