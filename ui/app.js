import {S, $, on, emit, api, say, reduce, esc} from './state.js';
import './graph.js'; import './inspector.js'; import './log.js'; import './files.js'; import './runtime.js'; import './config.js'; import './sound.js';

async function loadExps() {
  const j = await (await fetch('experiments')).json();
  $('exp').innerHTML = j.list.map(e => `<option ${e.running ? 'style="color:#8f8"' : ''}>${e.name}</option>`).join('');
  if (!S.cur && j.list.length) S.cur = j.list[0].name;
  if (S.cur) { $('exp').value = S.cur; await loadCfg(); }
}
async function loadCfg() { S.cfg = await api.get('config'); $('goal').value = S.cfg.root_task;
  $('topo').innerHTML = Object.entries(S.cfg.topologies || {}).map(([k, v]) => `<option value="${k}" title="${JSON.stringify(v)}">${k}</option>`).join(''); $('topo').value = S.cfg.topology;
  $('engine').innerHTML = Object.entries(S.cfg.engines || {}).map(([k, v]) => `<option value="${k}" title="${esc(v.url)} ${esc(v.model || '')}">${k}${v.model ? ' · ' + v.model : ''}</option>`).join(''); $('engine').value = S.cfg.engine; emit('cfg'); }
$('exp').onchange = () => { S.cur = $('exp').value; S.sel = null; emit('exp'); loadCfg(); };
$('runb').onclick = async () => { emit('savecfg'); const r = await api.post('run', {goal: $('goal').value, topology: $('topo').value, engine: $('engine').value}); if (r.error) return say(r.error);
  if (r.exp != S.cur) { S.cur = r.exp; emit('exp'); say(`new run dir: ${r.exp}`); } S.sel = null; loadExps(); };
// splitters: three columns (gutA left|center, gutB center|right), rows inside left (gutL) and right (gutR)
const MIN_COL = 260, MIN_ROW = 120, cols = () => getComputedStyle(document.body).gridTemplateColumns.split(' ').map(parseFloat);
const gut = (id, apply) => { let on = false; $(id).onmousedown = e => { on = true; e.preventDefault(); };
  window.addEventListener('mousemove', e => on && apply(e)); window.addEventListener('mouseup', () => on = false); };
gut('gutA', e => { const c = cols(); document.body.style.gridTemplateColumns = `${Math.max(MIN_COL, e.clientX - 10)}px 1fr ${c[2]}px`; });
gut('gutB', e => { const c = cols(); document.body.style.gridTemplateColumns = `${c[0]}px 1fr ${Math.max(MIN_COL, innerWidth - e.clientX - 10)}px`; });
gut('gutL', e => { const r = $('left').getBoundingClientRect(); $('left').style.gridTemplateRows = `${Math.max(MIN_ROW, e.clientY - r.top)}px 1fr`; });
gut('gutR', e => { const r = $('right').getBoundingClientRect(); $('right').style.gridTemplateRows = `${Math.max(MIN_ROW, e.clientY - r.top)}px 1fr`; });
function placeGuts() { const L = $('left').getBoundingClientRect(), R = $('right').getBoundingClientRect(), C = $('center').getBoundingClientRect(), A = $('agentpane').getBoundingClientRect(), T = $('rtpane').getBoundingClientRect();
  Object.assign($('gutA').style, {left: C.left - 10 + 'px', top: L.top + 'px', bottom: '10px'});
  Object.assign($('gutB').style, {left: R.left - 10 + 'px', top: L.top + 'px', bottom: '10px'});
  Object.assign($('gutL').style, {left: L.left + 'px', width: L.width + 'px', top: A.bottom + 'px'});
  Object.assign($('gutR').style, {left: R.left + 'px', width: R.width + 'px', top: T.bottom + 'px'}); }
setInterval(placeGuts, 300);
$('pauseb').onclick = () => api.post('action', {op: 'pause'});
$('contb').onclick = async () => { const r = await api.post('action', {op: 'continue'}); if (r.error) say(r.error); };
$('fitb').onclick = () => emit('fit');

async function poll() {
  if (!S.cur) return;
  const txt = await (await fetch(`exp/${S.cur}/events.jsonl?${Date.now()}`)).text().catch(() => '');
  reduce(txt.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
  const alive = Object.values(S.A).filter(a => a.state == 'alive' || a.state == 'waiting').length;
  const kv = {state: S.running ? 'RUNNING' : 'idle', topology: S.run.topology || '-', engine: S.run.engine ? S.run.engine + (S.run.model ? ' · ' + S.run.model : '') : '-', slots: S.run.slots ? `${S.run.slots} × ${S.run.slot_ctx} tok` : '-', 'agent cap': S.run.max_agents ?? '-',
    agents: Object.keys(S.A).length, alive, depth: S.depth, width: S.width, 'fan-out': S.fanout, steps: S.steps};
  $('hdr').innerHTML = Object.entries(kv).map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
  $('pauseb').classList.toggle('on', S.running && !S.paused); $('contb').classList.toggle('on', S.evs.length > 0 && (!S.running || S.paused));
  emit('tick');
}
loadExps().then(() => setInterval(poll, S.cfg?.poll_ms || 500));
