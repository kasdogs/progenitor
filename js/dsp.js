// Progenitor — semi-modular analog voice emulation
// AudioWorklet DSP engine. Everything runs in "volts" internally.
'use strict';

const OS = 2;                       // oversampling factor for the analog core
const TAU = Math.PI * 2;
const C4 = 261.6255653;

// ---------------------------------------------------------------- params
const PN = ['arpRate','arpMode','arpDir','arpOct','lfoRate','lfoWave','pitchAmt','cutoffAmt','pwAmt',
  'o1Oct','o1Wave','sync','o2Oct','o2Freq','o2Wave','mix1','mix2','mixN','cutoff','res','envAmt','kbTrack',
  'attack','decay','sustain','release','volume','vcaMode','revMix','hpf','att','glide','fine','modWheel',
  'instGain','triplet','legato'];
const PI = {}; PN.forEach((n, i) => PI[n] = i);
const DISCRETE = new Set(['arpMode','arpDir','arpOct','lfoWave','o1Oct','o1Wave','sync','o2Oct','o2Wave',
  'kbTrack','vcaMode','triplet','legato']);

// ---------------------------------------------------------------- jacks
const OUTS = ['o1Out','o2Out','mixOut','vcfOut','envPOut','envNOut','lfoOut','shOut','hpfOut','attOut',
  'gateOut','kbOut','velOut','clkOut','revOut','euroOut'];
const INS = ['o1Pitch','pwmIn','o2Pitch','fmIn','mix1In','mix2In','noiseIn','vcfIn','envAmtIn','cutoffIn',
  'trigIn','vcaAmtIn','vcaIn','revIn','rateIn','syncIn','hpfIn','attIn','clkIn','onoffIn','resetIn'];
const MULTS = ['mult1','mult2','mult3','mult4'];
const O = {}; OUTS.forEach((n, i) => O[n] = i);
const I = {}; INS.forEach((n, i) => I[n] = i);

const PPQN = [1,2,3,4,5,6,7,8,9,10,11,12,24,48];
const DIVS = [16,12,8,6,4,3,2,1.5,1,0.75,0.5,0.375,0.25,0.1875,0.125,0.09375,0.0625];
const TDIVS = [8/3,4/3,2/3,1/3,1/6,1/12,1/24];

function th(x) { // fast tanh
  if (x > 3) return 1; if (x < -3) return -1;
  const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2);
}
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

// ---------------------------------------------------------------- oscillator
// PolyBLEP oscillator with one sample of latency so step corrections can be
// spread over the samples on both sides of every discontinuity (wraps, pulse
// edges and hard-sync resets).
// waves: 0 tri, 1 saw up, 2 square, 3 narrow pulse, 4 sine, 5 saw down
class Osc {
  constructor() { this.p = Math.random(); this.prev = 0; this.b = 0; this.a = 0; this.wrapT = -1; }
  static val(w, p, pw) {
    switch (w) {
      case 0: return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
      case 1: return 2 * p - 1;
      case 2: case 3: return (p < pw ? 1 : -1) - (2 * pw - 1);
      case 4: return Math.sin(TAU * p);
      default: return 1 - 2 * p;
    }
  }
  ev(t, h) { const u = 1 - t; this.b += h * u * u * 0.5; this.a -= h * t * t * 0.5; }
  seg(p, dt, t0, t1, w, pw) {
    let rem = (t1 - t0) * dt, t = t0;
    if (rem <= 0) return p;
    const pulse = w === 2 || w === 3;
    for (let guard = 0; guard < 16; guard++) {
      const toPw = pulse && p < pw;
      const target = toPw ? pw : 1;
      const dist = target - p;
      if (dist > rem) return p + rem;
      t += dist / dt; rem -= dist;
      if (toPw) { p = pw; this.ev(t, -2); }
      else {
        p = 0; this.wrapT = t;
        const h = w === 1 ? -2 : (w === 5 || pulse) ? 2 : 0;
        if (h) this.ev(t, h);
      }
    }
    return p;
  }
  step(dt, w, pw, resetT) {
    this.b = 0; this.a = 0; this.wrapT = -1;
    let p = this.p;
    if (dt < 0) dt = 0;
    if (resetT >= 0) {
      p = this.seg(p, dt, 0, resetT, w, pw);
      const h = Osc.val(w, 0, pw) - Osc.val(w, p, pw);
      if (h) this.ev(resetT, h);
      p = this.seg(0, dt, resetT, 1, w, pw);
      this.wrapT = resetT;
    } else p = this.seg(p, dt, 0, 1, w, pw);
    if (p >= 1) p -= Math.floor(p);
    this.p = p;
    const y = Osc.val(w, p, pw) + this.a;
    const out = this.prev + this.b;
    this.prev = y;
    return out;
  }
}

// ---------------------------------------------------------------- ladder
// 4-pole transistor-ladder model (Huovilainen) with per-stage saturation,
// run at a further 2x internally on top of the engine's oversampling.
class Ladder {
  constructor() { this.y = [0,0,0,0]; this.t = [0,0,0]; this.d4 = 0; this.d5 = 0; }
  process(x, fc, res, fs) {
    const f = fc / (fs * 2), f2 = f * f, f3 = f2 * f;
    const fcr = 1.8730 * f3 + 0.4955 * f2 - 0.6490 * f + 0.9988;
    const acr = -3.9364 * f2 + 1.8409 * f + 0.9968;
    const g = 1 - Math.exp(-TAU * f * fcr);
    const k = 4 * res * acr;
    const y = this.y, t = this.t;
    for (let j = 0; j < 2; j++) {
      const inp = x - k * this.d5 + (Math.random() - 0.5) * 2e-3;
      y[0] += g * (th(inp) - t[0]); t[0] = th(y[0]);
      y[1] += g * (t[0] - t[1]);    t[1] = th(y[1]);
      y[2] += g * (t[1] - t[2]);    t[2] = th(y[2]);
      y[3] += g * (t[2] - th(y[3]));
      this.d5 = (y[3] + this.d4) * 0.5; this.d4 = y[3];
    }
    return this.d5;
  }
}

