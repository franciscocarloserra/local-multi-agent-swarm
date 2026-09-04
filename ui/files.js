// Treemap: area = file size (chars ≈ tokens*4), color = growth in the last GROW_S seconds (grey → orange → red).
import {S, $, on, esc, tm, api, short, selectFile} from './state.js';
const GROW_S = 30, FADE_S = 2; let files = [], key = '', curFile = null, lastFetch = 0;
on('tick', async () => { if (Date.now() - lastFetch < 1000) return; lastFetch = Date.now(); files = await api.get('files').catch(() => []); render(); });
on('exp', () => { curFile = null; key = ''; });
$('treemap').onclick = e => { const p = e.target.closest('[data-p]')?.dataset.p; if (p) { curFile = curFile == p ? null : p; selectFile(curFile); key = ''; render(); } };
on('select', () => { if (S.selFile != curFile) curFile = S.selFile; key = ''; render(); });

function growth(path) { const now = Date.now() / 1000; return S.evs.filter(e => e.ev == 'fs' && e.op == 'WRITE' && e.file == path && now - e.t < GROW_S).reduce((s, e) => s + (e.size || 0), 0); }
// stable: dark slate-green; being written: deepens into a darker saturated green proportionally to growth (white text stays readable)
function color(g, size) { const r = Math.min(1, g / Math.max(size, 1)); return r == 0 ? '#1d2622' : `hsl(150,${30 + 35 * r}%,${14 + 10 * r}%)`; }
function layout(items, x, y, w, h, out) { // slice & dice alternating by aspect
  if (!items.length) return; const tot = items.reduce((s, f) => s + f.size, 0) || 1;
  if (items.length == 1) return out.push({...items[0], x, y, w, h});
  let acc = 0, i = 0; for (; i < items.length - 1 && acc < tot / 2; i++) acc += items[i].size; const a = items.slice(0, i || 1), b = items.slice(i || 1), fa = a.reduce((s, f) => s + f.size, 0) / tot;
  if (w > h) { layout(a, x, y, w * fa, h, out); layout(b, x + w * fa, y, w * (1 - fa), h, out); } else { layout(a, x, y, w, h * fa, out); layout(b, x, y + h * fa, w, h * (1 - fa), out); }
}
async function render() {
  const el = $('treemap'), W = el.clientWidth, H = el.clientHeight, boxes = [];
  layout(files.map(f => ({...f, size: Math.max(f.size, 1)})).sort((a, b) => b.size - a.size), 0, 0, W, H, boxes);
  const k = JSON.stringify([boxes, curFile, S.sel, S.evs.length]); if (k == key) return; key = k;
  const mine = S.sel && S.A[S.sel]?.files ? S.A[S.sel].files : null, now = Date.now() / 1000;
  el.innerHTML = boxes.map(b => { const g = growth(b.path), meta = S.files[b.path] || {writers: {}, readers: {}}, w = Object.keys(meta.writers).map(short), r = Object.keys(meta.readers).map(short);
    return `<div data-p="${esc(b.path)}" class="${curFile == b.path ? 'sel' : ''} ${mine ? (mine[b.path] ? 'mine' : 'dim') : ''} ${meta.first && now - meta.first < FADE_S ? 'new' : ''} ${g ? 'hot' : ''}" title="${esc(b.path)} · ${b.size} chars ≈ ${Math.round(b.size / 4)} tok${g ? ` · +${g} in ${GROW_S}s` : ''}\nwritten by ${w.join(', ') || '-'}\nread by ${r.join(', ') || '-'}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:${color(g, b.size)}"><b>${esc(b.path)}</b> ${Math.round(b.size / 4)} tok${g ? ` ▲${g}` : ''}<small>✍ ${esc(w.join(', ') || '-')}</small><small>👁 ${esc(r.join(', ') || '-')}</small></div>`; }).join('') || '<span class="muted">(empty work dir)</span>';
  const log = S.evs.filter(e => e.ev == 'fs' && (!curFile || e.file == curFile) && (!S.sel || S.sel.startsWith('__') || e.agent == S.sel)).slice(-40).reverse()
    .map(e => `<div class="ev fs ${now - e.t < FADE_S ? 'new' : ''}"><b>${e.op}</b> ${esc(e.file)} <span class="muted">${esc(short(e.agent))} · ${esc((S.A[e.agent]?.status || '').slice(0, 60))} · ${tm(e.t)}${e.size ? ' ' + e.size + 'c' : ''}</span></div>`).join('');
  $('fslog').innerHTML = log;
}
