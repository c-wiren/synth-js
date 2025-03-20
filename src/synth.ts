function assert(condition: any, message?: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

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
interface Voice {
    oscillator: OscillatorNode; // pure oscillator
    panner: StereoPannerNode;   // panner per oscillator
}

// virtual oscillator that allows for unison and detune
interface Oscillator {
    voices: Voice[];        // voices containing actual oscillators
    frequency: GainNode;    // frequency multiplier for all voices
    gain: GainNode;
}

interface Note {
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

interface OscillatorSettings {
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
        /** Resonance/Q amount at the cutoff frequency. */
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
}

function validatePreset(preset: DeepPartial<Preset>) {
    for (const envelope of [preset.envelopes?.amplitude, preset.envelopes?.filter]) {
        if (!envelope) continue;
        assert((envelope.attack ?? 0) >= 0, "Attack must be non-negative");
        assert((envelope.decay ?? 0) >= 0, "Decay must be non-negative");
        assert((envelope.sustain ?? 0) >= 0 && (envelope.sustain ?? 0) <= 1, "Sustain must be between 0 and 1");
        assert((envelope.release ?? 0) >= 0, "Release must be non-negative");
    }
    for (const oscillator of preset.oscillators ?? []) {
        if (!oscillator) continue;
        assert((oscillator.unison ?? 1) >= 1, "Unison must be at least 1");
    }
    assert((preset.filter?.cutoff ?? 0) >= 0 && (preset.filter?.cutoff ?? 0) <= 1, "Cutoff must be between 0 and 1");
    assert((preset.filter?.resonance ?? 0) >= 0, "Resonance must be non-negative");
    assert((preset.filter?.envelope ?? 0) >= 0 && (preset.filter?.envelope ?? 0) <= 1, "Filter envelope must be between 0 and 1");
    assert((preset.filter?.keyboard ?? 0) >= 0 && (preset.filter?.keyboard ?? 0) <= 1, "Keyboard tracking must be between 0 and 1");

    assert((preset.glide ?? 0) >= 0, "Glide must be non-negative");
    assert((preset.lfoFrequency ?? 0) >= 0, "LFO frequency must be non-negative");
    assert((preset.lfoPitch ?? 0) >= 0 && (preset.lfoPitch ?? 0) <= 1, "LFO pitch must be between 0 and 1");
}

/** Convert decibels to a gain multiplier. */
export function dBToGain(value: number): number {
    return Math.pow(10, value / 20);
}

/** Convert gain multiplier to decibels.  */
export function gainTodB(value: number): number {
    return 20 * Math.log10(value);
}

/** Convert an exponential value (0-1) to a frequency between 20 Hz and 20 kHz. */
export function valueToFrequency(value: number): number {
    return 20 * Math.pow(1000, value);
}

/** Convert a frequency between 20 Hz and 20 kHz to an exponential value (0-1). */
export function frequencyToValue(frequency: number): number {
    return Math.log(frequency / 20) / Math.log(1000);
}

function calculateDetune(unison: number, voice: number): number {
    // Asymmetric detune
    const left_gain = 0.9;
    const left_power = 1.22;
    const right_power = 1.2;
    let voice_detune = unison > 1 ? ((voice / unison * 2 - 1)) : 0;
    return voice_detune > 0 ? Math.pow(voice_detune, left_power) * left_gain : -Math.pow(-voice_detune, right_power);
}

function calculateUnisonGain(unison: number): number {
    const strength = 0.7;
    return 1 - strength + strength / Math.sqrt(Math.max(unison - 1, 1));
}

/** Calculate the envelope curve at a given time
 *
 * @param time Time, normalized to 0-1
 * @param shape Curve shape, 0 is linear, positive is exponential, negative is logarithmic
 * @returns Value at time x, normalized to 0-1
 */
function calculateEnvelopeCurve(time: number, shape: number): number {
    if (Math.abs(shape) < 1e-6) return time;
    return (Math.exp(shape * time) - 1) / (Math.exp(shape) - 1);
}

function calculateEnvelopeCurveArray(start: number, end: number, shape: number): Float32Array {
    const length = 9;
    const curve = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        curve[i] = start + calculateEnvelopeCurve(i / (length - 1), shape) * (end - start);
    }
    return curve;
}

function createConstantSource(audioCtx: AudioContext, value: number): ConstantSourceNode {
    const constantSource = audioCtx.createConstantSource();
    constantSource.offset.value = value;
    constantSource.start();
    return constantSource;
}

function defaultOscillatorSettings(audioCtx: AudioContext, on: boolean): OscillatorSettings {
    return { on, gain: 1, compound_gain: createConstantSource(audioCtx, 1), semitones: 0, fine: 0, unison: 1, detune: 0, pitch: createConstantSource(audioCtx, 1), waveform: Waveform.Sawtooth, pwm: 0 };
}

async function loadAudioWorkletProcessor(audioCtx: AudioContext, processorCode: string): Promise<void> {
    const blob = new Blob([processorCode], { type: 'application/javascript' });
    return audioCtx.audioWorklet.addModule(URL.createObjectURL(blob));
}

function createPeriodicWave(audioCtx: AudioContext, waveform: Waveform, phase: number = 0, pwm: number = 0): PeriodicWave {
    if (waveform === Waveform.Sine) {
        const phaseAngle = phase * 2 * Math.PI;
        return audioCtx.createPeriodicWave(new Float32Array([0, Math.cos(phaseAngle)]), new Float32Array([0, Math.sin(phaseAngle)]));
    }
    const size = 256;
    const real = new Float32Array(size);
    const imag = new Float32Array(size);
    real[0] = 0;
    imag[0] = 0;
    switch (waveform) {
        case Waveform.Sawtooth:
            for (let i = 1; i < size; i++) {
                const coefficient = 2 / (i * Math.PI);
                const phaseAngle = phase * 2 * Math.PI;
                real[i] = -coefficient * Math.sin(i * phaseAngle);
                imag[i] = coefficient * Math.cos(i * phaseAngle);
            }
            break;
        case Waveform.Square:
            if (pwm < 0.01) {
                for (let i = 1; i < size; i += 2) {
                    const coefficient = 4 / (i * Math.PI);
                    const phaseAngle = phase * 2 * Math.PI;
                    real[i] = -coefficient * Math.sin(i * phaseAngle);
                    imag[i] = coefficient * Math.cos(i * phaseAngle);
                }
            } else {
                const dutyCycle = 0.5 - pwm * 0.49;
                real[0] = 2 * dutyCycle - 1;
                for (let i = 1; i < size; i++) {
                    const coefficient = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * dutyCycle);
                    const phaseAngle = phase * 2 * Math.PI;
                    real[i] = coefficient * Math.cos(i * phaseAngle);
                    imag[i] = coefficient * Math.sin(i * phaseAngle);
                }
            }
            break;
    }
    return audioCtx.createPeriodicWave(real, imag);
}

