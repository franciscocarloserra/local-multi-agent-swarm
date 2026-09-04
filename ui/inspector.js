import {S, $, on, esc, short, tm, api, say, sc, scp} from './state.js';
let chatKey = '';
on('select', render); on('tick', render); on('exp', () => { chatKey = ''; render(); });
// one input: send = whole text as message; spawn = first word is the child name, the rest its task
// messages to the control loop go to the root agent (the loop itself has no model)
const act = async op => { let sel = S.sel; if (sel == '__loop') sel = Object.keys(S.A).find(n => !S.A[n].parent); if (!sel || sel.startsWith('__') || sel.startsWith('edge:')) return; const v = $('a_task').value.trim(), [name, ...rest] = v.split(/\s+/);
  if (!v) return;
  if (op == 'spawn' && !name) return;
  const r = await api.post('action', {op, name: op == 'spawn' ? name : sel, parent: sel, task: rest.join(' ') || name, msg: v});
  if (r.error) return say(r.error); say(`sent to ${short(sel)} · answer arrives in the log and here`); $('a_task').value = ''; chatKey = ''; $('chat').insertAdjacentHTML('beforeend', `<div class="m user"><i>USER → ${esc(short(sel))} (sent)</i>${esc(v)}</div>`); $('chat').scrollTop = $('chat').scrollHeight; };
$('sendb').onclick = () => act('send'); $('spawnb').onclick = () => act('spawn'); $('killb').onclick = () => act('kill');
$('a_task').onkeydown = e => { if (e.key == 'Enter') act('send'); };

function human(e) { const me = e.agent == S.sel, t = `<i>${tm(e.t)}</i>`;
  switch (e.ev) {
    case 'spawn': return me ? '' : `<div class="act a-spawn">${t}<b>spawned</b> ${esc(short(e.agent))}: ${esc(e.task.slice(0, 140))}</div>`;
    case 'refused': return `<div class="act a-refused">${t}<b>spawn refused</b> ${esc(short(e.agent))} — ${esc(e.reason || '')}</div>`;
    case 'send': return e.agent == 'user' ? `<div class="act a-user">${t}<b>USER said</b> ${esc(e.msg)}</div>` : me ? `<div class="act a-send">${t}<b>sent to</b> ${esc(short(e.to))}: ${esc(e.msg.slice(0, 160))}</div>` : `<div class="act a-recv">${t}<b>received from</b> ${esc(short(e.agent))}: ${esc(e.msg.slice(0, 160))}</div>`;
    case 'fs': return `<div class="act a-fs">${t}<b>${{WRITE: 'wrote', READ: 'read', LS: 'listed', RUN: 'ran'}[e.op]}</b> ${esc(e.file)}${e.size ? ` (${e.size} chars)` : ''}</div>`;
    case 'done': return me ? `<div class="act a-done">${t}<b>finished</b> ${esc(e.result.slice(0, 200))}</div>` : `<div class="act a-done">${t}<b>child finished</b> ${esc(short(e.agent))}: ${esc(e.result.slice(0, 140))}</div>`;
    case 'kill': return `<div class="act a-kill">${t}<b>${me ? 'ended' : 'child ended'}</b> ${me ? '' : esc(short(e.agent)) + ' '}— ${esc(e.reason)} by ${esc(e.by)}</div>`;
    case 'status': return me ? `<div class="act a-status">${t}<b>status</b> ${esc(e.msg)}</div>` : '';
    case 'validate': return `<div class="act a-validate">${t}<b>validation ${e.accepted ? 'accepted' : 'rejected'}</b> ${e.n} — ${esc(e.feedback || '')}</div>`;
    case 'revive': return `<div class="act a-revive">${t}<b>revived</b> by ${esc(e.by)}, history intact</div>`;
    case 'reply': return `<div class="act a-reply">${t}<b>replied to USER</b> ${esc(e.msg)}</div>`;
    case 'verdict': return me ? `<div class="act a-verdict">${t}<b>supervisor</b> drift ${e.drift} · stuck ${e.stuck} · progress ${e.progress} — ${esc(e.note || '')}</div>` : '';
    default: return ''; } }

