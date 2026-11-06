# Progenitor

A semi-modular analog synthesizer voice for the browser, served at kas.dog/progenitor.

Plays with no cables; patching overrides the internal (normalled) routing, as on hardware.

## Voice

- **Oscillators:** two saw-core oscillators (triangle, saw, square, narrow pulse) with hard sync, linear FM and PWM, anti-aliased with PolyBLEP/PolyBLAMP.
  - **Saw:** by default it follows the measured Moog Voyager waveshape (the Grandmother's oscillators are Voyager-derived): a curved rise whose upper harmonics roll off further as pitch rises. An ideal ramp is selectable in Settings.
  - **Triangle:** folded from the saw, with a slightly off-centre fold point per unit.
  - **Narrow pulse:** ~16% (osc 1) and ~18% (osc 2), as measured on hardware.
  - **Drift:** slow per-oscillator drift, plus an optional cold-start warm-up that mostly settles within about 15 minutes.
- **Mixer:** the CP3-style discrete summing stage, DC coupled.
  - **Taper:** audio-taper level knobs, so a full-level oscillator reaches the stage's ~5 V overload point at about 1 o'clock, as the manual describes.
  - **Distortion:** gentle above 1 o'clock and overdriven at the top. One channel measures ~0.3% THD at 1 o'clock, ~2% at 80% and ~5% fully up.
  - **Asymmetry:** the stage clips more softly and higher on the positive side (+12 V / -6 V rails), with the CP3's spike on positive peaks, giving even and odd harmonics.
  - **Passive bus:** raising one channel slightly ducks the others, and a hot mix squashes everything.
  - **Compensation cap:** a gentle top-end roll-off (~25 kHz).
- **Filter:** 4-pole transistor ladder with tanh stages and keyboard tracking (1:2 / OFF / 1:1). By default it is solved with zero-delay feedback (trapezoidal integrators, Newton-Raphson every sample). The faster Huovilainen model is selectable in Settings.
  - **Cutoff:** the knob alone spans ~10 Hz–11 kHz; CV, envelope and tracking reach past 20 kHz.
  - **Resonance:** follows the measured Mother-32 ladder taper, with a dead zone to 10% and self-oscillation from ~80%. Passband gain drops as resonance rises.
  - **Self-oscillation tuning:** a pitch trim keeps it mostly within about ±13 cents.
  - **AC-coupled regeneration:** resonance fades at the very bottom of the cutoff range (loop-gain corner ~15 Hz, applied to the gain only so tracking stays in tune).
  - **Control feedthrough:** a fast cutoff sweep leaks a small step into the ladder (the envelope "pop" at high resonance), so a self-oscillating filter pings instantly.
- **Envelope:** 911-style RC contour, output 0 to +8 V.
  - **Attack:** charges toward an over-biased 1.25x target until it trips at full scale.
  - **Decay and release:** exponential, each within 1% in its stage time. Release heads to a floor trimmed slightly below 0 V, so the VCA closes in finite time.
  - **Knob law:** follows owner measurements of the circuit: ~2 ms at the very end of the track, jumping to ~30 ms almost at once, ~0.2 s at the first tick, ~0.7 s at 9 o'clock, ~2.2 s at noon and ~13 s fully up.
  - **Multi-Trig:** off by default, as in firmware 1.1+, so legato notes don't retrigger. When on, the gate drops for the reset time: fast (4 ms), slow (20 ms) or custom (4–50 ms). The envelope releases meanwhile, then re-attacks from where it got to.
- **VCA:** ENV, KB RLS and DRONE modes. VCA AMT IN multiplies the level in ENV and KB RLS, and sets it alone in DRONE (per the manual). The input pair compresses a hot signal, so overdrive depends on the input level, not on the VCA level.
- **Modulation:** the PITCH, CUTOFF and PULSE WIDTH AMT knobs have an audio-style taper and are scaled by the MOD wheel, as on the hardware. LFO (sine, saw, ramp, square) from 0.07 Hz to 1.3 kHz, with sync and sample & hold. The sine is shaped from the triangle (~1.5% distortion), as in the original 921-style circuit.
- **Noise:** white, with a gentle top-end rolloff.
- **Utilities:** a 1-pole high pass (20 Hz–20 kHz), a bipolar attenuator (normalled to +8 V) and a 4-jack passive mult.
- **Spring reverb:** a parametric model of the 3-spring, long-decay Accutronics/Belton BMN3AB31B tank. Tap the SPRING REVERB title to knock the tank.
  - **Tank:** stretched-allpass chirp cascades in damped, modulated loops, plus a high-frequency chirp path.
  - **Springs:** echo delays of ~30.8, ~23.1 and ~17.1 ms, with transitions near 4 and 6 kHz. Decay measures ~2.9 s.
  - **Driver and recovery:** 905-style single-ended stages, lopsided when pushed. The recovery output is phase-inverted, as on the 905.
  - **REVERB IN** replaces only the tank's feed; the dry path is always the VCA. The recovery amp is rail-limited, so a full-level signal patched straight in drives the tank hard without swamping the output.
- **Arp/Seq:** arpeggiator, and three 256-step sequences with tie, rest, accent and legato. Includes tap tempo, MIDI clock, external clock (or step advance), and clock, reset and on/off jacks. Clock PPQN defaults to 4, as in firmware 1.1.3.
- **Firmware options:** settings that are SysEx-only on the hardware live in the Settings dialog:
  - pitch variance (random ±0–40 cents per note)
  - swing
  - arp FWD/BKWD end-note repeat (on by default)
  - keyed timing reset
  - sequence transpose reference (first note or middle C)
  - keyboard transposing the sequence
  - delayed sequence change
- **Digitised controls:** OSC 2 FREQUENCY and the pitch wheel have the hardware's centre deadband.
- **Glide and keyboard CV:** generated the way firmware does it, stepped at a control rate and smoothed after the DAC.
- **Global settings:** the documented settings, entered from the panel (hold HOLD + press SYNC, then use the keys) or from the Settings dialog.
- **Patch points:** 41 in total, with universal patching. Any jack connects to any other, and every jack takes any number of cables.
  - **Circuit solve:** each group of connected jacks is solved as a passive circuit every sample, using the impedances in the manual's patch point index.
  - **Outputs:** audio outputs are 2 kΩ, most of them AC coupled. The reverb output is 1 kΩ. Control outputs are 5 Ω, with a current limit.
  - **Inputs:** 90 kΩ for pitch and linear FM, 110 kΩ for envelope amount and high pass, 100 kΩ for everything else.
  - **Normals at outputs:** joining another output to an output jack also changes what that output feeds internally. For example, ATT OUT into FILTER OUTPUT changes what the VCA hears.
  - **Behaviour:** two audio outputs in the mult mix half and half. A control output joined to anything wins. Fighting control outputs meet in the middle. An input joined only to other inputs reads 0 V.
- **Layouts:** the keyboard and controls are always docked at the bottom.
  - **Desktop:** one row of modules, scaled to fit the window's width and height, so nothing scrolls. On short, wide screens the rear-panel modules stack in a column at the right-hand end instead of a row on top, whichever gives the bigger scale. Only very narrow windows wrap the modules into rows and scroll.
  - **Phones:** a scrolling strip (portrait and landscape). Held sideways, the controls, wheels and keys share one compact row, so the whole module strip fits the height.
  - **Phone header:** one row (patch, menu, power) plus a module navigator that jumps along the strip and highlights what's in view. MIDI, Settings, Save, Help and cable visibility move into the ⋯ menu.
  - **Strip layout:** after a thin divider at the end of the main modules, AUDIO sits above ARP/SEQ CV in one column, with MIDI to their right (the navigator's I/O button jumps there). Desktop and tablet keep the horizontal rear-panel row.
  - **Under the keys (phones):** an arrow under the pitch and mod wheels hides them, giving the keyboard more room (it then sits at the left of the scrollbar row, to bring them back), and a scrollbar beside it scrolls the keys (drag it, or tap to jump). Phone keys are 37 px wide.
  - **KEYS:** hides or shows the keyboard for a bigger patching view.
  - **Module zoom:** pinch the module area to zoom just the modules, from "every module visible" (no spare space either side) up to large, focused between your fingers. The page itself never zooms, so the keyboard stays docked. ⋯ → Reset module zoom fits the modules to the screen height again.
  - **Disconnecting:** click or right-click a patched jack (mouse), or press and hold it (touch), to open a menu of its cables. Each row pulls exactly that cable, and hovering a row highlights it. The menu also has Disconnect all and Add another cable.
  - **Touch patching:** a tapped jack stays selected while you scroll, and a bar above the keyboard names it (◀ / ▶ shows which way it is; tap the bar to scroll back). Tap another jack to connect, or the same one again to cancel.
  - **Touch gestures:** a quick sideways swipe from a jack scrolls. A vertical drag, or a short hold then a drag in any direction, draws a cable. Holding a patched jack opens its disconnect menu; hold then drag moves its newest plug.
  - **Hit areas:** jacks have enlarged touch targets.
  - **Auto-scroll:** dragging a cable to the edge of the screen scrolls the panel (sideways on phones, up and down on tablets).
- **Keyboard:** 32 keys on screen.
  - The computer keyboard uses the tracker layout from modularaudio, starting on the low F: Z/A rows for the first octave, Q/number rows above, covering all 32 keys.
  - ← / → are <KB / KB>.
  - Scale lock offers the seven modes with a root, or a custom note set, and snaps to the nearest note.
- **MIDI:** Web MIDI in and out, covering notes, pitch bend, mod wheel, sustain, clock and the CC map (including CC 95, Multi-Trig).
  - **Output:** like the hardware, sends CCs only for its digitised controls and switches (LFO and arp rate, glide, OSC 2 FREQUENCY, octaves, sync, modes, keyboard octave), plus wheels and keys.
  - **Filters:** each group has the hardware's MIDI out filter (global group 2).

**CPU mode** (Settings): Auto turns on Lite for touch devices.
- Lite roughly halves the load: the analog core runs at the base rate, the filter uses the classic ladder with a high-frequency tuning correction, the spring tank uses two springs without the high-frequency path, and smoothing and drift update at a control rate.
- Full is unchanged in sound, but now about 15% faster from exact optimisations: cached coefficients, a fast cosine for the measured saw, and a series form of the mixer curve in its linear range.

The analog core (oscillators, mixer, filter, envelope, VCA) runs 2x oversampled in an AudioWorklet (4x selectable in Settings). The ladder runs at a further 2x internally. The spring tank runs at half the base rate, plus one full-rate path for the high-frequency chirps.

Other analog behaviour modelled:
- per-stage cutoff and drive mismatch in the ladder, randomised per power-on
- per-unit spread in pulse width and triangle symmetry, randomised per power-on
- 1/f-style pitch drift per oscillator
- slight top-octave flattening from the saw core's finite reset time
- a small adjustable VCA control bleed (attack thump)
- a saturating input stage on the high pass

## Factory patches

- **Grandmother manual patches:** all 16 sheets from the manual, under "Grandmother manual patches".
- **Lisa Bella Donna patchbook:** the 20 patches from the *Grandmother Exploration Patchbook*, named "(LBD) …".
- **How they were transcribed:** knob pointers were measured from the sheet artwork (300° sweep), switches from the circled options, and cables traced end to end.
- **What each patch shows:** its sheet's playing notes appear when it loads and as the menu tooltip.
- **Volume:** left at the default for every patch.

## Sources

- Moog Grandmother manual (v2): patch point index, ranges and behaviour.
- Gordon Reid, Grandmother review, Sound On Sound, Sept 2018: pulse widths, mixer headroom, filter range.
- Amos Gaynes (Moog) interview, Reverb.com 2019: circuit lineage.
- Pekonen, Lazzarini, Timoney, Kleimola & Välimäki, *Discrete-time modelling of the Moog sawtooth oscillator waveform*, EURASIP JASP 2011: measured saw shape.
- Paschou, Esqueda, Välimäki & Mourjopoulos, APSIPA 2017: Mother-32 ladder measurements.
- Välimäki, Parker & Abel, JAES 2010, and Gamper, Parker & Välimäki, DAFx-11: spring reverb models.
- Belton/Accutronics BMN3AB3B1B datasheet values.
- *Technical Analysis and DSP Emulation Specification for the Moog Grandmother* (research compilation): CP3 mixer, 911 contour, 902 VCA, 905 reverb and BMN3AB31B tank parameters, firmware 1.1.3 SysEx options. Where it disagrees with the manual (trigger threshold, envelope output range, VCA AMT behaviour, mixer coupling), the manual wins.
- Moog forum owner measurements of the envelope ("What is the approx duration of the ENV stages on the Grandmother?", "Grandmother Decay Time Bad Scaling"): stage-time knob law.

No hardware schematics are public. Calibration against reference recordings of a real unit is planned next.

## Files

- `index.html`: page shell and dialogs
- `css/style.css`: panel styling and responsive layout (single row, two rows, or stacked on phones)
- `js/app.js`: panel UI, patching, keyboard, MIDI, settings, patches
- `js/dsp.js`: AudioWorklet DSP engine (calibration constants are in `TUNE`)

No build step. Serve the folder statically (GitHub Pages works as-is).

Patches, global settings and sequences are kept in localStorage. Patches can also be exported and imported as JSON.

Patch formats 2 and 3 changed the knob units for cutoff, resonance, envelope and modulation amounts. Older patches convert automatically when they load, so their settings carry over.
