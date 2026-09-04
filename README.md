# Local Multi-Agent Swarm

Watch a swarm of LLM agents run on your own machine, explore different swarm topologies, and nudge or redirect any agent in real time.

https://github.com/user-attachments/assets/c8918e8a-4dda-4516-9b02-11aa8094d67c


## Why

Most multi-agent frameworks hide what the agents are actually doing to each other. This is the opposite: one local model, many contexts, and a panel where you can see every spawn, every message and every file write as it happens, click on any agent to read its full prompt and history, and send it a message that it has to answer right away.

I built it to study how far a small local model gets when it is allowed to delegate: how deep the tree goes, where it gets stuck, when agents overwrite each other's work. It turned out to be a nice way to just watch a swarm think.

## How it works

You type a goal and press ▶ new. A `root` agent gets the goal and decides what to do with it: work alone, or `SPAWN` children with subtasks, `SEND` them messages, `WRITE` files, `KILL` children when they are done, and finally say `DONE`.

- Every agent is a fresh context of the same model. Agents only wake up when they have mail, so an idle swarm costs nothing.
- A supervisor sits outside the tree and periodically scores each live agent (is it drifting? stuck? making progress?), from hard signals plus its recent output. It can nudge an agent, and its verdicts are logged next to the evidence.
- When root says it is done, a judge call checks the files against the goal. If they do not match, root gets the feedback and tries again, a bounded number of times.
- Nothing is lost when a run ends. Finished agents stay idle with their memory intact; message one and it wakes up. You can pause, continue, and resume after restarting the server. Everything is on disk per run: what happened, the exact prompts and completions, and the files the agents wrote.

The panel has three columns: on the left an inspector for whatever you clicked (agent, edge, file) and the general log; in the center the topology graph; on the right the runtime (engine slots, GPU, per-agent tokens) and a treemap of the files being written.

Agents can only touch the run's own `work/` directory. Shell execution is off by default and, when you turn it on, runs inside bubblewrap without network.

## Try it

You need Python 3.10+ and a running OpenAI-compatible completion server. The reference setup is llama.cpp serving a 26B MoE model on one 24 GB GPU, but a smaller model, a smaller card or a hosted API all work. [AGENTS.md](AGENTS.md) has the hardware notes and the exact launch command.

```sh
git clone https://github.com/franciscocarloserra/local-multi-agent-swarm
cd local-multi-agent-swarm
python3 server.py
```

No dependencies to install. Open http://localhost:7812, pick your engine and a topology preset (flat, orchestrator, deep, solo), type a goal, press ▶ new.

To use a hosted model, set `engine` in `config.json` to `openai` or `openrouter` and export the API key. Every limit, prompt and threshold lives in `config.json`, and the panel lets you edit them under "Prompts & knobs".

## What agents can say

`STATUS`, `SPAWN`, `SEND`, `KILL`, `DONE`, `WAIT`, `LS`, `READ`, `WRITE` (appends, so agents cannot wipe each other's work), and `RUN` (off by default). Anything else is ignored and logged.

## Roadmap

- Connectors to external agent systems, so a node in the swarm can be an agent running somewhere else and its messages still show up in the same graph and log.
- Compare two runs side by side.

## More

- [AGENTS.md](AGENTS.md): stack, dependencies, hardware, file map, rules for changing the code.
- [INTENT.md](INTENT.md): the design log, kept current as the tool changes.
