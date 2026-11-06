// Progenitor — panel, patching, keyboard, MIDI and settings
'use strict';
(() => {
const $ = (s, r = document) => r.querySelector(s);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const LS = k => 'progenitor.' + k;
const load = (k, d) => { try { const v = localStorage.getItem(LS(k)); return v ? JSON.parse(v) : d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(LS(k), JSON.stringify(v)); } catch {} };

// ---------------------------------------------------------------- defaults
const DEF = { arpRate: .45, arpMode: 0, arpDir: 0, arpOct: 0, lfoRate: .45, lfoWave: 0, pitchAmt: 0, cutoffAmt: 0, pwAmt: 0,
  o1Oct: 2, o1Wave: 1, sync: 0, o2Oct: 1, o2Freq: .5, o2Wave: 1, mix1: .6, mix2: 0, mixN: 0, cutoff: 0.673, res: 0.262,
  envAmt: .62, kbTrack: 0, attack: 0, decay: 0.397, sustain: .6, release: 0.291, volume: .7, vcaMode: 0, revMix: .15,
  hpf: 0, att: .5, glide: 0, fine: .5, modWheel: 0, instGain: 0, triplet: 0, legato: 0 };
const GDEF = { midiCh: 0, midiClkIn: 0, midiClkOut: 0, prio: 2, bend: 2, extMode: 0, ppqnIn: 3, ppqnOut: 3, kbRange: 0,
  multiTrig: 0, mtSpeed: 1, mtMs: 4, pvar: 0, swing: .5, arpRepeat: 1, keyReset: 0, seqTrMode: 0, seqKb: 1, seqDelay: 0,
  outKeys: 1, outWheels: 1, outPanel: 1,
  local: 1, glideType: 0, gatedGlide: 1, transpose: 0, tapPersist: 0, velRange: 0, o2Range: 7, clkOutMode: 0, midiOutCh: -1,
  drift: .5, warm: 0, bleed: .3, os: 2, filt: 1, saw: 1, cpu: 'auto', extGain: .5, cables: 'show', scale: 'chromatic', root: 0, mask: Array(12).fill(true) };
const PPQN = [1,2,3,4,5,6,7,8,9,10,11,12,24,48];
const DIVN = ['4 whole notes','3 whole notes','2 whole notes','dotted whole','whole','dotted half','half','dotted quarter','quarter',
  'dotted 8th','8th','dotted 16th','16th','dotted 32nd','32nd','dotted 64th','64th'];
const TDIVN = ['whole triplet','half triplet','quarter triplet','8th triplet','16th triplet','32nd triplet','64th triplet'];

const G = Object.assign({}, GDEF, load('global', {}));
const state = { p: Object.assign({}, DEF), cables: [], name: 'Init' };
let seqs = load('seqs', null);
let node = null, ctx = null, powered = false;
let eng = { synced: false, play: false, hold: false, tap: false, oct: 0, run: false };
const post = m => { if (node) node.port.postMessage(m); };

// ---------------------------------------------------------------- formatting
const fHz = h => h >= 1000 ? (h / 1000).toFixed(h >= 10000 ? 1 : 2) + ' kHz' : h.toFixed(h < 10 ? 2 : h < 100 ? 1 : 0) + ' Hz';
const fT = s => s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s';
const pct = v => Math.round(v * 100) + '%';
const bip = v => { const x = Math.round((v - .5) * 200); return (x > 0 ? '+' : '') + x + '%'; };
const dial = v => (v * 10).toFixed(1);
// envelope stage time against knob position (same law as ENV_T in dsp.js)
const ENV_PTS = [[0, 0], [0.03, 0.03], [0.1, 0.2], [0.2, 0.7], [0.5, 2.2], [1, 13.3]];
function ENV_T(k, tmin) {
  k = Math.min(1, Math.max(0, k));
  if (k >= 0.2) { const [a, b] = k < 0.5 ? [ENV_PTS[3], ENV_PTS[4]] : [ENV_PTS[4], ENV_PTS[5]]; return a[1] + (b[1] - a[1]) * (k - a[0]) / (b[0] - a[0]); }
  const pts = [[0, tmin], ENV_PTS[1], ENV_PTS[2], ENV_PTS[3]];
  for (let i = 0; i < 3; i++) if (k <= pts[i + 1][0]) { const [a, b] = [pts[i], pts[i + 1]]; return a[1] * Math.pow(b[1] / a[1], (k - a[0]) / (b[0] - a[0])); }
  return 0.7;
}
const FMT = {
  arpRate: v => eng.synced ? (state.p.triplet ? TDIVN[Math.round(v * 6)] : DIVN[Math.round(v * 16)]) : Math.round(20 * Math.pow(14, v)) + ' BPM',
  lfoRate: v => fHz(0.07 * Math.pow(2, 14.214 * v)),
  pitchAmt: pct, cutoffAmt: pct, pwAmt: pct,
  o2Freq: v => { const r = state.p.sync ? Math.max(24, G.o2Range * 3) : G.o2Range; const s = (v - .5) * 2 * r; return (s > 0 ? '+' : '') + s.toFixed(2) + ' st'; },
  mix1: dial, mix2: dial, mixN: dial,
  cutoff: v => fHz(10 * Math.pow(1100, v)), res: pct, envAmt: bip,
  attack: v => fT(ENV_T(v, 0.0015)), decay: v => fT(ENV_T(v, 0.002)), release: v => fT(ENV_T(v, 0.002)),
  sustain: pct, volume: dial, revMix: pct, hpf: v => fHz(20 * Math.pow(500, v)), att: bip,
  glide: v => v < .004 ? 'off' : fT(.002 * Math.pow(2000, v)), fine: v => { const c = Math.round((v - .5) * 200); return (c > 0 ? '+' : '') + c + ' cents'; },
};
const MOD_AMT = new Set(['pitchAmt', 'cutoffAmt', 'pwAmt']);
const NAMES = { arpRate: 'Arp/Seq rate', lfoRate: 'Mod rate', pitchAmt: 'Pitch amount', cutoffAmt: 'Cutoff amount', pwAmt: 'Pulse width amount',
  o2Freq: 'Osc 2 frequency', mix1: 'Oscillator 1', mix2: 'Oscillator 2', mixN: 'Noise', cutoff: 'Cutoff', res: 'Resonance', envAmt: 'Envelope amount',
  attack: 'Attack', decay: 'Decay', release: 'Release', sustain: 'Sustain', volume: 'Volume', revMix: 'Reverb mix', hpf: 'High pass',
  att: 'Attenuator', glide: 'Glide', fine: 'Fine tune', o1Oct: 'Osc 1 octave', o2Oct: 'Osc 2 octave', o1Wave: 'Osc 1 wave', o2Wave: 'Osc 2 wave', lfoWave: 'Mod wave' };

// ---------------------------------------------------------------- module layout (panel units)
const J = (id, x, y, label, out) => ({ t: 'jack', id, x, y, label, out: !!out });
const K = (id, x, y, label, o = {}) => Object.assign({ t: 'knob', id, x, y, label }, o);
const SEL = (id, x, y, label, o) => Object.assign({ t: 'sel', id, x, y, label }, o);
const R = (id, x, y, label, opts, o = {}) => Object.assign({ t: 'radio', id, x, y, label, opts }, o);
const TX = (x, y, text, cls) => ({ t: 'text', x, y, text, cls });
const LN = (x, y, w, h) => ({ t: 'rule', x, y, w, h });
const OSCW = ['tri', 'saw', 'sq', 'pulse'];
const MODS = [
  { id: 'arp', title: 'ARP/SEQ', w: 165, h: 628, items: [
    J('gateOut', 82, 62, 'GATE OUT', 1), J('kbOut', 38, 125, 'KB OUT', 1), J('velOut', 127, 125, 'KB VEL OUT', 1),
    K('arpRate', 83, 235, 'RATE', { led: 'arpLed' }),
    R('arpMode', 83, 362, 'MODE', ['ARP', 'SEQ', 'REC'], { hi: 2 }),
    R('arpDir', 83, 457, 'DIRECTION', ['ORDR', 'FWD/<br>BKWD', 'RNDM']),
    R('arpOct', 83, 552, 'OCT / SEQ', ['1', '2', '3']) ] },
  { id: 'mod', title: 'MODULATION', w: 332, h: 628, items: [
    J('rateIn', 37, 62, 'RATE IN'), J('lfoOut', 295, 62, 'WAVE OUT', 1), J('syncIn', 125, 125, 'SYNC IN'), J('shOut', 208, 125, 'S/H OUT', 1),
    K('lfoRate', 166, 235, 'RATE', { led: 'lfoLed' }), K('pitchAmt', 85, 395, 'PITCH AMT', { inv: 1 }), K('cutoffAmt', 248, 395, 'CUTOFF AMT', { inv: 1 }),
    K('pwAmt', 85, 545, 'PULSE WIDTH AMT', { boxed: 1 }), SEL('lfoWave', 248, 545, 'WAVEFORM', { icons: ['sine', 'sawd', 'ramp', 'sq'] }) ] },
  { id: 'osc', title: 'OSCILLATORS', w: 331, h: 628, items: [
    TX(16, 46, '1', 'osnum'), TX(315, 46, '2', 'osnum'), LN(165, 70, 2, 268), LN(165, 470, 2, 140), LN(118, 395, 88, 2),
    J('o1Out', 81, 62, 'WAVE OUT', 1), J('o1Pitch', 38, 125, 'PITCH IN'), J('pwmIn', 126, 125, 'PWM IN'),
    SEL('o1Oct', 81, 240, 'OCTAVE', { opts: ["32'", "16'", "8'", "4'"] }),
    J('o2Out', 248, 62, 'WAVE OUT', 1), J('o2Pitch', 206, 125, 'PITCH IN'), J('fmIn', 293, 125, 'LIN FM IN'),
    SEL('o2Oct', 248, 240, 'OCTAVE', { opts: ["16'", "8'", "4'", "2'"] }),
    { t: 'sync', id: 'sync', x: 83, y: 395, label: 'SYNC' }, K('o2Freq', 248, 395, 'FREQUENCY', { bip: 1 }),
    SEL('o1Wave', 81, 548, 'WAVEFORM', { icons: OSCW }), SEL('o2Wave', 248, 548, 'WAVEFORM', { icons: OSCW }) ] },
  { id: 'mix', title: 'MIXER', w: 166, h: 628, items: [
    J('mix1In', 36, 62, 'OSC 1 IN'), J('mix2In', 128, 62, 'OSC 2 IN'), J('noiseIn', 36, 125, 'NOISE IN'), J('mixOut', 128, 125, 'OUTPUT', 1),
    K('mix1', 83, 235, 'OSCILLATOR 1', { inv: 1 }), K('mix2', 83, 395, 'OSCILLATOR 2', { inv: 1 }), K('mixN', 83, 545, 'NOISE') ] },
  { id: 'util', title: 'UTILITIES', w: 166, h: 628, items: [
    LN(37, 62, 90, 2), LN(37, 125, 90, 2), LN(37, 62, 2, 63), LN(127, 62, 2, 63),
    J('mult1', 37, 62, ''), J('mult2', 127, 62, ''), J('mult3', 37, 125, ''), J('mult4', 127, 125, ''), TX(82, 158, 'MULT', 'lbl'),
    K('hpf', 84, 245, 'HIGH PASS'), J('hpfIn', 37, 345, 'INPUT'), J('hpfOut', 127, 345, 'OUTPUT', 1),
    K('att', 84, 465, 'ATTENUATOR', { bip: 1 }), J('attIn', 37, 572, 'INPUT'), J('attOut', 127, 572, 'OUTPUT', 1) ] },
  { id: 'filter', title: 'FILTER', w: 332, h: 628, items: [
    J('vcfIn', 39, 62, 'INPUT'), J('vcfOut', 293, 62, 'OUTPUT', 1), J('envAmtIn', 127, 125, 'ENV AMT IN'), J('cutoffIn', 212, 125, 'CUTOFF IN'),
    K('cutoff', 166, 245, 'CUTOFF', { size: 'l' }), LN(166, 338, 2, 30),
    R('kbTrack', 166, 400, 'KBD TRACK', ['1:2', 'OFF', '1:1']),
    K('envAmt', 82, 545, 'ENVELOPE AMT', { bip: 1 }), K('res', 249, 545, 'RESONANCE') ] },
  { id: 'env', title: 'ENVELOPE', w: 332, h: 628, items: [
    J('trigIn', 166, 62, 'TRIGGER IN'), J('envPOut', 83, 125, '+ ENV OUT', 1), J('envNOut', 248, 125, '- ENV OUT', 1),
    K('attack', 83, 235, 'ATTACK'), K('decay', 83, 395, 'DECAY'), K('release', 83, 545, 'RELEASE'),
    { t: 'slider', id: 'sustain', x: 248, y1: 262, y2: 518, label: 'SUSTAIN' } ] },
  { col: [
    { id: 'out', title: 'OUTPUT', w: 165, h: 440, items: [
      J('vcaAmtIn', 83, 62, 'VCA AMT IN'), J('vcaIn', 40, 125, 'VCA IN'), J('revIn', 127, 125, 'REVERB IN'),
      K('volume', 83, 240, 'VOLUME'), R('vcaMode', 83, 364, 'VCA MODE', ['ENV', 'KB<br>RLS', 'DRONE']) ] },
    { id: 'spring', title: 'SPRING REVERB', w: 165, h: 168, kick: 1, tight: 1, items: [K('revMix', 83, 98, 'MIX')] } ] },
];
const REAR = [
  { id: 'midi', title: 'MIDI', w: 287, h: 100, items: [
    K('fine', 40, 52, 'FINE TUNE', { size: 's', lblY: 88 }), { t: 'led', id: 'midiLed', x: 112, y: 48 }, TX(112, 72, 'IN', 'lbl sm'),
    { t: 'midiText', x: 205, y: 60 } ] },
  { id: 'cv', title: 'ARP/SEQ CV', w: 332, h: 100, items: [
    J('clkOut', 40, 56, 'CLOCK OUT', 1), J('resetIn', 124, 56, 'RESET IN'), J('onoffIn', 208, 56, 'ON/OFF IN'), J('clkIn', 292, 56, 'CLOCK IN') ] },
  { id: 'audio', title: 'AUDIO', w: 331, h: 100, items: [
    J('revOut', 40, 56, 'REVERB<br>OUT', 1), J('euroOut', 124, 56, 'EURORACK<br>OUT', 1), { t: 'ext', x: 208, y: 56, label: 'EXT. INPUT' },
    { t: 'led', id: 'outLed', x: 292, y: 50 }, TX(292, 84, 'MAIN OUT', 'lbl out') ] },
];
// phones: AUDIO above ARP/SEQ CV in one column, MIDI to their right (vertically centred),
// all after a thin divider
const REAR_V = [
  { id: 'audio', title: 'AUDIO', w: 186, h: 306, items: [
    J('revOut', 47, 113, 'REVERB<br>OUT', 1), J('euroOut', 139, 113, 'EURORACK<br>OUT', 1),
    { t: 'ext', x: 47, y: 232, label: 'EXT.<br>INPUT' }, { t: 'led', id: 'outLed', x: 139, y: 228 }, TX(139, 262, 'MAIN<br>OUT', 'lbl out') ] },
  { id: 'cv', title: 'ARP/SEQ CV', w: 186, h: 306, tight: 1, items: [
    J('clkOut', 47, 110, 'CLOCK<br>OUT', 1), J('resetIn', 139, 110, 'RESET<br>IN'), J('onoffIn', 47, 226, 'ON/OFF<br>IN'), J('clkIn', 139, 226, 'CLOCK<br>IN') ] },
  { id: 'midi', title: 'MIDI', w: 150, h: 291, items: [
    K('fine', 75, 113, 'FINE TUNE'), { t: 'led', id: 'midiLed', x: 75, y: 211 }, TX(75, 233, 'MIDI IN', 'lbl sm'),
    { t: 'midiText', x: 75, y: 268 } ] },
];

const LHC = { id: 'lhc', title: '', w: 268, h: 312, items: [
  K('glide', 54, 66, 'GLIDE'), { t: 'led', id: 'legLed', x: 54, y: 140 }, TX(54, 158, 'LEGATO', 'lbl sm'),
  { t: 'pb', id: 'play', x: 138, y: 38, label: 'PLAY', sub: '(TIE)' }, { t: 'pb', id: 'hold', x: 188, y: 38, label: 'HOLD', sub: '(REST)' },
  { t: 'pb', id: 'tap', x: 238, y: 38, label: 'TAP', sub: '(ACCENT)' },
  { t: 'pb', id: 'shift', x: 138, y: 118, label: 'SHIFT' }, { t: 'pb', id: 'kbDn', x: 188, y: 118, label: '< KB' }, { t: 'pb', id: 'kbUp', x: 238, y: 118, label: 'KB >' },
  { t: 'octleds', x: 54, y: 206 },
  { t: 'wheel', id: 'bend', x: 160, y: 232, label: 'PITCH' }, { t: 'wheel', id: 'modWheel', x: 222, y: 232, label: 'MOD' } ] };
// compact strip for phones: buttons in a row, wheels moved next to the keyboard
const LHCM = { id: 'lhcm', title: '', w: 470, h: 96, items: [
  K('glide', 38, 40, 'GLIDE', { size: 's', lblY: 84 }), { t: 'led', id: 'legLed', x: 74, y: 26 }, TX(74, 42, 'LEG', 'lbl sm'),
  { t: 'pb', id: 'play', x: 120, y: 34, label: 'PLAY', sub: '(TIE)', subY: 76 }, { t: 'pb', id: 'hold', x: 172, y: 34, label: 'HOLD', sub: '(REST)', subY: 76 },
  { t: 'pb', id: 'tap', x: 224, y: 34, label: 'TAP', sub: '(ACC)', subY: 76 },
  { t: 'pb', id: 'shift', x: 290, y: 34, label: 'SHIFT' }, { t: 'pb', id: 'kbDn', x: 342, y: 34, label: '< KB' }, { t: 'pb', id: 'kbUp', x: 394, y: 34, label: 'KB >' },
  { t: 'octleds', x: 342, y: 80, nolabel: 1 }, TX(414, 80, 'OCT', 'lbl sm') ] };
const WHL = { id: 'whl', title: '', w: 100, h: 170, items: [
  { t: 'wheel', id: 'bend', x: 27, y: 74, label: 'PITCH' }, { t: 'wheel', id: 'modWheel', x: 73, y: 74, label: 'MOD' } ] };

// ---------------------------------------------------------------- DOM helpers
const ctrls = {}, jacks = {}, leds = {}, wheels = {};
let gsActive = false;
const capture = (el, id) => { try { el.setPointerCapture(id); } catch {} };
const place = (el, x, y) => { el.style.left = `calc(var(--u) * ${x}px)`; el.style.top = `calc(var(--u) * ${y}px)`; };
function mk(tag, cls, parent, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
function label(m, x, y, text, cls = 'lbl') { const l = mk('div', cls, m, text); place(l, x, y); return l; }

// knob SVG
function ticksSVG(n, r1, r2, a0 = -135, a1 = 135, minorEvery = 0) {
  let s = '<g class="ticks">';
  for (let i = 0; i < n; i++) {
    const a = (a0 + (a1 - a0) * i / (n - 1)) * Math.PI / 180, minor = minorEvery && i % minorEvery;
    const rr = minor ? r1 + (r2 - r1) * .45 : r1;
    s += `<line class="${minor ? 'minor' : ''}" x1="${Math.sin(a) * rr}" y1="${-Math.cos(a) * rr}" x2="${Math.sin(a) * r2}" y2="${-Math.cos(a) * r2}"/>`;
  }
  return s + '</g>';
}
function capSVG(r, uid) {
  let knurl = '';
  for (let i = 0; i < 24; i++) { const a = i * 15 * Math.PI / 180; knurl += `<circle cx="${Math.sin(a) * r}" cy="${-Math.cos(a) * r}" r="${r * .12}" fill="#1c1a19"/>`; }
  return `<defs><radialGradient id="g${uid}" cx="45%" cy="35%" r="70%"><stop offset="0" stop-color="#4b4440"/><stop offset=".55" stop-color="#25211f"/><stop offset="1" stop-color="#121010"/></radialGradient></defs>
  <circle r="${r + 3}" fill="#00000030" cy="3"/>${knurl}<circle class="cap" r="${r}" fill="url(#g${uid})" stroke="#0c0b0a" stroke-width="1.5"/>
  <circle r="${r * .62}" fill="none" stroke="#ffffff14" stroke-width="1.5"/>
  <g class="rot"><line x1="0" y1="${-r * .3}" x2="0" y2="${-r + 3}" stroke="#efe7d4" stroke-width="${Math.max(3, r * .1)}" stroke-linecap="round"/></g>`;
}
const ICON = {
  tri: 'M-9 6 L0 -7 L9 6', saw: 'M-9 6 L4 -7 L4 6', ramp: 'M-9 6 L4 -7 L4 6', sawd: 'M-8 -7 L-8 6 L8 6 M-8 -7 L8 6',
  sine: 'M-10 0 C-6 -10 -3 -10 0 0 C3 10 6 10 10 0', sq: 'M-9 6 L-9 -6 L0 -6 L0 6 L9 6 L9 -6', pulse: 'M-9 6 L-9 -6 L-4 -6 L-4 6 L9 6 L9 -6',
};
ICON.sawd = 'M-7 6 L-7 -6 L7 6'; ICON.ramp = 'M-7 6 L7 -6 L7 6';   // panel art: SAW |\  RAMP /|
let uidN = 0;

// ---------------------------------------------------------------- param set
let saveT = 0;
function setP(id, v, opt = {}) {
  if (!opt.midi && state.p[id] !== v) ccOut(id, v);
  state.p[id] = v;
  const c = ctrls[id]; if (c) c.render();
  if (opt.send !== false) post({ t: 'p', k: id, v });
  if (opt.save !== false) { clearTimeout(saveT); saveT = setTimeout(autosave, 400); markDirty(); }
}
function autosave() { store('current', { pv: PATCH_VER, p: state.p, cables: state.cables.map(c => [c.a, c.b, c.color]), name: state.name }); }
// Patch units changed in version 2 (cutoff knob to ~11 kHz, measured resonance taper,
// 1.5/2 ms–12 s envelope times). Older patches are converted so they sound the same.
// Version 3: the modulation amount knobs got an audio-style taper (depth = knob²), so older
// values become their square root and keep the same depth.
const PATCH_VER = 3;
function migrateP(p, ver = 1) {
  const q = Object.assign({}, p);
  if (ver < 3) for (const k of ['pitchAmt', 'cutoffAmt', 'pwAmt']) if (typeof q[k] === 'number') q[k] = Math.sqrt(clamp(q[k], 0, 1));
  if (ver >= 2) return q;
  if (typeof q.cutoff === 'number') q.cutoff = clamp(q.cutoff * Math.log(2000) / Math.log(1100), 0, 1);
  if (typeof q.res === 'number') q.res = q.res > 0 ? clamp(0.1 + 0.812 * Math.pow(q.res, 0.85), 0, 1) : 0;
  const tm = (v, t0, r) => clamp(Math.log(0.001 * Math.pow(10000, v) / t0) / Math.log(r), 0, 1);
  if (typeof q.attack === 'number') q.attack = tm(q.attack, 0.0015, 8000);
  for (const k of ['decay', 'release']) if (typeof q[k] === 'number') q[k] = tm(q[k], 0.002, 6000);
  return q;
}

// fine mode
const fineKeys = { shift: false, latch: false };
const fine = () => fineKeys.shift || fineKeys.latch;

// tooltip
const tip = $('#tip');
function showTip(id, el) {
  const f = FMT[id]; const v = state.p[id];
  let txt = f ? f(v) : '';
  if (!f && ctrls[id] && ctrls[id].spec.opts) txt = ctrls[id].spec.opts[v];
  if (!f && ctrls[id] && ctrls[id].spec.icons) txt = { tri: 'triangle', saw: 'saw', sq: 'square', pulse: 'narrow pulse', sine: 'sine', sawd: 'saw', ramp: 'ramp' }[ctrls[id].spec.icons[v]];
  if (MOD_AMT.has(id) && state.p.modWheel < 0.02) txt += ' · raise the MOD wheel';
  tip.innerHTML = `<span>${NAMES[id] || id}${fine() ? ' · fine' : ''}</span>${txt}`;
  const r = el.getBoundingClientRect();
  tip.style.left = (r.left + r.width / 2) + 'px'; tip.style.top = (r.top - 4) + 'px'; tip.hidden = false;
}
const hideTip = () => { tip.hidden = true; };

// ---------------------------------------------------------------- controls
const hooks = {};
class Knob {
  constructor(spec, m) {
    this.spec = spec; this.id = spec.id;
    const sel = spec.t === 'sel', size = sel ? 'sel' : (spec.size || 'm');
    const el = this.el = mk('div', 'knob k-' + size, m); place(el, spec.x, spec.y);
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', NAMES[spec.id] || spec.label);
    const uid = ++uidN;
    let svg;
    if (sel) {
      const n = (spec.opts || spec.icons).length;
      this.angles = n === 4 ? [-54, -18, 18, 54] : [-50, 0, 50];
      let marks = '';
      this.angles.forEach((a, i) => {
        const rad = a * Math.PI / 180, tx = Math.sin(rad) * 58, ty = -Math.cos(rad) * 58;
        const lx = Math.sin(rad) * 38, ly = -Math.cos(rad) * 38, lx2 = Math.sin(rad) * 45, ly2 = -Math.cos(rad) * 45;
        marks += `<line x1="${lx}" y1="${ly}" x2="${lx2}" y2="${ly2}" stroke="#26211d" stroke-width="2.4" stroke-linecap="round"/>`;
        if (spec.opts) marks += `<text x="${tx}" y="${ty}">${spec.opts[i]}</text>`;
        else {
          const ic = spec.icons[i], filled = false;
          marks += `<g transform="translate(${tx} ${ty}) scale(.85)"><path class="icon ${filled ? 'fill' : ''}" d="${ICON[ic]}"/></g>`;
        }
      });
      svg = `<svg viewBox="-75 -75 150 150">${marks}${capSVG(29, uid)}</svg>`;
    } else if (size === 'l') {
      let lab = '';
      [[20, '20Hz'], [200, '200Hz'], [2000, '2kHz'], [20000, '20kHz']].forEach(([hz, t]) => {
        const k = Math.log(hz / 10) / Math.log(2000), a = (-135 + 270 * k) * Math.PI / 180;
        lab += `<text x="${Math.sin(a) * 71}" y="${-Math.cos(a) * 69 + 2}" style="font-size:10.5px">${t}</text>`;
      });
      svg = `<svg viewBox="-80 -80 160 160">${ticksSVG(41, 44, 52, -135, 135, 5)}${lab}${capSVG(37, uid)}</svg>`;
    } else if (size === 's') {
      svg = `<svg viewBox="-29 -29 58 58">${ticksSVG(11, 24, 28)}${capSVG(18, uid)}</svg>`;
    } else {
      svg = `<svg viewBox="-50 -50 100 100">${ticksSVG(11, 39, 47)}${capSVG(30, uid)}</svg>`;
    }
    el.innerHTML = svg;
    this.rot = el.querySelector('.rot');
    const ly = spec.lblY !== undefined ? spec.lblY : spec.y + (size === 'l' ? 84 : sel ? 60 : 58);
    if (spec.label) label(m, spec.x, ly, spec.label, 'lbl' + (spec.inv ? ' out' : '') + (spec.boxed ? ' boxed' : ''));
    if (spec.bip) {
      const b = mk('div', 'biparc', m); place(b, spec.x, spec.y - 54);
      b.innerHTML = `<svg viewBox="-55 -20 110 40"><path d="M-36 14 Q-24 -6 -6 -9"/><path d="M36 14 Q24 -6 6 -9"/><path d="M-6 -9 l-5 -3 M-6 -9 l-4 4" /><path d="M6 -9 l5 -3 M6 -9 l4 4"/><text x="0" y="-6">0</text><text x="-44" y="18">-</text><text x="44" y="18">+</text></svg>`;
    }
    if (spec.led) { const l = mk('div', 'led', m); place(l, spec.x + 40, spec.y - 38); leds[spec.led] = l; }
    ctrls[this.id] = this;
    this.bind(sel);
    this.render();
  }
  get n() { return (this.spec.opts || this.spec.icons || []).length; }
  render() {
    const v = state.p[this.id];
    const a = this.angles ? this.angles[v] : -135 + 270 * v;
    this.rot.setAttribute('transform', `rotate(${a})`);
    this.el.setAttribute('aria-valuenow', v);
  }
  change(d) {
    const id = this.id, v = state.p[id];
    if (hooks[id] && hooks[id](d) === false) return;
    if (this.angles) setP(id, clamp(v + d, 0, this.n - 1));
    else setP(id, clamp(v + d, 0, 1));
  }
  bind(sel) {
    const el = this.el;
    el.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      e.preventDefault(); capture(el, e.pointerId); el.focus({ preventScroll: true });
      let lx = e.clientX, ly = e.clientY, moved = 0, acc = 0;
      showTip(this.id, el);
      const mv = ev => {
        if (pinch) return;
        const dy = ly - ev.clientY, dx = ev.clientX - lx; lx = ev.clientX; ly = ev.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        const d = dy + dx * 0.6;
        if (sel) { acc += d; if (Math.abs(acc) > 26) { this.change(Math.sign(acc)); acc = 0; } }
        else this.change(d / (fine() ? 2400 : 230));
        showTip(this.id, el);
      };
      const up = ev => {
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        if (sel && moved < 5 && ev.type === 'pointerup' && !pinch) setP(this.id, (state.p[this.id] + 1) % this.n);
        hideTip();
      };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', () => { if (!sel) setP(this.id, DEF[this.id] ?? .5); });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      if (sel) this.change(e.deltaY > 0 ? -1 : 1); else this.change(-e.deltaY / (fine() ? 12000 : 1200));
      showTip(this.id, el); clearTimeout(this.wt); this.wt = setTimeout(hideTip, 700);
    }, { passive: false });
    el.addEventListener('keydown', e => {
      const up = e.key === 'ArrowUp' || e.key === 'ArrowRight', dn = e.key === 'ArrowDown' || e.key === 'ArrowLeft';
      if (!up && !dn) return;
      e.preventDefault(); e.stopPropagation();
      this.change((up ? 1 : -1) * (sel ? 1 : e.shiftKey ? .002 : .02));
      showTip(this.id, el); clearTimeout(this.wt); this.wt = setTimeout(hideTip, 700);
    });
  }
}

class Radio {
  constructor(spec, m) {
    this.spec = spec; this.id = spec.id; this.btns = [];
    const n = spec.opts.length, sp = 42;
    spec.opts.forEach((o, i) => {
      const x = spec.x + (i - (n - 1) / 2) * sp;
      const b = mk('button', 'rbtn', m); place(b, x, spec.y); b.setAttribute('aria-label', `${spec.label} ${o.replace('<br>', '')}`);
      b.addEventListener('click', () => { if (hooks[this.id + 'Click'] && hooks[this.id + 'Click'](i) === false) return; setP(this.id, i); });
      this.btns.push(b);
      label(m, x, spec.y + (o.includes('<br>') ? 32 : 27), o, 'lbl sm' + (spec.hi === i ? ' out' : ''));
    });
    label(m, spec.x, spec.y + (spec.opts.some(o => o.includes('<br>')) ? 54 : 46), spec.label);
    ctrls[this.id] = this; this.render();
  }
  render() { this.btns.forEach((b, i) => b.classList.toggle('on', state.p[this.id] === i)); }
}

class Slider {
  constructor(spec, m) {
    this.spec = spec; this.id = spec.id;
    const h = spec.y2 - spec.y1, el = this.el = mk('div', 'slider', m);
    place(el, spec.x, (spec.y1 + spec.y2) / 2); el.style.height = `calc(var(--u) * ${h + 30}px)`;
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', 'Sustain');
    for (let i = 0; i <= 28; i++) { const r = mk('div', 'rung' + (i % 4 === 0 ? ' major' : ''), el); r.style.top = `calc(var(--u) * ${15 + h * i / 28}px)`; }
    mk('div', 'track', el).style.cssText = `top:calc(var(--u)*15px);bottom:calc(var(--u)*15px)`;
    this.cap = mk('div', 'capS', el); this.h = h;
    label(m, spec.x, spec.y2 + 82, spec.label);
    ctrls[this.id] = this; this.render();
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); capture(el, e.pointerId);
      const rect = el.getBoundingClientRect(), capR = this.cap.getBoundingClientRect();
      if (e.clientY < capR.top - 6 || e.clientY > capR.bottom + 6) {
        const top = rect.top + rect.height * 15 / (h + 30), bot = rect.bottom - rect.height * 15 / (h + 30);
        setP(this.id, clamp((bot - e.clientY) / (bot - top), 0, 1));
      }
      let ly = e.clientY; showTip(this.id, el);
      const px = () => el.getBoundingClientRect().height * h / (h + 30);
      const mv = ev => { if (pinch) return; const d = ly - ev.clientY; ly = ev.clientY; setP(this.id, clamp(state.p[this.id] + d / px() / (fine() ? 10 : 1), 0, 1)); showTip(this.id, el); };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); hideTip(); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', () => setP(this.id, DEF[this.id]));
    el.addEventListener('wheel', e => { e.preventDefault(); setP(this.id, clamp(state.p[this.id] - e.deltaY / 1200, 0, 1)); }, { passive: false });
    el.addEventListener('keydown', e => { if (e.key.startsWith('Arrow')) { e.preventDefault(); e.stopPropagation(); setP(this.id, clamp(state.p[this.id] + (/Up|Right/.test(e.key) ? .02 : -.02), 0, 1)); } });
  }
  render() { this.cap.style.top = `calc(var(--u) * ${15 + this.h * (1 - state.p[this.id])}px)`; }
}

