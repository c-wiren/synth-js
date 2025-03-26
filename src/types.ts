type DeepPartial<T> = T extends object ? {
    [P in keyof T]?: DeepPartial<T[P]>;
} : T;

/** Oscillator waveform */
export enum Waveform {
    /** Sawtooth: odd and even harmonics */
    Sawtooth = 0,
    /** Square: odd harmonics */
    Square = 1,
    /** Sine: no harmonics */
    Sine = 2
}

/** Synthesizer mode */
export enum Mode {
    /** Polyphonic */
    Poly = 0,
    /** Monophonic, retrigger */
    Mono = 1,
    /** Monophonic, legato */
    Legato = 2
}

// pure oscillator with panning
export interface Voice {
    oscillator: OscillatorNode; // pure oscillator
    panner: StereoPannerNode;   // panner per oscillator
}

// virtual oscillator that allows for unison and detune
export interface Oscillator {
    voices: Voice[];        // voices containing actual oscillators
    frequency: GainNode;    // frequency multiplier for all voices
    gain: GainNode;
}

export interface Note {
    noteNumber: number;                 // MIDI note number
    gain: GainNode;                     // amplitude envelope
    filter: BiquadFilterNode;
    filter_cutoff: WaveShaperNode;      // filter cutoff frequency
    filter_envelope: GainNode;          // filter envelope
    filter_keyboard: GainNode;          // filter keyboard tracking
    frequency: ConstantSourceNode;      // note frequency
    pitch: GainNode;                    // pitch multiplier
    oscillators: Oscillator[];
    released: boolean;
}

export interface OscillatorSettings {
    on: boolean;                        // on/off
    gain: number;                       // 0-1
    compound_gain: ConstantSourceNode;  // gain and unison multiplier, 0-1
    semitones: number;                  // transpose in semitones
    fine: number;                       // fine tune in cents
    unison: number;                     // number of voices
    detune: number;                     // unison detune in cents
    pitch: ConstantSourceNode;          // pitch multiplier
    waveform: Waveform;                 // waveform
    pwm: number;                        // 0-1 for square wave, 0 for regular
}

/** Envelope settings, describes how a sound changes over time. */
export interface ADSR {
    /** Duration of the attack phase, in seconds. */
    attack: number;
    /** Duration of the decay phase, in seconds. */
    decay: number;
    /** Sustain level, from 0 to 1. */
    sustain: number;
    /** Duration of the release phase, in seconds. */
    release: number;
    /** Shape of the attack curve: positive is exponential, negative is logarithmic. */
    attackShape: number;
    /** Shape of the decay curve: positive is exponential, negative is logarithmic. */
    decayShape: number;
    /** Shape of the release curve: positive is exponential, negative is logarithmic. */
    releaseShape: number;
}

/** Configuration for a specific synth sound. Can be exported and applied. */
export interface Preset {
    /** Envelope settings, describes how a sound changes over time. */
    envelopes: {
        /** Amplitude envelope: controls the volume over time  */
        amplitude: ADSR;
        /** Filter envelope: controls the filter cutoff over time */
        filter: ADSR;
    },
    /** Oscillator settings */
    oscillators: {
        /** Whether the oscillator is active. */
        on: boolean;        // on/off
        /** Output level in decibels. */
        volume: number;     // dB
        /** Transpose in semitones. */
        semitones: number;
        /** Fine tune in cents. */
        fine: number;
        /** Number of voices for a wider sound. Combine with detune for a thicker sound. */
        unison: number;
        /** Unison detune in cents. */
        detune: number;
        /** Shape of the waveform. */
        waveform: Waveform;
        /** Pulse width modulation for square waves (0-1). */
        pwm: number;
    }[];
    /** Filter configuration */
    filter: {
        /** Cutoff frequency 0-1, representing 20 Hz to 20 kHz. */
        cutoff: number;
        /** Resonance at the cutoff frequency (0-1). */
        resonance: number;
        /** Filter envelope depth, controlling how much the envelope affects cutoff (0-1). */
        envelope: number;
        /** Keyboard tracking depth, controlling how much the pitch affects cutoff (0-1). */
        keyboard: number;
    };
    /** Time in seconds for pitch transitions between notes. */
    glide: number;
    /** Whether glide is applied between all notes or only legato. */
    glide_always: boolean;
    /** Synthesizer mode/polyphony. */
    mode: Mode;
    /** LFO frequency in Hz. */
    lfoFrequency: number;
    /** LFO pitch modulation depth (0-1), up to two octaves in depth. */
    lfoPitch: number;
    /** Effects */
    fx: {
        /** Chorus */
        chorus: {
            /** Chorus amount (0-1). */
            amount: number;
            /** Chorus mode. */
            mode: 0 | 1;
        };
        /** Soft clipping on the master output. */
        softClip: boolean;
    };
    /** Master volume in dB. */
    masterVolume: number;
}

/** Configuration for a specific synth sound. Can be exported and applied. */
export type PartialPreset = DeepPartial<Preset>;