function semitonesToMultiplier(semitones: number): number {
    return Math.pow(2, semitones / 12);
}

function noteNumberToFrequency(noteNumber: number, tuning: number): number {
    return tuning * Math.pow(2, (noteNumber - 69) / 12);
}

// Convert a MIDI note number to a filter value between 0 and 1, pivot at middle C
function noteNumberToFilterValue(noteNumber: number): number {
    const middleC = 60;
    return ((noteNumber - middleC) / 12) * Math.log(2) / Math.log(1000);
}

/** Polyphonic synthesizer with analog-like features based on native Web Audio API nodes. */
export class Synth {
    private audioCtx: AudioContext;
    private notes: Map<number, Note>;
    private tuning: number;
    private previousNoteNumber?: number; // for glide
    private keyStack: number[]; // stack of pressed keys

    private envelopes: {
        amplitude: ADSR,
        filter: ADSR;
    };

    private oscillatorSettings: OscillatorSettings[];
    private filterSettings: {
        cutoff: ConstantSourceNode;    // 0-1
        resonance: ConstantSourceNode; // Q
        envelope: ConstantSourceNode;  // 0-1
        keyboard: ConstantSourceNode;  // 0-1
    };
    private lfo: OscillatorNode;
    private lfoGain: GainNode;
    private lfoPitch: WaveShaperNode;
    private masterVolume: number; // dB
    private masterGain: GainNode;
    private glide: number; // seconds
    private glide_always: boolean;
    private mode: Mode;

