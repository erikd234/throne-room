// Multiplayer: a second throne for the teammate online, name signs, join banner, "Hand to X" in the chat drawer, hand-off fx.
(() => {
  const T = window.__throne; if (!T) return;
  const { iso, rr, box, esc, send, byId, DESKS, seatOf, sprites, say, goTo, $ } = T;
  const BT = {x:5.25, y:.65}, SEAT = {x:BT.x + 1.05, y:BT.y + 1.05}, INK = {erik:'#7B2D5A'};
  const bspot = i => ({x:BT.x + 1.1 + i*.9, y:BT.y + 2.9 + i*.5});
  const ink = b => INK[b.id] || b.color || '#1F9E97';
  const shade = (hex, f) => '#' + hex.slice(1).match(/../g).map(h => Math.round(parseInt(h, 16)*f).toString(16).padStart(2, '0')).join('');
  let popT = null, pulses = [];
  const cs = T.cohostSprite;

  const css = document.createElement('style');
  css.textContent = `.mp-banner{position:absolute;right:20px;top:14px;display:flex;gap:12px;align-items:center;padding:10px 18px;z-index:6;border:2px solid #1F9E97;background:#EFFBFA;animation:mpIn .35s cubic-bezier(.3,1.6,.6,1)}
.mp-banner .av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;font:700 15px Fredoka,sans-serif;border:2px solid #fff;box-shadow:0 0 0 2px #2A2536}
.mp-banner b{font:700 19px Fredoka,sans-serif;display:block}.mp-banner small{font-weight:800;color:#4A4458}
@keyframes mpIn{from{transform:translateY(-14px) scale(.8);opacity:0}}`;
  document.head.appendChild(css);
  let bannerTimer;
  function banner(html, secs = 5){
    let el = $('.mp-banner'); if (!el){ el = document.createElement('div'); el.className = 'card mp-banner'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = html; el.hidden = false; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => el.hidden = true, secs*1000);
  }
  const av = b => `<span class="av" style="background:${b.color || '#888'}">${esc((b.name || '?')[0])}</span>`;

  T.on('presence', m => {
    if (!m.joined || m.joined.id === T.me.id) return;
    const b = m.joined;
    banner(`${av(b)}<span><b>${esc(b.name)} joined the studio</b><small>Same QM org · same line · same GBrain</small></span>`, 6);
    setTimeout(() => { $('#toast').hidden = true; }, 0);
  });
  T.on('handoff', m => {
    const names = m.names || [];
    banner(`${av(m.from)}<b>handed</b>${m.ids.map((id, i) => av({name:names[i], color:'#5B8DEF'})).join('')}<b>to</b>${av(m.to)}<b>${esc(m.to.name.split(' ')[0])}</b>`, 5);
    for (const id of m.ids){
      const sp = sprites.get(id); if (sp) say(sp, `Now reporting to ${m.to.name.split(' ')[0]}`, 4.5);
      pulses.push({id, color:m.to.color, t:0});
    }
  });

  // "Hand to <teammate>" in the chat drawer.
  const acts = $('#dactions');
  const addHand = () => {
    const w = T.peek != null && byId(T.peek), mate = T.bosses.find(b => b.id !== T.me.id);
    if (!w || !mate || w.leaving || (w.owner && w.owner !== T.me.id) || acts.querySelector('[data-mp-hand]')) return;
    const b = document.createElement('button');
    b.className = 'btn sm'; b.dataset.mpHand = mate.id; b.style.cssText = `border-color:${mate.color};color:${shade(mate.color, .7)}`;
    b.textContent = `Hand to ${mate.name.split(' ')[0]}`;
    b.onclick = () => { send({type:'handOff', ids:[w.id], to:mate.id}); b.disabled = true; };
    acts.appendChild(b);
  };
  if (acts) new MutationObserver(addHand).observe(acts, {childList:true});
  T.on('presence', () => setTimeout(() => T.renderPeek(true), 0));

  function drawSign(b, x, y, k){
    const p = iso(x, y, 150*k), g = T.ctx;
    g.save(); g.translate(p.x, p.y); g.scale(k, k);
    g.fillStyle = '#FFFCF6'; g.strokeStyle = '#2A2536'; g.lineWidth = 3; rr(-52, -22, 104, 40, 12); g.fill(); g.stroke();
    g.fillStyle = ink(b); g.font = '700 24px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.name.split(' ')[0].toUpperCase(), 0, 0);
    g.restore();
  }
  function drawMateThrone(b, k){
    const c = b.color || '#1F9E97', d1 = shade(c, .8), d2 = shade(c, .66), d3 = shade(c, .5), x = BT.x, y = BT.y, h = v => v*k;
    box(x - .2, y - .1, 2.6, 2.6, h(10), 0, d1, d2, d2, d3);
    box(x + .5, y + .5, 1.1, 1.1, h(14), h(10), c, d2, d2);
    box(x + .35, y + .35, 1.4, .26, h(58), h(10), '#D8E2EA', '#AFBCC7', '#AFBCC7');
    box(x + .35, y + .35, .26, 1.4, h(58), h(10), '#D8E2EA', '#AFBCC7', '#AFBCC7');
    box(x + .55, y + .55, 1.0, .1, h(46), h(18), c, c, d2);
    box(x + .55, y + .55, .1, 1.0, h(46), h(18), c, d2, c);
  }
  const ease = t => { const s = 1.70158; t -= 1; return t*t*((s + 1)*t + s) + 1; };

  T.onItems(items => {
    const mate = T.cohost;
    if (!mate){ popT = null; return; }
    if (popT == null) popT = T.simT;
    const k = Math.max(.01, ease(Math.min(1, (T.simT - popT)/.6)));
    items.push({k:BT.x + BT.y + 1.2, f:() => drawMateThrone(mate, k)});
  });

  // Teammate walks in and sits; their line waits at their throne.
  T.onDraw(() => {
    const mate = T.cohost;
    if (!mate || !cs.here){ cs._seat = false; return; }
    if (!cs._seat){ cs._seat = true; cs.sitting = false; goTo(cs, SEAT, () => { cs.sitting = true; cs.z = 22; cs.fx = 1; cs.fy = 1; say(cs, 'Hey team!', 2.2); }); }
    const L = T.lineOrder().filter(sp => sp.srv && sp.srv.owner === mate.id && T.LINE_PHASES.has(sp.srv.phase));
    L.forEach((sp, i) => {
      if (sp.special && sp.special !== 'mate') return;
      if (sp.special === 'mate' && sp._mi === i) return;
      sp.special = 'mate'; sp._mi = i; sp.sitting = false; sp.target = 'mate' + i;
      goTo(sp, bspot(i), () => { sp.fx = -1; sp.fy = -1; sp.arrived = true; });
    });
    for (const sp of sprites.values()) if (sp.special === 'mate' && !L.includes(sp)){ sp.special = null; sp.target = null; sp._mi = null; }
  });
  T.onDrawTop(rdt => {
    const g = T.ctx, mate = T.cohost;
    if (mate){ const k = Math.max(.01, ease(Math.min(1, (T.simT - popT)/.6))); drawSign(T.me, 1.9, 1.9, k); drawSign(mate, BT.x + .9, BT.y + .9, k);
      const s2 = (T.simT - popT)/1.1; if (s2 > 0 && s2 < 1){ const c = iso(BT.x + 1, BT.y + 1, 20); g.strokeStyle = `rgba(53,224,255,${1 - s2})`; g.lineWidth = 5; g.beginPath(); g.ellipse(c.x, c.y, 60 + 120*s2, 30 + 60*s2, 0, 0, 7); g.stroke(); } }
    // Owner-color rings on handed-off desks; a bright pulse right after the hand-off.
    for (const w of T.state().workers || []){
      if (!w.handoffs || !w.handoffs.length || w.desk == null || !DESKS[w.desk]) continue;
      const b = T.bosses.find(x => x.id === w.owner) || (w.owner === T.me.id ? T.me : null), col = b?.color || '#1F9E97';
      const s = seatOf(DESKS[w.desk]), c = iso(s.x, s.y, 0);
      const pl = pulses.find(p => p.id === w.id);
      g.save(); g.strokeStyle = col;
      if (pl){ pl.t += rdt; const a = Math.min(1, pl.t/.3), f = 1 + .25*Math.sin(pl.t*6)*Math.max(0, 1 - pl.t/4); g.globalAlpha = .95; g.lineWidth = 5; g.beginPath(); g.ellipse(c.x, c.y, 36*a*f, 18*a*f, 0, 0, 7); g.stroke(); if (pl.t > 4) pulses.splice(pulses.indexOf(pl), 1); }
      else { g.globalAlpha = .45; g.lineWidth = 2.5; g.beginPath(); g.ellipse(c.x, c.y, 32, 16, 0, 0, 7); g.stroke(); }
      g.restore();
    }
  });
})();
