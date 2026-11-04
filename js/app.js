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
  o1Oct: 2, o1Wave: 1, sync: 0, o2Oct: 1, o2Freq: .5, o2Wave: 1, mix1: .6, mix2: 0, mixN: 0, cutoff: .62, res: .15,
  envAmt: .62, kbTrack: 0, attack: 0, decay: .45, sustain: .6, release: .35, volume: .7, vcaMode: 0, revMix: .15,
  hpf: 0, att: .5, glide: 0, fine: .5, modWheel: 0, instGain: 0, triplet: 0, legato: 0 };
const GDEF = { midiCh: 0, midiClkIn: 0, midiClkOut: 0, prio: 2, bend: 2, extMode: 0, ppqnIn: 1, ppqnOut: 1, kbRange: 0,
  local: 1, glideType: 0, gatedGlide: 1, transpose: 0, tapPersist: 0, velRange: 0, o2Range: 7, clkOutMode: 0, midiOutCh: -1,
  drift: .5, warm: 0, bleed: .3, os: 2, extGain: .5, cables: 'show' };
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
const FMT = {
  arpRate: v => eng.synced ? (state.p.triplet ? TDIVN[Math.round(v * 6)] : DIVN[Math.round(v * 16)]) : Math.round(20 * Math.pow(14, v)) + ' BPM',
  lfoRate: v => fHz(0.07 * Math.pow(2, 14.214 * v)),
  pitchAmt: pct, cutoffAmt: pct, pwAmt: pct,
  o2Freq: v => { const r = state.p.sync ? Math.max(24, G.o2Range * 3) : G.o2Range; const s = (v - .5) * 2 * r; return (s > 0 ? '+' : '') + s.toFixed(2) + ' st'; },
  mix1: dial, mix2: dial, mixN: dial,
  cutoff: v => fHz(10 * Math.pow(2000, v)), res: pct, envAmt: bip,
  attack: v => fT(0.001 * Math.pow(10000, v)), decay: v => fT(0.001 * Math.pow(10000, v)), release: v => fT(0.001 * Math.pow(10000, v)),
  sustain: pct, volume: dial, revMix: pct, hpf: v => fHz(20 * Math.pow(500, v)), att: bip,
  glide: v => v < .004 ? 'off' : fT(.002 * Math.pow(2000, v)), fine: v => { const c = Math.round((v - .5) * 200); return (c > 0 ? '+' : '') + c + ' cents'; },
};
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
ICON.sawd = 'M-8 -6 L6 6 L6 -6'; ICON.ramp = 'M-8 6 L6 -6 L6 6';
let uidN = 0;

// ---------------------------------------------------------------- param set
let saveT = 0;
function setP(id, v, opt = {}) {
  state.p[id] = v;
  const c = ctrls[id]; if (c) c.render();
  if (opt.send !== false) post({ t: 'p', k: id, v });
  if (opt.save !== false) { clearTimeout(saveT); saveT = setTimeout(autosave, 400); markDirty(); }
}
function autosave() { store('current', { p: state.p, cables: state.cables.map(c => [c.a, c.b, c.color]), name: state.name }); }

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
        const dy = ly - ev.clientY, dx = ev.clientX - lx; lx = ev.clientX; ly = ev.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        const d = dy + dx * 0.6;
        if (sel) { acc += d; if (Math.abs(acc) > 26) { this.change(Math.sign(acc)); acc = 0; } }
        else this.change(d / (fine() ? 2400 : 230));
        showTip(this.id, el);
      };
      const up = () => {
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        if (sel && moved < 5) setP(this.id, (state.p[this.id] + 1) % this.n);
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
      const mv = ev => { const d = ly - ev.clientY; ly = ev.clientY; setP(this.id, clamp(state.p[this.id] + d / px() / (fine() ? 10 : 1), 0, 1)); showTip(this.id, el); };
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
  jacks[spec.id] = { el, out: spec.out, label: nm };
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
        b.addEventListener('pointerdown', e => { e.preventDefault(); syncPress(); });
        ctrls.sync = { spec: it, render() { b.classList.toggle('on', !!state.p.sync); b.classList.toggle('blink', gsActive); } };
        ctrls.sync.render(); break;
      }
      case 'midiText': { const t = mk('div', 'mtext', m, 'Connect MIDI…'); place(t, it.x, it.y); t.addEventListener('click', openMidi); leds.midiText = t; break; }
      case 'ext': {
        const b = mk('button', 'extbtn', m, '<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12Z"/></svg>');
        place(b, it.x, it.y); b.title = 'External input (microphone / line in)'; b.setAttribute('aria-label', 'External input');
        label(m, it.x, it.y + 28, it.label, 'lbl sm'); b.addEventListener('click', toggleExt); leds.ext = b; break;
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
const rearRow = mk('div', 'rear-row', panel);
REAR.forEach(s => buildModule(s, rearRow));
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
  $('#lhcWrap').innerHTML = ''; $('#whWrap').innerHTML = '';
  if (compact) { buildModule(LHCM, $('#lhcWrap')); buildModule(WHL, $('#whWrap')); }
  else buildModule(LHC, $('#lhcWrap'));
  if (typeof refreshLeds === 'function' && leds.play) refreshLeds();
}

