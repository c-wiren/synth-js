# synth

Polyphonic synthesizer with analog-like features based on native Web Audio API nodes.

## About

Web Audio API provides all components needed to make a fully-featured Polysynth, but the components are relatively low level, and requires a lot of work to get basic sounds. By putting these together, modelling the behavior of familiar analog synthesizers, we can easily recreate a wide range of sounds with just a few controls.

- Two oscillators
  - Saw and square waveforms
  - Random phase
  - Fine tuning
  - Unison with stereo panning and detune
- Per note filter with cutoff, resonance, and Q-value
- ADSR controls for amplitude and filter

## Installation

```
npm install @c-wiren/synth
```

## Examples

Play middle C for one second:

```typescript
import { Synth } from "@c-wiren/synth";

const audioCtx = new window.AudioContext();
let synth = new Synth(audioCtx);
await synth.init();
synth.noteOn(60, 1);
window.setTimeout(() => {
  synth.noteOff(60);
}, 1000);
```

Export and apply a preset:

```typescript
let preset = synth.exportPreset();
preset.oscillators[0].waveform = Waveform.Sawtooth;
synth.applyPreset(preset);
```
