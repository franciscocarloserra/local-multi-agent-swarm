"""Supervision loop, outside the agent tree. Every `supervise_every` steps it scores each live agent for drift / stuck / progress
using explicit metadata (goal, task, steps, tokens, command mix, recent outputs, children results) + programmatic signals, via one LLM call
per agent. Verdicts are logged (ev=verdict) with the raw metadata so the ranking is auditable. Optional nudge/kill on thresholds."""
import json, re, threading, time, urllib.request

class Supervisor:
    def __init__(self, orch):
        self.o, self.cfg, self.last_step, self.verdicts = orch, orch.cfg, 0, {}

    def signals(self, name):
        a, evs = self.o.agents[name], self.o.agents[name]["history"]
        outs = [m["content"] for m in evs if m["role"] == "assistant"]
        cmds = [l.split()[0] for o in outs for l in o.splitlines() if re.match(r"^\s*(SPAWN|SEND|KILL|DONE|WAIT|STATUS|READ|WRITE|LS|RUN)\b", l)]
        tail = outs[-3:]
        return {"steps": a["nsteps"], "ctx_used": a["used"], "ctx_pct": round(100 * a["used"] / self.o.slot_ctx),
                "consecutive_waits": next((i for i, o in enumerate(reversed(outs)) if not re.search(r"^\s*WAIT\b", o, re.M)), len(outs)),
                "repeated_last_output": len(tail) >= 2 and tail[-1].strip() == tail[-2].strip(),
                "commands": {c: cmds.count(c) for c in set(cmds)}, "children": len(a["children"]),
                "children_done": sum(1 for c in a["children"] if not self.o.agents[c]["alive"]),
                "inbox_pending": len(a["inbox"]), "waiting": a["waiting"], "status": a["status"]}

    def judge(self, name):
        a, c, sig = self.o.agents[name], self.cfg, self.signals(name)
        outs = [m["content"] for m in a["history"] if m["role"] == "assistant"][-c["supervisor_last_outputs"]:]
        meta = {"agent": name, "task": a["task"], "parent": a["parent"], "depth": a["depth"], "signals": sig, "recent_outputs": outs,
                "children_results": [{"child": ch, "status": self.o.agents[ch]["status"], "alive": self.o.agents[ch]["alive"]} for ch in a["children"]]}
        body = {"messages": [{"role": "system", "content": c["supervisor_system"].format(goal=c["root_task"])},
                             {"role": "user", "content": json.dumps(meta, ensure_ascii=False)}],
                "max_tokens": c["supervisor_n_predict"], "temperature": 0}
        txt, ms, _ = self.o.chat(body, "supervisor", name)
        m = re.search(r"\{.*\}", txt, re.S)
        try: v = json.loads(m.group(0))
        except Exception: v = {"drift": None, "stuck": None, "progress": None, "note": "unparseable: " + txt[:200]}
        v = {k: v.get(k) for k in ("drift", "stuck", "progress", "note")}
        self.verdicts[name] = v
        self.o.log(ev="verdict", agent=name, by="supervisor", ms=ms, signals=sig, **v)
        return v

    def act(self, name, v):
        a, c = self.o.agents[name], self.cfg
        if not a["alive"] or v["stuck"] is None: return
        if v["stuck"] >= c["supervisor_kill_stuck"] or (v["drift"] or 0) >= c["supervisor_kill_drift"]:
            self.o.kill(name, "supervisor", "supervisor"); return
        if v["stuck"] >= c["supervisor_nudge_stuck"] or (v["drift"] or 0) >= c["supervisor_nudge_drift"]:
            self.o.deliver(name, c["supervisor_nudge_template"].format(**v)); self.o.log(ev="send", agent="supervisor", to=name, msg=c["supervisor_nudge_template"].format(**v))

    def loop(self):
        while self.o.running:
            if self.o.steps - self.last_step < self.cfg["supervise_every"]: time.sleep(0.5); continue
            self.last_step = self.o.steps
            for n in list(self.o.alive()):
                if not self.o.running: break
                if self.o.agents[n]["nsteps"] == 0: continue
                try: self.act(n, self.judge(n))
                except Exception as e: self.o.log(ev="error", agent="supervisor", msg=f"{n}: {e}")

    def start(self): threading.Thread(target=self.loop, daemon=True).start()