// ---------------------------------------------------------------- layout scaling
let layoutMode = 0;
function layout() {
  const W = document.documentElement.clientWidth - 24;
  let u, mode;
  const one = 2087, two = 1040, three = 346;
  if (W / one >= 0.56) { u = Math.min(1.05, W / one); mode = 1; }
  else if (W >= 640) { u = Math.min(0.95, W / two); mode = 2; }
  else { u = Math.min(1.1, (W + 16) / three); mode = 3; }
  document.documentElement.style.setProperty('--u', u.toFixed(4));
  document.body.classList.toggle('L3', mode === 3);
  document.body.classList.toggle('dock', mode !== 1);
  const du = mode === 1 ? clamp(u * 1.25, .72, 1) : mode === 2 ? .7 : clamp((W + 12) / 480, .55, .9);
  document.documentElement.style.setProperty('--du', du.toFixed(3));
  $('#keyboard').style.height = (mode === 3 ? 170 * du : 312 * du) + 'px';
  if (mode === 3) $('#keyboard').style.width = (19 * 40) + 'px'; else $('#keyboard').style.width = '';
  buildDeck(mode === 3);
  layoutMode = mode;
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
let pending = null, dragC = null;
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
  svgC.setAttribute('width', panel.scrollWidth); svgC.setAttribute('height', panel.scrollHeight);
  const w = Math.max(4, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) * 8);
  let s = '';
  const all = state.cables.slice();
  for (const c of all) {
    const [x1, y1] = jackXY(c.a), [x2, y2] = jackXY(c.b);
    const d = cablePath(x1, y1, x2, y2);
    s += `<path class="shadow" d="${d}" stroke-width="${w + 3}" transform="translate(2 4)"/>` +
      `<path class="cable" d="${d}" stroke="${c.color}" stroke-width="${w}" stroke-opacity=".93"/>` +
      `<circle class="plug" cx="${x1}" cy="${y1}" r="${w * .95}" fill="${c.color}"/><circle class="plug" cx="${x2}" cy="${y2}" r="${w * .95}" fill="${c.color}"/>`;
  }
  if (dragC) {
    const [x1, y1] = jackXY(dragC.fixed);
    s += `<path class="cable" d="${cablePath(x1, y1, dragC.x, dragC.y)}" stroke="${dragC.color}" stroke-width="${w}" stroke-opacity=".8"/><circle class="plug" cx="${dragC.x}" cy="${dragC.y}" r="${w}" fill="${dragC.color}"/>`;
  }
  svgC.innerHTML = s;
  svgC.setAttribute('class', G.cables === 'show' ? '' : G.cables);
  for (const id in jacks) jacks[id].el.classList.toggle('pending', pending === id);
}
function validPair(a, b) {
  if (a === b) return false;
  const ka = kindOf(a), kb = kindOf(b);
  if (ka === 'm' && kb === 'm') return false;
  if (ka === 'o' && kb === 'o') return false;
  if (ka === 'i' && kb === 'i') return false;
  return true;
}
function connect(a, b, color) {
  if (!validPair(a, b)) return false;
  let ka = kindOf(a);
  if (ka === 'i' || (ka === 'm' && kindOf(b) === 'o')) [a, b] = [b, a];
  if (kindOf(b) === 'i') state.cables = state.cables.filter(c => c.b !== b);
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
function bindJack(el, id) {
  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY; let started = false, hot = null;
    const pid = e.pointerId;
    const mv = ev => {
      if (ev.pointerId !== pid) return;
      if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 7) {
        started = true; pending = null;
        const here = state.cables.filter(c => c.a === id || c.b === id);
        if (kindOf(id) === 'i' && here.length) { const c = here[0]; dragC = { fixed: c.a === id ? c.b : c.a, moving: c, color: c.color }; state.cables = state.cables.filter(x => x !== c); }
        else dragC = { fixed: id, color: COLORS[colorI % COLORS.length] };
        markTargets(dragC.fixed);
      }
      if (started) {
        const p = panel.getBoundingClientRect(); dragC.x = ev.clientX - p.left; dragC.y = ev.clientY - p.top;
        const t = document.elementFromPoint(ev.clientX, ev.clientY), je = t && t.closest('.jack');
        if (hot && hot !== je) hot.classList.remove('hot');
        hot = je; if (je) je.classList.add('hot');
        drawCables();
      }
    };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (hot) hot.classList.remove('hot');
      if (!started) { tapJack(id); return; }
      const t = document.elementFromPoint(ev.clientX, ev.clientY), je = t && t.closest('.jack');
      const fixed = dragC.fixed, color = dragC.color, wasMoving = !!dragC.moving;
      dragC = null; markTargets(null);
      if (je && validPair(fixed, je.dataset.jack)) { if (!wasMoving) colorI++; connect(fixed, je.dataset.jack, color); }
      else if (wasMoving) patchChanged(); else drawCables();
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
}
function tapJack(id) {
  if (pending) {
    const p = pending; pending = null; markTargets(null);
    if (p !== id && validPair(p, id)) connect(p, id);
    drawCables(); return;
  }
  const here = state.cables.filter(c => c.a === id || c.b === id);
  if (here.length) { removeCable(here[here.length - 1]); return; }
  pending = id; markTargets(id); drawCables();
}
document.addEventListener('pointerdown', e => { if (pending && !e.target.closest('.jack')) { pending = null; markTargets(null); drawCables(); } });

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
  if (id === 'kbDn') post({ t: 'oct', d: -1 });
  if (id === 'kbUp') post({ t: 'oct', d: 1 });
  if (pressed.play && pressed.hold && pressed.tap) { clearTimeout(panicT); panicT = setTimeout(() => { if (pressed.play && pressed.hold && pressed.tap) { post({ t: 'panic' }); keysUp(); toast('All notes off'); } }, 1000); }
  if (id === 'hold' || id === 'play' || id === 'tap') refreshLeds();
}
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
    if (isBend) post({ t: 'bend', v }); else setP('modWheel', v);
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
const KB_LO = 41, KB_HI = 72;
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
    kbEl.appendChild(k); keyEls[n] = k;
  }
})();
const ptrNote = {};
function kbPointer(e) {
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const k = t && t.closest && t.closest('#keyboard [data-note]');
  if (!k) return [null, 0];
  const r = k.getBoundingClientRect();
  const vel = Math.round(clamp(30 + 97 * (e.clientY - r.top) / r.height, 1, 127));
  return [+k.dataset.note, vel];
}
kbEl.addEventListener('pointerdown', e => {
  e.preventDefault(); ensurePower(); capture(kbEl, e.pointerId);
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
const downCount = {};
function keyDown(n, vel, from) {
  downCount[n] = (downCount[n] || 0) + 1;
  if (keyEls[n]) keyEls[n].classList.add('down');
  if (downCount[n] > 1) return;
  if (GS.active) { GS.key(n, true); return; }
  if (G.local) post({ t: 'on', k: n, v: vel, s: 'kb' });
  else midiSend([0x90 | outCh(), clamp(n + eng.oct * 12, 0, 127), vel]);
}
function keyUp(n, from) {
  if (!downCount[n]) return;
  downCount[n]--;
  if (downCount[n] > 0) return;
  if (keyEls[n]) keyEls[n].classList.remove('down');
  if (GS.active) { GS.key(n, false); return; }
  if (G.local) post({ t: 'off', k: n, s: 'kb' });
  else midiSend([0x80 | outCh(), clamp(n + eng.oct * 12, 0, 127), 0]);
}
function keysUp() { for (const n in downCount) { downCount[n] = 0; if (keyEls[n]) keyEls[n].classList.remove('down'); } }
$('#kbLeft').addEventListener('click', () => $('#kbOuter').scrollBy({ left: -7 * 40, behavior: 'smooth' }));
$('#kbRight').addEventListener('click', () => $('#kbOuter').scrollBy({ left: 7 * 40, behavior: 'smooth' }));

// computer keyboard
const QW = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
let qwBase = 48;
const qwDown = {};
window.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, select, textarea, dialog')) return;
  if (e.key === 'Shift') { fineKeys.shift = true; refreshLeds(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'KeyZ') { qwBase = Math.max(36, qwBase - 12); toast('Computer keys: C' + (qwBase / 12 - 1)); return; }
  if (e.code === 'KeyX') { qwBase = Math.min(60, qwBase + 12); toast('Computer keys: C' + (qwBase / 12 - 1)); return; }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) pbDown('play'), pbUp('play'); return; }
  if (e.code in QW && !e.repeat) {
    e.preventDefault(); ensurePower();
    let n = qwBase + QW[e.code];
    if (n < KB_LO || n > KB_HI) n = clamp(n, KB_LO, KB_HI);
    qwDown[e.code] = n; keyDown(n, 100, 'qw');
  }
});
window.addEventListener('keyup', e => {
  if (e.key === 'Shift') { fineKeys.shift = false; refreshLeds(); }
  if (e.code in qwDown) { keyUp(qwDown[e.code], 'qw'); delete qwDown[e.code]; }
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
  { g: 2, p: 0, k: 'midiOutCh', name: 'MIDI out channel (separate)', n: 16, lab: i => 'channel ' + (i + 1) },
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
function applyGlobal() {
  post({ t: 'g', v: { midiCh: G.midiCh, midiClkIn: G.midiClkIn, midiClkOut: G.midiClkOut, prio: G.prio, bendUp: G.bend, bendDn: G.bend,
    extMode: G.extMode, ppqnIn: G.ppqnIn, ppqnOut: G.ppqnOut, kbRange: G.kbRange, glideType: G.glideType, gatedGlide: G.gatedGlide,
    transpose: G.transpose, tapPersist: G.tapPersist, velRange: G.velRange, o2Range: G.o2Range, clkOutMode: G.clkOutMode, drift: G.drift, warm: G.warm, bleed: G.bleed, os: G.os } });
  post({ t: 'p', k: 'instGain', v: extOn ? G.extGain : 0 });
  saveGlobal(); drawCables();
  $('#btnCables').textContent = 'Cables: ' + G.cables;
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
  const E = $('#emuList'); E.innerHTML = '';
  const rng = (name, k, min, max, step) => { const lab = mk('label', '', E, `<span>${name}</span>`); const r = mk('input', '', lab); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = G[k]; r.addEventListener('input', () => { G[k] = +r.value; applyGlobal(); }); };
  const opt = (name, k, opts) => { const lab = mk('label', '', E, `<span>${name}</span>`); const s = mk('select', '', lab); opts.forEach(([v, t]) => { const o = mk('option', '', s, t); o.value = v; }); s.value = G[k]; s.addEventListener('change', () => { G[k] = isNaN(+s.value) ? s.value : +s.value; applyGlobal(); }); };
  rng('Oscillator drift', 'drift', 0, 1, .01);
  opt('Cold-start warm-up drift', 'warm', [[0, 'off'], [1, 'on']]);
  rng('VCA control bleed (attack thump)', 'bleed', 0, 1, .01);
  opt('Oversampling', 'os', [[2, '2x (lighter on CPU)'], [4, '4x (cleaner FM and sync)']]);
  rng('External input gain', 'extGain', 0, 1, .01);
  opt('Cables', 'cables', [['show', 'show'], ['dim', 'dim'], ['hide', 'hide']]);
}
$('#btnSettings').addEventListener('click', () => { buildSettings(); $('#dlgSettings').showModal(); });
$('#btnHelp').addEventListener('click', () => $('#dlgHelp').showModal());
$('#btnCables').addEventListener('click', () => { G.cables = { show: 'dim', dim: 'hide', hide: 'show' }[G.cables]; applyGlobal(); });

// ---------------------------------------------------------------- external input
let extOn = false, extStream = null, extSrc = null;
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
let midi = null, midiOut = null, midiInId = load('midiIn', 'all'), midiOutId = load('midiOut', 'none');
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
  leds.midiText.textContent = nIn.length > 18 ? nIn.slice(0, 17) + '…' : nIn;
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
function midiCC(c, v) {
  const n7 = v / 127;
  const cont = { 1: 'modWheel', 3: 'lfoRate', 5: 'glide', 8: 'arpRate', 12: 'o2Freq' };
  if (cont[c]) { cc14[c] = v; setP(cont[c], n7); return; }
  const lsb = { 33: 1, 35: 3, 37: 5, 40: 8, 44: 12 };
  if (lsb[c]) { const m = lsb[c]; if (cc14[m] !== undefined) setP(cont[m], ((cc14[m] << 7) | v) / 16383); return; }
  const tri = Math.min(2, Math.floor(v / 43)), quad = Math.min(3, v >> 5), on = v >= 64 ? 1 : 0;
  switch (c) {
    case 65: if (!on) { if (glideSaved === null) { glideSaved = state.p.glide; setP('glide', 0); } } else if (glideSaved !== null) { setP('glide', glideSaved); glideSaved = null; } break;
    case 69: post({ t: 'sethold', v: on }); break;
    case 73: post({ t: 'setplay', v: on }); break;
    case 74: setP('o1Oct', quad); break;
    case 75: setP('o2Oct', quad); break;
    case 77: setP('sync', on); break;
    case 85: G.glideType = tri; applyGlobal(); break;
    case 89: { const o = clamp(Math.round(v / 25.5) - 2, -2, 2); post({ t: 'oct', d: o - eng.oct }); break; }
    case 90: { const [tr, i] = CC90[Math.min(23, Math.round(v / 5.33))]; setP('triplet', tr); setP('arpRate', tr ? i / 6 : i / 16); break; }
    case 91: setP('arpMode', tri); break;
    case 92: setP('arpDir', tri); break;
    case 93: setP('arpOct', tri); break;
    case 94: setP('legato', on); break;
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
    if (e.t === 'mo') midiSend(e.on ? [0x90 | outCh(), clamp(e.n, 0, 127), clamp(e.v || 100, 1, 127)] : [0x80 | outCh(), clamp(e.n, 0, 127), 0]);
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
    [],
  ];
}

// ---------------------------------------------------------------- patches
const PRESETS = [
  { name: 'Init', p: {}, c: [] },
  { name: 'Sync Sweep Lead', p: { sync: 1, o1Wave: 1, o2Wave: 1, o2Oct: 2, o2Freq: .62, mix1: .35, mix2: .62, cutoff: .7, res: .25, envAmt: .66, decay: .52, sustain: .55, glide: .3, pitchAmt: .12, lfoRate: .5, revMix: .2 }, c: [['envPOut', 'attIn'], ['attOut', 'o2Pitch']], extra: { att: .78 } },
  { name: 'Sample & Hold Bubbles', p: { o1Wave: 2, mix1: .55, cutoff: .42, res: .72, envAmt: .55, lfoRate: .56, revMix: .42, decay: .6, sustain: .7, release: .5 }, c: [['shOut', 'cutoffIn']] },
  { name: 'Ladder Whistle', p: { mix1: 0, res: 1, cutoff: .42, kbTrack: 2, envAmt: .5, attack: .32, release: .5, sustain: .9, revMix: .38, pitchAmt: 0 }, c: [] },
  { name: 'Linear FM Bell', p: { o1Wave: 0, o1Oct: 3, o2Wave: 0, o2Oct: 1, o2Freq: .5, mix1: 0, mix2: .72, cutoff: .86, res: .05, envAmt: .5, attack: 0, decay: .66, sustain: 0, release: .62, revMix: .34 }, c: [['o1Out', 'fmIn']] },
  { name: 'Two-Filter Pad', p: { o1Wave: 1, o2Wave: 1, o2Freq: .515, mix1: .55, mix2: .55, attack: .58, decay: .6, sustain: .82, release: .66, cutoff: .56, res: .3, envAmt: .58, hpf: .38, cutoffAmt: .3, modWheel: .5, lfoRate: .3, revMix: .45 }, c: [['mixOut', 'hpfIn'], ['hpfOut', 'vcfIn']] },
  { name: 'Acid Sequence', p: { arpMode: 1, arpOct: 0, arpRate: .52, o1Wave: 1, o1Oct: 1, mix1: .7, cutoff: .33, res: .78, envAmt: .82, decay: .34, sustain: 0, release: .2, glide: .22, legato: 1, kbTrack: 0, revMix: .12 }, c: [['velOut', 'cutoffIn']] },
  { name: 'Drone Field', p: { vcaMode: 2, o1Oct: 0, o2Oct: 0, o2Freq: .53, mix1: .45, mix2: .45, mixN: .25, cutoff: .5, res: .45, envAmt: .5, lfoRate: .18, revMix: .62 }, c: [['lfoOut', 'attIn'], ['attOut', 'cutoffIn']], extra: { att: .64 } },
  { name: 'Velocity Pluck', p: { o1Wave: 3, o2Wave: 1, o2Freq: .505, mix1: .5, mix2: .45, cutoff: .38, res: .35, envAmt: .74, decay: .4, sustain: .1, release: .4, revMix: .25 }, c: [['velOut', 'cutoffIn']] },
  { name: 'Tremolo Organ', p: { o1Wave: 2, o1Oct: 2, o2Wave: 0, o2Oct: 2, mix1: .5, mix2: .5, cutoff: .78, envAmt: .5, attack: .1, sustain: 1, release: .3, lfoRate: .42, vcaMode: 1, revMix: .3 }, c: [['lfoOut', 'vcaAmtIn']] },
];
let userPatches = load('patches', []);
let dirty = false;
function markDirty() { if (!dirty) { dirty = true; refreshPatchSel(); } }
function refreshPatchSel() {
  const s = $('#patchSel'); s.innerHTML = '';
  const g1 = mk('optgroup', '', s); g1.label = 'Starting patches';
  PRESETS.forEach((p, i) => { const o = mk('option', '', g1, p.name); o.value = 'f' + i; });
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
  if (v[0] === 'f') { const pr = PRESETS[+v.slice(1)]; applyPatch(Object.assign({}, pr.p, pr.extra || {}), pr.c, pr.name); }
  else if (v[0] === 'u') { const up = userPatches[+v.slice(1)]; applyPatch(up.p, up.cables, up.name); }
  e.target.blur();
});
function snapshot(name) { return { name, p: Object.assign({}, state.p), cables: state.cables.map(c => [c.a, c.b, c.color]) }; }
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
  if (a === 'export') {
    const blob = new Blob([JSON.stringify({ format: 'progenitor-patch', version: 1, ...snapshot(state.name), seqs }, null, 1)], { type: 'application/json' });
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
    const p = {}; for (const k in DEF) if (typeof j.p[k] === 'number') p[k] = j.p[k];
    applyPatch(p, j.cables.filter(c => Array.isArray(c) && typeof c[0] === 'string' && typeof c[1] === 'string'), String(j.name || 'Imported').slice(0, 40));
    if (Array.isArray(j.seqs) && j.seqs.length === 3 && confirm('This file also contains sequences. Load them too (replaces your current ones)?')) { seqs = j.seqs; post({ t: 'seqs', v: seqs }); store('seqs', seqs); }
    dirty = true; refreshPatchSel();
  } catch { toast('That file is not a Progenitor patch'); }
  e.target.value = '';
});

// ---------------------------------------------------------------- toast
let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 1800); }

// ---------------------------------------------------------------- boot
const cur = load('current', null);
if (cur && cur.p) {
  Object.assign(state.p, DEF, cur.p); state.name = cur.name || 'Init';
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
