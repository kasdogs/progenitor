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
// Jack electrics for the passive patch model, from the patch point index in the
// Grandmother manual: audio outputs 2 kΩ (most AC coupled), reverb out 1 kΩ,
// control outputs 5 Ω; inputs 90 kΩ (pitch, linear FM), 110 kΩ (env amt, high
// pass) and 100 kΩ elsewhere. The clock output is listed as 100 kΩ, almost
// certainly a misprint, so it is treated as a 5 Ω control output.
const R_OUT = { o1Out: 2000, o2Out: 2000, mixOut: 2000, vcfOut: 2000, hpfOut: 2000, shOut: 2000, euroOut: 2000, revOut: 1000 };
const rOut = n => R_OUT[n] || 5;
const I_LIM = 0.022;                // op-amp short-circuit current for the 5 Ω outputs (typical value, not a Moog spec)
const G_LIM = 1 / 200;              // residual output conductance while current-limited, so fighting outputs settle in between
const AC_OUTS = ['o1Out', 'o2Out', 'vcfOut', 'hpfOut', 'revOut', 'euroOut'];
const R_IN = { o1Pitch: 90e3, o2Pitch: 90e3, fmIn: 90e3, envAmtIn: 110e3, hpfIn: 110e3 };
const rIn = n => R_IN[n] || 100e3;
const I = {}; INS.forEach((n, i) => I[n] = i);

const PPQN = [1,2,3,4,5,6,7,8,9,10,11,12,24,48];
const DIVS = [16,12,8,6,4,3,2,1.5,1,0.75,0.5,0.375,0.25,0.1875,0.125,0.09375,0.0625];
const TDIVS = [8/3,4/3,2/3,1/3,1/6,1/12,1/24];

function th(x) { // fast tanh
  if (x > 3) return 1; if (x < -3) return -1;
  const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2);
}
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
// Transistor-style soft saturation: x / (1 + |x/Vs|^6)^(1/6). Essentially linear
// well below Vs, compressing gradually toward it; a lower negative-side Vs makes
// it slightly lopsided, which is where the even-harmonic warmth comes from.
function tsat(x, vp, vn) {
  const v = x >= 0 ? vp : vn, r = x / v, r2 = r * r, r6 = r2 * r2 * r2;
  if (r6 < 1e-3) return x * (1 - r6 * (1 / 6 - r6 * (7 / 72)));   // series, exact to ~1e-10 here
  return x / Math.cbrt(Math.sqrt(1 + r6));
}
// cos on [0, π], accurate to ~3e-6 (folded to [0, π/2], Taylor to x^8)
function hcos(x) {
  const neg = x > 1.5707963267948966; if (neg) x = Math.PI - x;
  const x2 = x * x, c = 1 - x2 * (0.5 - x2 * (1 / 24 - x2 * (1 / 720 - x2 / 40320)));
  return neg ? -c : c;
}
// Mixer channel gain: plain taper to 80%, then a modest extra push into the stage.
const mixGain = k => k + (k > 0.8 ? (k - 0.8) * 1.6 : 0);
// Calibration constants, fitted offline against the previous approved behaviour and
// measured targets (see the commit notes): summing-stage saturation, wet level,
// and the self-oscillation pitch trim (octaves per unit of feedback above k = 4).
// trim tables: [feedback r = k/4, cents of correction]
const TUNE = { mixVp: 7.4, mixVn: 6.72, tank: 0.9143,
  trimZ: [[0.9, 0], [1.0, 10], [1.071, 25], [1.171, 53.5], [1.286, 71.5]],
  trimH: [[0.9, 0], [1.0, 8], [1.071, 19], [1.171, 39], [1.286, 68]] };
function RES_TRIM(r, zdf) {
  const t = zdf ? TUNE.trimZ : TUNE.trimH;
  if (r <= t[0][0]) return 1;
  let c = t[t.length - 1][1];
  for (let i = 1; i < t.length; i++) if (r <= t[i][0]) { const [r0, c0] = t[i - 1], [r1, c1] = t[i]; c = c0 + (c1 - c0) * (r - r0) / (r1 - r0); break; }
  return Math.pow(2, c / 1200);
}

