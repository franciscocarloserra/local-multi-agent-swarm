#!/usr/bin/env python3
"""Web panel + API. Experiments live in experiments/<name>/ (config.json, events.jsonl, raw.jsonl).
GET  /experiments            list      POST /experiments {name,from?}   create (copies template config.json)
GET  /exp/<n>/config         config    POST /exp/<n>/config {..}        persist + apply live
GET  /exp/<n>/events.jsonl   raw file  POST /exp/<n>/run | /stop
POST /exp/<n>/action {op:spawn|kill|send, name, parent?, task?, msg?}   user actions -> orchestrator"""
import json, os, re, shutil, unicodedata, urllib.parse, urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from orch import Orch

ROOT = os.path.dirname(os.path.abspath(__file__)); EXPS = f"{ROOT}/experiments"
tpl = json.load(open(f"{ROOT}/config.json")); orchs = {}

import subprocess, time
_gpu = {"t": 0, "v": None}
def gpu():
    if time.time() - _gpu["t"] > 2:
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"],
                                 capture_output=True, text=True, timeout=2).stdout.split(",")
            _gpu["v"] = {"mem_used": int(out[0]), "mem_total": int(out[1]), "util": int(out[2])}
        except Exception: _gpu["v"] = None
        _gpu["t"] = time.time()
    return _gpu["v"]

