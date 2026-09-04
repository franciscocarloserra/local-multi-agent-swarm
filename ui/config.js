import {S, $, on, esc, api} from './state.js';
const TEXTS = ['system_template', 'orchestrator_text', 'leaf_text', 'idle_prompt', 'deadlock_prompt', 'budget_template', 'budget_warn_text', 'heartbeat_template'];
const KNOBS = ['n_predict', 'temperature', 'max_agents', 'max_depth', 'max_children', 'max_steps', 'max_steps_per_agent', 'max_pokes', 'heartbeat_every', 'heartbeat_to', 'heartbeat_depth', 'auto_poke', 'budget_warn_pct', 'budget_kill_pct', 'allow_run', 'run_timeout_s', 'read_max_chars', 'idle_poll_s', 'poll_ms', 'llm_url'];
on('cfg', () => { const c = S.cfg;
  $('cfgbody').innerHTML = TEXTS.map(k => `<label>${k}</label><textarea data-k="${k}" rows="${k == 'system_template' ? 10 : 2}">${esc(c[k] ?? '')}</textarea>`).join('')
    + KNOBS.map(k => `<label>${k} <input data-k="${k}" value="${esc(JSON.stringify(c[k]))}" style="width:14em"></label>`).join('') + '<button id="saveb">save</button>';
  $('saveb').onclick = save; });
on('savecfg', save);
// the prompt editor lives in the General log by default and moves into the Control loop inspector when that node is selected
on('select', () => { const host = S.sel == '__loop' ? $('loopcfg') : $('logpane'); if ($('cfgd').parentElement != host) host.appendChild($('cfgd')); });
async function save() { const c = S.cfg; if (!c) return; c.root_task = $('goal').value;
  for (const t of $('cfgbody').querySelectorAll('textarea')) c[t.dataset.k] = t.value;
  for (const i of $('cfgbody').querySelectorAll('input')) { try { c[i.dataset.k] = JSON.parse(i.value); } catch { c[i.dataset.k] = i.value; } }
  await api.post('config', c); }
