# Progenitor

A semi-modular analog synthesizer voice for the browser, served at kas.dog/progenitor.

Plays with no cables; patching overrides the internal (normalled) routing, as on hardware.

## Voice

- **Oscillators:** two saw-core oscillators (triangle, saw, square, narrow pulse) with hard sync, linear FM and PWM, anti-aliased with PolyBLEP/PolyBLAMP.
  - **Saw:** by default it follows the measured Moog Voyager waveshape (the Grandmother's oscillators are Voyager-derived): a curved rise whose upper harmonics roll off further as pitch rises. An ideal ramp is selectable in Settings.
  - **Triangle:** folded from the saw, with a slightly off-centre fold point per unit.
  - **Narrow pulse:** ~16% (osc 1) and ~18% (osc 2), as measured on hardware.
  - **Drift:** slow per-oscillator drift, plus an optional cold-start warm-up that mostly settles within about 15 minutes.
- **Mixer:** DC coupled.
  - The summing stage is the main limiter, so one hot channel squashes the others.
  - A single channel is essentially clean up to 80% on its knob, then warms up gradually through a slightly asymmetric transistor-style curve (about 2.75% added distortion at full).
- **Filter:** 4-pole transistor ladder with tanh stages and keyboard tracking (1:2 / OFF / 1:1). By default it is solved with zero-delay feedback (trapezoidal integrators, Newton-Raphson every sample). The faster Huovilainen model is selectable in Settings.
  - **Cutoff:** the knob alone spans ~10 Hz–11 kHz; CV, envelope and tracking reach past 20 kHz.
  - **Resonance:** follows the measured Mother-32 ladder taper, with a dead zone to 10% and self-oscillation from ~80%. Passband gain drops as resonance rises.
  - **Self-oscillation tuning:** a pitch trim keeps it mostly within about ±13 cents.
- **Envelope:** RC-style ADSR. Stage times run from ~1.5 ms (attack) and ~2 ms (decay, release) up to ~12 s. VCA modes are ENV, KB RLS and DRONE.
- **Modulation:** LFO (sine, saw, ramp, square) from 0.07 Hz to 1.3 kHz, with sync and sample & hold. The sine is shaped from the triangle (~1.5% distortion), as in the original 921-style circuit.
- **Noise:** white, with a gentle top-end rolloff.
- **Utilities:** a 1-pole high pass, a bipolar attenuator (normalled to +8 V) and a 4-jack passive mult.
- **Spring reverb:** a parametric model of the 3-spring, long-decay Belton tank: stretched-allpass chirp cascades in damped, modulated loops, plus a high-frequency chirp path. Decay is ~2.7 s. Tap the SPRING REVERB title to knock the tank.
- **Arp/Seq:** arpeggiator, and three 256-step sequences with tie, rest, accent and legato. Includes tap tempo, MIDI clock, external clock (or step advance), and clock, reset and on/off jacks.
- **Glide and keyboard CV:** generated the way firmware does it, stepped at a control rate and smoothed after the DAC.
- **Global settings:** the documented settings, entered from the panel (hold HOLD + press SYNC, then use the keys) or from the Settings dialog.
- **Patch points:** 41 in total, with universal patching. Any jack connects to any other, and every jack takes any number of cables.
  - **Circuit solve:** each group of connected jacks is solved as a passive circuit every sample, using the impedances in the manual's patch point index.
  - **Outputs:** audio outputs are 2 kΩ, most of them AC coupled. The reverb output is 1 kΩ. Control outputs are 5 Ω, with a current limit.
  - **Inputs:** 90 kΩ for pitch and linear FM, 110 kΩ for envelope amount and high pass, 100 kΩ for everything else.
  - **Behaviour:** two audio outputs in the mult mix half and half. A control output joined to anything wins. Fighting control outputs meet in the middle. An input joined only to other inputs reads 0 V.
- **Keyboard:** 32 keys on screen.
  - The computer keyboard uses the tracker layout from modularaudio, starting on the low F: Z/A rows for the first octave, Q/number rows above, covering all 32 keys.
  - ← / → are <KB / KB>.
  - Scale lock offers the seven modes with a root, or a custom note set, and snaps to the nearest note.
- **MIDI:** Web MIDI in and out, covering notes, pitch bend, mod wheel, sustain, clock and the CC map.

The analog core (oscillators, mixer, filter, envelope, VCA) runs 2x oversampled in an AudioWorklet (4x selectable in Settings). The ladder runs at a further 2x internally. The spring tank runs at half the base rate, plus one full-rate path for the high-frequency chirps.

Other analog behaviour modelled:
- per-stage cutoff and drive mismatch in the ladder, randomised per power-on
- per-unit spread in pulse width and triangle symmetry, randomised per power-on
- 1/f-style pitch drift per oscillator
- slight top-octave flattening from the saw core's finite reset time
- a small adjustable VCA control bleed (attack thump)
- a saturating input stage on the high pass

## Sources

- Moog Grandmother manual (v2): patch point index, ranges and behaviour.
- Gordon Reid, Grandmother review, Sound On Sound, Sept 2018: pulse widths, mixer headroom, filter range.
- Amos Gaynes (Moog) interview, Reverb.com 2019: circuit lineage.
- Pekonen, Lazzarini, Timoney, Kleimola & Välimäki, *Discrete-time modelling of the Moog sawtooth oscillator waveform*, EURASIP JASP 2011: measured saw shape.
- Paschou, Esqueda, Välimäki & Mourjopoulos, APSIPA 2017: Mother-32 ladder measurements.
- Välimäki, Parker & Abel, JAES 2010, and Gamper, Parker & Välimäki, DAFx-11: spring reverb models.
- Belton/Accutronics BMN3AB3B1B datasheet values.

No hardware schematics are public. Calibration against reference recordings of a real unit is planned next.

## Files

- `index.html`: page shell and dialogs
- `css/style.css`: panel styling and responsive layout (single row, two rows, or stacked on phones)
- `js/app.js`: panel UI, patching, keyboard, MIDI, settings, patches
- `js/dsp.js`: AudioWorklet DSP engine (calibration constants are in `TUNE`)

No build step. Serve the folder statically (GitHub Pages works as-is).

Patches, global settings and sequences are kept in localStorage. Patches can also be exported and imported as JSON.

Patch format version 2 changed the cutoff, resonance and envelope knob units. Older patches convert automatically on load, so they sound the same.