    /** Default preset. Is used as a fallback for applyPreset(). */
    static readonly defaultPreset: Preset = {
        envelopes: {
            amplitude: { attack: 0.001, decay: 5, sustain: 1, release: 0.2, attackShape: 0, decayShape: -2, releaseShape: -5 },
            filter: { attack: 0, decay: 5, sustain: 1, release: 1, attackShape: 0, decayShape: -2, releaseShape: -5 }
        },
        oscillators: [
            { on: true, volume: 0, semitones: 0, fine: 0, unison: 1, detune: 0, waveform: Waveform.Sawtooth, pwm: 0 },
            { on: false, volume: 0, semitones: 0, fine: 0, unison: 1, detune: 0, waveform: Waveform.Sawtooth, pwm: 0 }
        ],
        filter: {
            cutoff: 1,
            resonance: 0.5,
            envelope: 0,
            keyboard: 0
        },
        glide: 0,
        glide_always: false,
        mode: Mode.Poly,
        lfoFrequency: 5,
        lfoPitch: 0
    };

    private valueToFrequencyLUT: Float32Array;
    private octaveToMultiplierLUT: Float32Array;

    /** Create Synth
     *
     * @param autoConnect Automatically connect to audioCtx.destination
     */
    constructor(audioCtx: AudioContext, autoConnect = true) {
        this.audioCtx = audioCtx;
        this.notes = new Map();
        this.tuning = 440;
        this.keyStack = [];
        this.envelopes = Synth.defaultPreset.envelopes;
        this.oscillatorSettings = [];
        this.oscillatorSettings.push(defaultOscillatorSettings(audioCtx, true));
        this.oscillatorSettings.push(defaultOscillatorSettings(audioCtx, false));
        this.filterSettings = {
            cutoff: createConstantSource(audioCtx, Synth.defaultPreset.filter.cutoff),
            resonance: createConstantSource(audioCtx, Synth.defaultPreset.filter.resonance),
            envelope: createConstantSource(audioCtx, Synth.defaultPreset.filter.envelope),
            keyboard: createConstantSource(audioCtx, Synth.defaultPreset.filter.keyboard)
        };
        this.glide = 0; // seconds
        this.glide_always = false;
        this.mode = Synth.defaultPreset.mode;
        this.lfo = audioCtx.createOscillator();
        this.lfo.frequency.value = 5;
        this.lfoGain = audioCtx.createGain();
        this.lfoGain.gain.value = 0;
        this.lfo.connect(this.lfoGain);
        this.lfo.start();
        this.masterVolume = -12; // dB
        this.masterGain = audioCtx.createGain();
        this.setMasterVolume(this.masterVolume);
        if (autoConnect) {
            this.masterGain.connect(audioCtx.destination);
        }
        const lutSize = 33;
        this.valueToFrequencyLUT = new Float32Array(lutSize);
        for (let i = 0; i < lutSize; ++i) {
            this.valueToFrequencyLUT[i] = valueToFrequency(2 * i / (lutSize - 1) - 1);
        }
        this.octaveToMultiplierLUT = new Float32Array(lutSize);
        for (let i = 0; i < lutSize; ++i) {
            this.octaveToMultiplierLUT[i] = Math.pow(2, 2 * i / (lutSize - 1) - 1);
        }
        this.lfoPitch = new WaveShaperNode(this.audioCtx, { curve: this.octaveToMultiplierLUT });
        this.lfoGain.connect(this.lfoPitch);
    }