const JACK_SVG = `<svg viewBox="-20 -20 40 40"><path class="nut" d="M0-18 15.6-9 15.6 9 0 18-15.6 9-15.6-9Z"/><circle class="ring" r="10.5"/><circle class="hole" r="6"/></svg>`;
function kindOf(id) { return id.startsWith('mult') ? 'm' : jacks[id] && jacks[id].out ? 'o' : 'i'; }
function makeJack(spec, m) {
  const el = mk('div', 'jack' + (spec.out ? ' out' : ''), m, JACK_SVG); place(el, spec.x, spec.y);
  const nm = (spec.label || 'mult').replace('<br>', ' ');
  el.dataset.jack = spec.id; el.setAttribute('aria-label', nm + ' jack');
  const t = m.querySelector('.title'), mod = m.classList.contains('m-osc') ? (spec.x < 165 ? 'OSC 1' : 'OSC 2') : t ? t.textContent : '';
  jacks[spec.id] = { el, out: spec.out, label: nm, full: (mod ? mod + ' ' : '') + nm };
  if (spec.label) label(m, spec.x, spec.y + (spec.label.includes('<br>') ? 33 : 28), spec.label, 'lbl sm' + (spec.out ? ' out' : ''));
  bindJack(el, spec.id);
}

function buildModule(spec, parent) {
  const m = mk('div', 'module m-' + spec.id, parent);
  m.style.setProperty('--w', spec.w); m.style.setProperty('--h', spec.h);
  if (spec.title) {
    const t = label(m, spec.w / 2, 24, spec.title, 'title' + (spec.kick ? ' kick' : '') + (spec.tight ? ' tight' : ''));
    if (spec.kick) { t.style.pointerEvents = 'auto'; t.title = 'Knock the spring tank'; t.addEventListener('click', () => post({ t: 'kick' })); }
  }
  for (const it of spec.items) {
    switch (it.t) {
      case 'jack': makeJack(it, m); break;
      case 'knob': case 'sel': new Knob(it, m); break;
      case 'radio': new Radio(it, m); break;
      case 'slider': new Slider(it, m); break;
      case 'text': label(m, it.x, it.y, it.text, it.cls || 'lbl'); break;
      case 'rule': { const r = mk('div', 'rule', m); r.style.left = `calc(var(--u)*${it.x - (it.w > 2 ? 0 : 1)}px)`; r.style.top = `calc(var(--u)*${it.y - (it.h > 2 ? 0 : 1)}px)`; r.style.width = `calc(var(--u)*${it.w}px)`; r.style.height = `calc(var(--u)*${it.h}px)`; break; }
      case 'led': { const l = mk('div', 'led', m); place(l, it.x, it.y); leds[it.id] = l; break; }
      case 'sync': {
        const b = mk('button', 'sqbtn', m, '<i></i>'); place(b, it.x, it.y); b.setAttribute('aria-label', 'Sync');
        label(m, it.x, it.y + 57, it.label);
        b.addEventListener('click', e => { e.preventDefault(); syncPress(); });
        ctrls.sync = { spec: it, render() { b.classList.toggle('on', !!state.p.sync); b.classList.toggle('blink', gsActive); } };
        ctrls.sync.render(); break;
      }
      case 'midiText': { const t = mk('div', 'mtext', m, 'Connect MIDI…'); place(t, it.x, it.y); t.addEventListener('click', openMidi); leds.midiText = t; break; }
      case 'ext': {
        const b = mk('button', 'extbtn', m, '<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12Z"/></svg>');
        place(b, it.x, it.y); b.title = 'External input (microphone / line in)'; b.setAttribute('aria-label', 'External input');
        label(m, it.x, it.y + (it.label.includes('<br>') ? 33 : 28), it.label, 'lbl sm'); b.addEventListener('click', toggleExt); leds.ext = b; break;
      }
      case 'pb': {
        const b = mk('button', 'pbtn', m); place(b, it.x, it.y); b.setAttribute('aria-label', it.label);
        label(m, it.x, it.y + 32, it.label, 'lbl'); if (it.sub) label(m, it.x, it.subY || it.y + 48, it.sub, 'lbl sm');
        leds[it.id] = b; bindPB(b, it.id); break;
      }
      case 'octleds': { const w = mk('div', 'octleds', m); place(w, it.x, it.y); for (let i = 0; i < 5; i++) leds['oct' + i] = mk('div', 'led', w); if (!it.nolabel) label(m, it.x, it.y + 20, 'KB OCTAVE', 'lbl sm'); break; }
      case 'wheel': makeWheel(it, m); break;
    }
  }
  return m;
}

