# Progenitor

A semi-modular analog synthesizer voice for the browser, served at kas.dog/progenitor.

Plays with no cables; patching overrides the internal (normalled) routing, as on hardware.

## Voice

- **Oscillators:** two polyBLEP oscillators (triangle, saw, square, narrow pulse) with hard sync, linear FM and PWM. Slow per-oscillator analog drift, plus an optional cold-start warm-up.
- **Mixer:** DC coupled. Each channel is clean up to 80% on its knob, then overdrives through an asymmetric soft knee; the summing node has its own knee.
- **Filter:** 4-pole transistor ladder with tanh stages, self-oscillation and keyboard tracking (1:2 / OFF / 1:1). By default it is solved with zero-delay feedback (trapezoidal integrators, Newton-Raphson every sample). The faster Huovilainen model is selectable in Settings.
- **Envelope:** RC-style ADSR. VCA modes are ENV, KB RLS and DRONE.
- **Modulation:** LFO (sine, saw, ramp, square) from 0.07 Hz to 1.3 kHz, with sync and sample & hold.
- **Utilities:** a 1-pole high pass, a bipolar attenuator (normalled to +8 V) and a 4-jack passive mult.
- **Spring reverb:** a dispersive allpass-chain model of two springs with a clipping driver and a ~6 s tail; fully wet at 100% mix. Tap the SPRING REVERB title to knock the tank.
- **Arp/Seq:** arpeggiator, and three 256-step sequences with tie, rest, accent and legato. Includes tap tempo, MIDI clock, external clock (or step advance), and clock, reset and on/off jacks.
- **Global settings:** the documented settings, entered from the panel (hold HOLD + press SYNC, then use the keys) or from the Settings dialog.
- **Patch points:** 41 in total, with universal patching. Any jack connects to any other and takes multiple cables. Connected jacks form one node: tied outputs average, and an input joined only to other inputs reads 0 V.
- **Keyboard:** 32 keys on screen. The computer keyboard plays two octaves in the tracker layout from modularaudio: Z/A rows from C3, Q/number rows from C4. ← / → are <KB / KB>. Scale lock offers the seven modes with a root, or a custom note set, and snaps to the nearest note.
- **MIDI:** Web MIDI in and out, covering notes, pitch bend, mod wheel, sustain, clock and the CC map.

The analog core (oscillators, mixer, filter, envelope, VCA) runs 2x oversampled in an AudioWorklet (4x selectable in Settings), and the ladder runs at a further 2x internally.

Analog behaviour modelled:
- per-stage cutoff and drive mismatch in the ladder, randomised per power-on
- 1/f-style pitch drift per oscillator
- slight top-octave flattening from the saw core's finite reset time
- per-channel mixer drive into an asymmetric summing node
- a small adjustable VCA control bleed (attack thump)
- a saturating input stage on the high pass

## Files

- `index.html`: page shell and dialogs
- `css/style.css`: panel styling and responsive layout (single row, two rows, or stacked on phones)
- `js/app.js`: panel UI, patching, keyboard, MIDI, settings, patches
- `js/dsp.js`: AudioWorklet DSP engine

No build step. Serve the folder statically (GitHub Pages works as-is).

Patches, global settings and sequences are kept in localStorage. Patches can also be exported and imported as JSON.
