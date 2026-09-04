// Shared state + tiny event bus. Modules subscribe; nothing imports another pane.
export const S = {cur: null, cfg: null, sel: null, selFile: null, evs: [], A: {}, sends: [], run: {}, running: false, active: null, steps: 0, depth: 0, verdicts: {}, files: {}};
const subs = {};
export const on = (ev, fn) => (subs[ev] ??= []).push(fn);
export const emit = (ev, d) => (subs[ev] || []).forEach(f => f(d));
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'}[c]));
export const cap = s => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
export const short = n => n ? cap(n.split('/').pop()) : '';
export const tm = t => new Date(t * 1000).toLocaleTimeString();
export const api = {
  get: p => fetch(`exp/${S.cur}/${p}`).then(r => r.json()),
  post: (op, b = {}) => fetch(`exp/${S.cur}/${op}`, {method: 'POST', body: JSON.stringify(b)}).then(r => r.json()),
};
export const say = t => { $('msgline').textContent = t; setTimeout(() => { if ($('msgline').textContent == t) $('msgline').textContent = ''; }, 8000); };
export const select = n => { S.sel = n; S.selFile = null; emit('select', n); };
export const selectFile = p => { S.selFile = p; emit('select', S.sel); };
export const sc = v => v == null ? '#666' : v >= 7 ? '#e55' : v >= 4 ? '#ee6' : '#6d6';   // score colour: bad high
export const scp = v => v == null ? '#666' : v >= 7 ? '#6d6' : v >= 4 ? '#ee6' : '#e55';  // progress: good high

// Reduce events.jsonl into the model.
export function reduce(evs) {
  const A = {}, sends = [], verdicts = {}, files = {}; let run = {}, running = false, paused = false, active = null, steps = 0, depth = 0;
  for (const e of evs) {
    switch (e.ev) {
      case 'run': paused = false; if (Object.keys(A).length > 1) Object.keys(A).forEach(k => delete A[k]); sends.length = 0; Object.keys(verdicts).forEach(k => delete verdicts[k]); Object.keys(files).forEach(k => delete files[k]); run = e; running = true; steps = 0; depth = 0; break;
      case 'end': running = false; active = null; break;
      case 'resume': running = true; paused = false; break;
      case 'pause': paused = true; break;
      case 'continue': paused = false; break;
      case 'revive': if (A[e.agent]) { A[e.agent].state = 'alive'; A[e.agent].reason = null; } break;
      case 'validate': if (A[e.agent]) { A[e.agent].validation = e; if (!e.accepted) A[e.agent].state = 'alive'; } break;
      case 'spawn': A[e.agent] = {...e, children: [], state: 'alive', steps: 0}; if (e.parent && A[e.parent]) A[e.parent].children.push(e.agent); depth = Math.max(depth, e.depth); break;
      case 'think': active = e.agent; break;
      case 'step': { const a = A[e.agent]; if (!a) break; a.steps++; a.last = e; steps++; active = null;
        if (a.state == 'alive' || a.state == 'waiting') a.state = /^\s*WAIT\b/m.test(e.out) ? 'waiting' : 'alive'; break; }
      case 'status': if (A[e.agent]) A[e.agent].status = e.msg; break;
      case 'done': if (A[e.agent]) { A[e.agent].state = 'done'; A[e.agent].result = e.result; A[e.agent].reason = null; } break;
      case 'kill': if (A[e.agent]) { A[e.agent].state = e.idle ? 'idle' : 'dead'; A[e.agent].reason = e.reason; } break;
      case 'verdict': verdicts[e.agent] = e; if (A[e.agent]) A[e.agent].verdict = e; break;
      case 'fs': { const f = files[e.file] ??= {writers: {}, readers: {}, last: 0, first: e.t}; (e.op == 'WRITE' ? f.writers : f.readers)[e.agent] = (f.writers[e.agent] || 0) + 1; f.last = e.t;
        if (A[e.agent]) { const a = A[e.agent]; (a.files ??= {})[e.file] = e.op; } break; }
      case 'reply': if (A[e.agent]) A[e.agent].reply = e; break;
      case 'send': if (A[e.to]) { sends.push([e.agent, e.to]); if (A[e.to].state == 'waiting') A[e.to].state = 'alive'; } break;
    }
  }
  if (!running) active = null;
  // topology complexity: max width of any depth level, mean fan-out of delegators
  const byDepth = {}; let kids = 0, parents = 0;
  for (const a of Object.values(A)) { byDepth[a.depth] = (byDepth[a.depth] || 0) + 1; if (a.children.length) { parents++; kids += a.children.length; } }
  const width = Math.max(0, ...Object.values(byDepth)), fanout = parents ? +(kids / parents).toFixed(1) : 0;
  Object.assign(S, {evs, A, sends, run, running, paused, active, steps, depth, width, fanout, verdicts, files});
}