// ---------------------------------------------------------------- build panel
const panel = $('#panel');
const rearRow = mk('div', 'rear-row m-rear', panel);
let rearV = null, midiLabel = 'Connect MIDI…';
// build the rear-panel modules horizontal (desktop, tablet) or upright (phone strip)
function buildRear(vertical) {
  if (rearV === vertical) return;
  const first = rearV === null;
  rearV = vertical;
  const specs = vertical ? REAR_V : REAR;
  for (const s of REAR) for (const it of s.items) if (it.t === 'jack') { if (!first && pending === it.id) setPending(null); delete jacks[it.id]; }
  delete ctrls.fine;
  rearRow.innerHTML = '';
  if (vertical) {
    mk('div', 'rear-sep', rearRow).setAttribute('aria-hidden', 'true');
    const col = mk('div', 'rear-col', rearRow);
    buildModule(REAR_V[0], col); buildModule(REAR_V[1], col); buildModule(REAR_V[2], rearRow);
  } else specs.forEach(s => buildModule(s, rearRow));
  leds.midiText.textContent = midiLabel;
  if (typeof extOn !== 'undefined' && extOn) leds.ext.classList.add('on');
}
buildRear(false);
const modRow = mk('div', 'mod-row', panel);
MODS.forEach(s => {
  if (s.col) { const c = mk('div', 'col m-outcol', modRow); s.col.forEach(x => buildModule(x, c)); }
  else buildModule(s, modRow);
});
const svgC = $('#cables'); panel.appendChild(svgC);
let deckMode = 0;
function buildDeck(compact) {
  if (deckMode === (compact ? 2 : 1)) return;
  deckMode = compact ? 2 : 1;
  $('#kbFoot').prepend($('#whToggle'));   // keep the hider out of the way of the rebuild
  $('#lhcWrap').innerHTML = ''; $('#whWrap').innerHTML = '';
  if (compact) { buildModule(LHCM, $('#lhcWrap')); buildModule(WHL, $('#whWrap')); }
  else buildModule(LHC, $('#lhcWrap'));
  if (typeof refreshLeds === 'function' && leds.play) refreshLeds();
}

// ---------------------------------------------------------------- layout scaling
let layoutMode = 0;
const KEY_W = 37;   // white-key width on phones (px)
// phones: the arrow under the keys hides the pitch/mod wheels to make room for more keys
let wheelsHidden = load('wheelsHidden', false);
function paintWheelToggle() {
  const b = $('#whToggle'); b.textContent = wheelsHidden ? '›' : '‹';
  // shown wheels: the hider is anchored under them; hidden: it snaps into the scrollbar row
  // (sideways phones keep it in the scrollbar row: there is no height to spare under the wheels)
  const cl = document.body.classList;
  if (!wheelsHidden && cl.contains('L3') && !cl.contains('land')) { if (b.parentElement !== $('#whWrap')) $('#whWrap').appendChild(b); }
  else if (b.parentElement !== $('#kbFoot')) $('#kbFoot').prepend(b);
  b.setAttribute('aria-expanded', String(!wheelsHidden)); b.setAttribute('aria-label', (wheelsHidden ? 'Show' : 'Hide') + ' pitch and mod wheels');
}
$('#whToggle').addEventListener('click', () => { wheelsHidden = !wheelsHidden; store('wheelsHidden', wheelsHidden); paintWheelToggle(); layout(); });
paintWheelToggle();
// keyboard scrollbar (phones): drag the thumb, or tap the track to centre the keys there
{
  const outer = $('#kbOuter'), bar = $('#kbBar'), thumb = $('#kbThumb');
  const paint = () => {
    const sw = outer.scrollWidth, cw = outer.clientWidth, over = sw - cw;
    bar.classList.toggle('full', over <= 1);
    thumb.style.width = (100 * Math.min(1, cw / sw)) + '%';
    thumb.style.left = (over > 0 ? 100 * outer.scrollLeft / sw : 0) + '%';
    bar.setAttribute('aria-valuenow', over > 0 ? Math.round(100 * outer.scrollLeft / over) : 0);
  };
  outer.addEventListener('scroll', paint, { passive: true });
  new ResizeObserver(paint).observe(outer);
  new ResizeObserver(paint).observe($('#keyboard'));
  bar.addEventListener('pointerdown', e => {
    e.preventDefault(); capture(bar, e.pointerId);
    const r = bar.getBoundingClientRect(), scale = () => outer.scrollWidth / r.width;
    if (e.target !== thumb) {   // tap on the track: centre the view on that point
      outer.scrollLeft = (e.clientX - r.left) * scale() - outer.clientWidth / 2;
    }
    let lx = e.clientX;
    const mv = ev => { outer.scrollLeft += (ev.clientX - lx) * scale(); lx = ev.clientX; };
    const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); thumb.classList.remove('drag'); };
    thumb.classList.add('drag');
    bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
  });
  bar.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); outer.scrollBy({ left: (e.key === 'ArrowLeft' ? -3 : 3) * KEY_W }); }
  });
  bar.tabIndex = 0;
  paint();
}
// Pinch on the module strip zooms the modules only (the page itself never zooms). The range runs
// from "every module visible" (no spare space either side) up to large, focused on the fingers.
const zoom = {
  fit: 0.6, z: load('zoom', 1), unitsW: 2400, u: 0.6,
  range() {
    const sc = $('#wrap'), all = (sc.clientWidth - 20) / this.unitsW;
    return [Math.min(this.fit, all), Math.max(this.fit, 1.6)];
  },
  set(u, focus) {
    const [lo, hi] = this.range(); u = clamp(u, lo, hi);
    const sc = $('#wrap'), old = this.u;
    let fx = 0, fy = 0;
    if (focus) { fx = (focus.x + sc.scrollLeft - panel.offsetLeft) / old; fy = (focus.y + sc.scrollTop - panel.offsetTop) / old; }
    this.u = u; document.documentElement.style.setProperty('--u', u.toFixed(4));
    // at the "everything visible" end, trim any leftover overflow (a few parts don't scale linearly)
    if (u <= lo * 1.0001) for (let i = 0; i < 3; i++) {
      const over = panel.offsetWidth + 20 - sc.clientWidth; if (over <= 0) break;   // the panel itself, not the (possibly stale) cable layer
      const cw = sc.clientWidth - 20; this.u = u = u * cw / (cw + over + 0.5); document.documentElement.style.setProperty('--u', u.toFixed(4));
    }
    if (focus) { sc.scrollLeft = panel.offsetLeft + fx * u - focus.x; sc.scrollTop = panel.offsetTop + fy * u - focus.y; }
    drawCables();
  },
  save() { this.z = this.u / this.fit; store('zoom', this.z); },
  reset() { this.z = 1; store('zoom', 1); this.set(this.fit, null); },
};
let pinch = null;
{
  const sc = $('#wrap');
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = t => { const r = sc.getBoundingClientRect(); return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top }; };
  sc.addEventListener('touchstart', e => {
    if (!document.body.classList.contains('L3') || e.touches.length !== 2) return;
    pinch = { d0: dist(e.touches), u0: zoom.u };
    cancelGestures();
  }, { passive: true, capture: true });
  sc.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    zoom.set(pinch.u0 * dist(e.touches) / pinch.d0, mid(e.touches));
  }, { passive: false, capture: true });
  const end = e => { if (pinch && e.touches.length < 2) { pinch.done = true; zoom.save(); if (!e.touches.length) pinch = null; } };
  sc.addEventListener('touchend', end, { capture: true }); sc.addEventListener('touchcancel', end, { capture: true });
}
// a pinch beginning mid-gesture cancels whatever the first finger was doing
function cancelGestures() {
  hideTip();
  if (dragC) { if (dragC.hot) dragC.hot.classList.remove('hot'); const mvC = dragC.moving; dragC = null; markTargets(null); if (mvC) { state.cables.push(mvC); patchChanged(); } else drawCables(); }
}
// keep the page itself from zooming (iOS ignores user-scalable=no)
['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', e => { if (e.touches.length > 1 && !e.target.closest('#wrap') && e.cancelable) e.preventDefault(); }, { passive: false });
let deckHidden = load('deckHidden', false);
$('#modNav').appendChild($('#deckToggle'));
$('#deckToggle').addEventListener('click', () => {
  deckHidden = !deckHidden; store('deckHidden', deckHidden);
  const b = $('#deckToggle'); b.textContent = deckHidden ? 'KEYS ▴' : 'KEYS ▾';
  b.setAttribute('aria-expanded', String(!deckHidden)); b.setAttribute('aria-label', deckHidden ? 'Show keyboard' : 'Hide keyboard');
  layout();
});
if (deckHidden) { $('#deckToggle').textContent = 'KEYS ▴'; $('#deckToggle').setAttribute('aria-expanded', 'false'); }

// module navigator (phones): jump along the strip and highlight where you are.
// - a tap highlights that button straight away and keeps it while the strip glides there
//   (no flicker through the modules in between), and briefly lights the module up, which also
//   shows where it is when everything already fits on screen
// - scrolling by hand highlights the module at the left edge of the strip; once the strip
//   is scrolled all the way right, the right-most module fully in view wins, so the last
//   buttons (OUT, I/O) can light up too
const NAV = [['arp', 'ARP/SEQ'], ['mod', 'MOD'], ['osc', 'OSC'], ['mix', 'MIX'], ['util', 'UTIL'], ['filter', 'FILTER'], ['env', 'ENV'], ['outcol', 'OUT'], ['rear', 'I/O']];
const navMod = id => panel.querySelector('.m-' + id);
let navLock = null, navOn = null, navLockT = 0;
function navHighlight(id) {
  if (id === navOn) return;
  navOn = id;
  let btn = null;
  navBtns.forEach(b => { const on = b.dataset.m === id; b.classList.toggle('on', on); if (on) btn = b; });
  if (btn) {   // keep the lit button in view in the nav row, without jerking it around
    const nv = $('#modNav'), br = btn.getBoundingClientRect(), nr = nv.getBoundingClientRect();
    if (br.left < nr.left + 4 || br.right > nr.right - 4) nv.scrollTo({ left: nv.scrollLeft + br.left - nr.left - (nr.width - br.width) / 2, behavior: 'smooth' });
  }
}
const navBtns = NAV.map(([id, t]) => {
  const b = mk('button', '', $('#modNav'), t); b.dataset.m = id;
  b.addEventListener('click', () => {
    const m = navMod(id), sc = $('#wrap');
    const left = m.getBoundingClientRect().left - panel.getBoundingClientRect().left + panel.offsetLeft;
    navLock = id; navHighlight(id);
    clearTimeout(navLockT); navLockT = setTimeout(() => { navLock = null; }, 1200);   // safety: release after the glide
    sc.scrollTo({ left: Math.max(0, left - 10), behavior: 'smooth' });
    m.classList.remove('flash'); void m.offsetWidth; m.classList.add('flash');
  });
  return b;
});
$('#modNav').insertBefore($('#deckToggle'), null);   // KEYS stays last
let navRaf = 0;
function navActive() {
  navRaf = 0;
  if (!document.body.classList.contains('L3')) return;
  if (pending) chipDir();
  if (navLock) return;
  const sc = $('#wrap'), s = sc.getBoundingClientRect(), edge = s.left + 24;
  const atEnd = sc.scrollLeft >= sc.scrollWidth - sc.clientWidth - 2 && sc.scrollWidth > sc.clientWidth;
  let best = NAV[0][0];
  for (const [id] of NAV) {
    const r = navMod(id).getBoundingClientRect();
    if (atEnd ? r.right <= s.right + 1 && r.left >= s.left - 1 : r.left <= edge) best = id;
  }
  navHighlight(best);
}
{
  const sc = $('#wrap');
  sc.addEventListener('scroll', () => { if (!navRaf) navRaf = requestAnimationFrame(navActive); }, { passive: true });
  // any scrolling by hand releases the tapped highlight
  const release = () => { if (navLock) { navLock = null; clearTimeout(navLockT); } };
  sc.addEventListener('touchstart', release, { passive: true });
  sc.addEventListener('wheel', release, { passive: true });
  sc.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') release(); });
  if ('onscrollend' in window) sc.addEventListener('scrollend', () => { if (navLock) { clearTimeout(navLockT); navLockT = setTimeout(() => { navLock = null; }, 150); } });
}
// Desktop and tablet (mouse): one row of modules, scaled so the whole instrument fits the window,
// width and height, with the keyboard docked at the bottom. No page scroll, so no scrollbar
// appears and steals width (which used to wrap the last module onto a second row). Only when the
// window is too narrow for a usable single row do the modules wrap into rows and scroll.
const ONE_W = 2088, ONE_H = 745, PAD_V = 14 + 18;   // one-row panel size in layout units; #wrap padding
function layout() {
  const iw = document.documentElement.clientWidth, W = iw - 24;
  let u, mode;
  const coarse = matchMedia('(pointer: coarse)').matches, H = window.innerHeight;
  const land = coarse && H < 560 && W + 24 > H;           // phone held sideways
  if (W < 640 || land || (coarse && W / ONE_W < 0.56)) { u = 0.6; mode = 3; }   // phones and touch tablets: refined below
  else if (W / ONE_W >= 0.45) { u = W / ONE_W; mode = 1; }
  else { u = Math.min(0.95, W / 1100); mode = 2; }
  document.body.classList.toggle('land', mode === 3 && land);
  document.body.classList.toggle('kbHide', mode === 3 && deckHidden);
  const sc = $('#wrap'), ratio = sc.scrollWidth > sc.clientWidth ? sc.scrollLeft / (sc.scrollWidth - sc.clientWidth) : 0;
  document.documentElement.style.setProperty('--u', u.toFixed(4));
  document.body.classList.toggle('L3', mode === 3);
  document.body.classList.toggle('dock', true);
  document.body.classList.toggle('fit', mode === 1);
  // deck scale: by width, but never more than ~30% of the window height (desktop) or ~36% (sideways phone)
  const du = mode === 3 ? (land ? clamp(H / 680, .5, .6) : clamp((W + 12) / 480, .55, .9))
    : clamp(Math.min(W / ONE_W * 1.25, (0.3 * H - 40) / 312), .6, 1);
  document.documentElement.style.setProperty('--du', du.toFixed(3));
  $('#keyboard').style.height = (mode === 3 ? (land ? Math.min(170 * du, H * 0.3) : 170 * du) : 312 * du) + 'px';
  if (mode === 3) $('#keyboard').style.width = (19 * KEY_W) + 'px'; else $('#keyboard').style.width = '';
  document.body.classList.toggle('noWheels', mode === 3 && wheelsHidden);
  buildDeck(mode === 3);
  buildRear(mode === 3);
  document.body.classList.toggle('noWheels', mode === 3 && wheelsHidden);
  paintWheelToggle();
  layoutMode = mode;
  const deckH = $('#deck').offsetHeight, barH = $('.bar').offsetHeight;
  document.documentElement.style.setProperty('--deckH', deckH + 'px');
  document.documentElement.style.setProperty('--barH', barH + 'px');
  document.body.classList.remove('side');
  if (mode === 1) {
    // fit both ways: the free height between the header and the docked keyboard caps the scale.
    // Two arrangements are tried: the rear-panel modules in a row above the others, or stacked
    // in a column at the right-hand end (better on short, wide windows); the larger scale wins.
    const availH = H - barH - deckH - PAD_V - 6;
    const uTop = Math.min(W / ONE_W, availH / ONE_H, 1.05);
    document.body.classList.add('side'); buildRear(true);
    const mu = 0.5; document.documentElement.style.setProperty('--u', mu);
    const sw = $('#panel').offsetWidth / mu, sh = $('#panel').offsetHeight / mu;
    const uSide = Math.min(W / sw, availH / sh, 1.05);
    const side = uSide > uTop * 1.03;
    if (!side) { document.body.classList.remove('side'); buildRear(false); }
    u = clamp(side ? uSide : uTop, 0.3, 1.05);
    document.documentElement.style.setProperty('--u', u.toFixed(4));
    // belt and braces: if anything still overflows (fonts, rounding), shrink until it fits
    for (let i = 0; i < 3; i++) {
      const p = $('#panel'), ow = p.offsetWidth - W, oh = p.offsetHeight + PAD_V + barH + deckH - H;
      if (ow <= 0 && oh <= 0) break;
      u *= Math.min(ow > 0 ? W / (W + ow + 1) : 1, oh > 0 ? (p.offsetHeight - oh - 1) / p.offsetHeight : 1);
      document.documentElement.style.setProperty('--u', u.toFixed(4));
    }
  }
  if (mode === 3) {
    // one row of modules (628 units tall; the rear-panel modules stack in a column at the end)
    // fills the free height; scroll sideways
    const avail = window.innerHeight - barH - deckH - 16;
    zoom.fit = clamp(avail / 628, land ? 0.18 : 0.4, 1.1);
    document.documentElement.style.setProperty('--u', zoom.fit.toFixed(4));
    zoom.unitsW = panel.offsetWidth / zoom.fit;
    zoom.set(zoom.fit * zoom.z, null);
    navActive();
    sc.scrollLeft = ratio * Math.max(0, sc.scrollWidth - sc.clientWidth);
  }
  requestAnimationFrame(() => {
    document.documentElement.style.setProperty('--deckH', $('#deck').offsetHeight + 'px');
    drawCables();
  });
}
window.addEventListener('resize', layout);
new ResizeObserver(() => drawCables()).observe(panel);