// ---------------------------------------------------------------- envelope
class ADSR {
  constructor() { this.v = 0; this.st = 0; this.g = false; }
  step(gate, ca, cd, cr, sus) {
    if (gate && !this.g) this.st = 1; else if (!gate && this.g) this.st = 3;
    this.g = gate;
    const st = this.st;
    if (st === 1) { this.v += (1.3 - this.v) * ca; if (this.v >= 1) { this.v = 1; this.st = 2; } }
    else if (st === 2) this.v += (sus - this.v) * cd;
    else if (st === 3) { this.v -= this.v * cr; if (this.v < 1e-6) { this.v = 0; this.st = 0; } }
    return this.v;
  }
}

// ---------------------------------------------------------------- halfband decimator
class HB {
  constructor() {
    const N = 31, M = 15, h = [];
    for (let n = -M; n <= M; n++) {
      const s = n === 0 ? 0.5 : Math.sin(Math.PI * n / 2) / (Math.PI * n);
      const w = 0.42 + 0.5 * Math.cos(Math.PI * n / (M + 1)) + 0.08 * Math.cos(2 * Math.PI * n / (M + 1));
      h.push(s * w);
    }
    const sum = h.reduce((a, b) => a + b, 0);
    this.k = []; this.c = [];
    h.forEach((v, i) => { if (Math.abs(v) > 1e-12) { this.k.push(i); this.c.push(v / sum); } });
    this.buf = new Float64Array(64); this.pos = 0;
  }
  push(x) { this.buf[this.pos] = x; this.buf[this.pos + 32] = x; this.pos = (this.pos + 1) & 31; }
  out() {
    let s = 0; const b = this.buf, p = this.pos + 1, k = this.k, c = this.c;
    for (let i = 0; i < k.length; i++) s += c[i] * b[p + k[i]];
    return s;
  }
}

// ---------------------------------------------------------------- spring reverb
// Dispersive spring model: cascade of stretched allpasses (the "chirp") inside
// a damped feedback delay, two springs of different lengths in parallel.
class Spring {
  constructor(fs, len, fc, a, n, seed) {
    this.fs = fs; this.N = n; this.M = Math.max(1, Math.round(fs / (2 * fc))); this.a = a;
    this.ap = []; for (let i = 0; i < n; i++) this.ap.push(new Float64Array(this.M));
    this.ai = 0;
    this.base = len * fs; this.dlen = Math.ceil(this.base * 1.02) + 8;
    this.dl = new Float64Array(this.dlen); this.w = 0;
    this.lp = 0; this.lpc = 1 - Math.exp(-TAU * 3600 / fs);
    this.g = -Math.pow(10, -3 * len / 2.6);
    this.ph = seed; this.phInc = TAU * (0.37 + seed * 0.1) / fs;
  }
  process(x) {
    let v = x + this.lp * this.g;
    const a = this.a, i = this.ai;
    for (let k = 0; k < this.N; k++) {
      const b = this.ap[k], z = b[i], w = v - a * z;
      b[i] = w; v = a * w + z;
    }
    this.ai = (i + 1) % this.M;
    this.dl[this.w] = v;
    this.ph += this.phInc; if (this.ph > TAU) this.ph -= TAU;
    const d = this.base * (1 + 0.004 * Math.sin(this.ph));
    let r = this.w - d; while (r < 0) r += this.dlen;
    const r0 = Math.floor(r), fr = r - r0, r1 = (r0 + 1) % this.dlen;
    const y = this.dl[r0] * (1 - fr) + this.dl[r1] * fr;
    this.w = (this.w + 1) % this.dlen;
    this.lp += (y - this.lp) * this.lpc;
    return y;
  }
}

