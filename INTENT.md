# multiagents-flat — intent and design log

Last updated 2026-09-04 (evening). Design intent and decisions, kept as a running log. Read this before touching anything.

## Purpose

Observe the **emergent coordination topology** of many contexts of one local model (gemma-4-26B-A4B on llama-server, alias `gemma4-multi`, 11 slots on port 6981): how far agents chain, delegate, spawn and kill each other. The point is capabilities and topology, not a product. Keep everything **ultra simple**; no over-engineering.

## Non-negotiables (user rules)

- User fires every run with an explicit GOAL. Nothing runs by itself.
- Maximum **visibility and governance**: the human sees everything and can steer any agent at any time. User messages reach agents labeled as highest-priority operator.
- Closed command set: agents can only emit STATUS, SPAWN, SEND, KILL, DONE, WAIT, LS, READ, WRITE, RUN. Local model "can do harm", so file access is confined to `experiments/<name>/work/`; RUN is off by default and, when on, runs under bubblewrap (read-only root, work dir only, no network).
- Everything programmatic that can be programmatic (signals, budget, caps, file attribution). LLM judgement only where needed (supervisor scores), and always auditable next to the raw signals.
- All numeric/tunable parameters externalized in `config.json` (per experiment). No hardcoding.
- Raw logs to disk per experiment: `events.jsonl` (topology/actions) and `raw.jsonl` (full LLM request/response), for travel-shooting later.
- Dark UI. **Minimal cognitive load, maximum interpretability**: clear visual hierarchy, each pane titled with an emoji, generous padding, no popups/alerts, no helper texts or floating buttons, human-readable action sentences, color-coded states (thinking white, alive blue, waiting yellow, done green, ended red), solid lines only, rounded cards, big role emoji on the card's right, bold capitalized titles.
- UI must stay decoupled: one module per pane, communication only through the event bus in `ui/state.js`. No pane imports another.
- Agents get descriptive names (prefixed by parent) and a role emoji chosen by the model (never robots).
- User does UX testing in Firefox; agents never open browsers. Live-server not used here (page polls data); `python3 server.py` on port 7812 serves everything.

## Architecture (current)

- `orch.py` — orchestrator thread. Agents = slots. Mail loop: an agent only runs when its inbox has mail; WAIT sleeps it; deadlock breaker wakes the deepest waiter once; per-agent step timeout; token budget line each turn with warn/kill thresholds; heartbeat digest of the whole tree to depth ≤ `heartbeat_to`; DONE/ended handoff to parent with status+stats+review instruction (OpenClaw-style); refused SPAWN returns the reason to the agent; run ends when nobody is alive.
- `supervisor.py` — separate loop outside the tree, reserves one slot. Every `supervise_every` steps, per live agent: programmatic signals (steps, ctx %, consecutive WAITs, repeated output, command mix, children done, inbox) + recent outputs → judge call → `{drift, stuck, progress, note}` logged as `verdict` with the signals. Thresholds `supervisor_nudge_*` (send a nudge) and `supervisor_kill_*` (default never).
- `server.py` — HTTP API + static. Experiments in `experiments/<name>/` (config.json, events.jsonl, raw.jsonl, work/). Endpoints: experiments list/create, config get/set (applied live), run (with goal + topology), stop, action (user spawn/send/kill), agent chat, files, file, runtime (orchestrator, llama slots, GPU via nvidia-smi).
- `ui/` — `state.js` (model, reducer over events.jsonl, bus, helpers), `app.js` (polling, run control), `graph.js` (topology graph with 🤖 control loop and 🔭 supervisor nodes, pan/zoom/fit, verdict badges D/S/P, file-touch highlighting), `inspector.js` (agent chat, injected instructions, humanized action history; loop and supervisor inspectors), `log.js` (numbered, filtered, collapsible general log), `files.js` (treemap: area = size in tokens, color = growth in last 30 s, writers/readers per file, cross-highlight with selected agent), `runtime.js`, `config.js`.
- Topology presets in config `topologies` (flat / orchestrator / deep / solo) override depth, children and heartbeat scope per run; chosen in Run control, recorded in the `run` event for comparison.