// ---------------------------------------------------------------- cables
const COLORS = ['#d84a3a', '#e9a43b', '#3d8fd6', '#47ad6c', '#9b62c9', '#e8e1d2', '#2b2b2b', '#e46aa0'];
let colorI = load('colorI', 0);
let pending = null, dragC = null, hiJack = null, hiCable = null;
// tap-to-patch selection: stays selected while you scroll; tap the same jack again to cancel
function setPending(id) {
  pending = id; markTargets(id);
  const chip = $('#patchChip');
  if (id) { chip.querySelector('b').textContent = jacks[id].full; chip.hidden = false; chipDir(); } else chip.hidden = true;
  drawCables();
}
function chipDir() {
  const chip = $('#patchChip'); if (!pending) return;
  const r = jacks[pending].el.getBoundingClientRect(), s = $('#wrap').getBoundingClientRect();
  const off = layoutMode === 3 ? (r.right < s.left ? '◀ ' : r.left > s.right ? '▶ ' : '') : '';
  chip.querySelector('.pc-dir').textContent = off;
}
function jackXY(id) {
  const j = jacks[id]; if (!j) return [0, 0];
  const r = j.el.getBoundingClientRect(), p = panel.getBoundingClientRect();
  return [r.left + r.width / 2 - p.left, r.top + r.height / 2 - p.top];
}
function cablePath(x1, y1, x2, y2) {
  const d = Math.hypot(x2 - x1, y2 - y1), sag = Math.min(40 + d * 0.33, 260);
  return `M${x1} ${y1} C${x1 + (x2 - x1) * .15} ${y1 + sag} ${x2 - (x2 - x1) * .15} ${y2 + sag} ${x2} ${y2}`;
}
function drawCables() {
  // size from the panel's own box (not scrollWidth, which would include this layer and keep stale space after zooming out)
  svgC.setAttribute('width', panel.offsetWidth); svgC.setAttribute('height', panel.offsetHeight);
  const w = Math.max(4, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) * 8);
  let s = '';
  const all = state.cables.slice();
  for (const c of all) {
    const [x1, y1] = jackXY(c.a), [x2, y2] = jackXY(c.b);
    const d = cablePath(x1, y1, x2, y2);
    const fade = hiJack && c.a !== hiJack && c.b !== hiJack, hot = hiCable === c;
    s += `<g opacity="${fade ? .18 : 1}"><path class="shadow" d="${d}" stroke-width="${w + 3}" transform="translate(2 4)"/>` +
      `<path class="cable" d="${d}" stroke="${c.color}" stroke-width="${hot ? w * 1.7 : w}" stroke-opacity=".93"/>` +
      `<circle class="plug" cx="${x1}" cy="${y1}" r="${w * .95}" fill="${c.color}"/><circle class="plug" cx="${x2}" cy="${y2}" r="${w * .95}" fill="${c.color}"/></g>`;
  }
  if (dragC) {
    const [x1, y1] = jackXY(dragC.fixed);
    s += `<path class="cable" d="${cablePath(x1, y1, dragC.x, dragC.y)}" stroke="${dragC.color}" stroke-width="${w}" stroke-opacity=".8"/><circle class="plug" cx="${dragC.x}" cy="${dragC.y}" r="${w}" fill="${dragC.color}"/>`;
  }
  svgC.innerHTML = s;
  svgC.setAttribute('class', G.cables === 'show' ? '' : G.cables);
  for (const id in jacks) jacks[id].el.classList.toggle('pending', pending === id);
}
// universal patching: any jack can join any other jack (see resolvePatch in dsp.js)
function validPair(a, b) { return a !== b && !!jacks[a] && !!jacks[b]; }
function connect(a, b, color) {
  if (!validPair(a, b)) return false;
  const rank = { o: 0, m: 1, i: 2 };
  if (rank[kindOf(a)] > rank[kindOf(b)]) [a, b] = [b, a];
  if (state.cables.some(c => (c.a === a && c.b === b) || (c.a === b && c.b === a))) return false;
  if (!color) { color = COLORS[colorI % COLORS.length]; colorI++; store('colorI', colorI); }
  state.cables.push({ a, b, color });
  patchChanged(); return true;
}
function removeCable(c) { state.cables = state.cables.filter(x => x !== c); patchChanged(); }
function patchChanged() { post({ t: 'patch', c: state.cables.map(c => [c.a, c.b]) }); drawCables(); markDirty(); clearTimeout(saveT); saveT = setTimeout(autosave, 300); }
function markTargets(from) {
  for (const id in jacks) { const ok = from && validPair(from, id); jacks[id].el.classList.toggle('target', !!ok); jacks[id].el.classList.toggle('dim', !!from && !ok && id !== from); }
}
// while a cable is being dragged near the edge of the scrolling module strip, scroll it
const scroller = $('#wrap');
let dragPt = null, edgeRaf = 0;
function dragTo(cx, cy) {
  if (!dragC) return;
  const p = panel.getBoundingClientRect(); dragC.x = cx - p.left; dragC.y = cy - p.top;
  const t = document.elementFromPoint(cx, cy), je = t && t.closest('.jack');
  if (dragC.hot && dragC.hot !== je) dragC.hot.classList.remove('hot');
  dragC.hot = je; if (je) je.classList.add('hot');
  drawCables();
}
function edgeLoop() {
  edgeRaf = 0;
  if (!dragC || !dragPt) return;
  const r = scroller.getBoundingClientRect(), zone = Math.min(64, r.width * 0.14);
  const canX = scroller.scrollWidth > scroller.clientWidth, canY = scroller.scrollHeight > scroller.clientHeight;
  let vx = 0, vy = 0;
  if (canX) { if (dragPt.x < r.left + zone) vx = -(r.left + zone - dragPt.x) / zone; else if (dragPt.x > r.right - zone) vx = (dragPt.x - (r.right - zone)) / zone; }
  if (canY) { if (dragPt.y < r.top + zone) vy = -(r.top + zone - dragPt.y) / zone; else if (dragPt.y > r.bottom - zone && dragPt.y < r.bottom) vy = (dragPt.y - (r.bottom - zone)) / zone; }
  // layouts where the page itself scrolls (tablet / landscape): scroll the window vertically instead,
  // using the area between the top bar and the docked keyboard as the visible region
  let page = false;
  if (!canX && !canY) {
    const top = $('.bar').getBoundingClientRect().bottom, deck = document.body.classList.contains('dock') ? $('#deck').getBoundingClientRect().top : window.innerHeight;
    if (dragPt.y < top + zone) vy = -(top + zone - dragPt.y) / zone; else if (dragPt.y > deck - zone) vy = (dragPt.y - (deck - zone)) / zone;
    page = true;
  }
  vx = clamp(vx, -1, 1); vy = clamp(vy, -1, 1);
  if (vx || vy) {
    const dx = Math.sign(vx) * vx * vx * 22 + vx * 4, dy = Math.sign(vy) * vy * vy * 16 + vy * 3;
    if (page) window.scrollBy(0, dy); else { scroller.scrollLeft += dx; scroller.scrollTop += dy; }
    dragTo(dragPt.x, dragPt.y);
  }
  edgeRaf = requestAnimationFrame(edgeLoop);
}
function bindJack(el, id) {
  // On phones jacks allow native sideways panning (touch-action: pan-x). The first move decides:
  // a quick, mostly sideways swipe scrolls the strip; a vertical drag, or any drag after a short
  // hold, belongs to the jack (a cable) and blocks the pan.
  let ts = null;
  el.addEventListener('touchstart', e => { const t = e.touches[0]; ts = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: e.timeStamp, own: false } : null; }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!ts) return;
    if (ts.own) { if (e.cancelable) e.preventDefault(); return; }
    const t = e.touches[0], dx = t.clientX - ts.x, dy = t.clientY - ts.y;
    if (Math.abs(dx) + Math.abs(dy) < 3) return;
    if (e.timeStamp - ts.t > 180 || Math.abs(dy) > Math.abs(dx) * 0.8) { ts.own = true; if (e.cancelable) e.preventDefault(); }
    else ts.pan = true;
  }, { passive: false });
  const owned = () => !document.body.classList.contains('L3') || (ts && ts.own);
  el.addEventListener('contextmenu', e => { e.preventDefault(); openJackMenu(id); });
  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY; let started = false;
    const pid = e.pointerId, touch = e.pointerType !== 'mouse';
    // touch: holding a patched jack arms it (release = pull its newest cable, drag = move that plug)
    let armed = false;
    const holdT = touch ? setTimeout(() => {
      if (!started && state.cables.some(c => c.a === id || c.b === id)) { armed = true; el.classList.add('armed'); if (navigator.vibrate) navigator.vibrate(12); }
    }, 450) : 0;
    const mv = ev => {
      if (ev.pointerId !== pid) return;
      if (pinch) { clearTimeout(holdT); el.classList.remove('armed'); armed = false; return; }
      if (touch && !owned()) return;
      if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 7) {
        started = true; clearTimeout(holdT); el.classList.remove('armed');
        if (pending) setPending(null);
        // a plain drag always starts a new cable; Alt-drag (or hold-then-drag on touch) moves the newest plug here
        const here = state.cables.filter(c => c.a === id || c.b === id);
        const move = here.length && (e.altKey || armed);
        if (move) { const c = here[here.length - 1]; dragC = { fixed: c.a === id ? c.b : c.a, moving: c, color: c.color }; state.cables = state.cables.filter(x => x !== c); }
        else dragC = { fixed: id, color: COLORS[colorI % COLORS.length] };
        markTargets(dragC.fixed);
      }
      if (started) {
        dragPt = { x: ev.clientX, y: ev.clientY };
        dragTo(ev.clientX, ev.clientY);
        if (!edgeRaf) edgeRaf = requestAnimationFrame(edgeLoop);
      }
    };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      clearTimeout(holdT); el.classList.remove('armed');
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      dragPt = null;
      if (started && ev.type === 'pointercancel') {          // the browser took the gesture: put things back
        if (dragC.hot) dragC.hot.classList.remove('hot');
        const mvC = dragC.moving; dragC = null; markTargets(null);
        if (mvC) { state.cables.push(mvC); patchChanged(); } else drawCables();
        return;
      }
      if (!started) {
        if (ev.type === 'pointercancel' || (ts && ts.pan) || pinch) return;
        if (armed) { openJackMenu(id); return; }
        tapJack(id, touch); return;
      }
      if (dragC.hot) dragC.hot.classList.remove('hot');
      const t = document.elementFromPoint(ev.clientX, ev.clientY), je = t && t.closest('.jack');
      const fixed = dragC.fixed, color = dragC.color, wasMoving = !!dragC.moving;
      dragC = null; markTargets(null);
      if (je && validPair(fixed, je.dataset.jack)) { if (!wasMoving) colorI++; connect(fixed, je.dataset.jack, color); }
      else if (wasMoving) patchChanged(); else drawCables();
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
}
// tap patching. Touch: a tap always selects (patched or not), tapping the same jack again
// cancels, tapping any other jack connects; press and hold a patched jack for its disconnect
// menu. Mouse: clicking a patched jack with nothing selected opens the disconnect menu.
function tapJack(id, touch) {
  if (jmClosedFor === id) { jmClosedFor = null; return; }
  jmClosedFor = null;
  if (pending) {
    const p = pending; setPending(null);
    if (p !== id && validPair(p, id)) connect(p, id);
    return;
  }
  const here = state.cables.filter(c => c.a === id || c.b === id);
  if (!touch && here.length) { openJackMenu(id); return; }
  setPending(id);
}
// Disconnect menu: lists every cable on a jack so you can pull exactly the one you mean.
// Opens on a patched jack with a click/right-click (mouse) or a press-and-hold (touch).
const jm = $('#jackMenu');
function openJackMenu(id) {
  const here = state.cables.filter(c => c.a === id || c.b === id);
  if (!here.length) return;
  if (pending) setPending(null);
  hiJack = id; hiCable = null;
  jm.innerHTML = '';
  mk('div', 'jm-h', jm, jacks[id].full);
  for (const c of here.slice().reverse()) {
    const other = c.a === id ? c.b : c.a;
    const row = mk('button', 'jm-row', jm, `<i style="background:${c.color}"></i><span>${jacks[other].full}</span><b aria-hidden="true">×</b>`);
    row.setAttribute('aria-label', 'Disconnect ' + jacks[other].full);
    row.addEventListener('pointerenter', () => { hiCable = c; drawCables(); });
    row.addEventListener('pointerleave', () => { if (hiCable === c) { hiCable = null; drawCables(); } });
    row.addEventListener('click', e => { e.stopPropagation(); removeCable(c); if (state.cables.some(x => x.a === id || x.b === id)) openJackMenu(id); else closeJackMenu(); });
  }
  if (here.length > 1) mk('button', 'jm-act', jm, 'Disconnect all').addEventListener('click', e => { e.stopPropagation(); state.cables = state.cables.filter(c => c.a !== id && c.b !== id); patchChanged(); closeJackMenu(); });
  mk('button', 'jm-act', jm, 'Add another cable from here').addEventListener('click', e => { e.stopPropagation(); closeJackMenu(); setPending(id); });
  jm.hidden = false;
  const r = jacks[id].el.getBoundingClientRect(), mw = jm.offsetWidth, mh = jm.offsetHeight;
  let x = r.left + r.width / 2 - mw / 2, y = r.bottom + 8;
  if (y + mh > window.innerHeight - 8) y = r.top - mh - 8;
  jm.style.left = clamp(x, 8, window.innerWidth - mw - 8) + 'px'; jm.style.top = clamp(y, 8, window.innerHeight - mh - 8) + 'px';
  drawCables();
}
function closeJackMenu() { if (jm.hidden) return; jm.hidden = true; hiJack = null; hiCable = null; drawCables(); }
let jmClosedFor = null;   // pressing the same jack again just closes its menu
document.addEventListener('pointerdown', e => {
  if (jm.hidden || e.target.closest('#jackMenu')) return;
  const j = e.target.closest('.jack'); jmClosedFor = j && j.dataset.jack === hiJack ? hiJack : null;
  closeJackMenu();
}, true);
$('#wrap').addEventListener('scroll', closeJackMenu, { passive: true });
window.addEventListener('resize', closeJackMenu);
// a mouse click on empty panel still cancels; on touch only the jack itself (or the chip) does, so scrolling keeps it
document.addEventListener('pointerdown', e => { if (pending && e.pointerType === 'mouse' && !e.target.closest('.jack, #patchChip')) setPending(null); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!jm.hidden) closeJackMenu(); else if (pending) setPending(null); } });
$('#patchChip button').addEventListener('click', e => { e.stopPropagation(); setPending(null); });
$('#patchChip').addEventListener('click', () => { if (pending) jacks[pending].el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); });

// ---------------------------------------------------------------- left-hand controller
const pressed = {};
let holdUsed = false, panicT = 0, tapT = 0;
function bindPB(b, id) {
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); capture(b, e.pointerId);
    pbDown(id, e.pointerType);
    const up = () => { b.removeEventListener('pointerup', up); b.removeEventListener('pointercancel', up); pbUp(id); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  });
}
function pbDown(id, ptype) {
  pressed[id] = true; ensurePower();
  if (id === 'play') post({ t: 'play' });
  if (id === 'hold') holdUsed = false;
  if (id === 'tap') { post({ t: 'tap' }); clearTimeout(tapT); tapT = setTimeout(() => { if (pressed.tap && !pressed.play && !pressed.hold) { post({ t: 'tapx' }); toast('Tap tempo off'); } }, 1000); }
  if (id === 'shift') { if (ptype === 'touch' || ptype === 'pen') { fineKeys.latch = !fineKeys.latch; } else fineKeys.shift = true; refreshLeds(); }
  if (id === 'kbDn' || id === 'kbUp') {
    const d = id === 'kbDn' ? -1 : 1; post({ t: 'oct', d });
    const o = clamp(eng.oct + d, -2, 2);
    if (midiOut && G.outPanel && o !== eng.oct) midiSend([0xB0 | outCh(), 89, [0, 26, 51, 77, 102][o + 2]]);
  }
  if (pressed.play && pressed.hold && pressed.tap) { clearTimeout(panicT); panicT = setTimeout(() => { if (pressed.play && pressed.hold && pressed.tap) { post({ t: 'panic' }); keysUp(); toast('All notes off'); } }, 1000); }
  if (id === 'hold' || id === 'play' || id === 'tap') refreshLeds();
}
function flashPB(id) { const b = leds[id]; if (!b) return; b.classList.add('on'); setTimeout(() => { pressed[id] = false; b.classList.remove('on'); }, 120); }
function pbUp(id) {
  pressed[id] = false;
  if (id === 'hold' && !holdUsed) post({ t: 'hold' });
  if (id === 'shift') { fineKeys.shift = false; refreshLeds(); }
}
hooks.glide = d => {
  if (pressed.hold) { holdUsed = true; const on = d > 0 ? 1 : 0; if (state.p.legato !== on) { setP('legato', on); toast('Legato glide ' + (on ? 'on' : 'off')); } return false; }
};
hooks.arpRate = () => { if (eng.synced) { const t = fine() ? 1 : 0; if (state.p.triplet !== t) setP('triplet', t); } };

// wheels
function makeWheel(it, m) {
  const el = mk('div', 'wheel', m, '<div class="drum"><div class="mark"></div></div>'); place(el, it.x, it.y);
  label(m, it.x, it.y + 72, it.label, 'lbl sm');
  const drum = el.querySelector('.drum'), mark = el.querySelector('.mark');
  const isBend = it.id === 'bend';
  const w = { v: isBend ? 0 : state.p.modWheel };
  const render = () => {
    const pos = isBend ? (w.v + 1) / 2 : w.v; // 0..1, 1 = top
    mark.style.top = (8 + (1 - pos) * 84) + '%';
    drum.style.backgroundPositionY = (pos * 40) + 'px';
  };
  const setW = v => {
    w.v = v; render();
    if (isBend) {
      const b = Math.abs(v) < 0.03 ? 0 : (v - Math.sign(v) * 0.03) / 0.97;   // centre deadband
      post({ t: 'bend', v: b });
      if (midiOut && G.outWheels) { const x = clamp(Math.round(b * 8192 + 8192), 0, 16383); midiSend([0xE0 | outCh(), x & 127, x >> 7]); }
    } else setP('modWheel', v);
  };
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); capture(el, e.pointerId); ensurePower();
    let ly = e.clientY; const h = el.getBoundingClientRect().height;
    const mv = ev => { const d = (ly - ev.clientY) / (h * .8); ly = ev.clientY; setW(clamp(w.v + d * (isBend ? 2 : 1), isBend ? -1 : 0, 1)); };
    const up = () => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      if (isBend) { const back = () => { w.v *= .6; if (Math.abs(w.v) < .01) w.v = 0; setW(w.v); if (w.v) requestAnimationFrame(back); }; back(); }
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  if (isBend) wheels.bend = { set: v => { w.v = v; render(); } };
  else { wheels.mod = { set: v => { w.v = v; render(); } }; ctrls.modWheel = { spec: {}, render() { w.v = state.p.modWheel; render(); } }; }
  render();
}
// ---------------------------------------------------------------- keyboard
const KB_LO = 41, KB_HI = 72, QW_BASE = 41;   // computer-key Z = the panel keyboard's low F
// labels shown on the on-screen keys (Z/A rows for the low octave, Q/number rows above)
const KEY_LABELS = ['Z', 'S', 'X', 'D', 'C', 'F', 'V', 'B', 'H', 'N', 'J', 'M',
  'Q', '2', 'W', '3', 'E', '4', 'R', 'T', '6', 'Y', '7', 'U', 'I', '9', 'O', '0', 'P', '-', '[', ']'];
