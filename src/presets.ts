import { Mode, Waveform, type PartialPreset } from './types';

/** Built-in example presets. */
const presets = {
    "Juno Brass": {
        oscillators: [
            {
                waveform: Waveform.Sawtooth
            }
        ],
        envelopes: {
            amplitude: {
                attack: 0,
                decay: 1,
                sustain: 1,
                release: 0.3
            },
            filter: {
                attack: 0.05,
                decay: 1.5,
                sustain: 0.125,
                release: 0.15
            }
        },
        filter: {
            cutoff: 0.3,
            envelope: 0.5,
            resonance: 0,
            keyboard: 0.5
        },
        fx: {
            chorus: {
                amount: 1
            },
            softClip: true
        }
    },
    "SuperSaw": {
        oscillators: [
            {
                unison: 7,
                detune: 30,
                waveform: Waveform.Sawtooth
            }
        ],
        envelopes: {
            amplitude: {
                release: 0.3
            }
        }
    },
    "SuperSaw Octave": {
        oscillators: [
            {
                unison: 7,
                detune: 30,
                waveform: Waveform.Sawtooth
            },
            {
                on: true,
                volume: -6,
                semitones: 12,
                unison: 7,
                detune: 50,
                waveform: Waveform.Sawtooth
            }
        ],
        envelopes: {
            amplitude: {
                release: 0.3
            }
        }
    },
    "80s Bass": {
        oscillators: [
            {
                waveform: Waveform.Sawtooth,
                fine: -5,
                volume: -3
            },
            {
                on: true,
                waveform: Waveform.Square,
                semitones: -12,
                fine: 5,
                volume: -6
            }
        ],
        envelopes: {
            amplitude: {
                attack: 0,
                decay: 1,
                sustain: 1,
                release: 0.3
            },
            filter: {
                attack: 0.01,
                decay: 1.5,
                sustain: 0.125,
                release: 0.5
            }
        },
        filter: {
            cutoff: 0.3,
            envelope: 0.5,
            resonance: 0,
            keyboard: 0.3
        },
        fx: {
            chorus: {
                amount: 1
            },
            softClip: true
        }
    },
    "Smooth Lead": {
        oscillators: [
            {
                waveform: Waveform.Square,
                pwm: 0.8
            },
        ],
        envelopes: {
            amplitude: {
                attack: 0.01
            }
        },
        filter: {
            keyboard: 0.8,
            resonance: 0.2,
            cutoff: 0.3
        },
        mode: Mode.Legato,
        glide: 0.03
    },
};

export default presets;