// ---------------------------------------------------------------- arp / seq / keyboard controller
class Ctl {
  constructor(e) {
    this.e = e; this.fs = e.fsB;
    this.held = []; this.sus = false;
    this.latch = []; this.latchFresh = true;
    this.play = false; this.hold = false; this.tap = false; this.persist = false;
    this.oct = 0; this.semi = 0;
    this.cv = 0; this.cvT = 0; this.glideOn = false; this.glideFrom = 0;
    this.gate = false; this.dip = 0; this.vel = 100; this.note = -1;
    this.seqs = [[], [], []]; this.recFresh = true; this.pendTie = false; this.editing = false; this.cur = 0;
    this.running = false; this.idx = 0; this.dirSign = 1;
    this.qpos = 0; this.lastStep = -1; this.gateOffQ = -1; this.gateOffF = -1;
    this.taps = []; this.tapQps = 2;
    this.midiLastF = -1e9; this.midiQps = 2; this.midiTicks = 0; this.midiLimit = Infinity;
    this.extLastF = -1; this.extQps = 2; this.extCount = 0; this.extLimit = Infinity;
    this.prevClk = 0; this.prevReset = 0; this.prevOnOff = null;
    this.clkOutCnt = 0; this.clkPulse = 0; this.midiOutCnt = 0;
    this.f = 0; this.led = 0; this.transNote = 60;
  }
  mode() { return this.e.S[PI.arpMode]; }
  seqSel() { return this.e.S[PI.arpOct]; }
  glideTime() { const k = this.e.S[PI.glide]; return k < 0.004 ? 0 : 0.002 * Math.pow(2000, k); }
  pick() {
    const h = this.held, pr = this.e.g.prio;
    if (pr === 0) return h.reduce((m, x) => Math.min(m, x.n), 999);
    if (pr === 1) return h.reduce((m, x) => Math.max(m, x.n), -999);
    return h[h.length - 1].n;
  }
  setNote(n, retrig, overlap) {
    const gt = this.glideTime(), legato = this.e.S[PI.legato] > 0.5;
    this.cvT = (n - 60) / 12;
    if (gt > 0 && (!legato || overlap)) { this.glideOn = true; this.glideFrom = this.cv; }
    else { this.cv = this.cvT; this.glideOn = false; }
    if (retrig && this.gate) this.dip = Math.round(this.fs * 0.0015);
    if (this.note !== n || retrig) {
      if (this.note >= 0) this.e.evq.push({ t: 'mo', on: 0, n: this.note });
      this.e.evq.push({ t: 'mo', on: 1, n, v: this.vel });
    }
    this.gate = true; this.note = n;
  }
  gateOff() {
    this.gate = false;
    if (this.note >= 0) this.e.evq.push({ t: 'mo', on: 0, n: this.note });
    this.note = -1;
  }
  direct(on, overlap, newN) {
    const live = this.held.filter(h => !h.sus || true);
    if (!live.length) { this.gateOff(); return; }
    const p = this.pick();
    if (on) { if (p === newN) this.setNote(p, true, overlap); }
    else if (p !== this.note) this.setNote(p, false, true);
  }
  noteOn(key, vel, src) {
    const n = key + (src === 'kb' ? this.oct * 12 + this.semi : 0);
    const wasEmpty = this.held.length === 0;
    this.held = this.held.filter(h => !(h.k === key && h.src === src));
    this.held.push({ k: key, n, v: vel, src, sus: false });
    this.vel = vel;
    const m = this.mode();
    if (m === 2 && this.running && this.editing) { this.editNote(n); return; }
    if (m === 2 && !this.running) { this.recNote(n, !wasEmpty); this.direct(true, !wasEmpty, n); return; }
    if (this.play && m === 0) {
      if (this.hold) { if (this.latchFresh) { this.latch = []; this.latchFresh = false; } this.latch.push(n); }
      if (!this.running) this.startRun();
      return;
    }
    if (this.play && m === 1) { this.transNote = n; if (!this.running) this.startRun(); return; }
    this.direct(true, !wasEmpty, n);
  }
  noteOff(key, src) {
    const h = this.held.find(h => h.k === key && h.src === src);
    if (!h) return;
    if (this.sus) { h.sus = true; return; }
    this.release(h);
  }
  release(h) {
    this.held = this.held.filter(x => x !== h);
    if (!this.held.length) this.latchFresh = true;
    const m = this.mode();
    if (this.running) {
      if (this.editing) return;
      if (!this.hold && !this.held.length) { this.stopRun(); return; }
      if (m === 1 && this.held.length) this.transNote = this.held[this.held.length - 1].n;
      return;
    }
    this.direct(false);
  }
  sustain(on) {
    this.sus = on;
    if (!on) this.held.filter(h => h.sus).forEach(h => this.release(h));
  }
  octave(d) {
    const o = clamp(this.oct + d, -2, 2), delta = (o - this.oct) * 12;
    this.oct = o;
    if (this.e.g.transpose === 1 && delta) {
      this.held.forEach(h => { if (h.src === 'kb') h.n += delta; });
      this.latch = this.latch.map(n => n + delta);
      if (!this.running && this.held.length) this.setNote(this.pick(), false, true);
      else if (this.running && this.mode() === 1) this.transNote += delta;
    }
  }
  // ---- arp/seq transport
  synced() {
    const g = this.e.g;
    return this.e.src[I.clkIn] !== -1 || (g.midiClkIn !== 2 && this.f - this.midiLastF < this.fs * 0.5) || this.tap || this.persist;
  }
  startRun() {
    this.running = true; this.idx = 0; this.dirSign = 1;
    const ext = this.e.src[I.clkIn] !== -1, midi = this.e.g.midiClkIn !== 2 && this.f - this.midiLastF < this.fs * 0.5;
    if (!ext && !midi) { this.qpos = 0; this.lastStep = -1; }
    if (ext && this.e.g.extMode === 1) this.pendingAdv = true;
  }
  stopRun() {
    this.running = false; this.editing = false; this.gateOffQ = -1; this.gateOffF = -1;
    this.gateOff();
    if (!this.play && this.held.length) this.setNote(this.pick(), true, false);
  }
  setPlay(on) {
    if (on === this.play) return;
    this.play = on;
    const g = this.e.g;
    if (g.midiClkOut === 0) this.e.evq.push({ t: on ? 'mstart' : 'mstop' });
    if (!on) { if (this.running) this.stopRun(); else if (this.held.length) this.setNote(this.pick(), false, true); return; }
    const m = this.mode();
    if (m === 0 && (this.held.length || (this.hold && this.latch.length))) { this.gateOff(); this.startRun(); }
    else if (m === 1 && this.held.length) { this.transNote = this.held[this.held.length - 1].n; this.gateOff(); this.startRun(); }
  }
  btnPlay() {
    if (this.mode() === 2) {
      if (this.running && this.editing) { const s = this.curStep(); if (s) { s.t = !s.t; this.postSeqs(); } }
      else { this.pendTie = true; }
      return;
    }
    this.setPlay(!this.play);
  }
  btnHold() {
    if (this.mode() === 2) {
      if (this.running && this.editing) { const s = this.curStep(); if (s) { s.r = true; this.postSeqs(); } }
      else this.recRest();
      return;
    }
    this.hold = !this.hold;
    if (this.hold) { this.latch = this.held.map(h => h.n); this.latchFresh = this.held.length === 0; }
    else { this.latch = []; if (this.running && !this.held.length) this.stopRun(); }
  }
  btnTap() {
    if (this.mode() === 2) {
      const seq = this.seqs[this.seqSel()];
      const s = this.running && this.editing ? this.curStep() : seq[seq.length - 1];
      if (s) { s.a = !s.a || !(this.running && this.editing); this.postSeqs(); }
      return;
    }
    const now = this.f / this.fs;
    this.taps = this.taps.filter(t => now - t < 2.5); this.taps.push(now);
    if (this.taps.length >= 3 || (this.tap && this.taps.length >= 2)) {
      const iv = []; for (let i = 1; i < this.taps.length; i++) iv.push(this.taps[i] - this.taps[i - 1]);
      const avg = iv.reduce((a, b) => a + b, 0) / iv.length;
      if (avg > 0.05) { this.tapQps = 1 / avg; this.tap = true; this.persist = false; }
    }
  }
  tapExit() { this.tap = false; this.taps = []; this.persist = !!this.e.g.tapPersist; }
  modeChanged(old, nu) {
    if (nu === 2) {
      if (this.running && old === 1) this.editing = true;
      else { if (this.running) this.stopRun(); this.recFresh = true; this.pendTie = false; }
    } else if (old === 2) {
      this.editing = false; this.postSeqs();
      if (nu === 1 && this.running) return;
    } else if (this.running) { this.idx = 0; }
    if (nu !== 2 && !this.running && this.play) {
      if ((nu === 0 && (this.held.length || this.latch.length)) || (nu === 1 && this.held.length)) this.startRun();
    }
  }
  seqChanged() { if (this.mode() === 2 && !this.running) this.recFresh = true; this.idx = 0; }
  curStep() { return this.seqs[this.seqSel()][this.cur]; }
  seqRoot(seq) { const s = seq.find(s => !s.r); return s ? s.n : 60; }
  recNote(n, legato) {
    const seq = this.seqs[this.seqSel()];
    if (this.recFresh) { seq.length = 0; this.recFresh = false; }
    if (seq.length >= 256) return;
    seq.push({ n, t: this.pendTie || legato, r: false, a: false });
    this.pendTie = false; this.postSeqs();
  }
  recRest() {
    const seq = this.seqs[this.seqSel()];
    if (this.recFresh) { seq.length = 0; this.recFresh = false; }
    if (seq.length >= 256) return;
    seq.push({ n: 60, t: false, r: true, a: false }); this.pendTie = false; this.postSeqs();
  }
  editNote(n) {
    const seq = this.seqs[this.seqSel()], s = seq[this.cur];
    if (!s) return;
    const tr = this.transNote - this.seqRoot(seq);
    s.n = n - tr; s.r = false;
    this.setNote(n, true, false); this.postSeqs();
  }
  postSeqs() { this.e.evq.push({ t: 'seqs', d: this.seqs }); }
  divNow() {
    if (!this.synced()) return 0.5;
    const k = this.e.S[PI.arpRate];
    if (this.e.S[PI.triplet] > 0.5) return TDIVS[Math.round(k * (TDIVS.length - 1))];
    return DIVS[Math.round(k * (DIVS.length - 1))];
  }
  doStep(stepQ, div) {
    const m = this.mode();
    if (m === 0) {
      const notes = this.hold ? this.latch : this.held.map(h => h.n);
      if (!notes.length) { this.gateOff(); return; }
      const oc = this.e.S[PI.arpOct] + 1, dir = this.e.S[PI.arpDir];
      let list = [];
      for (let o = 0; o < oc; o++) for (const n of notes) list.push(n + 12 * o);
      if (dir === 1 && list.length > 2) list = list.concat(list.slice(1, -1).reverse());
      let n;
      if (dir === 2) n = list[Math.floor(Math.random() * list.length)];
      else { if (this.idx >= list.length) this.idx = 0; n = list[this.idx]; this.idx = (this.idx + 1) % list.length; }
      const lastHeld = this.held[this.held.length - 1]; if (lastHeld) this.vel = lastHeld.v;
      this.setNote(n, true, false);
      this.armGateOff(stepQ, div, false);
    } else {
      const seq = this.seqs[this.seqSel()], L = seq.length;
      if (!L) { this.gateOff(); return; }
      const tr = this.transNote - this.seqRoot(seq);
      let i = this.idx; if (i >= L) i = 0;
      const s = seq[i]; this.cur = i;
      const dir = this.e.S[PI.arpDir];
      let nx;
      if (dir === 0) nx = (i + 1) % L;
      else if (dir === 1) { if (L === 1) nx = 0; else { if (i + this.dirSign < 0 || i + this.dirSign >= L) this.dirSign = -this.dirSign; nx = i + this.dirSign; } }
      else nx = Math.floor(Math.random() * L);
      this.idx = nx;
      if (s.r) { this.gateOff(); this.gateOffQ = -1; this.gateOffF = -1; return; }
      const tie = s.t && this.gate;
      this.setNote(s.n + tr, !tie, tie);
      if (s.a) this.e.accTrig();
      const nxt = seq[nx];
      this.armGateOff(stepQ, div, !!(nxt && !nxt.r && nxt.t));
    }
  }
  armGateOff(stepQ, div, through) {
    if (through) { this.gateOffQ = -1; this.gateOffF = -1; return; }
    if (this.stepAdv) this.gateOffF = this.f + this.advLen * 0.5;
    else this.gateOffQ = stepQ + div * 0.5;
  }
  midiClock(k) {
    const g = this.e.g; if (g.midiClkIn === 2) return;
    if (k === 'tick') {
      const df = this.f - this.midiLastF;
      if (df > 0 && df < this.fs) { const q = (1 / 24) / (df / this.fs); this.midiQps += (q - this.midiQps) * 0.15; }
      this.midiLastF = this.f; this.midiTicks++;
      const pq = this.midiTicks / 24; if (pq > this.qpos) this.qpos = pq;
      this.midiLimit = pq + 1 / 24;
    } else if (k === 'start') {
      this.midiTicks = 0; this.qpos = 0; this.lastStep = -1; this.midiLastF = this.f; this.midiLimit = 1 / 24;
      if (g.midiClkIn === 0) { this.setPlay(true); this.idx = 0; }
    } else if (k === 'stop') { if (g.midiClkIn === 0) this.setPlay(false); }
    else if (k === 'cont') { if (g.midiClkIn === 0) this.setPlay(true); }
  }
  panic() {
    this.held = []; this.latch = []; this.sus = false;
    if (this.running) { this.running = false; this.editing = false; }
    this.gateOff(); this.e.evq.push({ t: 'panic' });
  }
  // per base-rate sample
  tick() {
    const e = this.e, g = e.g, fs = this.fs;
    this.f++;
    // rear-panel transport inputs
    if (e.src[I.onoffIn] !== -1) {
      const on = e.inp(I.onoffIn, 0) > 2.5;
      if (on !== this.prevOnOff) { this.prevOnOff = on; this.setPlay(on); }
    } else this.prevOnOff = null;
    const rs = e.src[I.resetIn] !== -1 ? e.inp(I.resetIn, 0) : 0;
    if (rs > 3 && this.prevReset <= 3) { this.idx = 0; this.dirSign = 1; }
    this.prevReset = rs;

    const ext = e.src[I.clkIn] !== -1;
    const cv = ext ? e.inp(I.clkIn, 0) : 0;
    const edge = ext && cv > 3 && this.prevClk <= 3; this.prevClk = cv;
    const midiOn = !ext && g.midiClkIn !== 2 && this.f - this.midiLastF < fs * 0.5;
    this.stepAdv = ext && g.extMode === 1;
    const div = this.divNow();

    if (this.stepAdv) {
      if (edge) {
        this.advLen = this.extLastF > 0 ? Math.min(this.f - this.extLastF, fs * 4) : fs * 0.25;
        this.extLastF = this.f; this.led = 1;
        if (this.running) this.doStep(0, div);
      }
      if (this.gateOffF >= 0 && this.f >= this.gateOffF) { this.gateOffF = -1; this.gateOff(); }
    } else {
      let qps, limit = Infinity;
      if (ext) {
        if (edge) {
          const ppq = PPQN[g.ppqnIn];
          if (this.extLastF > 0) { const dt = (this.f - this.extLastF) / fs; if (dt < 4) this.extQps += ((1 / ppq) / dt - this.extQps) * 0.5; }
          this.extLastF = this.f; this.extCount++;
          const pq = this.extCount / ppq; if (pq > this.qpos) this.qpos = pq;
          this.extLimit = pq + 1 / ppq;
        }
        qps = this.extQps; limit = this.extLimit;
      } else if (midiOn) { qps = this.midiQps; limit = this.midiLimit; }
      else if (this.tap || this.persist) qps = this.tapQps;
      else qps = 20 * Math.pow(14, e.S[PI.arpRate]) / 60;
      this.qps = qps;
      this.qpos = Math.min(this.qpos + qps / fs, limit);
      const sc = Math.floor(this.qpos / div + 1e-9);
      if (sc !== this.lastStep) {
        this.lastStep = sc; this.led = 1;
        if (this.running) this.doStep(sc * div, div);
      }
      if (this.gateOffQ >= 0 && this.qpos >= this.gateOffQ) { this.gateOffQ = -1; this.gateOff(); }
      // clock outputs
      const clkRun = this.running || g.clkOutMode === 1;
      const c = Math.floor(this.qpos * PPQN[g.ppqnOut]);
      if (c !== this.clkOutCnt) { this.clkOutCnt = c; if (clkRun) this.clkPulse = Math.round(fs * 0.005); }
      const c24 = Math.floor(this.qpos * 24);
      if (c24 !== this.midiOutCnt) { this.midiOutCnt = c24; if (g.midiClkOut !== 2 && clkRun && !midiOn) e.evq.push({ t: 'clk' }); }
    }
    if (this.stepAdv && edge && (this.running || g.clkOutMode === 1)) this.clkPulse = Math.round(fs * 0.005);
    if (this.clkPulse > 0) this.clkPulse--;

    // glide
    if (this.glideOn) {
      const t = this.glideTime();
      if (t <= 0) { this.cv = this.cvT; this.glideOn = false; }
      else if (!(g.gatedGlide && !this.gate)) {
        const d = this.cvT - this.cv;
        if (g.glideType === 2) { this.cv += d * (1 - Math.exp(-3 / (t * fs))); if (Math.abs(d) < 1e-5) { this.cv = this.cvT; this.glideOn = false; } }
        else {
          const step = g.glideType === 0 ? 1 / (t * fs) : Math.max(Math.abs(this.cvT - this.glideFrom), 1e-4) / (t * fs);
          if (Math.abs(d) <= step) { this.cv = this.cvT; this.glideOn = false; } else this.cv += d > 0 ? step : -step;
        }
      }
    }
    let gateNow = this.gate;
    if (this.dip > 0) { this.dip--; gateNow = false; }
    this.gateNow = gateNow;
  }
}