const kbEl = $('#keyboard'), keyEls = {};
const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const gsName = n => NOTE_NAMES[n % 12] + (Math.floor((n - 41 + 5) / 12)); // panel naming: lowest F = F0
(function buildKeys() {
  const whites = []; for (let n = KB_LO; n <= KB_HI; n++) if (!isBlack(n)) whites.push(n);
  const ww = 100 / whites.length;
  let wi = 0;
  for (let n = KB_LO; n <= KB_HI; n++) {
    const k = document.createElement('div');
    k.dataset.note = n; k.dataset.n = gsName(n);
    if (isBlack(n)) { k.className = 'bkey'; k.style.left = `calc(${wi * ww}% - ${ww * .31}%)`; k.style.width = (ww * .62) + '%'; }
    else { k.className = 'wkey'; wi++; }
    const lab = KEY_LABELS[n - QW_BASE]; if (lab) k.innerHTML = `<span class="kl">${lab}</span>`;
    kbEl.appendChild(k); keyEls[n] = k;
  }
})();
const ptrNote = {};
let scaleEdit = false;
function kbPointer(e) {
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const k = t && t.closest && t.closest('#keyboard [data-note]');
  if (!k) return [null, 0];
  const r = k.getBoundingClientRect();
  const vel = Math.round(clamp(30 + 97 * (e.clientY - r.top) / r.height, 1, 127));
  return [+k.dataset.note, vel];
}
kbEl.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (scaleEdit && !GS.active) { const [n] = kbPointer(e); if (n !== null) { G.mask[n % 12] = !G.mask[n % 12]; scaleChanged(); } return; }
  ensurePower(); capture(kbEl, e.pointerId);
  const [n, v] = kbPointer(e); if (n === null) return;
  ptrNote[e.pointerId] = n; keyDown(n, v, 'ptr');
});
kbEl.addEventListener('pointermove', e => {
  if (!(e.pointerId in ptrNote)) return;
  const [n, v] = kbPointer(e);
  if (n !== ptrNote[e.pointerId]) { if (ptrNote[e.pointerId] !== null) keyUp(ptrNote[e.pointerId], 'ptr'); ptrNote[e.pointerId] = n; if (n !== null) keyDown(n, v, 'ptr'); }
});
const ptrEnd = e => { if (!(e.pointerId in ptrNote)) return; if (ptrNote[e.pointerId] !== null) keyUp(ptrNote[e.pointerId], 'ptr'); delete ptrNote[e.pointerId]; };
kbEl.addEventListener('pointerup', ptrEnd); kbEl.addEventListener('pointercancel', ptrEnd);
// Scale lock: same modes and nearest-note snapping (ties go down) as modularaudio's Keys.
const SCALES = {
  ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
};
const SCALE_OPTS = [['chromatic', 'Off (chromatic)'], ['ionian', 'Ionian (major)'], ['dorian', 'Dorian'], ['phrygian', 'Phrygian'], ['lydian', 'Lydian'],
  ['mixolydian', 'Mixolydian'], ['aeolian', 'Aeolian (natural minor)'], ['locrian', 'Locrian'], ['custom', 'Custom (pick notes)']];
function allowedSet() {
  if (G.scale === 'chromatic' || !G.scale) return null;
  if (G.scale === 'custom') return new Set(G.mask.map((on, pc) => on ? pc : -1).filter(pc => pc >= 0));
  return new Set(SCALES[G.scale].map(i => (i + G.root) % 12));
}
function snapNote(note, allowed) {
  if (!allowed) return note;
  if (!allowed.size) return null;
  for (let d = 0; d < 12; d++) {
    if (allowed.has(((note - d) % 12 + 12) % 12)) return note - d;
    if (allowed.has(((note + d) % 12 + 12) % 12)) return note + d;
  }
  return note;
}
// physical key -> { c: press count, s: the (snapped) note sent to the engine }
const pressMap = {}, engCount = {};
const sendOn = (s, vel) => { if (G.local) post({ t: 'on', k: s, v: vel, s: 'kb' }); else if (G.outKeys) midiSend([0x90 | outCh(), clamp(s + eng.oct * 12, 0, 127), vel]); };
const sendOff = s => { if (G.local) post({ t: 'off', k: s, s: 'kb' }); else if (G.outKeys) midiSend([0x80 | outCh(), clamp(s + eng.oct * 12, 0, 127), 0]); };
function keyDown(n, vel) {
  const pm = pressMap[n] || (pressMap[n] = { c: 0, s: null, gs: false });
  pm.c++; if (keyEls[n]) keyEls[n].classList.add('down');
  if (pm.c > 1) return;
  if (GS.active) { pm.gs = true; GS.key(n, true); return; }
  const s = snapNote(n, allowedSet()); pm.s = s;
  if (s === null) return;
  engCount[s] = (engCount[s] || 0) + 1;
  if (engCount[s] === 1) sendOn(s, vel);
}
function keyUp(n) {
  const pm = pressMap[n]; if (!pm || !pm.c) return;
  if (--pm.c > 0) return;
  if (keyEls[n]) keyEls[n].classList.remove('down');
  delete pressMap[n];
  if (pm.gs) { GS.key(n, false); return; }
  const s = pm.s; if (s === null || !engCount[s]) return;
  if (--engCount[s] === 0) { delete engCount[s]; sendOff(s); }
}
function keysUp() {
  for (const n in pressMap) delete pressMap[n];
  for (const s in engCount) delete engCount[s];
  for (const n in keyEls) keyEls[n].classList.remove('down');
}
function paintScale() {
  const set = allowedSet();
  for (const n in keyEls) {
    const pc = n % 12, k = keyEls[n];
    k.classList.toggle('oos', !!set && !set.has(pc));
    k.classList.toggle('root', !!set && G.scale !== 'custom' && pc === G.root);
    k.classList.toggle('editing', scaleEdit);
  }
  const sb = $('#scaleBar');
  sb.querySelector('#scaleSel').value = G.scale;
  sb.querySelector('#rootSel').value = G.root;
  sb.querySelector('#rootSel').hidden = G.scale === 'chromatic' || G.scale === 'custom';
  const eb = sb.querySelector('#scaleEdit'); eb.hidden = G.scale !== 'custom'; eb.classList.toggle('on', scaleEdit);
  const names = set ? [...set].sort((x, y) => ((x - G.root + 12) % 12) - ((y - G.root + 12) % 12)).map(pc => NOTE_NAMES[pc]) : null;
  sb.querySelector('#scaleInfo').textContent = !set ? 'all 12 notes' : set.size ? names.join(' ') : 'no notes selected';
}
function scaleChanged() { saveGlobal(); paintScale(); }
(function buildScaleBar() {
  const sb = $('#scaleBar');
  const ss = sb.querySelector('#scaleSel'), rs = sb.querySelector('#rootSel');
  SCALE_OPTS.forEach(([v, t]) => { mk('option', '', ss, t).value = v; });
  NOTE_NAMES.forEach((t, i) => { mk('option', '', rs, t).value = i; });
  ss.addEventListener('change', () => {
    const prev = allowedSet();
    if (ss.value === 'custom' && G.scale !== 'custom' && prev) G.mask = Array.from({ length: 12 }, (_, pc) => prev.has(pc));
    G.scale = ss.value; if (G.scale !== 'custom') scaleEdit = false; scaleChanged(); ss.blur();
  });
  rs.addEventListener('change', () => { G.root = +rs.value; scaleChanged(); rs.blur(); });
  sb.querySelector('#scaleEdit').addEventListener('click', e => { scaleEdit = !scaleEdit; paintScale(); e.currentTarget.blur(); });
  if (!Array.isArray(G.mask) || G.mask.length !== 12) G.mask = Array(12).fill(true);
  paintScale();
})();
$('#kbLeft').addEventListener('click', () => $('#kbOuter').scrollBy({ left: -7 * KEY_W, behavior: 'smooth' }));
$('#kbLeft2').addEventListener('click', () => $('#kbOuter').scrollBy({ left: -7 * KEY_W, behavior: 'smooth' }));
$('#kbRight2').addEventListener('click', () => $('#kbOuter').scrollBy({ left: 7 * KEY_W, behavior: 'smooth' }));
$('#kbRight').addEventListener('click', () => $('#kbOuter').scrollBy({ left: 7 * KEY_W, behavior: 'smooth' }));

// computer keyboard: tracker layout by physical key position, starting on the panel's low F.
// Bottom letter row = white keys, row above = black keys (gaps at B–C and E–F, as on a piano);
// the Q row and number row continue an octave up, covering all 32 keys F–C.
// Left / right arrows are the <KB / KB> octave buttons.
const QW = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyF: 5, KeyV: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, Digit4: 17, KeyR: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, Minus: 29, BracketLeft: 30, BracketRight: 31,
};
const qwDown = {};
window.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, select, textarea, dialog')) return;
  if (e.key === 'Shift') { fineKeys.shift = true; refreshLeds(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); if (!e.repeat) { const id = e.code === 'ArrowLeft' ? 'kbDn' : 'kbUp'; pbDown(id); flashPB(id); } return; }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) pbDown('play'), pbUp('play'); return; }
  if (e.code in QW && !e.repeat) {
    e.preventDefault(); ensurePower();
    const n = QW_BASE + QW[e.code];
    qwDown[e.code] = n; keyDown(n, 100);
  }
});
window.addEventListener('keyup', e => {
  if (e.key === 'Shift') { fineKeys.shift = false; refreshLeds(); }
  if (e.code in qwDown) { keyUp(qwDown[e.code]); delete qwDown[e.code]; }
});
window.addEventListener('blur', () => { fineKeys.shift = false; for (const c in qwDown) { keyUp(qwDown[c]); delete qwDown[c]; } });

// ---------------------------------------------------------------- global settings (panel key entry + dialog)
const GSET = [
  { g: 0, p: 0, k: 'midiCh', name: 'MIDI channel', n: 16, lab: i => 'channel ' + (i + 1) },
  { g: 0, p: 1, k: 'midiClkIn', name: 'MIDI clock input', opts: ['follow clock + start/stop', 'follow clock only', 'ignore'] },
  { g: 0, p: 2, k: 'midiClkOut', name: 'MIDI clock output', opts: ['send clock + start/stop', 'send clock only', 'off'] },
  { g: 0, p: 3, k: 'prio', name: 'Note priority', opts: ['low', 'high', 'last'] },
  { g: 0, p: 4, k: 'bend', name: 'Pitch bend range', n: 13, lab: i => i + ' semitones' },
  { g: 0, p: 5, k: 'extMode', name: 'External clock mode', opts: ['clock', 'step advance'] },
  { g: 0, p: 6, k: 'ppqnIn', name: 'Clock input PPQN', opts: PPQN.map(String) },
  { g: 0, p: 7, k: 'ppqnOut', name: 'Clock output PPQN', opts: PPQN.map(String) },
  { g: 0, p: 8, k: 'kbRange', name: 'KB OUT range', opts: ['-5 to +5 V', '0 to 10 V'] },
  { g: 0, p: 9, k: 'local', name: 'Local control', opts: ['off', 'on'] },
  { g: 1, p: 0, k: 'glideType', name: 'Glide type', opts: ['linear constant rate', 'linear constant time', 'exponential'] },
  { g: 1, p: 1, k: 'gatedGlide', name: 'Gated glide', opts: ['off', 'on'] },
  { g: 1, p: 2, k: 'transpose', name: 'Transpose behaviour', opts: ['on new note', 'immediate'] },
  { g: 1, p: 3, k: 'tapPersist', name: 'Tap tempo division persists', opts: ['off', 'on'] },
  { g: 1, p: 4, k: 'velRange', name: 'Velocity CV range', opts: ['-5 to +5 V', '0 to 10 V'] },
  { g: 1, p: 5, k: 'o2Range', name: 'Osc 2 frequency knob range', n: 19, lab: i => i + ' semitones' },
  { g: 1, p: 6, k: 'clkOutMode', name: 'Clock output', opts: ['only while running', 'always'] },
  { g: 1, p: 7, k: 'multiTrig', name: 'Multi-trig (retrigger on legato notes)', opts: ['off', 'on'] },
  { g: 1, p: 8, k: 'mtSpeed', name: 'Multi-trig reset speed', opts: ['slow (20 ms)', 'fast (4 ms)', 'custom'] },
  { g: 2, p: 0, k: 'midiOutCh', name: 'MIDI out channel (separate)', n: 16, lab: i => 'channel ' + (i + 1) },
  { g: 2, p: 3, k: 'outKeys', name: 'MIDI out: keys', opts: ['off', 'on'] },
  { g: 2, p: 2, k: 'outWheels', name: 'MIDI out: wheels', opts: ['off', 'on'] },
  { g: 2, p: 1, k: 'outPanel', name: 'MIDI out: panel', opts: ['off', 'on'] },
];
const PARAM_KEYS = [42, 44, 46, 49, 51, 54, 56, 58, 61, 63];
const GROUP_KEYS = { 66: 1, 68: 2, 70: 3 };
const WHITE_KEYS = []; for (let n = KB_LO; n <= KB_HI; n++) if (!isBlack(n)) WHITE_KEYS.push(n);
const GS = {
  active: false, sel: GSET[0], heldGroup: 0, lastWhite: null, lastWhiteT: 0,
  enter() { this.active = true; gsActive = true; this.sel = null; kbEl.classList.add('gsmode'); keysUp(); post({ t: 'panic' }); this.show(); ctrls.sync.render(); },
  exit() { this.active = false; gsActive = false; kbEl.classList.remove('gsmode'); $('#gsBanner').hidden = true; ctrls.sync.render(); saveGlobal(); },
  optsOf(s) { return s.opts || Array.from({ length: s.n }, (_, i) => s.lab(i)); },
  show() {
    const b = $('#gsBanner'); b.hidden = false;
    if (!this.sel) { b.innerHTML = 'Global settings · press a <b>black key</b> to choose a setting (hold F#2 or G#2 for groups 1–2), then a <b>white key</b> for its value. Press <b>SYNC</b> to finish.'; return; }
    const s = this.sel, v = G[s.k], opts = this.optsOf(s);
    b.innerHTML = `${s.g}.${s.p + 1} <b>${s.name}</b>: ${v < 0 ? 'same as input' : opts[v]} · white keys F0–${gsName(WHITE_KEYS[Math.min(opts.length, WHITE_KEYS.length) - 1])} set it · SYNC exits`;
  },
  key(n, down) {
    if (!down) { if (GROUP_KEYS[n]) this.heldGroup = 0; return; }
    if (GROUP_KEYS[n]) { this.heldGroup = GROUP_KEYS[n]; return; }
    const pi = PARAM_KEYS.indexOf(n);
    if (pi >= 0) { const s = GSET.find(x => x.g === this.heldGroup && x.p === pi); if (s) { this.sel = s; this.show(); } return; }
    const wi = WHITE_KEYS.indexOf(n);
    if (wi >= 0 && this.sel) {
      const opts = this.optsOf(this.sel);
      if (wi < opts.length) { G[this.sel.k] = wi; applyGlobal(); this.show(); }
      const now = performance.now();
      if (this.lastWhite === n && now - this.lastWhiteT < 400) { this.exit(); toast('Global settings saved'); }
      this.lastWhite = n; this.lastWhiteT = now;
    }
  },
};
function syncPress() {
  ensurePower();
  if (GS.active) { GS.exit(); toast('Global settings saved'); return; }
  if (pressed.hold) { holdUsed = true; GS.enter(); return; }
  setP('sync', state.p.sync ? 0 : 1);
}
function saveGlobal() { store('global', G); }
// lite CPU mode: Auto turns it on for touch devices (phones and tablets)
const TOUCH_DEVICE = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
const liteOn = () => G.cpu === 'lite' || (G.cpu === 'auto' && TOUCH_DEVICE);
function applyGlobal() {
  post({ t: 'g', v: { midiCh: G.midiCh, midiClkIn: G.midiClkIn, midiClkOut: G.midiClkOut, prio: G.prio, bendUp: G.bend, bendDn: G.bend,
    extMode: G.extMode, ppqnIn: G.ppqnIn, ppqnOut: G.ppqnOut, kbRange: G.kbRange, glideType: G.glideType, gatedGlide: G.gatedGlide,
    transpose: G.transpose, tapPersist: G.tapPersist, velRange: G.velRange, o2Range: G.o2Range, clkOutMode: G.clkOutMode,
    multiTrig: G.multiTrig, mtMs: G.mtSpeed === 2 ? G.mtMs : G.mtSpeed ? 4 : 20, pvar: G.pvar, swing: G.swing, arpRepeat: G.arpRepeat,
    keyReset: G.keyReset, seqTrMode: G.seqTrMode, seqKb: G.seqKb, seqDelay: G.seqDelay, drift: G.drift, warm: G.warm, bleed: G.bleed, os: G.os, filt: G.filt, saw: G.saw, lite: liteOn() ? 1 : 0 } });
  post({ t: 'p', k: 'instGain', v: extOn ? G.extGain : 0 });
  saveGlobal(); drawCables();
  $('#btnCables').textContent = 'Cables: ' + G.cables;
  $('#menuCables').textContent = 'Cables: ' + G.cables;
}
function buildSettings() {
  const L = $('#settingsList'); L.innerHTML = '';
  for (const s of GSET) {
    const lab = mk('label', '', L, `<span>${s.name}<span class="k">${s.g}.${s.p + 1}</span></span>`);
    const sel = mk('select', '', lab);
    if (s.k === 'midiOutCh') mk('option', '', sel, 'same as input').value = -1;
    GS.optsOf(s).forEach((o, i) => { const op = mk('option', '', sel, o); op.value = i; });
    sel.value = G[s.k]; sel.addEventListener('change', () => { G[s.k] = +sel.value; applyGlobal(); });
  }
  const F = $('#fwList'); F.innerHTML = '';
  const frng = (name, k, min, max, step, fmt) => { const lab = mk('label', '', F, `<span>${name} <b class="v"></b></span>`); const r = mk('input', '', lab); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = G[k]; const v = lab.querySelector('.v'); const show = () => v.textContent = fmt(G[k]); show(); r.addEventListener('input', () => { G[k] = +r.value; show(); applyGlobal(); }); };
  const fopt = (name, k, opts) => { const lab = mk('label', '', F, `<span>${name}</span>`); const s = mk('select', '', lab); opts.forEach((t, i) => { const o = mk('option', '', s, t); o.value = i; }); s.value = G[k]; s.addEventListener('change', () => { G[k] = +s.value; applyGlobal(); }); };
  frng('Pitch variance (random per note)', 'pvar', 0, 40, 0.1, v => '±' + v.toFixed(1) + ' cents');
  frng('Arp/seq swing', 'swing', 0, 1, .01, v => Math.round(v * 100) + '%' + (Math.abs(v - .5) < .005 ? ' (straight)' : ''));
  frng('Multi-trig reset time (custom speed)', 'mtMs', 4, 50, 1, v => v + ' ms');
  fopt('Arp FWD/BKWD end notes', 'arpRepeat', ['play once', 'repeat']);
  fopt('Arp/seq keyed timing reset', 'keyReset', ['off', 'on']);
  fopt('Sequence transpose', 'seqTrMode', ['relative to first note', 'relative to middle C']);
  fopt('Keyboard transposes sequence', 'seqKb', ['off', 'on']);
  fopt('Delay sequence change to end of pass', 'seqDelay', ['off', 'on']);
  const E = $('#emuList'); E.innerHTML = '';
  const rng = (name, k, min, max, step) => { const lab = mk('label', '', E, `<span>${name}</span>`); const r = mk('input', '', lab); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = G[k]; r.addEventListener('input', () => { G[k] = +r.value; applyGlobal(); }); };
  const opt = (name, k, opts) => { const lab = mk('label', '', E, `<span>${name}</span>`); const s = mk('select', '', lab); opts.forEach(([v, t]) => { const o = mk('option', '', s, t); o.value = v; }); s.value = G[k]; s.addEventListener('change', () => { G[k] = isNaN(+s.value) ? s.value : +s.value; applyGlobal(); }); };
  opt('CPU mode', 'cpu', [['auto', `Auto (${TOUCH_DEVICE ? 'Lite on this device' : 'Full on this device'})`], ['lite', 'Lite'], ['full', 'Full']]);
  mk('p', 'small', E, 'Lite roughly halves the CPU load: the analog core runs without oversampling, the filter uses the classic ladder model, and the spring tank is lighter. Full uses the settings below.');
  rng('Oscillator drift', 'drift', 0, 1, .01);
  opt('Cold-start warm-up drift', 'warm', [[0, 'off'], [1, 'on']]);
  rng('VCA control bleed (attack thump)', 'bleed', 0, 1, .01);
  opt('Sawtooth shape', 'saw', [[1, 'measured (Moog Voyager recordings)'], [0, 'ideal ramp']]);
  opt('Filter model', 'filt', [[1, 'zero-delay ladder, Newton solve'], [0, 'Huovilainen ladder (classic)']]);
  opt('Oversampling', 'os', [[2, '2x (lighter on CPU)'], [4, '4x (cleaner FM and sync)']]);
  // in Lite the filter model and oversampling are fixed; show that rather than silently ignoring them
  const lock = () => { for (const lab of E.querySelectorAll('label')) { const t = lab.firstChild.textContent; if (t === 'Filter model' || t === 'Oversampling') { lab.style.opacity = liteOn() ? .45 : 1; lab.querySelector('select').disabled = liteOn(); } } };
  E.querySelector('select').addEventListener('change', lock); lock();
  rng('External input gain', 'extGain', 0, 1, .01);
  opt('Cables', 'cables', [['show', 'show'], ['dim', 'dim'], ['hide', 'hide']]);
}
$('#btnSettings').addEventListener('click', () => { buildSettings(); $('#dlgSettings').showModal(); });
$('#btnHelp').addEventListener('click', () => $('#dlgHelp').showModal());
$('#btnCables').addEventListener('click', () => { G.cables = { show: 'dim', dim: 'hide', hide: 'show' }[G.cables]; applyGlobal(); });

