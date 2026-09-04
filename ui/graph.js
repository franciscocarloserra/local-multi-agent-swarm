import {S, $, on, esc, cap, select, sc, scp} from './state.js';
const W = 340, H = 108, GX = 80, GY = 14, PAD = 84, EPAD = 16, FADE_S = 2, CLUSTER_GAP = 1.1;   // extra rows between sibling subtrees that have their own children   // emoji column at the left (EPAD), text starts at PAD   // tree grows left→right: x = depth, y = row
let view = {x: 0, y: 0, k: 1}, fitted = false, lastW = 0, drag = null, moved = false, lastSvg = '';
const tf = () => $('vp').setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);

$('svg').addEventListener('click', e => { if (moved) return; const g = e.target.closest('.node,.chan'); if (g?.dataset.n) { lastSvg = ''; select(g.dataset.n); draw(); } });
$('graph').onmousedown = e => { drag = {x: e.clientX - view.x, y: e.clientY - view.y, sx: e.clientX, sy: e.clientY}; moved = false; };
window.addEventListener('mousemove', e => { if (!drag) return; if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) moved = true; view.x = e.clientX - drag.x; view.y = e.clientY - drag.y; tf(); });
window.addEventListener('mouseup', () => drag = null); document.addEventListener('mouseleave', () => drag = null);
$('graph').onwheel = e => { e.preventDefault(); const r = $('graph').getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = e.deltaY < 0 ? 1.1 : 1 / 1.1; view.x = mx - (mx - view.x) * f; view.y = my - (my - view.y) * f; view.k *= f; tf(); };
on('fit', () => { fitted = false; draw(); }); on('tick', draw); on('exp', () => { fitted = false; lastSvg = ''; });

