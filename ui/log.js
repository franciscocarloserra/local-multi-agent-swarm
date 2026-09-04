import {S, $, on, esc, short, cap} from './state.js';
const TYPES = ['spawn', 'kill', 'refused', 'done', 'validate', 'revive', 'resume', 'pause', 'continue', 'send', 'reply', 'fs', 'verdict', 'status', 'heartbeat', 'error', 'info', 'step', 'think', 'run', 'end'];
export const LABEL = {spawn: ['Spawned', '🤖'], kill: ['Killed', '⛔'], refused: ['Refused', '🚫'], done: ['Done', '✅'], validate: ['Validated', '⚖️'], revive: ['Revived', '♻️'], resume: ['Resumed', '⏯'], pause: ['Paused', '⏸'], continue: ['Continued', '▶️'], send: ['Message', '✉️'], reply: ['Reply', '💬'], fs: ['File', '📄'], verdict: ['Verdict', '🔭'],
  status: ['Status', '💬'], heartbeat: ['Heartbeat', '💓'], error: ['Error', '❗'], info: ['Info', 'ℹ️'], step: ['Step', '🧠'], think: ['Thinking', '⏳'], run: ['Started', '🎯'], end: ['Finished', '🏁']};
const FSL = {WRITE: ['Wrote', '📝'], READ: ['Read', '👁'], LS: ['Listed', '📂'], RUN: ['Ran', '🖥']};
const FILT = Object.fromEntries(TYPES.map(t => [t, !['step', 'think', 'status'].includes(t)]));
let seen = -1;
$('filters').innerHTML = TYPES.map(t => `<label class="${FILT[t] ? 'on' : ''}" data-t="${t}">${LABEL[t][1]} ${LABEL[t][0]}</label>`).join('');
$('filters').onclick = e => { const t = e.target.dataset.t; if (!t) return; FILT[t] = !FILT[t]; e.target.classList.toggle('on'); seen = -1; render(); };
$('q').oninput = () => { seen = -1; render(); };
on('tick', render); on('exp', () => seen = -1);
function render() {
  if (S.evs.length == seen) return; seen = S.evs.length; const q = $('q').value.toLowerCase(), now = Date.now() / 1000, FADE_S = 2;
  $('log').innerHTML = S.evs.map((e, i) => [e, i + 1]).filter(([e]) => FILT[e.ev] !== false && (!q || JSON.stringify(e).toLowerCase().includes(q))).slice(-300).map(([e, i]) => {
    const body = e.ev == 'validate' ? `${e.accepted ? 'accepted' : 'rejected'} ${e.n} · ${e.feedback || ''}${e.forced ? ' · forced after max_validations' : ''}` : e.ev == 'verdict' ? `drift ${e.drift} · stuck ${e.stuck} · progress ${e.progress} · ${e.note || ''}` : e.file ? e.file : (e.reason && e.ev == 'refused' ? e.reason + ' · ' : '') + (e.msg || e.result || e.task || e.out || '');
    let [name, ico] = e.ev == 'fs' ? FSL[e.op] || LABEL.fs : LABEL[e.ev] || [e.ev, '•']; if (e.ev == 'kill' && e.reason) name = cap(e.reason.split(/\s/)[0]); if (e.ev == 'validate') [name, ico] = e.accepted ? ['Accepted', '⚖️'] : ['Rejected', '⚖️'];
    const who = e.agent == 'user' ? 'USER' : short(e.agent || '') + (e.to ? ' → ' + short(e.to) : '');
    return `<details class="ev ${e.ev} ${e.by == 'user' || e.agent == 'user' ? 'user' : ''} ${now - e.t < FADE_S ? 'new' : ''}"><summary><span class="n">${i}</span><span>${ico}</span><b>${name}</b><span>${esc(who)}</span><span class="d">${esc(body)}</span></summary><div class="full">${esc(body)}</div></details>`; }).join('');
  $('logbox').scrollTop = $('logbox').scrollHeight;
}
