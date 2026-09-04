"""Multi-agent orchestrator on one llama-server. Agents SPAWN/SEND/KILL/DONE via text commands.
Runs in a thread; user actions arrive via queue. Logs: events.jsonl (topology/steps) + raw.jsonl (full LLM req/resp)."""
import json, os, queue, re, subprocess, threading, time, urllib.request

class Orch:
    def __init__(self, exp_dir, cfg):
        self.dir, self.cfg = exp_dir, cfg
        self.agents, self.order, self.q = {}, [], queue.Queue()
        self.locks, self.paused = {}, False   # one lock per agent: a user ping steps the agent in its own thread while the loop keeps going
        self.running, self.steps = False, 0
        self.eng = dict(cfg["engines"][cfg["engine"]]); self.eng.setdefault("url", cfg.get("llm_url"))
        try:   # llama-server exposes /slots: cap = slots. Remote engines don't: cap = engine max_agents, ctx = remote_ctx.
            sl = json.load(urllib.request.urlopen(self.eng["url"] + "/slots", timeout=10))
            self.slots, self.slot_ctx = len(sl), sl[0]["n_ctx"]
        except Exception as e:
            self.slots_error = str(e); self.slot_ctx = cfg["remote_ctx"]
            self.slots = int(self.eng["max_agents"]) + (1 if cfg["supervisor"] else 0) if self.eng["max_agents"] != "auto" else 1
        reserve = 1 if cfg["supervisor"] else 0
        cap = self.eng["max_agents"] if self.eng["max_agents"] != "auto" else cfg["max_agents"]
        self.max_agents = (self.slots - reserve) if cap == "auto" else min(int(cap), self.slots - reserve)
        self.work = f"{exp_dir}/work"; os.makedirs(self.work, exist_ok=True)
        self.evf = open(f"{exp_dir}/events.jsonl", "a"); self.raw = open(f"{exp_dir}/raw.jsonl", "a")
        self.state_path = f"{exp_dir}/state.json"
        if os.path.exists(self.state_path):   # resume: full agent histories come back exactly as they were
            st = json.load(open(self.state_path)); self.agents, self.order, self.steps = st["agents"], st["order"], st["steps"]

    def save(self):
        json.dump({"agents": self.agents, "order": self.order, "steps": self.steps}, open(self.state_path + ".tmp", "w"), ensure_ascii=False)
        os.replace(self.state_path + ".tmp", self.state_path)

    def log(self, **ev):
        ev["t"] = round(time.time(), 3)
        self.evf.write(json.dumps(ev, ensure_ascii=False) + "\n"); self.evf.flush()

    def alive(self): return [n for n in self.order if self.agents[n]["alive"]]

    def spawn(self, name, parent, task, by, emoji=None):
        if emoji is None and "|" in task:
            head, _, rest = task.partition("|")
            if len(head.strip()) <= 4 and rest.strip(): emoji, task = head.strip(), rest.strip()
        emoji = emoji or self.cfg["default_emoji"]
        depth = self.agents[parent]["depth"] + 1 if parent in self.agents else 0
        why = ("name exists" if name in self.agents else f"agent cap {self.max_agents} reached (alive {len(self.alive())})" if len(self.alive()) >= self.max_agents
               else f"depth {depth} > max_depth {self.cfg['max_depth']}" if depth > self.cfg["max_depth"] else None)
        if why:
            self.log(ev="refused", agent=name, parent=parent, by=by, depth=depth, reason=why)
            if parent in self.agents: self.agents[parent]["inbox"].append(f"[SPAWN {name} refused: {why}]")
            return
        self.agents[name] = {"parent": parent if parent in self.agents else None, "depth": depth, "task": task,
                             "alive": True, "history": [], "inbox": [f"[start] Your task: {task}"], "children": [], "used": 0, "pokes": 0, "waiting": False, "nsteps": 0, "status": "", "emoji": emoji}
        self.order.append(name)
        if parent in self.agents: self.agents[parent]["children"].append(name)
        self.log(ev="spawn", agent=name, parent=self.agents[name]["parent"], by=by, depth=depth, task=task, emoji=emoji)

    def deliver(self, to, msg):
        self.agents[to]["inbox"].append(msg); self.agents[to]["waiting"] = False

    def kill(self, name, by, reason="killed"):
        a = self.agents.get(name)
        if not a or not a["alive"]: return
        idle = reason in self.cfg["idle_reasons"]   # idle agents keep their history and wake up on any message
        a["alive"] = False; a["idle"] = idle; self.log(ev="kill", agent=name, by=by, reason=reason, idle=idle)
        if a["parent"] and self.agents[a["parent"]]["alive"] and by != a["parent"]:
            self.deliver(a["parent"], f"[{name} ENDED status={reason} by {by}, steps {a['nsteps']}] No result.")
        for c in a["children"]: self.kill(c, name, "parent_ended")

    def revive(self, name, by):
        """Bring an ended agent back with its history intact (no fresh context). Only the user or the validation gate do this."""
        a = self.agents[name]
        if a["alive"]: return
        state = "done" if a.get("done") else "idle" if a.get("idle") else "ended"
        a["alive"], a["waiting"], a["pokes"], a["done"] = True, False, 0, False
        self.deliver(name, self.cfg["revive_template"].format(by=by, state=state)); self.log(ev="revive", agent=name, by=by)

    def send(self, to, msg, by):
        if to not in self.agents: return
        if not self.agents[to]["alive"] and by == "user": self.revive(to, by)
        if self.agents[to]["alive"]:
            self.deliver(to, (self.cfg["user_label"] if by == "user" else f"[from {by}]") + " " + msg); self.log(ev="send", agent=by, to=to, msg=msg)
            if by == "user":   # absolute priority: stepped right now in its own thread (llama has spare slots), even while paused
                self.agents[to]["user_ping"] = True; threading.Thread(target=self.step, args=(to,), daemon=True).start()

    def chat(self, body, agent, about=None):
        """One chat completion on the configured engine; every call is appended to raw.jsonl."""
        c, e = self.cfg, self.eng
        if e.get("model"): body["model"] = e["model"]
        h = {"Content-Type": "application/json"}
        if e.get("api_key_env"): h["Authorization"] = "Bearer " + os.environ.get(e["api_key_env"], "")
        req = urllib.request.Request(e["url"] + "/v1/chat/completions", json.dumps(body).encode(), h)
        t = time.perf_counter(); r = json.load(urllib.request.urlopen(req, timeout=c["llm_timeout_s"])); ms = round((time.perf_counter() - t) * 1000)
        self.raw.write(json.dumps({"t": time.time(), "agent": agent, "about": about, "engine": c["engine"], "ms": ms, "request": body, "response": r}, ensure_ascii=False) + "\n"); self.raw.flush()
        tm = r.get("timings") or {}
        if not tm and "usage" in r: u = r["usage"]; tm = {"prompt_n": u.get("prompt_tokens"), "cache_n": 0, "predicted_n": u.get("completion_tokens")}
        return r["choices"][0]["message"]["content"], ms, tm

    def system_for(self, name):
        """The exact system prompt an agent runs with (stable prefix for llama's prefix cache)."""
        a, c = self.agents[name], self.cfg
        leaf = a["depth"] >= c["max_depth"]
        return c["system_template"].format(name=name, depth=a["depth"], parent=a["parent"] or "none", task=a["task"],
                                           max_children=0 if leaf else c["max_children"],
                                           role=c["leaf_text"] if leaf else c["orchestrator_text"].format(max_children=c["max_children"]))

    def llm(self, a, name):
        c = self.cfg
        req_body = {"messages": [{"role": "system", "content": self.system_for(name)}] + a["history"],
                    "max_tokens": c["n_predict"], "temperature": c["temperature"]}
        return self.chat(req_body, name)

    def step(self, name):
        with self.locks.setdefault(name, threading.Lock()): self._step(name)
        self.save()

    def _step(self, name):
        a = self.agents[name]
        if not a["alive"] or not a["inbox"]: return
        pct = round(100 * a["used"] / self.slot_ctx)
        budget = self.cfg["budget_template"].format(used=a["used"], ctx=self.slot_ctx, pct=pct,
                 warn=self.cfg["budget_warn_text"] if pct >= self.cfg["budget_warn_pct"] else "")
        user = budget + "\n" + ("\n".join(a["inbox"]) or self.cfg["idle_prompt"]); a["inbox"] = []
        a["history"].append({"role": "user", "content": user}); self.log(ev="think", agent=name)
        try: out, ms, tm = self.llm(a, name)
        except Exception as e: self.log(ev="error", agent=name, msg=str(e)); a["history"].pop(); self.running = False; return
        a["history"].append({"role": "assistant", "content": out}); self.steps += 1; a["nsteps"] += 1
        if a.get("user_ping"): a["user_ping"] = False; self.log(ev="reply", agent=name, to="user", msg=out[:self.cfg["reply_log_chars"]])
        a["used"] = (tm.get("prompt_n") or 0) + (tm.get("cache_n") or 0) + (tm.get("predicted_n") or 0)
        self.log(ev="step", agent=name, ms=ms, prompt_n=tm.get("prompt_n"), cache_n=tm.get("cache_n"),
                 predicted_n=tm.get("predicted_n"), used=a["used"], ctx=self.slot_ctx, out=out)
        if a["used"] >= self.slot_ctx * self.cfg["budget_kill_pct"] / 100:
            self.kill(name, "system", "budget"); return
        if a["nsteps"] >= self.cfg["max_steps_per_agent"]: self.kill(name, "system", "timeout"); return
        for line in self.blocks(out):
            m = re.match(r"^\s*(SPAWN|SEND|KILL|DONE|WAIT|STATUS|READ|WRITE|LS|RUN)\b\s*(.*)", line, re.S)   # re.S: WRITE bodies span lines
            if not m: continue
            cmd, rest = m.group(1), m.group(2)
            arg, _, msg = [s.strip() for s in rest.partition("|")]
            if cmd == "WAIT": a["waiting"] = True
            elif cmd == "STATUS": a["status"] = rest.strip(" |"); self.log(ev="status", agent=name, msg=a["status"])
            elif cmd in ("READ", "WRITE", "LS", "RUN"): self.tool(name, cmd, arg, msg)
            elif cmd == "SPAWN": self.spawn(arg, name, msg, name)
            elif cmd == "SEND": self.send(arg, msg, name)
            elif cmd == "KILL" and arg in a["children"]: self.kill(arg, name)
            elif cmd == "DONE":
                if a["parent"] is None and not self.validate(name, msg): break
                a["alive"] = False; a["done"] = a["idle"] = True; self.log(ev="done", agent=name, result=msg)
                if a["parent"] and self.agents[a["parent"]]["alive"]:
                    self.deliver(a["parent"],
                        f"[{name} DONE status=completed | steps {len(a['history'])//2}, ctx {a['used']}/{self.slot_ctx}] Result: {msg}\nReview it before deciding your task is complete.")
                break

    def validate(self, name, result):
        """Final gate: when a root agent says DONE, a judge call checks the goal against the result + work dir. Rejection re-opens the root with feedback."""
        c, a = self.cfg, self.agents[name]
        if not c["validate"]: return True
        files = {}
        for d, _, fs in os.walk(self.work):
            for f in fs:
                rel = os.path.relpath(os.path.join(d, f), self.work)
                try: files[rel] = open(os.path.join(d, f)).read()[:c["validate_file_chars"]]
                except Exception as e: files[rel] = f"<{e}>"
        meta = {"agent": name, "task": a["task"], "result": result, "steps": a["nsteps"], "files": files}
        body = {"messages": [{"role": "system", "content": c["validate_system"].format(goal=c["root_task"])},
                             {"role": "user", "content": json.dumps(meta, ensure_ascii=False)}], "max_tokens": c["validate_n_predict"], "temperature": 0}
        try:
            txt, ms, _ = self.chat(body, "validator", name)
            m = re.search(r"\{.*\}", txt, re.S); v = json.loads(m.group(0))
        except Exception as e: v = {"accepted": True, "feedback": f"validator unavailable: {e}"}; ms = 0
        n = a.get("validations", 0) + 1; a["validations"] = n
        ok = bool(v.get("accepted")) or n > c["max_validations"]
        self.log(ev="validate", agent=name, by="validator", accepted=ok, n=n, ms=ms, feedback=str(v.get("feedback", ""))[:400], files=list(files), forced=(not v.get("accepted") and ok))
        if not ok: self.deliver(name, c["validate_reject_template"].format(n=n, max=c["max_validations"], feedback=v.get("feedback", "")))
        return ok

    def path(self, rel):
        p = os.path.realpath(os.path.join(self.work, rel.strip().lstrip("/")))
        return p if p.startswith(self.work + os.sep) or p == self.work else None

    def tool(self, name, cmd, arg, msg):
        a, p = self.agents[name], self.path(arg)
        if p is None: a["inbox"].append(f"[{cmd} error] path outside work dir"); return
        rel, c = os.path.relpath(p, self.work), self.cfg
        try:
            if cmd == "WRITE":
                os.makedirs(os.path.dirname(p), exist_ok=True); ap = c["write_mode"] == "append" and os.path.exists(p)
                open(p, "a" if ap else "w").write(("\n" if ap else "") + msg)
                a["inbox"].append(f"[WRITE {'appended' if ap else 'ok'}] {rel} ({len(msg)} chars, file now {os.path.getsize(p)} bytes)")
            elif cmd == "READ":
                txt = open(p).read()[:c["read_max_chars"]]; a["inbox"].append(f"[READ {rel}]\n{txt}")
            elif cmd == "LS":
                ls = [os.path.relpath(os.path.join(d, f), self.work) for d, _, fs in os.walk(p) for f in fs]
                a["inbox"].append("[LS] " + (", ".join(sorted(ls)) or "(empty)"))
            elif cmd == "RUN":
                if not c["allow_run"] or not p.endswith(".py"): a["inbox"].append("[RUN denied]"); return
                cmd = c["run_sandbox_cmd"].format(work=self.work).split() + ["python3", os.path.relpath(p, self.work)]
                r = subprocess.run(cmd, cwd=self.work, capture_output=True, text=True, timeout=c["run_timeout_s"])
                a["inbox"].append(f"[RUN {rel} exit {r.returncode}]\n{(r.stdout + r.stderr)[-c['read_max_chars']:]}")
        except Exception as e: a["inbox"].append(f"[{cmd} error] {e}")
        self.log(ev="fs", agent=name, op=cmd, file=rel, size=len(msg) if cmd == "WRITE" else None)

    def blocks(self, out):
        """Split output into command blocks: a WRITE line swallows following lines until the next command line."""
        cmds, res = re.compile(r"^\s*(SPAWN|SEND|KILL|DONE|WAIT|STATUS|READ|WRITE|LS|RUN)\b"), []
        for line in out.splitlines():
            if res and res[-1].lstrip().startswith("WRITE") and not cmds.match(line): res[-1] += "\n" + line
            else: res.append(line)
        return [r.strip("`\n ") for r in res]

    def heartbeat(self):
        """Every heartbeat_every steps, give agents at depth <= heartbeat_to a digest of the whole tree."""
        c = self.cfg
        if not c["heartbeat_every"] or not self.steps or self.steps % c["heartbeat_every"]: return
        lines = [f"{n} d{a['depth']} {'alive' if a['alive'] else 'ended'} steps={a['nsteps']} ctx={a['used']}/{self.slot_ctx}: {a['status'][:80]}"
                 for n, a in self.agents.items() if a["depth"] <= c["heartbeat_depth"]]
        digest = c["heartbeat_template"].format(step=self.steps, tree="\n".join(lines))
        for n in self.alive():
            if self.agents[n]["depth"] <= c["heartbeat_to"]: self.deliver(n, digest)
        self.log(ev="heartbeat", agent="system", step=self.steps, n=len(lines))

    def drain(self):
        while not self.q.empty():
            u = self.q.get()
            {"spawn": lambda: self.spawn(u["name"], u.get("parent"), u["task"], "user", u.get("emoji")),
             "kill": lambda: self.kill(u["name"], "user"),
             "send": lambda: self.send(u["name"], u["msg"], "user"),
             "stop": lambda: setattr(self, "running", False),
             "pause": lambda: setattr(self, "paused", True), "continue": lambda: setattr(self, "paused", False)}[u["op"]]()

    def loop(self):
        self.running = True
        if self.steps: self.cfg["max_steps"] = self.steps + self.cfg["resume_extra_steps"]; self.log(ev="resume", steps=self.steps, max_steps=self.cfg["max_steps"])
        while self.running:
            self.drain()
            if self.paused: time.sleep(self.cfg["idle_poll_s"]); continue   # paused: nothing auto-steps; user pings still answer
            if not self.alive(): self.log(ev="info", agent="system", msg="no agents alive, run ends"); break
            ready = [n for n in self.alive() if self.agents[n]["inbox"]]
            if not ready and self.cfg["auto_poke"]:
                ready = [n for n in self.alive() if not self.agents[n]["waiting"] and self.agents[n]["pokes"] < self.cfg["max_pokes"]
                         and not any(self.agents[c]["alive"] for c in self.agents[n]["children"])][:1]
            if not ready:  # everybody WAITing with no live children = deadlock: wake the deepest waiter once
                stuck = [n for n in self.alive() if self.agents[n]["waiting"] and self.agents[n]["pokes"] < self.cfg["max_pokes"]
                         and not any(self.agents[c]["alive"] for c in self.agents[n]["children"])]
                if stuck: ready = [stuck[-1]]; self.agents[stuck[-1]]["inbox"].append(self.cfg["deadlock_prompt"])
                for n in ready: self.agents[n]["pokes"] += 1
            if not ready or self.steps >= self.cfg["max_steps"]:
                time.sleep(self.cfg["idle_poll_s"]); continue
            for n in ready:
                if not self.running: break
                if not self.agents[n]["alive"] or not self.agents[n]["inbox"]: continue
                self.step(n); self.drain(); self.heartbeat()
        self.save(); self.log(ev="end", steps=self.steps, agents=len(self.agents), alive=len(self.alive()))

    def log_run(self):
        """The run header: logged by the server before the root spawn, so the UI reducer sees run → spawn in order."""
        self.log(ev="run", cfg=self.cfg, engine=self.cfg["engine"], model=self.eng.get("model") or "", slots=self.slots, slot_ctx=self.slot_ctx, max_agents=self.max_agents, slots_error=getattr(self, "slots_error", None), topology=self.cfg.get("topology"))

    def start(self):
        """Start or resume the loop (idempotent when running). Resuming keeps every agent's history: the user can revive any ended agent with a message."""
        if self.running: return
        threading.Thread(target=self.loop, daemon=True).start()
        if self.cfg["supervisor"]:
            from supervisor import Supervisor
            self.sup = Supervisor(self); time.sleep(0.2); self.sup.start()
