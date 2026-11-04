# Progenitor

A semi-modular analog synthesizer voice for the browser, served at kas.dog/progenitor.

Plays with no cables; patching overrides the internal (normalled) routing, as on hardware.

## Voice

- **Oscillators:** two polyBLEP oscillators (triangle, saw, square, narrow pulse) with hard sync, linear FM and PWM. Slow per-oscillator analog drift, plus an optional cold-start warm-up.
- **Mixer:** DC-coupled with soft saturation that starts around 1 o'clock.
- **Filter:** 4-pole transistor-ladder model with per-stage saturation, self-oscillation and keyboard tracking (1:2 / OFF / 1:1).
- **Envelope:** RC-style ADSR. VCA modes are ENV, KB RLS and DRONE.
- **Modulation:** LFO (sine, saw, ramp, square) from 0.07 Hz to 1.3 kHz, with sync and sample & hold.
- **Utilities:** a 1-pole high pass, a bipolar attenuator (normalled to +8 V) and a 4-jack passive mult.
- **Spring reverb:** a dispersive allpass-chain model of two springs. Tap the SPRING REVERB title to knock the tank.
- **Arp/Seq:** arpeggiator, and three 256-step sequences with tie, rest, accent and legato. Includes tap tempo, MIDI clock, external clock (or step advance), and clock, reset and on/off jacks.
- **Global settings:** the documented settings, entered from the panel (hold HOLD + press SYNC, then use the keys) or from the Settings dialog.
- **Patch points:** 41 in total.
- **MIDI:** Web MIDI in and out, covering notes, pitch bend, mod wheel, sustain, clock and the CC map.

The analog core (oscillators, mixer, filter, envelope, VCA) runs 2x oversampled in an AudioWorklet, and the ladder runs at a further 2x internally.

## Files

- `index.html`: page shell and dialogs
- `css/style.css`: panel styling and responsive layout (single row, two rows, or stacked on phones)
- `js/app.js`: panel UI, patching, keyboard, MIDI, settings, patches
- `js/dsp.js`: AudioWorklet DSP engine

No build step. Serve the folder statically (GitHub Pages works as-is).

Patches, global settings and sequences are kept in localStorage. Patches can also be exported and imported as JSON.