    connect(destination: AudioNode): void {
        this.masterGain.connect(destination);
    }

    disconnect(): void {
        this.masterGain.disconnect();
    }

    /** Apply a preset overwriting the current settings, unspecified settings are kept. */
    applyPartialPreset(preset: DeepPartial<Preset>) {
        validatePreset(preset);
        if (preset.envelopes) {
            if (preset.envelopes.amplitude) {
                Object.assign(this.envelopes.amplitude, preset.envelopes.amplitude);
            }
            if (preset.envelopes.filter) {
                Object.assign(this.envelopes.filter, preset.envelopes.filter);
            }
        }
        if (preset.oscillators) {
            for (let i = 0; i < preset.oscillators.length; i++) {
                if (preset.oscillators[i]) {
                    let updatePitch = false;
                    let updateGain = false;
                    if (preset.oscillators[i]!.on !== undefined) {
                        this.oscillatorSettings[i].on = preset.oscillators[i]!.on!;
                    }
                    if (preset.oscillators[i]!.semitones !== undefined) {
                        this.oscillatorSettings[i].semitones = preset.oscillators[i]!.semitones!;
                        updatePitch = true;
                    }
                    if (preset.oscillators[i]!.fine !== undefined) {
                        this.oscillatorSettings[i].fine = preset.oscillators[i]!.fine!;
                        updatePitch = true;
                    }
                    if (updatePitch) {
                        this.oscillatorSettings[i].pitch.offset.setValueAtTime(semitonesToMultiplier(this.oscillatorSettings[i].semitones + this.oscillatorSettings[i].fine / 100), this.audioCtx.currentTime);
                    }
                    if (preset.oscillators[i]!.unison !== undefined) {
                        this.oscillatorSettings[i].unison = preset.oscillators[i]!.unison!;
                        updateGain = true;
                    }
                    if (preset.oscillators[i]!.detune !== undefined) {
                        this.oscillatorSettings[i].detune = preset.oscillators[i]!.detune!;
                    }
                    if (preset.oscillators[i]!.waveform !== undefined) {
                        this.oscillatorSettings[i].waveform = preset.oscillators[i]!.waveform!;
                    }
                    if (preset.oscillators[i]!.pwm !== undefined) {
                        this.oscillatorSettings[i].pwm = preset.oscillators[i]!.pwm!;
                    }
                    if (preset.oscillators[i]!.volume !== undefined) {
                        this.oscillatorSettings[i].gain = dBToGain(preset.oscillators[i]!.volume!);
                        updateGain = true;
                    }
                    if (updateGain) {
                        this.oscillatorSettings[i].compound_gain.offset.setValueAtTime(this.oscillatorSettings[i].gain * calculateUnisonGain(this.oscillatorSettings[i].unison), this.audioCtx.currentTime);
                    }
                }
            }
        }
        if (preset.filter) {
            if (preset.filter.cutoff !== undefined) {
                this.filterSettings.cutoff.offset.setValueAtTime(preset.filter.cutoff, this.audioCtx.currentTime);
            }
            if (preset.filter.resonance !== undefined) {
                this.filterSettings.resonance.offset.setValueAtTime(preset.filter.resonance, this.audioCtx.currentTime);
            }
            if (preset.filter.envelope !== undefined) {
                this.filterSettings.envelope.offset.setValueAtTime(preset.filter.envelope, this.audioCtx.currentTime);
            }
            if (preset.filter.keyboard !== undefined) {
                this.filterSettings.keyboard.offset.setValueAtTime(preset.filter.keyboard, this.audioCtx.currentTime);
            }
        }
        if (preset.glide !== undefined) {
            this.glide = preset.glide;
        }
        if (preset.glide_always !== undefined) {
            this.glide_always = preset.glide_always;
        }
        if (preset.mode !== undefined) {
            this.mode = preset.mode;
            if (this.mode !== Mode.Poly) {
                for (let note of this.notes.values()) {
                    if (note.noteNumber !== this.keyStack[this.keyStack.length - 1]) {
                        this.noteAbort(note.noteNumber);
                    }
                }
            }
        }
        if (preset.lfoFrequency !== undefined) {
            this.lfo.frequency.setValueAtTime(preset.lfoFrequency, this.audioCtx.currentTime);
        }
        if (preset.lfoPitch !== undefined) {
            this.lfoGain.gain.setValueAtTime(preset.lfoPitch, this.audioCtx.currentTime);
        }
    }