function draw() {
  const A = S.A, pos = {}; let row = 0;
  const layout = n => { const kids = A[n].children.filter(c => A[c]); if (!kids.length) { pos[n] = {x: A[n].depth, y: row++}; return pos[n].y; }
    const ys = seq(kids); pos[n] = {x: A[n].depth, y: (ys[0] + ys[ys.length - 1]) / 2}; return pos[n].y; };
  const has = n => A[n].children.some(c => A[c]);
  const seq = ns => ns.map((c, i) => { if (i && (has(c) || has(ns[i - 1]))) row += CLUSTER_GAP; return layout(c); });   // clusters (subtrees) get breathing room, leaves stay packed
  const roots = Object.keys(A).filter(n => !A[n].parent || !A[A[n].parent]); seq(roots);
  const ry = roots.map(n => pos[n].y), cy = ry.length ? (ry[0] + ry[ry.length - 1]) / 2 : 0; pos.__loop = {x: -1, y: cy - 0.5}; pos.__sup = {x: -1, y: cy + 0.5};   // loop and supervisor stacked tightly, centered on the roots
  const px = p => GX / 2 + (p.x + 1) * (W + GX) + W / 2, py = p => GY + p.y * (H + GY) + H / 2;
  const line = (q, p, cls) => `<path class="${cls}" d="M${px(q) + W / 2},${py(q)} C${px(q) + W / 2 + GX / 2},${py(q)} ${px(p) - W / 2 - GX / 2},${py(p)} ${px(p) - W / 2},${py(p)}"/>`;
  // message channels: one per unordered pair. Parent↔child traffic rides on the tree edge (badge = count); other pairs get a pink curve.
  const chan = {}; for (const [f, t] of S.sends) { const k = [f, t].sort().join('>'); chan[k] = (chan[k] || 0) + 1; }
  const badge = (x, y, n, id) => `<g class="chan ${S.sel == id ? 'sel' : ''}" data-n="${esc(id)}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="11"/><text x="${x}" y="${y + 4}" text-anchor="middle">${n}</text></g>`;
  let s = '';
  for (const n in A) { const a = A[n]; if (!pos[n]) continue; const par = a.parent && pos[a.parent] ? a.parent : '__loop', k = [par == '__loop' ? 'user' : par, n].sort().join('>'), id = 'edge:' + k;
    s += `<g class="${chan[k] ? 'chan' : ''} ${S.sel == id ? 'sel' : ''}" data-n="${chan[k] ? esc(id) : ''}" style="${chan[k] ? 'cursor:pointer' : ''}">${chan[k] ? line(pos[par], pos[n], 'hit') : ''}${line(pos[par], pos[n], 'edge' + (a.state == 'dead' ? ' dead' : ''))}</g>`;
    if (chan[k]) { s += badge((px(pos[par]) + px(pos[n])) / 2, (py(pos[par]) + py(pos[n])) / 2, chan[k], id); delete chan[k]; } }
  for (const k in chan) { const [f, t] = k.split('>'), a = pos[f] || (f == 'user' ? pos.__loop : null), b = pos[t] || (t == 'user' ? pos.__loop : null); if (!a || !b || a == b) continue;
    const x1 = px(a), y1 = py(a), x2 = px(b), y2 = py(b), mx = (x1 + x2) / 2 + (y2 - y1) * 0.25, my = (y1 + y2) / 2 - (x2 - x1) * 0.25, id = 'edge:' + k;
    s += `<g class="chan ${S.sel == id ? 'sel' : ''}" data-n="${esc(id)}" style="cursor:pointer"><path class="hit" d="M${x1},${y1} Q${mx},${my} ${x2},${y2}"/><path class="send" d="M${x1},${y1} Q${mx},${my} ${x2},${y2}"/></g>` + badge((x1 + 2 * mx + x2) / 4, (y1 + 2 * my + y2) / 4, chan[k], id); }
  const now = Date.now() / 1000; const card = (n, cls, emoji, title, l2, l3) => `<g class="node ${cls} ${S.sel == n ? 'sel' : ''} ${S.A[n] && now - S.A[n].t < FADE_S ? 'new' : ''}" data-n="${esc(n)}" transform="translate(${px(pos[n]) - W / 2},${py(pos[n]) - H / 2})" style="cursor:pointer"><rect width="${W}" height="${H}" rx="10" ry="10"/><text class="emoji" x="${EPAD}" y="70">${emoji}</text><text class="title" x="${PAD}" y="34">${esc(title)}</text>${l2}<text class="st" x="${PAD}" y="88">${esc(l3).slice(0, 30)}</text></g>`;
  s += card('__loop', 'loop', '🤖', 'Control loop', `<text class="st" x="${PAD}" y="61">${S.run.topology || ''} · ${S.steps} steps · ${S.running ? 'running' : 'idle'}</text>`, `depth ${S.depth} · width ${S.width} · fan-out ${S.fanout}`);
  if (S.run.cfg?.supervisor ?? S.cfg?.supervisor) { const vs = Object.values(S.verdicts), worst = vs.filter(v => (v.stuck ?? 0) >= 7 || (v.drift ?? 0) >= 7).length;
    s += card('__sup', 'loop', '🔭', 'Supervisor', `<text class="st" x="${PAD}" y="61">${vs.length} verdicts · ${worst} flagged</text>`, `every ${(S.run.cfg || S.cfg).supervise_every} steps · nudge ≥${(S.run.cfg || S.cfg).supervisor_nudge_stuck}`); }
  const touch = S.selFile ? new Set([...Object.keys(S.files[S.selFile]?.writers || {}), ...Object.keys(S.files[S.selFile]?.readers || {})]) : null;
  for (const n in A) { const a = A[n], l = a.last || {}, v = a.verdict; if (!pos[n]) continue; const act = S.active == n, st = act ? 'THINKING' : a.state.toUpperCase() + (a.reason ? ' · ' + a.reason : '');
    const nf = Object.keys(a.files || {}).length, c = S.run.cfg || S.cfg || {}, flagged = v && ((v.stuck ?? 0) >= (c.supervisor_nudge_stuck ?? 7) || (v.drift ?? 0) >= (c.supervisor_nudge_drift ?? 7)), badges = flagged ? `<text class="flag" x="${W - 40}" y="88">⚑</text>` : '';
    s += card(n, `${a.state} ${a.by == 'user' ? 'user' : ''} ${act ? 'active' : ''} ${touch && !touch.has(n) ? 'dim' : ''} ${touch?.has(n) ? 'related' : ''}`, a.emoji || '', cap(n.split('/').pop()),
      `<text class="state s-${act ? 'active' : a.state}" x="${PAD}" y="61">${st}</text><text class="st" x="${PAD + 12 + 10 * st.length}" y="61">×${a.steps}</text>` + badges, a.status || a.task); }
  const mx = Math.max(0, ...Object.values(pos).map(p => p.x)), my = Math.max(0, ...Object.values(pos).map(p => p.y));
  const cw = GX + (mx + 2) * (W + GX), ch = GY + (my + 2) * (H + GY);
  if (!fitted || cw != lastW) { const gw = $('graph').clientWidth, gh = $('graph').clientHeight; view.k = Math.min(1, gw / cw, gh / ch); view.x = (gw - cw * view.k) / 2; view.y = 10; fitted = true; lastW = cw; }
  if (s != lastSvg && !drag) { $('vp').innerHTML = s; lastSvg = s; } tf();
}
