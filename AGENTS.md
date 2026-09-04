# AGENTS.md

Read this before running or modifying Local Multi-Agent Swarm (repo dir `multiagents-flat`). Rationale and history are in INTENT.md.

## What it is

One Python process (`server.py`) serves a static web panel and an HTTP API, and hosts the orchestrator (`orch.py`) and supervisor (`supervisor.py`) threads. Agents are chat contexts against one completion endpoint. No database, no framework, no build step.

## External dependencies

| Dependency | Needed for | Install |
|---|---|---|
| Python 3.10+ | everything | system package; stdlib only, no pip |
| An OpenAI-compatible completion server | the agents | local: llama.cpp `llama-server`; hosted: OpenAI or OpenRouter key |
| `nvidia-smi` | GPU row in the Runtime pane | comes with the NVIDIA driver; absent means the row is empty |
| `bwrap` (bubblewrap) | the `RUN` command, off by default | `apt install bubblewrap`; only needed if you set `allow_run: true` |
| Node | `check.sh` syntax check for the UI modules | any recent Node; only for development |
| Firefox or Chromium | the panel | any modern browser; the UI uses ES modules, SVG and WebAudio |

## Hardware for running locally

The reference setup is llama.cpp serving gemma-4-26B-A4B (Q3_K_M GGUF, about 13 GB) with 20 parallel slots and a 163840 token shared context, KV cache quantized to q4_0, on one RTX 3090 (24 GB). That uses about 23 GB of VRAM. The number of parallel slots (`-np`) is the agent cap: the orchestrator reads `/slots` and refuses spawns beyond it, minus one slot reserved for the supervisor.

Smaller cards work with fewer slots and a smaller context, e.g. `-np 6 -c 49152` on 12 GB, or with a smaller model. CPU-only works but each agent step takes minutes. With a hosted engine no GPU is needed; the cap is then `engines.<name>.max_agents` in `config.json`.

Reference launch command:

```sh
llama-server -m gemma-4-26B-A4B-it-UD-Q3_K_M.gguf -ngl 99 --flash-attn on \
  -c 163840 --cache-type-k q4_0 --cache-type-v q4_0 -np 20 \
  --no-cache-idle-slots --cache-reuse 0 --host 0.0.0.0 --port 6981 --reasoning off
```

## Run

```sh
nohup python3 server.py > /tmp/maf.log 2>&1 &     # port 7812
```

In the panel: Runs → pick engine and topology preset → Goal → ▶ new. ⏸ pause stops stepping without losing state; ▶ continue resumes, also after a server restart (from `experiments/<run>/state.json`). Messages sent from the inspector are delivered immediately, labeled as the human operator, and stepped in their own thread. Messaging a finished agent revives it with its previous context.

Restart the server without killing other Python processes:

```sh
for p in $(pgrep -f "^python3 server.py"); do [ "$(readlink /proc/$p/cwd)" = "$PWD" ] && kill $p; done
nohup python3 server.py > /tmp/maf.log 2>&1 &
```

## File map

- `config.json` — template with every knob. Copied into each run; the copy is what the run reads. Keys of note: `engine`/`engines`, `max_agents` (`auto` = slots), `max_depth`, `max_steps`, `max_children`, `n_predict`, `system_template`, `orchestrator_text`, `leaf_text`, budget thresholds, supervisor thresholds, `validate*`, `write_mode`, `idle_reasons`, `allow_run`, `run_sandbox_cmd`, `topologies`.
- `orch.py` — orchestrator: agent registry, mail loop, command parsing and execution, budget, heartbeat, DONE handoff, validation gate, revive, pause/continue, `state.json` persistence, `chat()` for any engine.
- `supervisor.py` — periodic judge over live agents; verdicts logged with the signals that fed them.
- `server.py` — HTTP API and static files. Creates `experiments/NNN-<slug>/` per run.
- `index.html`, `ui/style.css` — layout, three columns with drag gutters.
- `ui/state.js` — model, reducer over `events.jsonl`, pub/sub bus. Every other UI module talks only through this bus.
- `ui/app.js` polling and run controls; `ui/graph.js` SVG topology; `ui/inspector.js` selected node details and chat; `ui/log.js` general log; `ui/files.js` treemap; `ui/runtime.js`; `ui/config.js` prompts and knobs editor; `ui/sound.js` audio cues.
- `experiments/<run>/` — `config.json`, `events.jsonl`, `raw.jsonl`, `state.json`, `work/`.
- `check.sh` — module-mode syntax check of all JS and Python. Run it before reloading the page.

## Rules for changing the code

- Every numeric or textual parameter goes in `config.json`. No hardcoded knobs.
- Never start an experiment run on your own; the human fires runs. If you need to test, write async unit tests with a stubbed engine.
- Never delete files; move them to `todelete/`.
- Commit after each functional state. Update INTENT.md when behavior or design changes.
- Code and docs in English. UI dark, progressive disclosure: titles show the minimum, details unfold on demand, no popups or helper text.
- UI modules never import each other; add a bus event in `state.js` instead.
- Agents' file access stays confined to the run's `work/`. Do not widen it.

## Debugging

- `./check.sh` catches module syntax errors that a plain `node --check` misses.
- `raw.jsonl` has the exact prompt and completion of every step; `events.jsonl` is what the UI reduces.
- Runtime JS errors: open the browser console, or `import('./ui/app.js?'+Date.now())` from it to surface module load errors.