// ---------------------------------------------------------------- external input
var extOn = false, extStream = null, extSrc = null;   // var: read by buildRear before this line runs
async function toggleExt() {
  await ensurePower();
  if (extOn) {
    extOn = false; if (extSrc) extSrc.disconnect(); if (extStream) extStream.getTracks().forEach(t => t.stop());
    extSrc = extStream = null; leds.ext.classList.remove('on'); post({ t: 'p', k: 'instGain', v: 0 }); return;
  }
  try {
    extStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    extSrc = ctx.createMediaStreamSource(extStream); extSrc.connect(node);
    extOn = true; leds.ext.classList.add('on'); post({ t: 'p', k: 'instGain', v: G.extGain });
    toast('External input on — use headphones to avoid feedback');
  } catch (err) { toast('Could not open audio input'); }
}

// ---------------------------------------------------------------- MIDI
var midi = null, midiOut = null, midiInId = load('midiIn', 'all'), midiOutId = load('midiOut', 'none');   // var: read by setP before this line runs
const outCh = () => (G.midiOutCh >= 0 ? G.midiOutCh : G.midiCh) & 15;
function midiSend(bytes) { if (midiOut) try { midiOut.send(bytes); } catch {} }
async function openMidi() {
  $('#dlgMidi').showModal();
  if (!navigator.requestMIDIAccess) { $('#midiStatus').textContent = 'Web MIDI is not available in this browser.'; return; }
  if (!midi) {
    try { midi = await navigator.requestMIDIAccess(); midi.onstatechange = refreshMidi; }
    catch { $('#midiStatus').textContent = 'MIDI access was declined.'; return; }
  }
  refreshMidi();
}
function refreshMidi() {
  if (!midi) return;
  const si = $('#midiIn'), so = $('#midiOut');
  si.innerHTML = '<option value="all">All inputs</option><option value="none">None</option>';
  so.innerHTML = '<option value="none">None</option>';
  midi.inputs.forEach(p => { mk('option', '', si, p.name).value = p.id; });
  midi.outputs.forEach(p => { mk('option', '', so, p.name).value = p.id; });
  si.value = [...si.options].some(o => o.value === midiInId) ? midiInId : 'all';
  so.value = [...so.options].some(o => o.value === midiOutId) ? midiOutId : 'none';
  midi.inputs.forEach(p => { p.onmidimessage = (si.value === 'all' || si.value === p.id) ? onMidi : null; });
  midiOut = so.value === 'none' ? null : midi.outputs.get(so.value) || null;
  $('#midiStatus').textContent = `${midi.inputs.size} input(s), ${midi.outputs.size} output(s) found.`;
  const nIn = si.value === 'all' ? 'all inputs' : si.value === 'none' ? 'no input' : si.options[si.selectedIndex].text;
  midiLabel = nIn.length > 14 ? nIn.slice(0, 13) + '…' : nIn;
  leds.midiText.textContent = midiLabel;
}
$('#midiIn').addEventListener('change', e => { midiInId = e.target.value; store('midiIn', midiInId); refreshMidi(); });
$('#midiOut').addEventListener('change', e => { midiOutId = e.target.value; store('midiOut', midiOutId); refreshMidi(); });
$('#btnMidi').addEventListener('click', openMidi);
if (navigator.permissions && navigator.requestMIDIAccess) {
  navigator.permissions.query({ name: 'midi' }).then(r => { if (r.state === 'granted') navigator.requestMIDIAccess().then(m => { midi = m; midi.onstatechange = refreshMidi; refreshMidi(); }); }).catch(() => {});
}
const cc14 = {};
const CC90 = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 0], [0, 6], [0, 7], [1, 1], [0, 8], [0, 9], [1, 2], [0, 10], [0, 11], [1, 3], [0, 12], [0, 13], [1, 4], [0, 14], [0, 15], [1, 5], [0, 16], [1, 6]];
let midiLedT = 0, glideSaved = null;
function onMidi(ev) {
  const [st, d1 = 0, d2 = 0] = ev.data;
  if (st >= 0xF8) {
    if (st === 0xF8) post({ t: 'mclk', k: 'tick' }); else if (st === 0xFA) post({ t: 'mclk', k: 'start' });
    else if (st === 0xFB) post({ t: 'mclk', k: 'cont' }); else if (st === 0xFC) post({ t: 'mclk', k: 'stop' });
    return;
  }
  const type = st & 0xF0, ch = st & 15;
  if (ch !== G.midiCh) return;
  leds.midiLed.classList.add('on'); clearTimeout(midiLedT); midiLedT = setTimeout(() => leds.midiLed.classList.remove('on'), 60);
  if (!powered) return;
  if (type === 0x90 && d2 > 0) post({ t: 'on', k: d1, v: d2, s: 'midi' });
  else if (type === 0x80 || (type === 0x90 && d2 === 0)) post({ t: 'off', k: d1, s: 'midi' });
  else if (type === 0xE0) { const v = ((d2 << 7 | d1) - 8192) / 8192; post({ t: 'bend', v }); wheels.bend && wheels.bend.set(v); }
  else if (type === 0xB0) midiCC(d1, d2);
}
// The hardware transmits CCs only for its digitised controls (the seven pots its
// microcontroller reads, plus switches and buttons); the analog pots send nothing.
const CC_OUT = { modWheel: 1, lfoRate: 3, glide: 5, arpRate: 8, o2Freq: 12, o1Oct: 74, o2Oct: 75, sync: 77, arpMode: 91, arpDir: 92, arpOct: 93, legato: 94 };
const ccLast = {};
function ccOut(id, v) {
  const c = CC_OUT[id]; if (!c || !midiOut) return;
  if (c === 1 ? !G.outWheels : !G.outPanel) return;
  let x;
  if (id === 'arpRate' && eng.synced) {
    const i = Math.round(v * (state.p.triplet ? 6 : 16)), j = CC90.findIndex(([t, k]) => t === (state.p.triplet ? 1 : 0) && k === i);
    if (j < 0) return; x = [0, 5, 11, 16, 21, 27, 32, 37, 43, 48, 53, 59, 64, 69, 75, 80, 85, 91, 96, 101, 107, 112, 117, 123][j];
    if (ccLast[90] !== x) { ccLast[90] = x; midiSend([0xB0 | outCh(), 90, x]); } return;
  }
  if (id === 'o1Oct' || id === 'o2Oct') x = v * 32;
  else if (id === 'arpMode' || id === 'arpDir' || id === 'arpOct') x = [0, 43, 85][v];
  else if (id === 'sync' || id === 'legato') x = v ? 127 : 0;
  else x = Math.round(clamp(v, 0, 1) * 127);
  if (ccLast[c] === x) return; ccLast[c] = x;
  midiSend([0xB0 | outCh(), c, x]);
}
const setPm = (id, v) => setP(id, v, { midi: true });
function midiCC(c, v) {
  const n7 = v / 127;
  const cont = { 1: 'modWheel', 3: 'lfoRate', 5: 'glide', 8: 'arpRate', 12: 'o2Freq' };
  if (cont[c]) { cc14[c] = v; setPm(cont[c], n7); return; }
  const lsb = { 33: 1, 35: 3, 37: 5, 40: 8, 44: 12 };
  if (lsb[c]) { const m = lsb[c]; if (cc14[m] !== undefined) setPm(cont[m], ((cc14[m] << 7) | v) / 16383); return; }
  const tri = Math.min(2, Math.floor(v / 43)), quad = Math.min(3, v >> 5), on = v >= 64 ? 1 : 0;
  switch (c) {
    case 65: if (!on) { if (glideSaved === null) { glideSaved = state.p.glide; setPm('glide', 0); } } else if (glideSaved !== null) { setPm('glide', glideSaved); glideSaved = null; } break;
    case 69: post({ t: 'sethold', v: on }); break;
    case 73: post({ t: 'setplay', v: on }); break;
    case 74: setPm('o1Oct', quad); break;
    case 75: setPm('o2Oct', quad); break;
    case 77: setPm('sync', on); break;
    case 85: G.glideType = tri; applyGlobal(); break;
    case 89: { const o = clamp(Math.round(v / 25.5) - 2, -2, 2); post({ t: 'oct', d: o - eng.oct }); break; }
    case 90: { const [tr, i] = CC90[Math.min(23, Math.round(v / 5.33))]; setPm('triplet', tr); setPm('arpRate', tr ? i / 6 : i / 16); break; }
    case 91: setPm('arpMode', tri); break;
    case 92: setPm('arpDir', tri); break;
    case 93: setPm('arpOct', tri); break;
    case 94: setPm('legato', on); break;
    case 95: G.multiTrig = on; applyGlobal(); break;
    case 103: G.gatedGlide = on; applyGlobal(); break;
    case 107: post({ t: 'g', v: { bendUp: Math.round(v / 5.12) } }); break;
    case 108: post({ t: 'g', v: { bendDn: Math.round(v / 5.12) } }); break;
    case 119: post({ t: 'semi', v: clamp(Math.round(v / 5.12) - 12, -12, 12) }); break;
    case 64: post({ t: 'sus', v: v >= 64 }); break;
    case 122: G.local = on; applyGlobal(); break;
    case 120: case 123: post({ t: 'panic' }); break;
  }
}
function onEngineEvents(q) {
  for (const e of q) {
    if (e.t === 'mo') G.outKeys && midiSend(e.on ? [0x90 | outCh(), clamp(e.n, 0, 127), clamp(e.v || 100, 1, 127)] : [0x80 | outCh(), clamp(e.n, 0, 127), 0]);
    else if (e.t === 'clk') midiSend([0xF8]);
    else if (e.t === 'mstart') midiSend([0xFA]);
    else if (e.t === 'mstop') midiSend([0xFC]);
    else if (e.t === 'seqs') { seqs = e.d; store('seqs', seqs); }
    else if (e.t === 'panic') midiSend([0xB0 | outCh(), 123, 0]);
  }
}

// ---------------------------------------------------------------- engine status / LEDs / scope
const scope = $('#scope'), sctx = scope.getContext('2d');
let lastSt = null, arpFlash = 0;
function refreshLeds() {
  const play = eng.play, hold = eng.hold;
  leds.play.classList.toggle('on', !!play || !!pressed.play);
  leds.hold.classList.toggle('on', !!hold || !!pressed.hold);
  leds.tap.classList.toggle('on', !!eng.tap || !!pressed.tap);
  leds.shift.classList.toggle('on', fine());
  leds.legLed.classList.toggle('on', !!state.p.legato);
  for (let i = 0; i < 5; i++) leds['oct' + i].classList.toggle('on', i === eng.oct + 2);
}
function onStatus(s) {
  const wasSynced = eng.synced;
  eng = s; lastSt = s;
  leds.lfoLed.style.opacity = 0.25 + 0.75 * Math.max(0, s.lfo);
  leds.lfoLed.classList.add('on');
  if (s.step) arpFlash = performance.now();
  leds.arpLed.classList.toggle('on', performance.now() - arpFlash < 70);
  leds.outLed.classList.toggle('on', s.peak > 0.02);
  leds.outLed.style.opacity = s.peak > 0.02 ? clamp(.35 + s.peak, 0, 1) : 1;
  if (s.legato !== state.p.legato) { state.p.legato = s.legato; }
  refreshLeds();
  if (wasSynced !== s.synced && !tip.hidden) hideTip();
  // scope
  const W = scope.width, H = scope.height, d = s.scope;
  sctx.fillStyle = '#0a0908'; sctx.fillRect(0, 0, W, H);
  sctx.strokeStyle = '#2a2420'; sctx.beginPath(); sctx.moveTo(0, H / 2); sctx.lineTo(W, H / 2); sctx.stroke();
  let start = 0; for (let i = 1; i < 256; i++) if (d[i - 1] < 0 && d[i] >= 0) { start = i; break; }
  sctx.strokeStyle = '#ff9c3a'; sctx.lineWidth = 2; sctx.beginPath();
  for (let i = 0; i < 256; i++) { const y = H / 2 - d[start + i] * H * .9; i ? sctx.lineTo(i * W / 255, y) : sctx.moveTo(0, y); }
  sctx.stroke();
}

