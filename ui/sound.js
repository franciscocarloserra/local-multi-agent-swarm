// Subtle audio cues synthesized with WebAudio (no assets). Fires only for events newer than the page load.
import {S, on} from './state.js';
const VOL_SPAWN = 0.05, VOL_FILE = 0.04, SPAWN_MS = 90, FILE_MS = 220;
let ctx = null, seen = -1, cur = null;
const ac = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());
addEventListener('pointerdown', () => ac().resume(), {once: true});
function blip() { const c = ac(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
  o.type = 'sine'; o.frequency.setValueAtTime(660, t); o.frequency.exponentialRampToValueAtTime(1320, t + SPAWN_MS / 1000);
  g.gain.setValueAtTime(VOL_SPAWN, t); g.gain.exponentialRampToValueAtTime(0.0001, t + SPAWN_MS / 1000); o.connect(g).connect(c.destination); o.start(t); o.stop(t + SPAWN_MS / 1000); }
function rustle() { const c = ac(), n = Math.round(c.sampleRate * FILE_MS / 1000), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = b; f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.7; g.gain.value = VOL_FILE;
  s.connect(f).connect(g).connect(c.destination); s.start(); }
on('exp', () => { seen = -1; });
on('tick', () => { if (!ctx || ctx.state != 'running') { seen = S.evs.length; return; }
  if (seen < 0) { seen = S.evs.length; return; }
  const fresh = S.evs.slice(seen); seen = S.evs.length; const known = new Set(S.evs.slice(0, seen - fresh.length).filter(e => e.ev == 'fs' && e.op == 'WRITE').map(e => e.file));
  for (const e of fresh) { if (e.ev == 'spawn') blip(); else if (e.ev == 'fs' && e.op == 'WRITE' && !known.has(e.file)) { rustle(); known.add(e.file); } } });