async function render() {
  const sel = S.sel; $('inject').hidden = !sel || sel == '__sup' || sel.startsWith('edge:') || !!S.selFile; $('loopcfg').hidden = sel != '__loop';
  const dd = (title, body, open = false) => `<details class="dd" ${open ? 'open' : ''}><summary>${title}</summary><div class="ddbody">${body}</div></details>`;
  if (S.selFile) { const f = S.selFile, m = S.files[f] || {writers: {}, readers: {}}, k = 'file:' + f + ':' + (m.last || 0);
    $('agenth').innerHTML = `<span class="ico">🔍</span> Inspect: <span class="subj">📄 ${esc(f)}</span>`;
    $('seltask').textContent = `WRITTEN BY: ${Object.keys(m.writers).map(short).join(', ') || '-'}\nREAD BY: ${Object.keys(m.readers).map(short).join(', ') || '-'}`;
    $('actions').innerHTML = S.evs.filter(e => e.ev == 'fs' && e.file == f).map(e => `<div class="act a-fs"><i>${tm(e.t)}</i><b>${{WRITE: 'wrote', READ: 'read', LS: 'listed', RUN: 'ran'}[e.op]}</b> ${esc(short(e.agent))}${e.size ? ` (${e.size} chars)` : ''} — ${esc((S.A[e.agent]?.status || '').slice(0, 80))}</div>`).join('');
    if (k == chatKey) return; chatKey = k;
    $('chat').innerHTML = `<pre id="fileview">${esc(await (await fetch(`exp/${S.cur}/file?${encodeURIComponent(f)}`)).text())}</pre>`; return; }
  if (sel?.startsWith('edge:')) { const [f, t] = sel.slice(5).split('>'), ms = S.evs.filter(e => e.ev == 'send' && ((e.agent == f && e.to == t) || (e.agent == t && e.to == f)));
    $('agenth').innerHTML = `<span class="ico">🔍</span> Inspect: <span class="subj">✉️ ${esc(short(f))} ↔ ${esc(short(t))}</span>`; $('seltask').innerHTML = `${ms.length} messages`; $('chat').innerHTML = '';
    $('actions').innerHTML = ms.map(e => `<div class="act ${e.agent == 'user' ? 'a-user' : e.agent == f ? 'a-send' : 'a-recv'}"><i>${tm(e.t)}</i><b>${esc(short(e.agent))} → ${esc(short(e.to))}</b> ${esc(e.msg)}</div>`).join(''); return; }
  if (!sel) { $('agenth').innerHTML = '<span class="ico">🔍</span> Inspect'; $('seltask').textContent = ''; $('chat').innerHTML = ''; $('actions').innerHTML = ''; return; }
  if (sel == '__loop') { const r = S.run, c = r.cfg || {};
    $('agenth').innerHTML = `<span class="ico">🔍</span> Inspect: <span class="subj">🤖 Control loop</span>`;
    $('seltask').innerHTML = `${esc(r.topology || '')} · ${S.steps} steps · ${S.running ? 'running' : 'idle'}` + dd('Limits', `engine ${esc(r.engine || '')} ${esc(r.model || '')}<br>slots ${r.slots} · agent cap ${r.max_agents} · slot ctx ${r.slot_ctx}<br>max_depth ${c.max_depth} · max_children ${c.max_children} · max_steps ${c.max_steps} · per agent ${c.max_steps_per_agent}<br>heartbeat every ${c.heartbeat_every} to depth ≤ ${c.heartbeat_to} · supervisor every ${c.supervise_every} · validations ≤ ${c.max_validations}`);
    $('chat').innerHTML = S.evs.filter(e => (e.ev == 'send' && e.agent == 'user') || e.ev == 'reply').slice(-20).map(e => e.ev == 'send' ? `<div class="m user"><i>USER → ${esc(short(e.to))} · ${tm(e.t)}</i>${esc(e.msg)}</div>` : `<div class="m assistant"><i>${esc(short(e.agent))} → USER · ${tm(e.t)}</i>${esc(e.msg)}</div>`).join('');
    $('actions').innerHTML = S.evs.filter(e => ['run', 'end', 'resume', 'heartbeat', 'info', 'error', 'refused', 'kill', 'validate', 'revive', 'reply'].includes(e.ev) || e.agent == 'user').slice(-80)
      .map(e => `<div class="act a-${e.ev == 'send' ? 'user' : e.ev}"><i>${tm(e.t)}</i><b>${e.ev == 'send' ? 'USER →' : e.ev == 'reply' ? 'reply ←' : e.ev}${e.reason ? ':' + e.reason : ''}</b> ${esc(short(e.ev == 'send' ? e.to : e.agent || ''))} ${esc((e.reason && e.ev == 'refused' ? e.reason + ' · ' : '') + (e.msg || e.task || '')).slice(0, e.ev == 'reply' ? 600 : 160)}</div>`).join(''); return; }
  if (sel == '__sup') { const vs = Object.values(S.verdicts).sort((x, y) => ((y.stuck ?? 0) + (y.drift ?? 0)) - ((x.stuck ?? 0) + (x.drift ?? 0)));
    $('agenth').innerHTML = `<span class="ico">🔍</span> Inspect: <span class="subj">🔭 Supervisor</span>`; $('seltask').innerHTML = `${vs.length} agents scored · ranked by stuck + drift` + dd('How to read', 'D drift · S stuck · P progress (0-10). Signals are programmatic; scores are the judge model reading those signals.'); $('chat').innerHTML = '';
    $('actions').innerHTML = `<div id="verdicts"><table>${vs.map(v => { const g = v.signals || {}; return `<tr><td><b>${esc(short(v.agent))}</b><br><span class="muted">${esc(v.agent)}</span></td><td><span class="sc" style="background:${sc(v.drift)}">${v.drift ?? '?'}</span><span class="sc" style="background:${sc(v.stuck)}">${v.stuck ?? '?'}</span><span class="sc" style="background:${scp(v.progress)}">${v.progress ?? '?'}</span></td><td>${esc(v.note || '')}<br><span class="muted">steps ${g.steps} · ctx ${g.ctx_pct}% · waits ${g.consecutive_waits} · repeat ${g.repeated_last_output ? 'yes' : 'no'} · cmds ${esc(JSON.stringify(g.commands || {}))} · children ${g.children_done}/${g.children}</span></td></tr>`; }).join('')}</table></div>`; return; }
  const a = S.A[sel];
  $('agenth').innerHTML = `<span class="ico">🔍</span> Inspect: <span class="subj">${a?.emoji || ''} ${esc(short(sel))}</span> <span class="st-${a?.state}">${a?.state?.toUpperCase() || ''}</span>`;
  const d = await api.get(`agent?${encodeURIComponent(sel)}`).catch(() => null);
  $('seltask').innerHTML = a ? `<b>STATUS</b> ${esc(a.status || '-')}<br><b>TASK</b> ${esc(a.task)}${a.result ? '<br><b>RESULT</b> ' + esc(a.result) : ''}${a.validation ? '<br><b>VALIDATION</b> ' + (a.validation.accepted ? 'accepted' : 'rejected') + ' — ' + esc(a.validation.feedback || '') : ''}`
    + dd('Details', `path ${esc(sel)} · depth ${a.depth} · spawned by ${esc(a.by)}${a.reason ? ' · ended: ' + esc(a.reason) : ''} · ${a.steps} steps`)
    + dd('System prompt', `<pre class="prompt">${esc(d?.system || '(not in memory)')}</pre>`) : '';
  $('actions').innerHTML = dd('History', S.evs.filter(e => e.agent == sel || e.to == sel || e.parent == sel).map(human).join(''), true);
  if (!d) return;
  const k = JSON.stringify(d); if (k == chatKey) return; chatKey = k;
  $('chat').innerHTML = d.history.map(m => `<div class="m ${m.role}"><i>${m.role}</i>${esc(m.content)}</div>`).join('') + (d.inbox || []).map(m => `<div class="m inbox"><i>inbox (pending)</i>${esc(m)}</div>`).join('');
  $('chat').scrollTop = $('chat').scrollHeight;
}
