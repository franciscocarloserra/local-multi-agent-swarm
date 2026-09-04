import {S, $, on, esc, short, api} from './state.js';
let last = 0;
on('tick', async () => { if (Date.now() - last < 1000) return; last = Date.now(); const r = await api.get('runtime').catch(() => null); if (r) render(r); });
const bar = (v, t, label, unit = '') => `<div class="kv"><span>${label}</span><div class="bar"><i style="width:${Math.round(100 * v / t)}%"></i></div><span>${v}/${t}${unit}</span></div>`;
function render(r) {
  const busy = r.slots ? r.slots.filter(s => s.busy).length : 0;
  const n = r.slots?.length ?? 0, kv = (l, mid, v) => `<div class="kv"><span>${l}</span><span class="txt">${mid}</span><span>${v}</span></div>`;
  $('rt').innerHTML = kv('Loop', r.running ? (r.paused ? '🟡 paused' : '🟢 running') : '⚪ idle', `${r.steps} steps`)
    + (r.gpu ? bar(r.gpu.mem_used, r.gpu.mem_total, 'VRAM', ' MiB') + bar(r.gpu.util, 100, 'GPU', '%') : kv('GPU', 'n/a', ''))
    + (n ? `<div class="kv"><span>Slots</span><div class="slots">${r.slots.map(s => `<span class="${s.busy ? 'busy' : ''}" title="slot ${s.id} ctx ${s.n_ctx}"></span>`).join('')}</div><span>${busy}/${n} busy</span></div>` : kv('Slots', esc(r.slots_error || ''), ''))
    + `<table><tr><th style="width:40%">agent</th><th>state</th><th>inbox</th><th>steps</th><th>tokens</th></tr>${r.agents.map(a => `<tr><td title="${esc(a.name)}">${esc(short(a.name))}</td><td>${a.alive ? (a.waiting ? '🟡 waiting' : '🔵 alive') : '⚫ ended'}</td><td>${a.inbox}</td><td>${a.nsteps}</td><td>${a.used}</td></tr>`).join('')}</table>`;
}