// ---------------------------------------------------------------- engine
class Progenitor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fsB = sampleRate; this.fs = sampleRate * OS;
    this.P = new Float64Array(PN.length); this.S = new Float64Array(PN.length);
    this.disc = PN.map(n => DISCRETE.has(n));
    this.outs = new Float64Array(OUTS.length);
    this.src = new Int16Array(INS.length).fill(-1);
    this.multSrc = []; this.multV = 0;
    this.g = { midiCh: 0, midiClkIn: 0, midiClkOut: 0, prio: 2, bendUp: 2, bendDn: 2, extMode: 0, ppqnIn: 1, ppqnOut: 1,
      kbRange: 0, glideType: 0, gatedGlide: 1, transpose: 0, tapPersist: 0, velRange: 0, o2Range: 7, clkOutMode: 0,
      drift: 0.5, warm: 0 };
    this.o1 = new Osc(); this.o2 = new Osc(); this.lfo = new Osc();
    this.lad = new Ladder(); this.env = new ADSR();
    this.kbr = 0; this.acc = 0; this.accSt = 0;
    this.hpX = 0; this.hpY = 0; this.fmX = 0; this.fmY = 0;
    this.sh = 0; this.prevSync = 0; this.bend = 0;
    this.dec = new HB();
    this.spr = [new Spring(this.fsB, 0.0337, 4300, 0.62, 44, 0.1), new Spring(this.fsB, 0.0419, 3900, 0.6, 40, 0.7)];
    this.preHpX = 0; this.preHpY = 0; this.preLp = 0; this.revLp = 0;
    this.dcX = 0; this.dcY = 0;
    this.ctl = new Ctl(this);
    this.drift = [0, 0]; this.driftT = [0, 0]; this.driftN = 0; this.warmT = 0;
    this.evq = [];
    this.scope = new Float32Array(1024); this.scopeI = 0; this.uiT = 0; this.peak = 0;
    this.inited = false; this.power = true;
    this.port.onmessage = ev => this.msg(ev.data);
  }
  setParam(k, v) {
    const i = PI[k]; if (i === undefined) return;
    const old = this.P[i];
    this.P[i] = v;
    if (this.disc[i] || !this.inited) this.S[i] = v;
    if (k === 'arpMode' && old !== v && this.inited) this.ctl.modeChanged(old, v);
    if (k === 'arpOct' && old !== v && this.inited) this.ctl.seqChanged();
  }
  resolvePatch(cables) {
    this.src.fill(-1); this.multSrc = [];
    const kind = j => O[j] !== undefined ? 'o' : I[j] !== undefined ? 'i' : MULTS.includes(j) ? 'm' : null;
    for (const [a, b] of cables) {
      const ka = kind(a), kb = kind(b);
      let out = null, inp = null, toMult = false, fromMult = false;
      if (ka === 'o' && kb === 'i') { out = a; inp = b; }
      else if (ka === 'i' && kb === 'o') { out = b; inp = a; }
      else if (ka === 'o' && kb === 'm') { out = a; toMult = true; }
      else if (ka === 'm' && kb === 'o') { out = b; toMult = true; }
      else if (ka === 'm' && kb === 'i') { inp = b; fromMult = true; }
      else if (ka === 'i' && kb === 'm') { inp = a; fromMult = true; }
      if (toMult) this.multSrc.push(O[out]);
      else if (fromMult) this.src[I[inp]] = -2;
      else if (out && inp) this.src[I[inp]] = O[out];
    }
  }
  msg(d) {
    const c = this.ctl;
    switch (d.t) {
      case 'p': this.setParam(d.k, d.v); break;
      case 'ps': for (const k in d.v) this.setParam(k, d.v[k]); this.inited = true; break;
      case 'patch': this.resolvePatch(d.c); break;
      case 'on': c.noteOn(d.k, d.v, d.s); break;
      case 'off': c.noteOff(d.k, d.s); break;
      case 'bend': this.bend = d.v; break;
      case 'play': c.btnPlay(); break;
      case 'hold': c.btnHold(); break;
      case 'tap': c.btnTap(); break;
      case 'tapx': c.tapExit(); break;
      case 'oct': c.octave(d.d); break;
      case 'semi': c.semi = d.v; break;
      case 'g': Object.assign(this.g, d.v); break;
      case 'seqs': c.seqs = d.v; break;
      case 'mclk': c.midiClock(d.k); break;
      case 'sus': c.sustain(d.v); break;
      case 'panic': c.panic(); break;
      case 'setplay': c.setPlay(!!d.v); break;
      case 'sethold': if (!!d.v !== c.hold && c.mode() !== 2) c.btnHold(); break;
      case 'kick': this.kick = 1; break;
    }
  }
  inp(i, normal) { const s = this.src[i]; return s === -1 ? normal : s === -2 ? this.multV : this.outs[s]; }
  accTrig() { this.accSt = 1; }

  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1];
    const inst = inputs[0] && inputs[0][0];
    const P = this.P, S = this.S, n = L.length, fs = this.fs, fsB = this.fsB, o = this.outs, c = this.ctl, g = this.g;
    for (let i = 0; i < n; i++) {
      // parameter smoothing (~8 ms)
      for (let k = 0; k < S.length; k++) if (!this.disc[k]) S[k] += (P[k] - S[k]) * 0.003;
      c.tick();

      // analog drift: slow wandering per oscillator
      if (--this.driftN <= 0) { this.driftN = fsB * (1 + Math.random() * 2); this.driftT = [Math.random() * 2 - 1, Math.random() * 2 - 1]; }
      const dc = (g.drift * 4) / 1200;
      this.drift[0] += (this.driftT[0] * dc - this.drift[0]) * 0.00002;
      this.drift[1] += (this.driftT[1] * dc - this.drift[1]) * 0.00002;
      let warm = 0;
      if (g.warm) { this.warmT += 1 / fsB; warm = (14 / 1200) * Math.exp(-this.warmT / 75); }

      // per-base-sample derived values
      const ca = 1 - Math.exp(-1.466 / (0.001 * Math.pow(10000, S[PI.attack]) * fs));
      const cd = 1 - Math.exp(-3.5 / (0.001 * Math.pow(10000, S[PI.decay]) * fs));
      const relT = 0.001 * Math.pow(10000, S[PI.release]);
      const cr = 1 - Math.exp(-3.5 / (relT * fs));
      const sus = S[PI.sustain];
      const lfoK = 14.214 * S[PI.lfoRate];
      const lfoW = [4, 5, 1, 2][S[PI.lfoWave]];
      const mw = S[PI.modWheel];
      const pAmt = S[PI.pitchAmt] * mw * 1.5, cAmt = S[PI.cutoffAmt] * mw * 4, wAmt = S[PI.pwAmt] * mw * 0.45;
      const bendV = (this.bend >= 0 ? this.bend * g.bendUp : this.bend * g.bendDn) / 12;
      const fineV = (S[PI.fine] - 0.5) * 2 / 12;
      const base1 = c.cv + (S[PI.o1Oct] - 2) + fineV + bendV + this.drift[0] + warm;
      const syncOn = S[PI.sync] > 0.5;
      const range = syncOn ? Math.max(24, g.o2Range * 3) : g.o2Range;
      const base2 = c.cv + (S[PI.o2Oct] - 1) + fineV + bendV + this.drift[1] + warm * 1.3 + (S[PI.o2Freq] - 0.5) * 2 * range / 12;
      const w1 = S[PI.o1Wave], w2 = S[PI.o2Wave];
      const pb1 = w1 === 3 ? 0.14 : 0.5, pb2 = w2 === 3 ? 0.14 : 0.5;
      const m1 = S[PI.mix1] * 1.5, m2 = S[PI.mix2] * 1.5, mN = S[PI.mixN] * 1.5;
      const cutBase = 3.3219 + 10.966 * S[PI.cutoff];
      const kbt = [0.5, 0, 1][S[PI.kbTrack]];
      const res = Math.pow(S[PI.res], 0.85) * 1.07;
      const envAmtK = (S[PI.envAmt] - 0.5) * 2;
      const vcaMode = S[PI.vcaMode];
      const hpA = Math.exp(-TAU * 20 * Math.pow(500, S[PI.hpf]) / fs);
      const attK = (S[PI.att] - 0.5) * 2;
      const gateV = c.gateNow ? 8 : 0;
      const instV = inst ? inst[i] * S[PI.instGain] * 40 : 0;
      // arp/seq outputs
      o[O.gateOut] = gateV;
      o[O.kbOut] = g.kbRange ? clamp(c.cv + 5, 0, 10) : clamp(c.cv, -5, 5);
      if (this.accSt === 1) { this.acc += (1.05 - this.acc) * 0.02; if (this.acc >= 1) this.accSt = 2; }
      else this.acc -= this.acc * 0.0012;
      if (c.running && c.mode() !== 0) o[O.velOut] = this.acc * 5;
      else o[O.velOut] = g.velRange ? c.vel / 127 * 10 : c.vel / 127 * 10 - 5;
      o[O.clkOut] = c.clkPulse > 0 ? 5 : 0;

      for (let s = 0; s < OS; s++) {
        // mult (passive: average of everything driving it)
        const ms = this.multSrc;
        if (ms.length) { let a = 0; for (let k = 0; k < ms.length; k++) a += o[ms[k]]; this.multV = a / ms.length; } else this.multV = 0;
        const noise = (Math.random() + Math.random() - 1) * 6;

        // modulation oscillator
        const sv = this.inp(I.syncIn, 0);
        let rT = -1;
        if (sv > 3 && this.prevSync <= 3) rT = clamp((3 - this.prevSync) / (sv - this.prevSync + 1e-9), 0, 1);
        this.prevSync = sv;
        const lHz = Math.min(0.07 * Math.pow(2, lfoK + this.inp(I.rateIn, 0)), fs * 0.2);
        const lfoV = this.lfo.step(lHz / fs, lfoW, 0.5, rT) * 5;
        if (this.lfo.wrapT >= 0) this.sh = (Math.random() * 2 - 1) * 5;
        o[O.lfoOut] = lfoV; o[O.shOut] = this.sh;
        const ln = lfoV / 5;

        // attenuator (input normalled to +8V)
        o[O.attOut] = this.inp(I.attIn, 8) * attK;

        // envelope
        const trig = this.inp(I.trigIn, gateV) > 2.3;
        const ev = this.env.step(trig, ca, cd, cr, sus);
        o[O.envPOut] = ev * 8; o[O.envNOut] = -ev * 8;
        this.kbr = trig ? this.kbr + (1 - this.kbr) * 0.02 : this.kbr - this.kbr * cr;

        // oscillators
        const pwm = this.inp(I.pwmIn, 0) / 5 * 0.45 + ln * wAmt;
        const pm = ln * pAmt;
        const f1 = C4 * Math.pow(2, base1 + pm + this.inp(I.o1Pitch, 0));
        const y1 = this.o1.step(f1 / fs, w1, clamp(pb1 + pwm, 0.03, 0.97), -1) * 5;
        const fmIn = this.inp(I.fmIn, 0);
        this.fmY = 0.9995 * (this.fmY + fmIn - this.fmX); this.fmX = fmIn;
        const f2 = C4 * Math.pow(2, base2 + pm + this.inp(I.o2Pitch, 0)) * (1 + this.fmY * 0.25);
        const y2 = this.o2.step(Math.max(f2, 0) / fs, w2, clamp(pb2 + pwm, 0.03, 0.97), syncOn ? this.o1.wrapT : -1) * 5;
        o[O.o1Out] = y1; o[O.o2Out] = y2;

        // mixer (DC coupled, soft saturating)
        const sum = this.inp(I.mix1In, y1) * m1 + this.inp(I.mix2In, y2) * m2 + this.inp(I.noiseIn, noise) * mN + instV;
        const mix = 6 * (th(sum / 6 + 0.04) - 0.04);
        o[O.mixOut] = mix;

        // ladder filter
        const x = this.inp(I.vcfIn, mix);
        const ea = clamp(envAmtK + this.inp(I.envAmtIn, 0) / 8, -1.5, 1.5);
        const oct = cutBase + kbt * c.cv + ea * ev * 7 + this.inp(I.cutoffIn, 0) + ln * cAmt;
        const fc = clamp(Math.pow(2, oct), 5, 22000);
        const vcf = this.lad.process(x * 0.2, fc, res, fs) * 5;
        o[O.vcfOut] = vcf;

        // VCA
        let cvA = vcaMode === 0 ? ev : vcaMode === 1 ? this.kbr : 1;
        if (this.src[I.vcaAmtIn] !== -1) {
          const a = this.inp(I.vcaAmtIn, 0) / 8;
          cvA = vcaMode === 2 ? clamp(a, 0, 1) : cvA * clamp(a, -1, 1);
        }
        const vca = 8 * th(this.inp(I.vcaIn, vcf) * cvA / 8);

        // high pass (static, 1-pole)
        const hx = this.inp(I.hpfIn, 0);
        this.hpY = hpA * (this.hpY + hx - this.hpX); this.hpX = hx;
        o[O.hpfOut] = this.hpY;

        this.dec.push(this.inp(I.revIn, vca));
      }

      // ---- base rate: spring tank and output stage
      const dry = this.dec.out();
      let rx = dry - this.preHpX; this.preHpY = 0.985 * (this.preHpY + rx); this.preHpX = dry;
      this.preLp += (this.preHpY - this.preLp) * 0.45;
      let drive = th(this.preLp * 0.12) * 4;
      if (this.kick) { drive += (Math.random() * 2 - 1) * 30 * this.kick; this.kick *= 0.97; if (this.kick < 0.01) this.kick = 0; }
      const wet = (this.spr[0].process(drive) + this.spr[1].process(drive * 0.9)) * 0.9;
      this.revLp += (wet - this.revLp) * 0.5;
      o[O.revOut] = this.revLp;
      const mx = S[PI.revMix];
      const mixed = dry * Math.cos(mx * Math.PI / 2) + this.revLp * Math.sin(mx * Math.PI / 2) * 1.2;
      o[O.euroOut] = clamp(mixed, -5, 5);
      const vol = S[PI.volume];
      let y = mixed * vol * vol / 4;
      this.dcY = 0.9997 * (this.dcY + y - this.dcX); this.dcX = y; y = this.dcY;
      y = Math.abs(y) < 0.8 ? y : Math.sign(y) * (0.8 + 0.2 * th((Math.abs(y) - 0.8) / 0.2));
      if (!this.power) y = 0;
      L[i] = y; if (R) R[i] = y;
      this.scope[this.scopeI] = y; this.scopeI = (this.scopeI + 1) & 1023;
      const ay = Math.abs(y); if (ay > this.peak) this.peak = ay;
    }
    // UI state ~30 Hz
    this.uiT += n;
    if (this.uiT > this.fsB / 30) {
      this.uiT = 0;
      const sc = new Float32Array(512);
      for (let k = 0; k < 512; k++) sc[k] = this.scope[(this.scopeI - 512 + k + 1024) & 1023];
      this.port.postMessage({ t: 'st', lfo: o[O.lfoOut] / 5, step: c.led, play: c.play, hold: c.hold, tap: c.tap,
        run: c.running, edit: c.editing, oct: c.oct, gate: c.gateNow, cur: c.cur, peak: this.peak, scope: sc,
        synced: c.synced(), qps: c.qps || 0, legato: S[PI.legato] });
      c.led = 0; this.peak = 0;
    }
    if (this.evq.length) { this.port.postMessage({ t: 'ev', q: this.evq }); this.evq = []; }
    return true;
  }
}

registerProcessor('progenitor', Progenitor);
if (typeof module !== 'undefined') module.exports = { Progenitor, PN, OUTS, INS, MULTS };