    /** Apply a preset overwriting the current settings, unspecified settings are reset to default. */
    applyPreset(preset: DeepPartial<Preset>) {
        this.applyPartialPreset({ ...Synth.defaultPreset, ...preset });
    }

    /** Export the current settings as a preset. */
    exportPreset(): Preset {
        return {
            envelopes: {
                amplitude: { ...this.envelopes.amplitude },
                filter: { ...this.envelopes.filter }
            },
            oscillators: this.oscillatorSettings.map(settings => ({
                on: settings.on,
                volume: gainTodB(settings.compound_gain.offset.value),
                semitones: settings.semitones,
                fine: settings.fine,
                unison: settings.unison,
                detune: settings.detune,
                waveform: settings.waveform,
                pwm: settings.pwm
            })),
            filter: {
                cutoff: this.filterSettings.cutoff.offset.value,
                resonance: this.filterSettings.resonance.offset.value,
                envelope: this.filterSettings.envelope.offset.value,
                keyboard: this.filterSettings.keyboard.offset.value
            },
            glide: this.glide,
            glide_always: this.glide_always,
            mode: this.mode,
            lfoFrequency: this.lfo.frequency.value,
            lfoPitch: this.lfoGain.gain.value
        };
    }

    // Handle legato transitions
    private noteOnLegato(noteNumber: number): boolean {
        if (this.notes.size > 0) {
            let foundNote;
            for (let note of this.notes.values()) {
                if (foundNote === undefined && !note.released) {
                    foundNote = note;
                } else {
                    this.noteAbort(note.noteNumber);
                }
            }
            if (foundNote) {
                const note = foundNote;
                const previousFrequency = note.frequency.offset.value;
                const previousKeyboard = note.filter_keyboard.gain.value;
                note.frequency.offset.cancelScheduledValues(this.audioCtx.currentTime);
                note.filter_keyboard.gain.cancelScheduledValues(this.audioCtx.currentTime);
                if (this.glide > 0) {
                    note.frequency.offset.setValueAtTime(previousFrequency, this.audioCtx.currentTime);
                    const thisFrequency = noteNumberToFrequency(noteNumber, this.tuning);
                    note.frequency.offset.exponentialRampToValueAtTime(thisFrequency, this.audioCtx.currentTime + this.glide);
                    note.filter_keyboard.gain.setValueAtTime(previousKeyboard, this.audioCtx.currentTime);
                    note.filter_keyboard.gain.linearRampToValueAtTime(noteNumberToFilterValue(noteNumber), this.audioCtx.currentTime + this.glide);
                } else {
                    note.frequency.offset.setValueAtTime(noteNumberToFrequency(noteNumber, this.tuning), this.audioCtx.currentTime);
                    note.filter_keyboard.gain.setValueAtTime(noteNumberToFilterValue(noteNumber), this.audioCtx.currentTime);
                }
                const previousNoteNumber = note.noteNumber;
                note.noteNumber = noteNumber;
                this.notes.set(noteNumber, note);
                this.notes.delete(previousNoteNumber);
                this.previousNoteNumber = noteNumber;
                return true;
            }
        }
        return false;
    }