def cfg_path(n): return f"{EXPS}/{n}/config.json"

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()
    def reply(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def body(self): return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")

    def do_GET(self):
        p = self.path.strip("/").split("/", 2)
        if len(p) == 3 and not p[2].startswith(("file?", "agent?")): p[2] = p[2].split("?")[0]
        if p == ["experiments"]:
            return self.reply({"template": tpl, "list": [{"name": n, "running": n in orchs and orchs[n].running}
                                                          for n in sorted(os.listdir(EXPS))]})
        if p[0] == "exp" and len(p) == 3:
            if p[2] == "config": return self.reply(json.load(open(cfg_path(p[1]))))
            if p[2] == "runtime":
                o = orchs.get(p[1]); rt = {"running": bool(o and o.running), "paused": bool(o and o.paused), "steps": o.steps if o else 0,
                      "agents": [{"name": n, "alive": a["alive"], "waiting": a["waiting"], "inbox": len(a["inbox"]), "nsteps": a["nsteps"], "used": a["used"]} for n, a in o.agents.items()] if o else []}
                try:
                    sl = json.load(urllib.request.urlopen(tpl["llm_url"] + "/slots", timeout=2))
                    rt["slots"] = [{"id": x["id"], "busy": x["is_processing"], "n_ctx": x.get("n_ctx")} for x in sl]
                except Exception as e: rt["slots_error"] = str(e)
                rt["gpu"] = gpu()
                return self.reply(rt)
            if p[2] == "files":
                w = f"{EXPS}/{p[1]}/work"; os.makedirs(w, exist_ok=True)
                return self.reply([{"path": os.path.relpath(os.path.join(d, f), w), "size": os.path.getsize(os.path.join(d, f)),
                                    "mtime": os.path.getmtime(os.path.join(d, f))} for d, _, fs in os.walk(w) for f in fs])
            if p[2].startswith("agent?"):
                name = urllib.parse.unquote(p[2][6:]); o = orchs.get(p[1]); a = o.agents.get(name) if o else None
                if a: return self.reply({"history": a["history"], "inbox": a["inbox"], "alive": a["alive"], "status": a["status"], "waiting": a["waiting"], "used": a["used"], "live": True, "system": o.system_for(name)})
                last = None
                for line in open(f"{EXPS}/{p[1]}/raw.jsonl"):
                    r = json.loads(line)
                    if r["agent"] == name: last = r
                if not last: return self.reply({"history": [], "live": False})
                h = last["request"]["messages"][1:] + [{"role": "assistant", "content": last["response"]["choices"][0]["message"]["content"]}]
                return self.reply({"history": h, "system": last["request"]["messages"][0]["content"], "live": False})
            if p[2].startswith("file?"):
                w = f"{EXPS}/{p[1]}/work"; fp = os.path.realpath(os.path.join(w, p[2][5:]))
                if not fp.startswith(w): return self.reply({"error": "bad path"}, 403)
                data = open(fp, "rb").read(); self.send_response(200); self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(data))); self.end_headers(); return self.wfile.write(data)
            self.path = f"/experiments/{p[1]}/{p[2]}"
        super().do_GET()

    def do_POST(self):
        p = self.path.strip("/").split("/"); b = self.body()
        if p == ["experiments"]:
            d = f"{EXPS}/{b['name']}"; os.makedirs(d, exist_ok=True)
            src = cfg_path(b["from"]) if b.get("from") else f"{ROOT}/config.json"
            shutil.copy(src, cfg_path(b["name"])); return self.reply({"ok": True})
        if p[0] != "exp" or len(p) != 3: return self.reply({"error": "bad path"}, 404)
        n, op = p[1], p[2]
        if op == "config":
            json.dump(b, open(cfg_path(n), "w"), indent=2, ensure_ascii=False)
            if n in orchs: orchs[n].cfg.update(b)
            return self.reply({"ok": True})
        if op == "run":
            if n in orchs and orchs[n].running: return self.reply({"error": "running"}, 409)
            ev = f"{EXPS}/{n}/events.jsonl"
            if os.path.exists(ev) and os.path.getsize(ev) > 0:   # closed run: keep it, start a fresh dir named from the goal
                plain = unicodedata.normalize("NFKD", b.get("goal") or "run").encode("ascii", "ignore").decode().lower()
                slug = re.sub(r"[^a-z0-9]+", "-", plain).strip("-")[:40].rstrip("-") or "run"
                nums = [int(m.group(1)) for d in os.listdir(EXPS) if (m := re.match(r"^(\d{3})-", d))]
                new = f"{max(nums, default=0) + 1:03d}-{slug}"   # three-digit run id first: runs of the same goal stay distinguishable
                os.makedirs(f"{EXPS}/{new}"); shutil.copy(cfg_path(n), cfg_path(new)); n = new
            c = json.load(open(cfg_path(n)))
            if b.get("topology"): c["topology"] = b["topology"]
            if b.get("engine") in c["engines"]: c["engine"] = b["engine"]
            c.update(c["topologies"].get(c.get("topology"), {}))
            o = orchs[n] = Orch(f"{EXPS}/{n}", c)
            if b.get("goal"): o.cfg["root_task"] = b["goal"]; json.dump(o.cfg, open(cfg_path(n), "w"), indent=2, ensure_ascii=False)
            o.log_run(); o.spawn("root", None, o.cfg["root_task"], "user", o.cfg["root_emoji"]); o.start(); return self.reply({"ok": True, "exp": n})
        if op == "stop":
            if n in orchs: orchs[n].q.put({"op": "stop"})
            return self.reply({"ok": True})
        if op == "action":
            if n not in orchs:   # server restarted: rebuild from state.json (agent histories intact) and resume
                if not os.path.exists(f"{EXPS}/{n}/state.json"): return self.reply({"error": "no saved state for this run"}, 409)
                orchs[n] = Orch(f"{EXPS}/{n}", json.load(open(cfg_path(n))))
            o = orchs[n]
            if b.get("op") == "send": o.send(b["name"], b["msg"], "user"); return self.reply({"ok": True})   # immediate, answers even while paused; never auto-resumes the loop
            if b.get("op") == "pause": o.paused = True; o.log(ev="pause", by="user"); return self.reply({"ok": True})
            if b.get("op") == "continue": o.paused = False; o.log(ev="continue", by="user"); o.start(); return self.reply({"ok": True, "running": o.running})
            o.q.put(b); return self.reply({"ok": True})
        self.reply({"error": "bad op"}, 404)

os.chdir(ROOT); os.makedirs(EXPS, exist_ok=True)
print(f"http://localhost:{tpl['http_port']}")
ThreadingHTTPServer(("", tpl["http_port"]), H).serve_forever()