## Visual language (agreed)

- Palette: background #0f0f0f, panes #171717 with #2a2a2a borders, titles #fc8. White text on dark tiles everywhere, never dark text on bright fills.
- Semantic colours: files/edits orange (#fa8), messages pink (#e6a), spawns blue (#8cf), done green (#6d6), ended red (#e55), waiting yellow (#ee6), verdicts gold (#fd6). The same colour means the same thing in graph, log, inspector and treemap.
- Selection = thick white border (graph node, treemap tile). Related-to-selection = orange border. Unrelated = dimmed.
- Treemap: slate tiles; a tile warms toward orange in proportion to how much agents wrote to it in the last 30 s.
- Every pane has an emoji title; every log action has a full name and an emoji (🤖 Spawned, ⛔ Ended, 🚫 Spawn refused, ✅ Done, ✉️ Message, 📝 Wrote, 👁 Read, 📂 Listed, 🖥 Ran, 🔭 Verdict, 💬 Status, 💓 Heartbeat, ❗ Error, 🎯 Run started, 🏁 Run ended).
- Panes are resizable via drag gutters. No popups, no helper text.
- Topological complexity is always visible by default: depth, width (max agents on one level), fan-out (mean children per delegator), in the Runs header and on the ⚙ Control loop card.

## Run flow (agreed)

GOAL textarea + ▶ run side by side. If the current experiment already holds a run it is preserved and a new experiment directory is created automatically, named by a slug of the goal (40 chars, ascii, hyphens). The Runs pane switches to it. Old runs stay browsable from the selector.

## UI clutter rules (latest)

- Anything that is reference or debugging data (log type filters, run stats, config) lives in a collapsed dropdown, vertically aligned, at a fixed position in its pane. Never a permanent row of chips or a stats line.
- Section-title emojis are desaturated and tinted to the header colour; emojis inside cards and log rows stay in colour because they carry meaning.
- Selected node: thick white border; clicking any node (agent, 🤖 control loop, 🔭 supervisor) must open its inspector. Inspector for an agent = task/status/result, live chat, injected-instruction bar, humanized action history.
- Graph shows file nodes with lines when an agent with files or a file is selected.

## Working conventions

- Commit after each functional state (repo is `multiagents-flat/` itself; `experiments/`, `todelete/`, `__pycache__/` ignored).
- Keep this file current: it is the resume point for anyone (human or agent) picking the project up.
- Check `node --check` per module AND watch for cross-scope redeclarations (a duplicate `const` broke the page once; node --check does not catch it).

## Findings so far

- Gemma over-delegates when depth allows it: researcher→librarian→searcher chains, slots exhausted, leaves die by timeout. Depth 2 (orchestrator) completes the cactus-guide goal end to end; depth 6 does not.
- Prefix-cache hygiene : keep system prompt byte-identical per agent, append history at the end. Hot turn ≈ 200–500 ms.
- Supervisor scores are coherent on first runs (waiting parents S≈2, writers P≈8–9, a repeating researcher flagged S3).

## Open / next

- UI still dense: consider progressive disclosure per pane (collapsed by default except graph + agent), and a "compare runs" view over `run` events (topology vs steps/agents/depth/files/verdicts).
- Runtime inventory is loose; decide what else belongs there (RUN subprocesses, per-slot agent mapping).
- Emoji on the goal/preset for quick recognition; keyboard focus on a_task after selecting a node.

## Visual rules added (2026-09-04)
- Log labels are single capitalized words; a kill row shows its reason as the label (Timeout, Budget, User).
- Section-title emojis are fully desaturated (cutout, reference only); emojis elsewhere keep color.
- Graph cards: PAD 16 inner padding, nodes fade in (`.node.new`, FADE_S seconds after spawn).
- Runtime pane: every metric is one row `label | bar | value` (.kv grid).
- llama alias `gemma4-multi` now `-np 20` (slot ctx 8192 with `-c 163840`).
- Sound: `ui/sound.js` synthesizes a soft blip on spawn and a noise rustle on first write of a file (WebAudio, volumes at file top; only after the first click, only for events newer than page load).
- Spawn animation is a white glow flash that decays (`spawnglow`); new file tiles and new log rows animate in green (`tilein`, `evin`).
- File system palette: dark slate-green tiles, white text; growth deepens the green (never orange). Selecting a file no longer draws file nodes in the graph: agents that touched it get a thick green border instead.

## Resume, validation, engines, append (2026-09-04)
- `state.json` per experiment (agents with full histories, order, steps) saved after every step; an action on a finished run resumes the loop (`resume` event, `max_steps` += `resume_extra_steps`), also after a server restart. Sending a message to an ended agent revives it with its history (`revive` event). This is the IBEX flow: user sees the goal failed, nudges, run continues.
- Validation gate: when a root agent says DONE, a judge call (`validate_system`, goal + result + work files) accepts or rejects; rejection re-opens the root with feedback, up to `max_validations` (`validate` event, shown in log and inspector).
- Engines: `engine` + `engines{name:{url,model,api_key_env,max_agents}}`; llama exposes /slots (cap = slots), remote engines use `max_agents` and `remote_ctx`. Selectable in the Runs row; recorded in the `run` event.
- WRITE appends by default (`write_mode`), so agents don't clobber each other.
- File click opens the file in the right inspector (header, writers/readers, content, history); Run stats floats top-right of Runs; fit button lives in the Agents header.
- Layout (2026-09-04): left column = Agent inspector + General log; center = Agents graph; right column = Runtime (with ⏸ pause / ▶ continue) + File system. Goal has one button: ▶ new. Panes are decoupled (each module only touches its own ids and the bus), so moving sections in index.html is safe; only the gutter code in app.js knows the layout.
- Run dirs are `NNN-slug` (three-digit run id first).
- Progressive disclosure: graph cards show no numeric verdict badges, only a red ⚑ when the supervisor's stuck/drift crosses the nudge threshold; numbers live in the inspector.
- General criterion (global UX criterion): progressive disclosure of information + crucial controls at hand + visual clarity + unified hierarchy. Titles carry the minimum; details go into `.dd` dropdowns (Limits, Details, System prompt, History). Each agent's exact system prompt is served by `agent?name` (`system`) and shown in its inspector; prompt templates and knobs are edited in the Control loop inspector (the editor moves there when ⚙ is selected).
- Graph edges: white curves = parent→child; pink curves = message channels (one per pair, width by count, badge = count). Clicking a channel opens the conversation in Inspect. Inspect is the pane title when nothing is selected.
- Always run `./check.sh` before committing (module-mode syntax check; plain `node --check` missed two `const` redeclarations). Runtime errors: browser console, `import('./ui/app.js?'+Date.now())` surfaces module load errors.
- Lifecycle (2026-09-04): agents don't die at the end. DONE, step limit (`timeout`) and `parent_ended` make them IDLE (`idle_reasons` in config): history intact, any USER message wakes them and resumes the loop. Only `budget`, user kill and supervisor kill → ENDED. Manual spawn/kill buttons are hidden (user talks, doesn't manage). Cards are 320×100 with 17px titles.
- User messages: delivered and logged immediately by the server (not on the next loop turn), the pinged agent steps before anyone else (`user_ping`), and its answer is logged as a `reply` event (💬) shown in the General log, the agent's history and the Control loop inspector (USER → / reply ←).
- Control (2026-09-04): ⏸ pause / ▶ continue live beside ▶ new in the Goal pane. Pause stops auto-stepping (loop thread stays alive, state kept); continue resumes, also after a server restart. A user message never auto-resumes the loop: the pinged agent is stepped immediately in its own thread (per-agent lock, spare llama slots), even while paused. That is the absolute-priority rule.