    /** Trigger note on.
     *
     * @param noteNumber MIDI note number
     * @param velocity Note velocity (0-1)
     */
    noteOn(noteNumber: number, velocity: number = 1) {
        if (velocity === 0) {
            this.noteOff(noteNumber);
            return;
        }
        this.keyStack = this.keyStack.filter(key => key !== noteNumber);
        this.keyStack.push(noteNumber);
        // Handle legato mode
        if (this.mode == Mode.Legato && this.noteOnLegato(noteNumber)) {
            return;
        }
        // TODO: This should instead reuse the oscillators
        const gain = this.audioCtx.createGain();
        if (this.envelopes.amplitude.attack > 0) {
            gain.gain.value = 0;
            gain.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(0, velocity, this.envelopes.amplitude.attackShape), this.audioCtx.currentTime, this.envelopes.amplitude.attack);
        } else {
            gain.gain.value = velocity;
        }
        if (this.envelopes.amplitude.decay > 0) {
            gain.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(velocity, velocity * this.envelopes.amplitude.sustain, this.envelopes.amplitude.decayShape), this.audioCtx.currentTime + this.envelopes.amplitude.attack, this.envelopes.amplitude.decay);
        } else {
            gain.gain.setValueAtTime(velocity * this.envelopes.amplitude.sustain, this.audioCtx.currentTime + this.envelopes.amplitude.attack);
        }
        const frequency = createConstantSource(this.audioCtx, noteNumberToFrequency(noteNumber, this.tuning));
        const pitch = this.audioCtx.createGain();
        pitch.gain.value = 0;
        this.lfoPitch.connect(pitch.gain);
        frequency.connect(pitch);
        if (this.glide > 0 && this.previousNoteNumber !== undefined) {
            const previousFrequency = noteNumberToFrequency(this.previousNoteNumber, this.tuning);
            const thisFrequency = noteNumberToFrequency(noteNumber, this.tuning);
            frequency.offset.value = previousFrequency;
            frequency.offset.exponentialRampToValueAtTime(thisFrequency, this.audioCtx.currentTime + this.glide);
        }
        const oscillators = [];
        for (let settings of this.oscillatorSettings) {
            if (!settings.on) { continue; }
            const voices = [];
            const oscillator_gain = this.audioCtx.createGain();
            oscillator_gain.gain.value = 0;
            settings.compound_gain.connect(oscillator_gain.gain);
            oscillator_gain.connect(gain);
            const oscillator_frequency = this.audioCtx.createGain();
            oscillator_frequency.gain.value = 0;
            settings.pitch.connect(oscillator_frequency.gain);
            pitch.connect(oscillator_frequency);
            for (let i = 0; i < settings.unison; i++) {
                const panner = this.audioCtx.createStereoPanner();
                panner.pan.value = settings.unison > 1 ? i / (settings.unison - 1) * 2 - 1 : 0;
                const oscillator = this.audioCtx.createOscillator();
                oscillator.setPeriodicWave(createPeriodicWave(this.audioCtx, settings.waveform, Math.random(), settings.pwm));
                oscillator.frequency.value = 0;
                oscillator_frequency.connect(oscillator.frequency);
                oscillator.detune.value = calculateDetune(settings.unison, i) * settings.detune;
                oscillator.connect(panner);
                panner.connect(oscillator_gain);
                oscillator.start();
                voices.push({ oscillator, panner });
            }
            oscillators.push({ voices, frequency: oscillator_frequency, gain: oscillator_gain });
        }
        // Node to convert exponential value 0-1 to frequency between 20 Hz and 20 kHz
        let filter_cutoff = new WaveShaperNode(this.audioCtx, { curve: this.valueToFrequencyLUT });

        // Filter
        const filter = this.audioCtx.createBiquadFilter();
        filter.frequency.value = 0;
        filter.type = "lowpass";
        this.filterSettings.cutoff.connect(filter_cutoff);
        this.filterSettings.resonance.connect(filter.Q);

        // Filter envelope
        const filter_envelope = this.audioCtx.createGain();
        if (this.envelopes.filter.attack > 0) {
            filter_envelope.gain.value = 0;
            filter_envelope.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(0, 1, this.envelopes.filter.attackShape), this.audioCtx.currentTime, this.envelopes.filter.attack);
        } else {
            filter_envelope.gain.value = 1;
        }
        if (this.envelopes.filter.decay > 0) {
            filter_envelope.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(1, this.envelopes.filter.sustain, this.envelopes.filter.decayShape), this.audioCtx.currentTime + this.envelopes.filter.attack, this.envelopes.filter.decay);
        } else {
            filter_envelope.gain.setValueAtTime(this.envelopes.filter.sustain, this.audioCtx.currentTime + this.envelopes.filter.attack);
        }
        this.filterSettings.envelope.connect(filter_envelope);

        // Keyboard tracking
        const filter_keyboard = this.audioCtx.createGain();
        if (this.glide > 0 && this.previousNoteNumber !== undefined) {
            filter_keyboard.gain.value = noteNumberToFilterValue(this.previousNoteNumber);
            filter_keyboard.gain.linearRampToValueAtTime(noteNumberToFilterValue(noteNumber), this.audioCtx.currentTime + this.glide);
        } else {
            filter_keyboard.gain.value = noteNumberToFilterValue(noteNumber);
        }
        this.filterSettings.keyboard.connect(filter_keyboard);
        filter_keyboard.connect(filter_envelope);

        filter_envelope.connect(filter_cutoff);
        filter_cutoff.connect(filter.frequency);
        gain.connect(filter);
        filter.connect(this.masterGain);

        if (this.mode == Mode.Poly) {
            this.noteAbort(noteNumber);
        } else if (this.mode == Mode.Mono) {
            for (let note of this.notes.values()) {
                this.noteAbort(note.noteNumber);
            }
        }
        this.previousNoteNumber = noteNumber;
        this.notes.set(noteNumber, { noteNumber, gain, filter, filter_cutoff, filter_envelope, filter_keyboard, frequency, pitch, oscillators, released: false });
    }

    /** Trigger note off.
     *
     * @param noteNumber MIDI note number
     */
    noteOff(noteNumber: number) {
        this.keyStack = this.keyStack.filter(key => key !== noteNumber);
        if (this.previousNoteNumber === noteNumber && this.keyStack.length > 0) {
            if (this.mode == Mode.Legato) {
                return this.noteOnLegato(this.keyStack[this.keyStack.length - 1]);
            } else if (this.mode == Mode.Mono) {
                return this.noteOn(this.keyStack[this.keyStack.length - 1]);
            }
        }
        const note = this.notes.get(noteNumber);
        if (note) {
            note.released = true;
            if (this.previousNoteNumber === noteNumber && !this.glide_always) {
                this.previousNoteNumber = undefined;
            }
            const currentGain = note.gain.gain.value;
            note.gain.gain.cancelScheduledValues(this.audioCtx.currentTime);
            if (this.envelopes.amplitude.release > 0) {
                try {
                    note.gain.gain.setValueAtTime(currentGain, this.audioCtx.currentTime);
                    note.gain.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(currentGain, 0, this.envelopes.filter.releaseShape), this.audioCtx.currentTime, this.envelopes.amplitude.release);
                } catch (err) {
                    // Fallback for Firefox
                    const new_gain = this.audioCtx.createGain();
                    new_gain.gain.value = currentGain;
                    new_gain.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(currentGain, 0, this.envelopes.filter.releaseShape), this.audioCtx.currentTime, this.envelopes.amplitude.release);
                    new_gain.connect(note.filter);
                    for (let oscillator of note.oscillators) {
                        oscillator.gain.connect(new_gain);
                    }
                    note.gain.disconnect();
                    note.gain = new_gain;
                }
            } else {
                note.gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
            }
            const currentEnvelope = note.filter_envelope.gain.value;
            note.filter_envelope.gain.cancelScheduledValues(this.audioCtx.currentTime);
            if (this.envelopes.filter.release > 0) {
                try {
                    note.filter_envelope.gain.setValueAtTime(currentEnvelope, this.audioCtx.currentTime);
                    note.filter_envelope.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(currentEnvelope, 0, this.envelopes.filter.releaseShape), this.audioCtx.currentTime, this.envelopes.filter.release);
                } catch (err) {
                    // Fallback for Firefox
                    const new_envelope = this.audioCtx.createGain();
                    new_envelope.gain.value = currentEnvelope;
                    new_envelope.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(currentEnvelope, 0, this.envelopes.filter.releaseShape), this.audioCtx.currentTime, this.envelopes.filter.release);
                    new_envelope.connect(note.filter_cutoff);
                    this.filterSettings.envelope.connect(new_envelope);
                    note.filter_keyboard.connect(new_envelope);
                    note.filter_envelope.disconnect();
                    note.filter_envelope = new_envelope;
                }
            } else {
                note.filter_envelope.gain.setValueAtTime(0, this.audioCtx.currentTime);
            }
            if (note.oscillators.length > 0 && note.oscillators[0].voices.length > 0) {
                // Cleanup when the first oscillator ends
                note.oscillators[0].voices[0].oscillator.onended = () => {
                    this.noteAbort(noteNumber);
                };
            }
            for (let oscillator of note.oscillators) {
                for (let voice of oscillator.voices) {
                    voice.oscillator.stop(this.audioCtx.currentTime + this.envelopes.amplitude.release);
                }
            }
        }
    }

    /** Immediately stop note.
     *
     * @param noteNumber MIDI note number
     */
    noteAbort(noteNumber: number) {
        const note = this.notes.get(noteNumber);
        if (note) {
            if (note.oscillators.length > 0 && note.oscillators[0].voices.length > 0) {
                // Reset in case of multiple calls
                note.oscillators[0].voices[0].oscillator.onended = null;
            }
            let i = 0;
            for (let oscillator of note.oscillators) {
                if (oscillator.voices.length > 0) {
                    for (let voice of oscillator.voices) {
                        voice.oscillator.stop();
                        voice.oscillator.disconnect();
                        voice.panner.disconnect();
                    }
                }
                oscillator.frequency.disconnect();
                oscillator.gain.disconnect();
                this.oscillatorSettings[i].compound_gain.disconnect(oscillator.gain.gain);
                this.oscillatorSettings[i].pitch.disconnect(oscillator.frequency.gain);
                ++i;
            }
            note.frequency.stop();
            note.gain.disconnect();
            note.filter.disconnect();
            note.filter_cutoff.disconnect();
            note.filter_envelope.disconnect();
            note.filter_keyboard.disconnect();
            note.frequency.disconnect();
            note.pitch.disconnect();
            this.filterSettings.cutoff.disconnect(note.filter_cutoff);
            this.filterSettings.resonance.disconnect(note.filter.Q);
            this.filterSettings.envelope.disconnect(note.filter_envelope);
            this.filterSettings.keyboard.disconnect(note.filter_keyboard);
            this.lfoPitch.disconnect(note.pitch.gain);
            this.notes.delete(noteNumber);
        }
    }

    /** Immediate reset. Aborts all notes. */
    panic() {
        this.keyStack = [];
        for (let note of this.notes.values()) {
            this.noteAbort(note.noteNumber);
        }
    }

    /** Get main output level in decibels. */
    getMasterVolume(): number {
        return this.masterVolume;
    }

    /** Set main output level in decibels. */
    setMasterVolume(volume: number) {
        this.masterVolume = volume;
        this.masterGain.gain.setValueAtTime(dBToGain(this.masterVolume), this.audioCtx.currentTime);
    }
}