// ---------------------------------------------------------------- oscillator
// Saw-core oscillator, PolyBLEP/PolyBLAMP with one sample of latency so the
// corrections can be spread over the samples on both sides of every
// discontinuity (wraps, pulse edges, triangle corners and hard-sync resets).
// waves: 0 triangle (folded from the saw; pw = fold point), 1 ideal saw up,
//        2/3 pulse (pw = duty), 5 saw down, 6 measured saw (Moog Voyager shape),
//        7 sine shaped from the triangle (modulation oscillator)
//
// Wave 6 is the phase-distortion model of a recorded Voyager sawtooth from
// Pekonen, Lazzarini, Timoney, Kleimola & Välimäki, "Discrete-time modelling of
// the Moog sawtooth oscillator waveform", EURASIP JASP 2011: a half-cosine rise
// over a fraction P of the cycle and a half-cosine fall over the rest, with
// P(f0) = 0.9924 - 0.00002151 f0 (fitted below 4 kHz, extrapolated above).
// It is continuous, so it needs no BLEP at the wrap.
let VP = 0.99;                                  // measured-saw rise fraction for the step in progress
const SINE_K = 1.45, SINE_N = 1 / Math.tanh(1.45);   // triangle-to-sine shaper, ~1.5% THD
class Osc {
  constructor() { this.p = Math.random(); this.prev = 0; this.b = 0; this.a = 0; this.wrapT = -1; }
  static val(w, p, pw) {
    switch (w) {
      case 0: return p < pw ? 2 * p / pw - 1 : 1 - 2 * (p - pw) / (1 - pw);
      case 1: return 2 * p - 1;
      case 2: case 3: return (p < pw ? 1 : -1) - (2 * pw - 1);
      case 6: return p < VP ? -hcos(Math.PI * p / VP) : hcos(Math.PI * (p - VP) / (1 - VP));
      case 7: { const t = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; return Math.tanh(SINE_K * t) * SINE_N; }
      default: return 1 - 2 * p;
    }
  }
  // slope in units per cycle (for BLAMP at sync resets)
  static slope(w, p, pw) {
    switch (w) {
      case 0: return p < pw ? 2 / pw : -2 / (1 - pw);
      case 1: return 2;
      case 5: return -2;
      case 6: return p < VP ? Math.sin(Math.PI * p / VP) * Math.PI / VP : -Math.sin(Math.PI * (p - VP) / (1 - VP)) * Math.PI / (1 - VP);
      default: return 0;
    }
  }
  ev(t, h) { const u = 1 - t; this.b += h * u * u * 0.5; this.a -= h * t * t * 0.5; }          // PolyBLEP, step h
  evA(t, m) { const u = 1 - t; this.b += m * u * u * u / 6; this.a += m * t * t * t / 6; }     // PolyBLAMP, slope change m per sample
  seg(p, dt, t0, t1, w, pw) {
    let rem = (t1 - t0) * dt, t = t0;
    if (rem <= 0) return p;
    const pulse = w === 2 || w === 3, tri = w === 0;
    for (let guard = 0; guard < 16; guard++) {
      const toPw = (pulse || tri) && p < pw;
      const target = toPw ? pw : 1;
      const dist = target - p;
      if (dist > rem) return p + rem;
      t += dist / dt; rem -= dist;
      if (toPw) {
        p = pw;
        if (pulse) this.ev(t, -2); else this.evA(t, (-2 / (1 - pw) - 2 / pw) * dt);
      } else {
        p = 0; this.wrapT = t;
        if (tri) this.evA(t, (2 / pw + 2 / (1 - pw)) * dt);
        else { const h = w === 1 ? -2 : (w === 5 || pulse) ? 2 : 0; if (h) this.ev(t, h); }
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
      const m = (Osc.slope(w, 0, pw) - Osc.slope(w, p, pw)) * dt;
      if (m) this.evA(resetT, m);
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
  constructor() {
    this.y = [0,0,0,0]; this.t = [0,0,0]; this.d4 = 0; this.d5 = 0;
    const r = () => (Math.random() * 2 - 1);
    this.m = [1 + r() * 0.015, 1 + r() * 0.015, 1 + r() * 0.015, 1 + r() * 0.015];   // per-stage cutoff (caps)
    this.v = [1 + r() * 0.02, 1 + r() * 0.02, 1 + r() * 0.02, 1 + r() * 0.02];       // per-stage drive (pairs)
    this.iv = this.v.map(x => 1 / x);
  }
  process(x, fc, res, fs) {
    const f = fc / (fs * 2), f2 = f * f, f3 = f2 * f;
    const fcr = 1.8730 * f3 + 0.4955 * f2 - 0.6490 * f + 0.9988;
    const acr = -3.9364 * f2 + 1.8409 * f + 0.9968;
    const g = 1 - Math.exp(-TAU * f * fcr);
    const k = 4 * res * acr;
    const y = this.y, t = this.t, m = this.m, v = this.v, iv = this.iv;
    const g0 = g * m[0], g1 = g * m[1], g2 = g * m[2], g3 = g * m[3];
    for (let j = 0; j < 2; j++) {
      const inp = x - k * this.d5 + (Math.random() - 0.5) * 2e-3;
      y[0] += g0 * (th(inp * v[0]) * iv[0] - t[0]); t[0] = th(y[0] * v[1]) * iv[1];
      y[1] += g1 * (t[0] - t[1]);    t[1] = th(y[1] * v[2]) * iv[2];
      y[2] += g2 * (t[1] - t[2]);    t[2] = th(y[2] * v[3]) * iv[3];
      y[3] += g3 * (t[2] - th(y[3] * v[3]) * iv[3]);
      this.d5 = (y[3] + this.d4) * 0.5; this.d4 = y[3];
    }
    return this.d5;
  }
}

// Zero-delay-feedback ladder: trapezoidal (TPT) integrators with tanh stages,
// the 4 coupled nonlinear equations solved every sample by Newton-Raphson.
// The Jacobian is bidiagonal plus one feedback corner, so each step is O(4).
class LadderZDF {
  constructor(src) {
    this.s = [0, 0, 0, 0]; this.y = [0, 0, 0, 0];
    this.m = src.m; this.v = src.v; this.iv = src.iv;   // share the same component mismatch
    this.F = new Float64Array(4); this.d = new Float64Array(4);
  }
  process(x, fc, res, fs) {
    const G = Math.tan(Math.PI * Math.min(fc, fs * 0.45) / fs);
    const k = 4 * res, s = this.s, y = this.y, m = this.m, v = this.v, iv = this.iv, F = this.F;
    for (let it = 0; it < 6; it++) {
      const u0 = x - k * y[3];
      const tu = Math.tanh(u0 * v[0]);
      const t0 = Math.tanh(y[0] * v[1]), t1 = Math.tanh(y[1] * v[2]), t2 = Math.tanh(y[2] * v[3]), t3 = Math.tanh(y[3] * v[3]);
      const G0 = G * m[0], G1 = G * m[1], G2 = G * m[2], G3 = G * m[3];
      F[0] = y[0] - s[0] - G0 * (tu * iv[0] - t0 * iv[1]);
      F[1] = y[1] - s[1] - G1 * (t0 * iv[1] - t1 * iv[2]);
      F[2] = y[2] - s[2] - G2 * (t1 * iv[2] - t2 * iv[3]);
      F[3] = y[3] - s[3] - G3 * (t2 * iv[3] - t3 * iv[3]);
      const d0 = 1 - t0 * t0, d1 = 1 - t1 * t1, d2 = 1 - t2 * t2, d3 = 1 - t3 * t3, du = 1 - tu * tu;
      const a0 = 1 + G0 * d0, a1 = 1 + G1 * d1, a2 = 1 + G2 * d2, a3 = 1 + G3 * d3;
      const c = G0 * k * du, b1 = G1 * d0, b2 = G2 * d1, b3 = G3 * d2;
      // forward substitution with D3 left symbolic: Di = pi + qi*D3
      const p0 = -F[0] / a0, q0 = -c / a0;
      const p1 = (-F[1] + b1 * p0) / a1, q1 = b1 * q0 / a1;
      const p2 = (-F[2] + b2 * p1) / a2, q2 = b2 * q1 / a2;
      const p3 = (-F[3] + b3 * p2) / a3, q3 = b3 * q2 / a3;
      const D3 = p3 / (1 - q3);
      const D0 = p0 + q0 * D3, D1 = p1 + q1 * D3, D2 = p2 + q2 * D3;
      y[0] += D0; y[1] += D1; y[2] += D2; y[3] += D3;
      if (Math.abs(D0) + Math.abs(D1) + Math.abs(D2) + Math.abs(D3) < 1e-7 && it > 0) break;
    }
    if (!(Math.abs(y[3]) < 50)) { this.s = [0, 0, 0, 0]; this.y = [0, 0, 0, 0]; return 0; }
    // update integrator states: s = 2y - s
    for (let i = 0; i < 4; i++) s[i] = 2 * y[i] - s[i];
    return y[3];
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
// Parametric spring model after Välimäki, Parker & Abel (JAES 2010) and Gamper,
// Parker & Välimäki (DAFx-11): per spring, a long cascade of stretched
// allpasses (the low-frequency chirps) inside a damped, modulated feedback delay
// with a DC blocker in the loop. The tank is a 3-spring, long-decay Belton
// BMN3AB3B1B-family part (2.75–4 s decay per its datasheet), so there are three
// springs of slightly different lengths. They run at half the base rate, which
// is fine because their content stays below the ~4 kHz transition frequency.
// A separate full-rate path of plain first-order allpasses adds the quieter
// high-frequency chirps above the transition.
const T60_SPRING = 3.3;   // per-spring loop setting; the summed tank measures ~2.75 s
class Spring {
  constructor(fs, len, fc, a, n, seed) {
    this.fs = fs; this.N = n; this.M = Math.max(1, Math.round(fs / (2 * fc))); this.a = a;
    this.ap = []; for (let i = 0; i < n; i++) this.ap.push(new Float64Array(this.M));
    this.ai = 0;
    this.base = len * fs; this.dlen = Math.ceil(this.base * 1.02) + 8;
    this.dl = new Float64Array(this.dlen); this.w = 0;
    this.lp = 0; this.lpc = 1 - Math.exp(-TAU * 3600 / fs);
    this.dcR = Math.exp(-TAU * 40 / fs); this.dcX = 0; this.dcY = 0;
    this.g = -Math.pow(10, -3 * len / T60_SPRING);
    this.ph = seed * TAU; this.phInc = TAU * (0.37 + seed * 0.1) / fs;
  }
  process(x) {
    this.dcY = this.dcR * (this.dcY + this.lp - this.dcX); this.dcX = this.lp;
    let v = x + this.dcY * this.g;
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
class SpringTank {
  constructor(fsB, lite) {
    const fh = fsB / 2;
    this.lite = !!lite;
    // lite: two springs with shorter chirp cascades and no high-frequency path
    this.spr = lite ? [new Spring(fh, 0.0330, 4100, 0.62, 56, 0.1), new Spring(fh, 0.0410, 3900, 0.60, 52, 0.6)]
      : [new Spring(fh, 0.0310, 4200, 0.62, 90, 0.1), new Spring(fh, 0.0368, 4000, 0.61, 86, 0.45), new Spring(fh, 0.0427, 3800, 0.60, 82, 0.8)];
    this.dn = new HB(); this.up = new HB(); this.ph = 0; this.yh = 0;
    // high-frequency chirp path (full rate)
    this.hfN = 40; this.hfA = -0.34; this.hfS = new Float64Array(this.hfN);
    this.hfLen = Math.round(0.0185 * fsB); this.hfDl = new Float64Array(this.hfLen + 2); this.hfW = 0;
    this.hfG = -Math.pow(10, -3 * 0.0185 / 2.0);
    this.hfLp = 0; this.hfLpc = 1 - Math.exp(-TAU * 10000 / fsB);
    const hp = Math.exp(-TAU * 4200 / fsB); this.hpR = hp; this.h1x = 0; this.h1y = 0; this.h2x = 0; this.h2y = 0;
  }
  process(x) {
    // low-frequency chirps: 3 springs at half rate
    this.dn.push(x);
    if (this.ph === 0) {
      const xd = this.dn.out();
      this.yh = this.lite ? (this.spr[0].process(xd) + this.spr[1].process(xd * 0.9)) * 0.42
        : this.spr[0].process(xd) + this.spr[1].process(xd * 0.92) + this.spr[2].process(xd * 0.85);
    }
    this.up.push(this.ph === 0 ? this.yh * 2 : 0);
    const lf = this.up.out();
    this.ph ^= 1;
    if (this.lite) return lf;
    // high-frequency chirps: input above the transition, plain allpass cascade in a loop
    this.h1y = this.hpR * (this.h1y + x - this.h1x); this.h1x = x;
    this.h2y = this.hpR * (this.h2y + this.h1y - this.h2x); this.h2x = this.h1y;
    let v = this.h2y + this.hfLp * this.hfG;
    const a = this.hfA, st = this.hfS;
    for (let k = 0; k < this.hfN; k++) { const w = v - a * st[k]; v = a * w + st[k]; st[k] = w; }
    this.hfDl[this.hfW] = v;
    let r = this.hfW - this.hfLen; if (r < 0) r += this.hfDl.length;
    const y = this.hfDl[r];
    this.hfW = (this.hfW + 1) % this.hfDl.length;
    this.hfLp += (y - this.hfLp) * this.hfLpc;
    return lf + y * 0.25;
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
    this.cv = 0; this.cvT = 0; this.cvS = 0; this.glideOn = false; this.glideFrom = 0;
    this.rcK = 1 - Math.exp(-1 / (0.001 * this.fs));   // ~1 ms smoothing after the pitch DAC
    this.gate = false; this.dip = 0; this.vel = 100; this.note = -1;
    this.seqs = [[], [], []]; this.recFresh = true; this.pendTie = false; this.editing = false; this.cur = 0;
    this.running = false; this.idx = 0; this.dirSign = 1;
    this.qpos = 0; this.lastStep = -1; this.gateOffQ = -1; this.gateOffF = -1;
    this.taps = []; this.tapQps = 2;
    this.midiLastF = -1e9; this.midiQps = 2; this.midiTicks = 0; this.midiLimit = Infinity;
    this.extLastF = -1; this.extQps = 2; this.extCount = 0; this.extLimit = Infinity;
    this.prevClk = 0; this.prevReset = 0; this.prevOnOff = null;
    this.clkOutCnt = 0; this.clkPulse = 0; this.midiOutCnt = 0;
    this.f = 0; this.led = 0; this.transNote = 60; this.gateDeadF = 0;
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
    this.running = false; this.editing = false; this.gateOffQ = -1; this.gateOffF = -1; this.gateDeadF = 0;
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
      const wasEditing = this.editing;
      this.editing = false; this.postSeqs();
      if (this.running && !this.hold && !this.held.length) { this.stopRun(); return; }
      if (wasEditing && this.running) { if (nu === 0) this.idx = 0; return; }
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
    this.gateOffQ = this.qpos + this.divNow() * 0.5; this.gateDeadF = this.f + this.fs * 0.5;
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
    else {
      this.gateOffQ = stepQ + div * 0.5;
      const q = this.qps > 0 ? this.qps : 2;
      this.gateDeadF = this.f + Math.min(div / q * 0.5 * 1.5, 4) * this.fs;
    }
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
      if (this.gateOffQ >= 0 && (this.qpos >= this.gateOffQ || this.f >= this.gateDeadF)) { this.gateOffQ = -1; this.gateOff(); }
      // clock outputs
      const clkRun = this.running || g.clkOutMode === 1;
      const c = Math.floor(this.qpos * PPQN[g.ppqnOut]);
      if (c !== this.clkOutCnt) { this.clkOutCnt = c; if (clkRun) this.clkPulse = Math.round(fs * 0.005); }
      const c24 = Math.floor(this.qpos * 24);
      if (c24 !== this.midiOutCnt) { this.midiOutCnt = c24; if (g.midiClkOut !== 2 && clkRun && !midiOn) e.evq.push({ t: 'clk' }); }
    }
    if (this.stepAdv && edge && (this.running || g.clkOutMode === 1)) this.clkPulse = Math.round(fs * 0.005);
    if (this.clkPulse > 0) this.clkPulse--;

    // invariants: the run needs a held key, HOLD or live edit; a stopped voice needs a held key
    if (this.running && !this.hold && !this.editing && !this.held.length) this.stopRun();
    else if (!this.running && this.gate && !this.held.length) this.gateOff();

    // glide: computed by the firmware at a control rate (~1.5 kHz), then smoothed after the DAC
    if (this.glideOn && (this.f & 31) === 0) {
      const t = this.glideTime(), n = 32;
      if (t <= 0) { this.cv = this.cvT; this.glideOn = false; }
      else if (!(g.gatedGlide && !this.gate)) {
        const d = this.cvT - this.cv;
        if (g.glideType === 2) { this.cv += d * (1 - Math.exp(-3 * n / (t * fs))); if (Math.abs(d) < 1e-5) { this.cv = this.cvT; this.glideOn = false; } }
        else {
          const step = n * (g.glideType === 0 ? 1 / (t * fs) : Math.max(Math.abs(this.cvT - this.glideFrom), 1e-4) / (t * fs));
          if (Math.abs(d) <= step) { this.cv = this.cvT; this.glideOn = false; } else this.cv += d > 0 ? step : -step;
        }
      }
    }
    this.cvS += (this.cv - this.cvS) * this.rcK;
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
    this.netOuts = []; this.netGin = []; this.netGo = []; this.netIl = []; this.netLim = []; this.netV = new Float64Array(64); this.nNets = 0;
    this.acI = AC_OUTS.map(n => O[n]); this.acX = new Float64Array(OUTS.length); this.acY = new Float64Array(OUTS.length);
    // per-unit component spread, re-rolled each power-on
    const rr = () => Math.random() - 0.5;
    this.pw1 = 0.16 + rr() * 0.02; this.pw2 = 0.18 + rr() * 0.02;         // narrow pulse (measured ~16% / ~18%)
    this.tf1 = 0.5 + rr() * 0.008; this.tf2 = 0.5 + rr() * 0.008;         // triangle fold point
    this.nLp = 0; this.dry1 = 0;
    this.g = { midiCh: 0, midiClkIn: 0, midiClkOut: 0, prio: 2, bendUp: 2, bendDn: 2, extMode: 0, ppqnIn: 1, ppqnOut: 1,
      kbRange: 0, glideType: 0, gatedGlide: 1, transpose: 0, tapPersist: 0, velRange: 0, o2Range: 7, clkOutMode: 0,
      drift: 0.5, warm: 0, bleed: 0.3, os: 2, filt: 1, saw: 1, lite: 0 };
    this.cc = {};   // cached coefficients
    this.o1 = new Osc(); this.o2 = new Osc(); this.lfo = new Osc();
    this.lad = new Ladder(); this.zdf = new LadderZDF(this.lad); this.env = new ADSR();
    this.kbr = 0; this.acc = 0; this.accSt = 0;
    this.hpX = 0; this.hpY = 0; this.fmX = 0; this.fmY = 0;
    this.sh = 0; this.prevSync = 0; this.bend = 0;
    this.dec = new HB(); this.dec4 = new HB(); this.OS = OS;
    this.tank = new SpringTank(this.fsB, false);
    this.preHpX = 0; this.preHpY = 0; this.preLp = 0; this.revLp = 0;
    this.dcX = 0; this.dcY = 0;
    this.ctl = new Ctl(this);
    this.drift = [0, 0]; this.warmT = 0;
    // three low-passed noise bands per oscillator (~1/f below a few Hz)
    this.dBands = [0.04, 0.35, 2.5].map(f => { const c = 1 - Math.exp(-TAU * f / this.fsB); return { c, k: Math.sqrt((2 - c) / c) }; });
    this.dState = [[0, 0, 0], [0, 0, 0]];
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
  // Every cable joins two jacks into one electrical net (the four mults are one
  // passive, unbuffered net). Each net is solved as a small circuit: every
  // output is a voltage source behind its output resistance (the 5 Ω control
  // outputs also current-limit), every input is a load to ground. Two 2 kΩ
  // audio outputs in the mult mix half-and-half; a 5 Ω control output joined
  // to anything wins; an input on a net with no outputs reads 0 V.
  resolvePatch(cables) {
    const ids = new Map(), par = [];
    const id = j => { if (!ids.has(j)) { ids.set(j, par.length); par.push(par.length); } return ids.get(j); };
    const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
    const valid = j => O[j] !== undefined || I[j] !== undefined || MULTS.includes(j);
    for (const [a, b] of cables) {
      if (!valid(a) || !valid(b)) continue;
      const A = MULTS.includes(a) ? 'mult1' : a, B = MULTS.includes(b) ? 'mult1' : b;
      unite(id(A), id(B));
    }
    const netOf = new Map(); this.netOuts = []; this.netGin = []; this.netGo = []; this.netIl = []; this.netLim = []; this.src.fill(-1);
    const net = r => {
      if (!netOf.has(r)) { netOf.set(r, this.netOuts.length); this.netOuts.push([]); this.netGin.push(0); this.netGo.push([]); this.netIl.push([]); this.netLim.push(false); }
      return netOf.get(r);
    };
    for (const [j, i] of ids) {
      const n = net(find(i));
      if (O[j] !== undefined) {
        const R = rOut(j);
        this.netOuts[n].push(O[j]); this.netGo[n].push(1 / R); this.netIl[n].push(R < 100 ? I_LIM : 0);
        if (R < 100) this.netLim[n] = true;
      } else if (I[j] !== undefined) { this.src[I[j]] = n; this.netGin[n] += 1 / rIn(j); }
    }
    // a lone current-limited output only ever drives light loads: no need to iterate
    for (let n = 0; n < this.netOuts.length; n++) if (this.netOuts[n].length < 2) this.netLim[n] = false;
    this.nNets = this.netOuts.length;
    if (this.netV.length < this.nNets) this.netV = new Float64Array(this.nNets * 2);
  }
  // Solve one net (KCL): sum of output currents = current into the input loads.
  solveNet(q) {
    const ms = this.netOuts[q], L = ms.length, gin = this.netGin[q], o = this.outs, Go = this.netGo[q], Il = this.netIl[q];
    if (!L) return 0;
    let num = 0, den = gin;
    for (let k = 0; k < L; k++) { num += Go[k] * o[ms[k]]; den += Go[k]; }
    let V = num / den;                                   // linear solution
    if (!this.netLim[q]) return V;
    let worst = 0;
    for (let k = 0; k < L; k++) if (Il[k]) worst = Math.max(worst, Math.abs(o[ms[k]] - V) * Go[k] / Il[k]);
    if (worst < 0.25) return V;                          // far from any current limit
    // safeguarded Newton: f(V) is monotone decreasing, root bracketed by the sources and 0 V
    let lo = 0, hi = 0;
    for (let k = 0; k < L; k++) { lo = Math.min(lo, o[ms[k]]); hi = Math.max(hi, o[ms[k]]); }
    for (let it = 0; it < 24; it++) {
      let f = -gin * V, df = -gin;
      for (let k = 0; k < L; k++) {
        const e = o[ms[k]] - V;
        if (!Il[k]) { f += e * Go[k]; df -= Go[k]; continue; }
        // i = Ilim * x / (1 + x^4)^(1/4), x = linear current / limit: linear to ~60% of the limit, then a firm knee
        const x = e * Go[k] / Il[k], r = Math.sqrt(Math.sqrt(1 + x * x * x * x));
        f += Il[k] * x / r + e * G_LIM; df -= Go[k] / (r * r * r * r * r) + G_LIM;
      }
      if (f > 0) lo = V; else hi = V;
      let Vn = V - f / df;
      if (!(Vn > lo && Vn < hi)) Vn = 0.5 * (lo + hi);
      if (Math.abs(Vn - V) < 1e-7) return Vn;
      V = Vn;
    }
    return V;
  }
  acOut(k, x, a) { const y = a * (this.acY[k] + x - this.acX[k]); this.acX[k] = x; this.acY[k] = y; return y; }
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
      case 'g': {
        Object.assign(this.g, d.v);
        // lite CPU mode: classic ladder, 2x oversampling, lighter spring tank, control-rate housekeeping
        const os = this.g.lite ? 1 : (this.g.os === 4 ? 4 : 2);
        if (os !== this.OS) { this.OS = os; this.fs = this.fsB * os; this.cc = {}; }
        if (!!this.g.lite !== this.tank.lite) this.tank = new SpringTank(this.fsB, !!this.g.lite);
        break;
      }
      case 'seqs': c.seqs = d.v; break;
      case 'mclk': c.midiClock(d.k); break;
      case 'sus': c.sustain(d.v); break;
      case 'panic': c.panic(); break;
      case 'setplay': c.setPlay(!!d.v); break;
      case 'sethold': if (!!d.v !== c.hold && c.mode() !== 2) c.btnHold(); break;
      case 'kick': this.kick = 1; break;
    }
  }
  inp(i, normal) { const s = this.src[i]; return s === -1 ? normal : this.netV[s]; }
  accTrig() { this.accSt = 1; }

  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1];
    const inst = inputs[0] && inputs[0][0];
    const P = this.P, S = this.S, n = L.length, fs = this.fs, fsB = this.fsB, o = this.outs, c = this.ctl, g = this.g, os = this.OS;
    for (let i = 0; i < n; i++) {
      // parameter smoothing (~8 ms)
      const lite = g.lite, ctl = (i & 3) === 0;
      if (!lite) { for (let k = 0; k < S.length; k++) if (!this.disc[k]) S[k] += (P[k] - S[k]) * 0.003; }
      else if (ctl) { for (let k = 0; k < S.length; k++) if (!this.disc[k]) S[k] += (P[k] - S[k]) * 0.01199; }
      c.tick();

      // analog drift: slow wandering per oscillator
      const dc = (g.drift * 3) / 1200;
      if (!lite || ctl) for (let q = 0; q < 2; q++) {
        const st = this.dState[q], n = lite ? 4 : 1;
        for (let b = 0; b < 3; b++) { const B = this.dBands[b], cB = n === 1 ? B.c : 1 - Math.pow(1 - B.c, n); st[b] += ((Math.random() * 2 - 1) * 1.732 * B.k - st[b]) * cB; }
        this.drift[q] = (st[0] * 0.62 + st[1] * 0.3 + st[2] * 0.08) * dc;
      }
      let warm = 0;
      if (g.warm) { this.warmT += 1 / fsB; warm = (14 / 1200) * Math.exp(-this.warmT / 300); }   // mostly settled by ~15 min, as the manual describes

      // per-base-sample derived values
      // stage times: ~1.5 ms (attack) / ~2 ms (decay, release) up to ~12 s
      const cc = this.cc;
      if (cc.a !== S[PI.attack]) { cc.a = S[PI.attack]; cc.ca = 1 - Math.exp(-1.466 / (0.0015 * Math.pow(8000, cc.a) * fs)); }
      if (cc.d !== S[PI.decay]) { cc.d = S[PI.decay]; cc.cd = 1 - Math.exp(-3.5 / (0.002 * Math.pow(6000, cc.d) * fs)); }
      if (cc.r !== S[PI.release]) { cc.r = S[PI.release]; cc.cr = 1 - Math.exp(-3.5 / (0.002 * Math.pow(6000, cc.r) * fs)); }
      const ca = cc.ca, cd = cc.cd, cr = cc.cr;
      const sus = S[PI.sustain];
      const lfoK = 14.214 * S[PI.lfoRate];
      const lfoW = [7, 5, 1, 2][S[PI.lfoWave]];
      const mw = S[PI.modWheel];
      // amount knobs have an audio-style (squared) taper, so the first half of the turn covers the
      // subtle depths (vibrato, gentle sweeps); the MOD wheel scales them all from off to full
      const pA = S[PI.pitchAmt], cA = S[PI.cutoffAmt], wA = S[PI.pwAmt];
      const pAmt = pA * pA * mw * 1.5, cAmt = cA * cA * mw * 4, wAmt = wA * wA * mw * 0.45;
      const bendV = (this.bend >= 0 ? this.bend * g.bendUp : this.bend * g.bendDn) / 12;
      const fineV = (S[PI.fine] - 0.5) * 2 / 12;
      const cv = c.cvS;
      const base1 = cv + (S[PI.o1Oct] - 2) + fineV + bendV + this.drift[0] + warm;
      const syncOn = S[PI.sync] > 0.5;
      const range = syncOn ? Math.max(24, g.o2Range * 3) : g.o2Range;
      const base2 = cv + (S[PI.o2Oct] - 1) + fineV + bendV + this.drift[1] + warm * 1.3 + (S[PI.o2Freq] - 0.5) * 2 * range / 12;
      const sawW = g.saw ? 6 : 1;
      const w1 = S[PI.o1Wave] === 1 ? sawW : S[PI.o1Wave], w2 = S[PI.o2Wave] === 1 ? sawW : S[PI.o2Wave];
      const pb1 = w1 === 3 ? this.pw1 : 0.5, pb2 = w2 === 3 ? this.pw2 : 0.5;
      const m1 = mixGain(S[PI.mix1]), m2 = mixGain(S[PI.mix2]), mN = mixGain(S[PI.mixN]);
      // cutoff knob alone spans ~10 Hz to ~11 kHz; CV, envelope and keyboard tracking reach 20 kHz and beyond
      const cutBase = 3.3219 + 10.1033 * S[PI.cutoff];
      const kbt = [0.5, 0, 1][S[PI.kbTrack]];
      // resonance taper (Mother-32 ladder measurements): dead zone to 10%, feedback rising
      // linearly to self-oscillation (k = 4) at 80% and on to k ≈ 5.1 at full
      const res = S[PI.res] < 0.1 ? 0 : (S[PI.res] - 0.1) / 0.7;
      // high resonance drags the self-oscillation pitch flat; trim it back so 1:1 tracking stays in tune
      const filtZ = g.filt && !lite;
      if (cc.res !== res || cc.fz !== filtZ) { cc.res = res; cc.fz = filtZ; cc.rc = RES_TRIM(res, filtZ); }
      const resComp = cc.rc;
      const envAmtK = (S[PI.envAmt] - 0.5) * 2;
      const vcaMode = S[PI.vcaMode];
      if (cc.h !== S[PI.hpf]) { cc.h = S[PI.hpf]; const hg = Math.tan(Math.PI * Math.min(20 * Math.pow(500, cc.h), fs * 0.24) / fs); cc.hpK = hg / (1 + hg); }
      const hpK = cc.hpK;
      if (cc.fs !== fs) { cc.fs = fs; cc.kbrC = 1 - Math.exp(-1 / (0.0008 * fs)); cc.acA = Math.exp(-TAU * 1.6 / fs); cc.acB = Math.exp(-TAU * 1.6 / fsB); cc.nK = 1 - Math.exp(-TAU * 20000 / fs); }
      const kbrC = cc.kbrC;
      const bleed = g.bleed * 0.5;
      const acA = cc.acA, acB = cc.acB;   // output coupling caps
      const nK = cc.nK;
      const attK = (S[PI.att] - 0.5) * 2;
      const gateV = c.gateNow ? 8 : 0;
      const instV = inst ? inst[i] * S[PI.instGain] * 40 : 0;
      // arp/seq outputs
      o[O.gateOut] = gateV;
      o[O.kbOut] = g.kbRange ? clamp(cv + 5, 0, 10) : clamp(cv, -5, 5);
      if (this.accSt === 1) { this.acc += (1.05 - this.acc) * 0.02; if (this.acc >= 1) this.accSt = 2; }
      else this.acc -= this.acc * 0.0012;
      if (c.running && c.mode() !== 0) o[O.velOut] = this.acc * 5;
      else o[O.velOut] = g.velRange ? c.vel / 127 * 10 : c.vel / 127 * 10 - 5;
      o[O.clkOut] = c.clkPulse > 0 ? 5 : 0;

      for (let s = 0; s < os; s++) {
        // patch nets: passive circuit solve (loading, tied outputs, current limiting)
        for (let q = 0; q < this.nNets; q++) this.netV[q] = this.solveNet(q);
        this.nLp += ((Math.random() + Math.random() - 1) * 7.4 - this.nLp) * nK;
        const noise = this.nLp;

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
        this.kbr = trig ? this.kbr + (1 - this.kbr) * kbrC : this.kbr - this.kbr * cr;

        // oscillators
        const pwm = this.inp(I.pwmIn, 0) / 5 * 0.45 + ln * wAmt;
        const pm = ln * pAmt;
        const f1 = C4 * Math.pow(2, base1 + pm + this.inp(I.o1Pitch, 0));
        VP = Math.max(0.5, 0.9924 - 0.00002151 * f1);
        const y1 = this.o1.step(f1 / (1 + f1 * 6e-7) / fs, w1, w1 === 0 ? this.tf1 : clamp(pb1 + pwm, 0.03, 0.97), -1) * 5;
        const fmIn = this.inp(I.fmIn, 0);
        this.fmY = 0.9995 * (this.fmY + fmIn - this.fmX); this.fmX = fmIn;
        const f2 = C4 * Math.pow(2, base2 + pm + this.inp(I.o2Pitch, 0)) * (1 + this.fmY * 0.25);
        const f2p = Math.max(f2, 0);
        VP = Math.max(0.5, 0.9924 - 0.00002151 * f2p);
        const y2 = this.o2.step(f2p / (1 + f2p * 6e-7) / fs, w2, w2 === 0 ? this.tf2 : clamp(pb2 + pwm, 0.03, 0.97), syncOn ? this.o1.wrapT : -1) * 5;
        o[O.o1Out] = this.acOut(O.o1Out, y1, acA); o[O.o2Out] = this.acOut(O.o2Out, y2, acA);

        // mixer (DC coupled). The summing stage is the main limiter, so one hot
        // channel squashes the others ("lack of headroom", SOS review). A single
        // channel stays near-linear to ~80% on its knob, then warms up gradually.
        const sum = tsat(this.inp(I.mix1In, y1) * m1, 14, 13) + tsat(this.inp(I.mix2In, y2) * m2, 14, 13)
          + tsat(this.inp(I.noiseIn, noise) * mN, 14, 13) + instV;
        const mix = tsat(sum, TUNE.mixVp, TUNE.mixVn);
        o[O.mixOut] = mix;

        // ladder filter
        const x = this.inp(I.vcfIn, mix);
        const ea = clamp(envAmtK + this.inp(I.envAmtIn, 0) / 8, -1.5, 1.5);
        const oct = cutBase + kbt * cv + ea * ev * 7 + this.inp(I.cutoffIn, 0) + ln * cAmt;
        let fc = clamp(Math.pow(2, oct) * resComp, 5, 22000);
        if (lite) { const r = fc / fs; fc *= 1 - 4.04 * r * r; }   // classic ladder at the base rate runs sharp up high
        const vcf = (filtZ ? this.zdf.process(x * 0.12 + (Math.random() - 0.5) * 2e-3, fc, res, fs) : this.lad.process(x * 0.12, fc, res, fs)) * 8.333;
        o[O.vcfOut] = this.acOut(O.vcfOut, vcf, acA);

        // VCA
        let cvA = vcaMode === 0 ? ev : vcaMode === 1 ? this.kbr : 1;
        if (this.src[I.vcaAmtIn] !== -1) {
          const a = this.inp(I.vcaAmtIn, 0) / 8;
          cvA = vcaMode === 2 ? clamp(a, 0, 1) : cvA * clamp(a, -1, 1);
        }
        const vca = 8 * th(this.inp(I.vcaIn, vcf) * cvA / 8) + cvA * bleed;

        // high pass (static, 1-pole)
        const hx = 9 * th(this.inp(I.hpfIn, 0) / 9);
        const hv = (hx - this.hpX) * hpK, hl = hv + this.hpX; this.hpX = hl + hv;
        o[O.hpfOut] = this.acOut(O.hpfOut, hx - hl, acA);

        const rv = this.inp(I.revIn, vca);
        if (os === 4) { this.dec4.push(rv); if (s & 1) this.dec.push(this.dec4.out()); } else if (os === 2) this.dec.push(rv); else this.dry1 = rv;
      }

      // ---- base rate: spring tank and output stage
      const dry = os === 1 ? this.dry1 : this.dec.out();
      let rx = dry - this.preHpX; this.preHpY = 0.985 * (this.preHpY + rx); this.preHpX = dry;
      this.preLp += (this.preHpY - this.preLp) * 0.45;
      let drive = th(this.preLp * 0.12) * 4;
      if (this.kick) { drive += (Math.random() * 2 - 1) * 30 * this.kick; this.kick *= 0.97; if (this.kick < 0.01) this.kick = 0; }
      const wet = this.tank.process(drive) * TUNE.tank;
      this.revLp += (wet - this.revLp) * 0.5;
      o[O.revOut] = this.acOut(O.revOut, this.revLp, acB);
      const mx = S[PI.revMix];
      const mixed = dry * Math.cos(mx * Math.PI / 2) + this.revLp * Math.sin(mx * Math.PI / 2) * 1.2;
      o[O.euroOut] = this.acOut(O.euroOut, 8 * th(mixed / 8), acB);
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
if (typeof module !== 'undefined') module.exports = { Progenitor, PN, OUTS, INS, MULTS, TUNE };