// ---------------------------------------------------------------- power
const overlay = $('#powerOverlay');
let powerP = null;
function ensurePower() { if (powered) { if (ctx.state !== 'running') ctx.resume(); return Promise.resolve(); } return powerOn(); }
function powerOn() {
  if (powerP) return powerP;
  powerP = (async () => {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule('js/dsp.js');
    node = new AudioWorkletNode(ctx, 'progenitor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    node.connect(ctx.destination);
    node.port.onmessage = e => { const d = e.data; if (d.t === 'st') onStatus(d); else if (d.t === 'ev') onEngineEvents(d.q); };
    if (!seqs) seqs = demoSeqs();
    node.port.postMessage({ t: 'ps', v: state.p });
    applyGlobal();
    node.port.postMessage({ t: 'seqs', v: seqs });
    node.port.postMessage({ t: 'patch', c: state.cables.map(c => [c.a, c.b]) });
    await ctx.resume();
    powered = true; overlay.hidden = true; $('#btnPower').classList.add('on');
  })().catch(err => { powerP = null; console.error(err); toast('Audio could not start: ' + err.message); });
  return powerP;
}
$('#powerOn').addEventListener('click', powerOn);
overlay.addEventListener('pointerdown', e => { if (e.target === overlay) powerOn(); });
$('#btnPower').addEventListener('click', async () => {
  if (!powered) return powerOn();
  if (ctx.state === 'running') { await ctx.suspend(); $('#btnPower').classList.remove('on'); toast('Power off'); }
  else { await ctx.resume(); $('#btnPower').classList.add('on'); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx && $('#btnPower').classList.contains('on')) ctx.resume(); });

function demoSeqs() {
  const s = (n, o = {}) => Object.assign({ n, t: false, r: false, a: false }, o);
  return [
    [s(36), s(36, { a: true }), s(48), s(36), s(39, { t: true }), s(41), s(36, { a: true }), s(46), s(36), s(48, { t: true }), s(36), s(43, { a: true }), s(36), s(46, { t: true }), s(48), s(39)],
    [s(48), s(55), s(60), s(55), s(63, { a: true }), s(60), s(55), s(51)],
    [s(48), s(51, { a: true }), s(55), s(58), s(60, { t: true }), s(58), s(55, { a: true }), s(53), s(51), s(48, { t: true })],
  ];
}

// ---------------------------------------------------------------- patches
// Factory patches. Every one is transcribed from a published patch sheet, knob by knob:
// - the Grandmother manual's patch sheets (pages 45-52)
// - Lisa Bella Donna's "Grandmother Exploration Patchbook" (Moog Music), prefixed (LBD)
// Knob values are the pointer angles on the sheet art mapped from its 300° sweep to 0..1
// (patch format 3 units). VOLUME is left at the default (the sheets set it "to taste").
// Notes are the sheets' own instructions, shown when a patch is loaded.
const PRESETS = [
  { name: 'Init', p: {}, c: [] },
  { name: "Disco Tom", group: 'manual', note: "", p: { arpRate: 0.403, lfoRate: 0.501, pitchAmt: 0, cutoffAmt: 0, pwAmt: 0, o2Freq: 0.5, mix1: 0, mix2: 0, mixN: 0, hpf: 0, att: 0.501, cutoff: 0.2, envAmt: 0.699, res: 1, attack: 0, decay: 0.065, release: 0.465, revMix: 0.066, sustain: 0, o1Oct: 0, o2Oct: 0, o1Wave: 0, o2Wave: 0, lfoWave: 0, arpMode: 0, arpDir: 0, arpOct: 0, kbTrack: 2, vcaMode: 0, sync: 0 }, c: [] },
  { name: "Drone Tides", group: 'manual', note: "", p: { arpRate: 0.5, lfoRate: 0.06, pitchAmt: 0, cutoffAmt: 0.058, pwAmt: 0, o2Freq: 1, mix1: 0.895, mix2: 0.199, mixN: 1, hpf: 0.197, att: 0.744, cutoff: 0.5, envAmt: 0.501, res: 0.5, attack: 0, decay: 0, release: 0, revMix: 0.24, sustain: 0.98, o1Oct: 0, o2Oct: 1, o1Wave: 0, o2Wave: 0, lfoWave: 0, arpMode: 0, arpDir: 0, arpOct: 0, kbTrack: 1, vcaMode: 2, sync: 0 }, c: [['lfoOut', 'attIn'], ['mixOut', 'hpfIn'], ['hpfOut', 'vcfIn'], ['attOut', 'cutoffIn']] },
  { name: "Evolution Arp", group: 'manual', note: "", p: { arpRate: 0.402, lfoRate: 0.2, pitchAmt: 0, cutoffAmt: 0, pwAmt: 0.5, o2Freq: 0.8, mix1: 1, mix2: 1, mixN: 0, hpf: 0, att: 0.502, cutoff: 0.2, envAmt: 0.838, res: 0, attack: 0, decay: 0.155, release: 0.458, revMix: 0.163, sustain: 0, o1Oct: 2, o2Oct: 2, o1Wave: 2, o2Wave: 3, lfoWave: 0, arpMode: 0, arpDir: 0, arpOct: 1, kbTrack: 1, vcaMode: 0, sync: 1 }, c: [['lfoOut', 'attIn'], ['attOut', 'o2Pitch'], ['envPOut', 'pwmIn'], ['mixOut', 'hpfIn'], ['hpfOut', 'vcfIn']] },
  { name: "Fat Pluck Bass", group: 'manual', note: "", p: { arpRate: 0.343, lfoRate: 0.064, pitchAmt: 0, cutoffAmt: 0, pwAmt: 0.737, o2Freq: 0, mix1: 1, mix2: 1, mixN: 0, hpf: 0, att: 0.501, cutoff: 0.149, envAmt: 1, res: 0, attack: 0, decay: 0.057, release: 0.244, revMix: 0.062, sustain: 0.47, o1Oct: 0, o2Oct: 1, o1Wave: 1, o2Wave: 2, lfoWave: 0, arpMode: 0, arpDir: 1, arpOct: 1, kbTrack: 0, vcaMode: 0, sync: 1 }, c: [] },
  { name: "Organ Lead", group: 'manual', note: "", p: { arpRate: 0.5, lfoRate: 0.399, pitchAmt: 0, cutoffAmt: 0, pwAmt: 0.536, o2Freq: 0.5, mix1: 1, mix2: 1, mixN: 0, hpf: 0.649, att: 0.5, cutoff: 0.247, envAmt: 0.9, res: 0.401, attack: 0, decay: 0, release: 0, revMix: 0.146, sustain: 0.65, o1Oct: 2, o2Oct: 3, o1Wave: 2, o2Wave: 2, lfoWave: 0, arpMode: 0, arpDir: 0, arpOct: 1, kbTrack: 1, vcaMode: 1, sync: 0 }, c: [['mixOut', 'hpfIn'], ['hpfOut', 'vcfIn']] },
  { name: "Short Flutey Arp", group: 'manual', note: "", p: { arpRate: 0.35, lfoRate: 0.05, pitchAmt: 0.199, cutoffAmt: 0.2, pwAmt: 0.255, o2Freq: 0.5, mix1: 1, mix2: 0.8, mixN: 0, hpf: 0.702, att: 0.5, cutoff: 0.2, envAmt: 0.8, res: 0, attack: 0.046, decay: 0.239, release: 0.4, revMix: 0.165, sustain: 0.38, o1Oct: 2, o2Oct: 2, o1Wave: 2, o2Wave: 1, lfoWave: 0, arpMode: 0, arpDir: 0, arpOct: 1, kbTrack: 2, vcaMode: 0, sync: 0 }, c: [] },
  { name: "Soft Sizzle Lead", group: 'manual', note: "", p: { arpRate: 0.5, lfoRate: 0.3, pitchAmt: 0.1, cutoffAmt: 0.098, pwAmt: 0, o2Freq: 0.5, mix1: 1, mix2: 0.453, mixN: 0.244, hpf: 0, att: 0.6, cutoff: 0.898, envAmt: 0.501, res: 0.8, attack: 0, decay: 0.45, release: 0.694, revMix: 0.5, sustain: 0.97, o1Oct: 2, o2Oct: 3, o1Wave: 0, o2Wave: 0, lfoWave: 0, arpMode: 0, arpDir: 0, arpOct: 1, kbTrack: 1, vcaMode: 0, sync: 0 }, c: [['o2Out', 'attIn'], ['attOut', 'cutoffIn']] },
  { name: "Silky Lead", group: 'manual', note: "", p: { arpRate: 0.556, lfoRate: 0.304, pitchAmt: 0.296, cutoffAmt: 0, pwAmt: 0, o2Freq: 0.5, mix1: 0.838, mix2: 1, mixN: 0, hpf: 0, att: 0.501, cutoff: 0.3, envAmt: 0.8, res: 0.1, attack: 0.236, decay: 0.598, release: 0.636, revMix: 0.1, sustain: 0.98, o1Oct: 2, o2Oct: 3, o1Wave: 1, o2Wave: 3, lfoWave: 0, arpMode: 0, arpDir: 0, arpOct: 1, kbTrack: 2, vcaMode: 0, sync: 0 }, c: [] },
  { name: "Syncy Slink Lead", group: 'manual', note: "", p: { arpRate: 0.5, lfoRate: 0.357, pitchAmt: 0, cutoffAmt: 0, pwAmt: 0, o2Freq: 0.5, mix1: 0.939, mix2: 0.901, mixN: 0, hpf: 0.597, att: 0.643, cutoff: 0.6, envAmt: 0.745, res: 0.155, attack: 0.102, decay: 0.053, release: 0.708, revMix: 0.267, sustain: 0.48, o1Oct: 1, o2Oct: 0, o1Wave: 2, o2Wave: 2, lfoWave: 0, arpMode: 0, arpDir: 0, arpOct: 1, kbTrack: 2, vcaMode: 0, sync: 1 }, c: [['envPOut', 'attIn'], ['attOut', 'o2Pitch'], ['mixOut', 'hpfIn'], ['hpfOut', 'vcfIn']] },
  { name: "Wrecked Bass", group: 'manual', note: "", p: { arpRate: 0.565, lfoRate: 0.301, pitchAmt: 0, cutoffAmt: 0.199, pwAmt: 0.304, o2Freq: 0, mix1: 1, mix2: 1, mixN: 0, hpf: 0, att: 0.501, cutoff: 0.838, envAmt: 1, res: 0.5, attack: 0, decay: 0.438, release: 0.397, revMix: 0.162, sustain: 0.64, o1Oct: 0, o2Oct: 0, o1Wave: 2, o2Wave: 2, lfoWave: 0, arpMode: 0, arpDir: 0, arpOct: 1, kbTrack: 2, vcaMode: 0, sync: 0 }, c: [['envPOut', 'o2Pitch'], ['vcfOut', 'fmIn']] },
  { name: "Slowfire", group: 'manual', note: "Turn GLIDE to 1 o'clock.", p: { arpRate: 0, lfoRate: 0.2, pitchAmt: 0, cutoffAmt: 0.199, pwAmt: 0.4, o2Freq: 1, mix1: 0.852, mix2: 0.655, mixN: 0, hpf: 0.501, att: 0.501, cutoff: 0.597, envAmt: 1, res: 0.636, attack: 0.896, decay: 0.899, release: 1, revMix: 0.697, sustain: 0.14, o1Oct: 1, o2Oct: 0, o1Wave: 2, o2Wave: 1, lfoWave: 0, arpMode: 0, arpDir: 1, arpOct: 1, kbTrack: 0, vcaMode: 1, sync: 0, glide: 0.61 }, c: [['o2Out', 'cutoffIn']] },
  { name: "Star-Weaver", group: 'manual', note: "MOD WHEEL up.", p: { arpRate: 0.598, lfoRate: 0.35, pitchAmt: 0.05, cutoffAmt: 1, pwAmt: 0.899, o2Freq: 0.5, mix1: 0.5, mix2: 0.8, mixN: 0.4, hpf: 0.501, att: 0.2, cutoff: 0.549, envAmt: 1, res: 0.501, attack: 0, decay: 0.052, release: 0.173, revMix: 0.898, sustain: 0.4, o1Oct: 1, o2Oct: 3, o1Wave: 2, o2Wave: 3, lfoWave: 2, arpMode: 1, arpDir: 1, arpOct: 1, kbTrack: 2, vcaMode: 0, sync: 0, modWheel: 1 }, c: [['velOut', 'syncIn'], ['o2Out', 'attIn'], ['attOut', 'envAmtIn']] },
  { name: "Phases", group: 'manual', note: "Adjust ATTENUATOR knob for sparkles.", p: { arpRate: 0.658, lfoRate: 0.102, pitchAmt: 0, cutoffAmt: 0.8, pwAmt: 0.706, o2Freq: 0.8, mix1: 0.596, mix2: 0.603, mixN: 0, hpf: 0.65, att: 0.504, cutoff: 0.602, envAmt: 0.888, res: 0.359, attack: 0, decay: 0.301, release: 0.701, revMix: 0.8, sustain: 0, o1Oct: 2, o2Oct: 0, o1Wave: 0, o2Wave: 2, lfoWave: 0, arpMode: 1, arpDir: 2, arpOct: 2, kbTrack: 0, vcaMode: 0, sync: 1 }, c: [['gateOut', 'attIn'], ['attOut', 'o2Pitch'], ['lfoOut', 'envAmtIn'], ['mixOut', 'hpfIn'], ['hpfOut', 'cutoffIn']] },
  { name: "The Dream", group: 'manual', note: "", p: { arpRate: 0.65, lfoRate: 0.402, pitchAmt: 0.097, cutoffAmt: 0.5, pwAmt: 0.705, o2Freq: 0.5, mix1: 0.61, mix2: 0.903, mixN: 1, hpf: 0.405, att: 0.501, cutoff: 0.347, envAmt: 0.846, res: 0.601, attack: 0.295, decay: 0.399, release: 0.595, revMix: 0.5, sustain: 0.42, o1Oct: 1, o2Oct: 0, o1Wave: 1, o2Wave: 1, lfoWave: 0, arpMode: 0, arpDir: 1, arpOct: 2, kbTrack: 0, vcaMode: 0, sync: 0 }, c: [['mixOut', 'hpfIn'], ['hpfOut', 'noiseIn']] },
  { name: "Cosmochordal", group: 'manual', note: "Raise MOD WHEEL for filter bubble. Adjust ATTENUATOR for OSC 2 vibrato / add GLIDE.", p: { arpRate: 0.5, lfoRate: 0.396, pitchAmt: 0, cutoffAmt: 0.8, pwAmt: 1, o2Freq: 0.773, mix1: 0.64, mix2: 0.536, mixN: 0.301, hpf: 0.501, att: 0.541, cutoff: 0.543, envAmt: 0.952, res: 0.606, attack: 0, decay: 0.2, release: 0.8, revMix: 0.4, sustain: 0.4, o1Oct: 1, o2Oct: 2, o1Wave: 2, o2Wave: 1, lfoWave: 0, arpMode: 0, arpDir: 0, arpOct: 0, kbTrack: 2, vcaMode: 0, sync: 0 }, c: [['lfoOut', 'attIn'], ['attOut', 'fmIn']] },
  { name: "Disco-Drone", group: 'manual', note: "PLAY / HOLD “Arp.” Play one note.", p: { arpRate: 0.5, lfoRate: 0.151, pitchAmt: 0, cutoffAmt: 1, pwAmt: 1, o2Freq: 0.8, mix1: 0.8, mix2: 0.5, mixN: 1, hpf: 0.501, att: 0.501, cutoff: 0.598, envAmt: 1, res: 0.363, attack: 0, decay: 0.101, release: 0, revMix: 0.834, sustain: 0.13, o1Oct: 1, o2Oct: 0, o1Wave: 2, o2Wave: 3, lfoWave: 0, arpMode: 0, arpDir: 1, arpOct: 1, kbTrack: 1, vcaMode: 0, sync: 1 }, c: [['lfoOut', 'fmIn']] },
  { name: "(LBD) Cherokee Winds", group: 'lbd', note: "MOD WHEEL UP · “UTILITIES” section provides a summing mixer: 1) flute 2) winds 3) birds 4) output sum · Play slowly and with space to hear elements", p: { arpRate: 0, lfoRate: 0.298, pitchAmt: 0, cutoffAmt: 1, pwAmt: 0, o2Freq: 0.5, mix1: 0, mix2: 0, mixN: 1, hpf: 0.8, att: 0.399, cutoff: 0.8, envAmt: 1, res: 1, attack: 0, decay: 0.2, release: 1, revMix: 0.749, lfoWave: 1, o1Oct: 2, o2Oct: 3, o1Wave: 2, o2Wave: 0, arpMode: 0, arpDir: 2, arpOct: 2, kbTrack: 2, vcaMode: 0, sync: 0, sustain: 0, modWheel: 1 }, c: [['envPOut', 'rateIn'], ['lfoOut', 'fmIn'], ['o1Out', 'mult1'], ['o2Out', 'attIn'], ['mixOut', 'hpfIn'], ['attOut', 'vcfIn'], ['hpfOut', 'mult2'], ['vcfOut', 'mult4'], ['mult3', 'vcaIn']] },
  { name: "(LBD) Heavy Church", group: 'lbd', note: "Made to be played loud · Attenuator for pulse width modulation · Noise/hi-pass for filthy harmonics", p: { arpRate: 0.199, lfoRate: 0.206, pitchAmt: 0, cutoffAmt: 1, pwAmt: 0, o2Freq: 0.2, mix1: 1, mix2: 1, mixN: 0, hpf: 0.599, att: 0.145, cutoff: 0.8, envAmt: 1, res: 0, attack: 0.599, decay: 0.198, release: 1, revMix: 0.5, lfoWave: 1, o1Oct: 0, o2Oct: 1, o1Wave: 2, o2Wave: 1, arpMode: 0, arpDir: 0, arpOct: 0, kbTrack: 1, vcaMode: 0, sync: 0, sustain: 0.42 }, c: [['lfoOut', 'attIn'], ['attOut', 'pwmIn'], ['mixOut', 'hpfIn'], ['hpfOut', 'noiseIn']] },
  { name: "(LBD) Funk FM", group: 'lbd', note: "MOD WHEEL UP! · The tighter the envelope, the better the funk!", p: { arpRate: 0.799, lfoRate: 0.206, pitchAmt: 0, cutoffAmt: 0.499, pwAmt: 0.502, o2Freq: 0.8, mix1: 1, mix2: 1, mixN: 0, hpf: 0.5, att: 0.5, cutoff: 0.298, envAmt: 1, res: 0, attack: 0, decay: 0.148, release: 0.3, revMix: 0.199, lfoWave: 0, o1Oct: 1, o2Oct: 1, o1Wave: 0, o2Wave: 2, arpMode: 0, arpDir: 0, arpOct: 2, kbTrack: 2, vcaMode: 0, sync: 1, sustain: 0.128, modWheel: 1 }, c: [['lfoOut', 'pwmIn'], ['kbOut', 'o2Pitch']] },
  { name: "(LBD) Mirror Images", group: 'lbd', note: "GLIDE at 11 o'clock · Raise MOD WHEEL for filtering FX", p: { arpRate: 0.598, lfoRate: 0.5, pitchAmt: 0, cutoffAmt: 0.599, pwAmt: 0, o2Freq: 0.5, mix1: 1, mix2: 1, mixN: 0, hpf: 0.599, att: 0.551, cutoff: 0.599, envAmt: 1, res: 0.8, attack: 0.698, decay: 0.695, release: 0.899, revMix: 0.696, lfoWave: 1, o1Oct: 1, o2Oct: 3, o1Wave: 2, o2Wave: 0, arpMode: 0, arpDir: 0, arpOct: 2, kbTrack: 2, vcaMode: 0, sync: 0, sustain: 0.574, glide: 0.39 }, c: [['lfoOut', 'attIn'], ['attOut', 'fmIn'], ['o1Out', 'hpfIn'], ['hpfOut', 'mix1In'], ['envPOut', 'pwmIn'], ['envNOut', 'rateIn']] },
  { name: "(LBD) Space Essex", group: 'lbd', note: "Start ARP / press HOLD · Play low “D” and high “D” on keyboard · Adjust hi-pass for variation, adjust attenuator for “computer lab mysteries”", p: { arpRate: 0.2, lfoRate: 0.101, pitchAmt: 0, cutoffAmt: 0, pwAmt: 0, o2Freq: 0.5, mix1: 0.397, mix2: 0.2, mixN: 0.014, hpf: 0.4, att: 0.702, cutoff: 0.597, envAmt: 1, res: 0, attack: 0.646, decay: 0.394, release: 1, revMix: 0.7, lfoWave: 3, o1Oct: 0, o2Oct: 3, o1Wave: 0, o2Wave: 0, arpMode: 0, arpDir: 0, arpOct: 2, kbTrack: 2, vcaMode: 1, sync: 0, sustain: 0.276 }, c: [['clkOut', 'hpfIn'], ['hpfOut', 'o1Pitch'], ['lfoOut', 'mult1'], ['shOut', 'mult2'], ['mult3', 'attIn'], ['attOut', 'o2Pitch'], ['envPOut', 'rateIn']] },
  { name: "(LBD) Gardens of Elkind", group: 'lbd', note: "Play/hold note while slowly bringing reverb up · Mix the oscillators while sequence plays · Adjust attenuator for dynamics", p: { arpRate: 0.702, lfoRate: 0.399, pitchAmt: 0.106, cutoffAmt: 0, pwAmt: 0, o2Freq: 0.5, mix1: 0.5, mix2: 1, mixN: 0, hpf: 0.5, att: 0.6, cutoff: 0.296, envAmt: 1, res: 0, attack: 0.053, decay: 0.105, release: 0.5, revMix: 0.699, lfoWave: 3, o1Oct: 3, o2Oct: 1, o1Wave: 1, o2Wave: 1, arpMode: 1, arpDir: 0, arpOct: 2, kbTrack: 1, vcaMode: 0, sync: 0, sustain: 0.274 }, c: [['gateOut', 'syncIn'], ['shOut', 'attIn'], ['attOut', 'cutoffIn'], ['envNOut', 'fmIn'], ['o1Out', 'revIn']] },
  { name: "(LBD) Transfiguration", group: 'lbd', note: "MOD WHEEL UP - start ARP with the slowest of tempos · Slowly bring up master volume, slowly bring up reverb volume to taste · Adjust attenuator for low frequencies, adjust envelope generator for high frequencies · Play loud - momentarily set GLIDE to full", p: { arpRate: 0, lfoRate: 0, pitchAmt: 0, cutoffAmt: 0.499, pwAmt: 0, o2Freq: 0.8, mix1: 0.8, mix2: 0, mixN: 0, hpf: 1, att: 0.449, cutoff: 0.446, envAmt: 1, res: 0, attack: 0.8, decay: 0.297, release: 0, revMix: 0, lfoWave: 3, o1Oct: 1, o2Oct: 3, o1Wave: 0, o2Wave: 3, arpMode: 0, arpDir: 0, arpOct: 1, kbTrack: 2, vcaMode: 2, sync: 0, sustain: 0.228, modWheel: 1 }, c: [['shOut', 'mult1'], ['mult2', 'o2Pitch'], ['envPOut', 'mult3'], ['envNOut', 'mult4'], ['hpfOut', 'revIn'], ['lfoOut', 'attIn'], ['attOut', 'o1Pitch']] },
  { name: "(LBD) Bravelands", group: 'lbd', note: "Create sequence · Adjust attenuation for frequency modulation", p: { arpRate: 0.394, lfoRate: 0.399, pitchAmt: 0, cutoffAmt: 0.4, pwAmt: 0, o2Freq: 0.5, mix1: 0.701, mix2: 0.851, mixN: 0, hpf: 0, att: 0.702, cutoff: 0.296, envAmt: 1, res: 0, attack: 0.053, decay: 0.152, release: 0.647, revMix: 0.401, lfoWave: 1, o1Oct: 2, o2Oct: 2, o1Wave: 1, o2Wave: 0, arpMode: 1, arpDir: 0, arpOct: 1, kbTrack: 2, vcaMode: 1, sync: 0, sustain: 0.42 }, c: [['gateOut', 'syncIn'], ['lfoOut', 'attIn'], ['attOut', 'vcfOut']] },
  { name: "(LBD) Clockworks", group: 'lbd', note: "MOD WHEEL UP · Play ARP / press HOLD - adjust MOD RATE for delay / echoes", p: { arpRate: 0.297, lfoRate: 0.398, pitchAmt: 0, cutoffAmt: 1, pwAmt: 0, o2Freq: 0.8, mix1: 0.551, mix2: 1, mixN: 0, hpf: 0.4, att: 0.5, cutoff: 0.649, envAmt: 0.743, res: 0.95, attack: 1, decay: 1, release: 0.9, revMix: 0.7, lfoWave: 3, o1Oct: 2, o2Oct: 2, o1Wave: 2, o2Wave: 2, arpMode: 0, arpDir: 0, arpOct: 2, kbTrack: 2, vcaMode: 0, sync: 0, sustain: 0.335, modWheel: 1 }, c: [['gateOut', 'syncIn'], ['lfoOut', 'vcaAmtIn'], ['mixOut', 'hpfIn'], ['hpfOut', 'cutoffIn']] },
  { name: "(LBD) Earthtones", group: 'lbd', note: "Play ARP / press HOLD · Adjust attenuator for frequency modulation", p: { arpRate: 0.598, lfoRate: 0.102, pitchAmt: 0, cutoffAmt: 0.301, pwAmt: 0, o2Freq: 0.699, mix1: 0.6, mix2: 0.395, mixN: 0, hpf: 0, att: 0.801, cutoff: 0.296, envAmt: 1, res: 0.396, attack: 0, decay: 0.201, release: 0.55, revMix: 0.401, lfoWave: 0, o1Oct: 3, o2Oct: 0, o1Wave: 0, o2Wave: 2, arpMode: 0, arpDir: 1, arpOct: 1, kbTrack: 2, vcaMode: 0, sync: 1, sustain: 0.08 }, c: [['lfoOut', 'attIn'], ['attOut', 'o2Pitch']] },
  { name: "(LBD) Beyond the Sun", group: 'lbd', note: "Play keyboard while slowly increasing reverb · Adjust attenuation for vibrato amount · Adjust noise while releasing the keyboard", p: { arpRate: 0.5, lfoRate: 0.398, pitchAmt: 0, cutoffAmt: 0, pwAmt: 0, o2Freq: 1, mix1: 0.9, mix2: 0, mixN: 0, hpf: 0.75, att: 0.552, cutoff: 0.4, envAmt: 1, res: 0.596, attack: 0.901, decay: 1, release: 1, revMix: 0, lfoWave: 1, o1Oct: 0, o2Oct: 3, o1Wave: 0, o2Wave: 2, arpMode: 0, arpDir: 1, arpOct: 0, kbTrack: 0, vcaMode: 0, sync: 0, sustain: 0.13 }, c: [['lfoOut', 'attIn'], ['attOut', 'fmIn'], ['o2Out', 'hpfIn'], ['hpfOut', 'revIn']] },
  { name: "(LBD) DX Sequence", group: 'lbd', note: "Create 16 step sequence - adjust attenuator for filter sequence · Bring up MOD WHEEL for dynamics · Adjust high pass filter for shape, adjust MOD RATE for ratcheting", p: { arpRate: 0.2, lfoRate: 0.206, pitchAmt: 0, cutoffAmt: 0.5, pwAmt: 0, o2Freq: 0.5, mix1: 0.904, mix2: 0.395, mixN: 1, hpf: 0.904, att: 0.801, cutoff: 0.296, envAmt: 1, res: 0, attack: 0, decay: 0.201, release: 0.5, revMix: 0.301, lfoWave: 0, o1Oct: 1, o2Oct: 0, o1Wave: 1, o2Wave: 1, arpMode: 1, arpDir: 0, arpOct: 0, kbTrack: 1, vcaMode: 0, sync: 0, sustain: 0.228 }, c: [['gateOut', 'syncIn'], ['lfoOut', 'vcaAmtIn'], ['shOut', 'attIn'], ['attOut', 'cutoffIn'], ['o2Out', 'hpfIn'], ['hpfOut', 'noiseIn']] },
  { name: "(LBD) Moog FM Bass", group: 'lbd', note: "Create sequence or ARP / press & hold · Adjust attenuation for FM mod · Patch ARP/SEQ GATE OUT to OSC 2 PITCH IN for “ratcheting”", p: { arpRate: 0.594, lfoRate: 0.153, pitchAmt: 0, cutoffAmt: 0.697, pwAmt: 0.502, o2Freq: 0.7, mix1: 1, mix2: 1, mixN: 0, hpf: 0, att: 0.6, cutoff: 0.272, envAmt: 1, res: 0, attack: 0, decay: 0.105, release: 0.4, revMix: 0, lfoWave: 0, o1Oct: 0, o2Oct: 0, o1Wave: 0, o2Wave: 3, arpMode: 0, arpDir: 0, arpOct: 1, kbTrack: 2, vcaMode: 0, sync: 1, sustain: 0.335 }, c: [['o2Out', 'attIn'], ['attOut', 'cutoffIn']] },
  { name: "(LBD) Apocalyptic Voids", group: 'lbd', note: "Press random keys for random sirens · Slowly increase reverb for “UFO arrivals” while playing notes · Adjust attenuator for pitch range - slow MOD RATE for “helicopters”", p: { arpRate: 0.591, lfoRate: 0.649, pitchAmt: 0, cutoffAmt: 1, pwAmt: 0, o2Freq: 0, mix1: 0, mix2: 0, mixN: 1, hpf: 0.8, att: 1, cutoff: 0.444, envAmt: 1, res: 1, attack: 0.053, decay: 0.395, release: 1, revMix: 0, lfoWave: 2, o1Oct: 0, o2Oct: 3, o1Wave: 3, o2Wave: 3, arpMode: 0, arpDir: 0, arpOct: 1, kbTrack: 1, vcaMode: 0, sync: 0, sustain: 0 }, c: [['envNOut', 'o1Pitch'], ['o1Out', 'attIn'], ['attOut', 'o2Pitch'], ['o2Out', 'hpfIn'], ['hpfOut', 'revIn']] },
  { name: "(LBD) Switched On Brass", group: 'lbd', note: "MOD WHEEL UP!", p: { arpRate: 0.299, lfoRate: 0.154, pitchAmt: 0, cutoffAmt: 0.4, pwAmt: 0, o2Freq: 0.549, mix1: 0.7, mix2: 0.7, mixN: 0, hpf: 0, att: 0.399, cutoff: 0.393, envAmt: 1, res: 0.396, attack: 0.054, decay: 0.104, release: 0.3, revMix: 0.6, lfoWave: 0, o1Oct: 2, o2Oct: 1, o1Wave: 1, o2Wave: 1, arpMode: 0, arpDir: 0, arpOct: 0, kbTrack: 2, vcaMode: 0, sync: 0, sustain: 0.569, modWheel: 1 }, c: [['o2Out', 'attIn'], ['attOut', 'envAmtIn'], ['envNOut', 'fmIn']] },
  { name: "(LBD) Arcana Obscura", group: 'lbd', note: "Turn on ARP (hold/press key) · Adjust attenuator for patterns, adjust waveform modulation for variation · Keep SEQ clock speed slow", p: { arpRate: 0.098, lfoRate: 0.399, pitchAmt: 0.597, cutoffAmt: 0.648, pwAmt: 0.502, o2Freq: 1, mix1: 0, mix2: 1, mixN: 0, hpf: 0.904, att: 0.55, cutoff: 0.396, envAmt: 0.9, res: 0.9, attack: 0, decay: 0.105, release: 0.101, revMix: 0.75, lfoWave: 3, o1Oct: 3, o2Oct: 3, o1Wave: 3, o2Wave: 3, arpMode: 0, arpDir: 0, arpOct: 2, kbTrack: 1, vcaMode: 0, sync: 0, sustain: 0.583 }, c: [['gateOut', 'attIn'], ['attOut', 'rateIn'], ['lfoOut', 'o2Pitch'], ['shOut', 'cutoffIn'], ['envNOut', 'o1Pitch'], ['o1Out', 'hpfIn'], ['hpfOut', 'mix1In']] },
  { name: "(LBD) Sequential Destinations", group: 'lbd', note: "MOD WHEEL UP! · Create sequence - adjust attenuator for chorus/phaser · Adjust MOD WHEEL for dynamics", p: { arpRate: 0.396, lfoRate: 0.141, pitchAmt: 0, cutoffAmt: 0.697, pwAmt: 0.6, o2Freq: 0.7, mix1: 1, mix2: 1, mixN: 0, hpf: 0, att: 0.399, cutoff: 0.593, envAmt: 1, res: 0.398, attack: 0.017, decay: 0.104, release: 0.649, revMix: 0.107, lfoWave: 0, o1Oct: 1, o2Oct: 0, o1Wave: 3, o2Wave: 2, arpMode: 1, arpDir: 0, arpOct: 0, kbTrack: 2, vcaMode: 0, sync: 1, sustain: 0.141, modWheel: 1 }, c: [['shOut', 'cutoffIn'], ['lfoOut', 'attIn'], ['attOut', 'o2Pitch']] },
  { name: "(LBD) Road Warriors", group: 'lbd', note: "Envelope generator controls modulation source · Tune oscillators to beat against each other · MOD WHEEL UP!", p: { arpRate: 0.343, lfoRate: 0.598, pitchAmt: 0, cutoffAmt: 1, pwAmt: 1, o2Freq: 0.552, mix1: 1, mix2: 1, mixN: 0, hpf: 0.598, att: 0.494, cutoff: 0.637, envAmt: 0.796, res: 0.665, attack: 0.053, decay: 0.201, release: 0.647, revMix: 0.358, lfoWave: 2, o1Oct: 1, o2Oct: 1, o1Wave: 1, o2Wave: 2, arpMode: 0, arpDir: 0, arpOct: 0, kbTrack: 2, vcaMode: 1, sync: 0, sustain: 0.228, modWheel: 1 }, c: [['gateOut', 'syncIn'], ['envPOut', 'rateIn'], ['o2Out', 'hpfIn'], ['hpfOut', 'cutoffIn']] },
  { name: "(LBD) Red Moon", group: 'lbd', note: "The longer you play a note, the more dramatic vibrato emerges · Tune OSC 2 to a 4th - slow sequences are cool with this", p: { arpRate: 0, lfoRate: 0.052, pitchAmt: 0.058, cutoffAmt: 0, pwAmt: 0.502, o2Freq: 0.651, mix1: 0.9, mix2: 0.3, mixN: 0, hpf: 0.803, att: 0.559, cutoff: 0.748, envAmt: 0.5, res: 0.397, attack: 0.901, decay: 0.593, release: 0.9, revMix: 0.552, lfoWave: 0, o1Oct: 0, o2Oct: 2, o1Wave: 0, o2Wave: 3, arpMode: 0, arpDir: 1, arpOct: 2, kbTrack: 2, vcaMode: 0, sync: 0, sustain: 0.422 }, c: [['envPOut', 'rateIn'], ['lfoOut', 'attIn'], ['attOut', 'fmIn'], ['o2Out', 'hpfIn'], ['hpfOut', 'mix2In']] },
  { name: "(LBD) Lisa's Laboratory", group: 'lbd', note: "Set octave to lowest setting · Press PLAY & HOLD on ARP on lowest available note · Momentarily bring up MOD WHEEL, adjust high pass filter to taste", p: { arpRate: 0.294, lfoRate: 0.399, pitchAmt: 0, cutoffAmt: 0.4, pwAmt: 0.502, o2Freq: 1, mix1: 0, mix2: 0.905, mixN: 0, hpf: 0.447, att: 0.392, cutoff: 0.655, envAmt: 0.693, res: 1, attack: 0.641, decay: 0.298, release: 0.8, revMix: 0.847, lfoWave: 2, o1Oct: 0, o2Oct: 3, o1Wave: 2, o2Wave: 0, arpMode: 0, arpDir: 2, arpOct: 0, kbTrack: 1, vcaMode: 1, sync: 0, sustain: 0.57 }, c: [['gateOut', 'hpfIn'], ['hpfOut', 'envAmtIn'], ['attOut', 'cutoffIn'], ['mult3', 'attIn'], ['envPOut', 'rateIn'], ['envNOut', 'syncIn'], ['mult4', 'o2Pitch'], ['o1Out', 'mult1'], ['shOut', 'mult2'], ['lfoOut', 'fmIn']] },
];
let userPatches = load('patches', []).map(u => (u.pv >= PATCH_VER ? u : Object.assign({}, u, { p: migrateP(u.p || {}, u.pv || 1), pv: PATCH_VER })));
store('patches', userPatches);
let dirty = false;
function markDirty() { if (!dirty) { dirty = true; refreshPatchSel(); } }
function refreshPatchSel() {
  const s = $('#patchSel'); s.innerHTML = '';
  const groups = { manual: 'Grandmother manual patches', lbd: 'Lisa Bella Donna patchbook' }, made = {};
  PRESETS.forEach((p, i) => {
    let parent = s;
    if (groups[p.group]) { if (!made[p.group]) { made[p.group] = mk('optgroup', '', s); made[p.group].label = groups[p.group]; } parent = made[p.group]; }
    const o = mk('option', '', parent, p.name); o.value = 'f' + i; if (p.note) o.title = p.note;
  });
  if (userPatches.length) { const g2 = mk('optgroup', '', s); g2.label = 'Your patches'; userPatches.forEach((p, i) => { const o = mk('option', '', g2, p.name); o.value = 'u' + i; }); }
  const cur = mk('option', '', s, state.name + (dirty ? ' (edited)' : '')); cur.value = 'cur'; cur.hidden = true;
  s.value = 'cur';
}
function applyPatch(pp, cables, name) {
  state.p = Object.assign({}, DEF, pp);
  state.cables = []; colorI = 0;
  for (const c of cables) { const [a, b, col] = c; if (jacks[a] && jacks[b]) { state.cables.push({ a, b, color: col || COLORS[colorI % COLORS.length] }); colorI++; } }
  state.name = name; dirty = false;
  for (const id in ctrls) ctrls[id].render();
  post({ t: 'ps', v: state.p }); post({ t: 'patch', c: state.cables.map(c => [c.a, c.b]) });
  drawCables(); autosave(); refreshPatchSel();
}
$('#patchSel').addEventListener('change', e => {
  const v = e.target.value;
  if (v[0] === 'f') {
    const pr = PRESETS[+v.slice(1)];   // factory patches are already in current (format 3) units
    applyPatch(Object.assign({}, pr.p), pr.c, pr.name);
    if (pr.note) toast(pr.name + ': ' + pr.note);
  }
  else if (v[0] === 'u') { const up = userPatches[+v.slice(1)]; applyPatch(up.p, up.cables, up.name); }
  e.target.blur();
});
function snapshot(name) { return { name, pv: PATCH_VER, p: Object.assign({}, state.p), cables: state.cables.map(c => [c.a, c.b, c.color]) }; }
function askName(def) {
  return new Promise(res => {
    const d = $('#dlgName'), inp = $('#nameIn'); inp.value = def;
    d.onclose = () => res(d.returnValue === 'ok' ? inp.value.trim() || def : null);
    d.showModal(); inp.select();
  });
}
async function savePatch(asNew) {
  let i = userPatches.findIndex(p => p.name === state.name);
  if (asNew || i < 0) {
    const name = await askName(i < 0 && !PRESETS.some(p => p.name === state.name) ? state.name : state.name + ' 2');
    if (!name) return;
    i = userPatches.findIndex(p => p.name === name);
    state.name = name;
    if (i < 0) { userPatches.push(snapshot(name)); } else userPatches[i] = snapshot(name);
  } else userPatches[i] = snapshot(state.name);
  store('patches', userPatches); dirty = false; autosave(); refreshPatchSel(); toast('Saved “' + state.name + '”');
}
$('#btnSave').addEventListener('click', () => savePatch(false));
const more = $('#moreMenu');
$('#btnMore').addEventListener('click', e => { e.stopPropagation(); more.hidden = !more.hidden; });
document.addEventListener('click', () => { more.hidden = true; });
more.addEventListener('click', async e => {
  const a = e.target.dataset.act; if (!a) return;
  more.hidden = true;
  if (a === 'saveas') savePatch(true);
  if (a === 'save') savePatch(false);
  if (a === 'midi') openMidi();
  if (a === 'settings') { buildSettings(); $('#dlgSettings').showModal(); }
  if (a === 'help') $('#dlgHelp').showModal();
  if (a === 'zoom') zoom.reset();
  if (a === 'cables') { G.cables = { show: 'dim', dim: 'hide', hide: 'show' }[G.cables]; applyGlobal(); }
  if (a === 'export') {
    const blob = new Blob([JSON.stringify({ format: 'progenitor-patch', version: 3, ...snapshot(state.name), seqs }, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), l = document.createElement('a');
    l.href = url; l.download = state.name.replace(/[^\w-]+/g, '_') + '.json'; l.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (a === 'import') $('#fileIn').click();
  if (a === 'delete') {
    const i = userPatches.findIndex(p => p.name === state.name);
    if (i < 0) { toast('Only your own saved patches can be deleted'); return; }
    if (!confirm('Delete “' + state.name + '”?')) return;
    userPatches.splice(i, 1); store('patches', userPatches); dirty = true; refreshPatchSel();
  }
  if (a === 'clear') { state.cables = []; patchChanged(); }
  if (a === 'seqclear') { if (seqs) { seqs[state.p.arpOct] = []; post({ t: 'seqs', v: seqs }); store('seqs', seqs); toast('Sequence ' + (state.p.arpOct + 1) + ' cleared'); } }
});
$('#fileIn').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!j.p || !Array.isArray(j.cables)) throw new Error('not a patch');
    let p = {}; for (const k in DEF) if (typeof j.p[k] === 'number') p[k] = j.p[k];
    if (!(j.pv >= PATCH_VER)) p = migrateP(p, j.pv || 1);
    applyPatch(p, j.cables.filter(c => Array.isArray(c) && typeof c[0] === 'string' && typeof c[1] === 'string'), String(j.name || 'Imported').slice(0, 40));
    if (Array.isArray(j.seqs) && j.seqs.length === 3 && confirm('This file also contains sequences. Load them too (replaces your current ones)?')) { seqs = j.seqs; post({ t: 'seqs', v: seqs }); store('seqs', seqs); }
    dirty = true; refreshPatchSel();
  } catch { toast('That file is not a Progenitor patch'); }
  e.target.value = '';
});

// ---------------------------------------------------------------- toast
let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 1800 + 45 * Math.max(0, msg.length - 30)); }

// ---------------------------------------------------------------- boot
const cur = load('current', null);
if (cur && cur.p) {
  Object.assign(state.p, DEF, cur.pv >= PATCH_VER ? cur.p : migrateP(cur.p, cur.pv || 1)); state.name = cur.name || 'Init';
  (cur.cables || []).forEach(([a, b, col]) => { if (jacks[a] && jacks[b]) state.cables.push({ a, b, color: col || COLORS[0] }); });
  for (const id in ctrls) ctrls[id].render();
}
refreshPatchSel();
layout();
refreshLeds();
$('#btnCables').textContent = 'Cables: ' + G.cables;
if (document.fonts) document.fonts.ready.then(() => drawCables());
window.progenitor = { state, G, get node() { return node; }, connect, applyPatch, PRESETS };
})();
