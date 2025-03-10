import ExponentialProcessor from "./exponential-processor";

function assert(condition: any, message?: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

type DeepPartial<T> = T extends object ? {
    [P in keyof T]?: DeepPartial<T[P]>;
} : T;

export enum Waveform {
    Sawtooth = 0,
    Square = 1,
    Sine = 2
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
    filter: BiquadFilterNode;           // filter
    filter_cutoff: AudioWorkletNode;    // filter cutoff frequency
    filter_envelope: GainNode;          // filter envelope
    frequency: ConstantSourceNode;      // note frequency
    oscillators: Oscillator[];          // oscillators
}

interface OscillatorSettings {
    on: boolean;                // on/off
    semitones: number;          // transpose in semitones
    fine: number;               // fine tune in cents
    unison: number;             // number of voices
    detune: number;             // unison detune in cents
    pitch: ConstantSourceNode;  // pitch multiplier
    waveform: Waveform;         // waveform
    pwm: number;                // 0-1 for square wave, 0 for regular
}

export interface ADSR {
    attack: number; // seconds
    decay: number; // seconds
    sustain: number; // 0 to 1
    release: number; // seconds
    attackShape: number; // 0 is linear, positive is exponential, negative is logarithmic
    decayShape: number; // 0 is linear, positive is exponential, negative is logarithmic
    releaseShape: number; // 0 is linear, positive is exponential, negative is logarithmic
}

export interface Preset {
    envelopes: {
        amplitude: ADSR; // amplitude envelope
        filter: ADSR;    // filter envelope
    },
    oscillators: {
        on: boolean;        // on/off
        semitones: number;  // transpose in semitones
        fine: number;       // fine tune in cents
        unison: number;     // number of voices
        detune: number;     // unison detune in cents
        waveform: Waveform; // waveform
        pwm: number;        // 0-1 for square wave, 0 for regular
    }[];
    filter: {
        cutoff: number;     // cutoff frequency 0-1, representing 20 Hz to 20 kHz
        resonance: number;  // resonance
        envelope: number;   // filter envelope contribution to cutoff frequency, 0-1
    };
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
}

export function dBToGain(value: number): number {
    return Math.pow(10, value / 20);
}

// Convert an exponential value 0-1 to a frequency between 20 Hz and 20 kHz
export function valueToFrequency(value: number): number {
    return 20 * Math.pow(1000, value);
}

// Convert a frequency between 20 Hz and 20 kHz to an exponential value 0-1
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
    return { on, semitones: 0, fine: 0, unison: 1, detune: 0, pitch: createConstantSource(audioCtx, 1), waveform: Waveform.Sawtooth, pwm: 0 };
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

export class Synth {
    private audioCtx: AudioContext;
    private notes: Map<number, Note>;
    private tuning: number;

    private envelopes: {
        amplitude: ADSR,
        filter: ADSR;
    };

    private oscillatorSettings: OscillatorSettings[];
    private filterSettings: {
        cutoff: ConstantSourceNode; // Hz
        resonance: ConstantSourceNode; // Q
        envelope: ConstantSourceNode; // Hz
    };
    private masterVolume: number; // dB
    private masterGain: GainNode;

    static readonly defaultPreset: Preset = {
        envelopes: {
            amplitude: { attack: 0.001, decay: 5, sustain: 1, release: 0.2, attackShape: 0, decayShape: -2, releaseShape: -5 },
            filter: { attack: 0, decay: 5, sustain: 1, release: 1, attackShape: 0, decayShape: -2, releaseShape: -5 }
        },
        oscillators: [
            { on: true, semitones: 0, fine: 0, unison: 1, detune: 0, waveform: Waveform.Sawtooth, pwm: 0 },
            { on: false, semitones: 0, fine: 0, unison: 1, detune: 0, waveform: Waveform.Sawtooth, pwm: 0 }
        ],
        filter: {
            cutoff: 1.0,
            resonance: 0.5,
            envelope: 0.0
        }
    };

    constructor(audioCtx: AudioContext) {
        this.audioCtx = audioCtx;
        this.notes = new Map();
        this.tuning = 440;
        this.envelopes = Synth.defaultPreset.envelopes;
        this.oscillatorSettings = [];
        this.oscillatorSettings.push(defaultOscillatorSettings(audioCtx, true));
        this.oscillatorSettings.push(defaultOscillatorSettings(audioCtx, false));
        this.filterSettings = {
            cutoff: createConstantSource(audioCtx, Synth.defaultPreset.filter.cutoff),
            resonance: createConstantSource(audioCtx, Synth.defaultPreset.filter.resonance),
            envelope: createConstantSource(audioCtx, Synth.defaultPreset.filter.envelope)
        };
        this.masterVolume = -12; // dB
        this.masterGain = audioCtx.createGain();
        this.setMasterVolume(this.masterVolume);
        this.masterGain.connect(audioCtx.destination);
    }

    // Initialize resources, must be called before playing any notes
    async init(): Promise<void> {
        return loadAudioWorkletProcessor(this.audioCtx, ExponentialProcessor);
    }

    // Apply a preset overwriting the current settings, can be partial
    applyPreset(preset: DeepPartial<Preset>) {
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
                    }
                    if (preset.oscillators[i]!.detune !== undefined) {
                        this.oscillatorSettings[i].detune = preset.oscillators[i]!.detune!;
                    }
                    if (preset.oscillators[i]!.waveform !== undefined) {
                        this.oscillatorSettings[i].waveform = preset.oscillators[i]!.waveform!;
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
        }
    }

    // Export the current settings as a preset
    exportPreset(): Preset {
        return {
            envelopes: {
                amplitude: { ...this.envelopes.amplitude },
                filter: { ...this.envelopes.filter }
            },
            oscillators: this.oscillatorSettings.map(settings => ({
                on: settings.on,
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
                envelope: this.filterSettings.envelope.offset.value
            }
        };
    }

    noteOn(noteNumber: number, velocity: number = 1) {
        if (velocity === 0) {
            this.noteOff(noteNumber);
            return;
        }
        // TODO: This should instead reuse the oscillators
        const gain = this.audioCtx.createGain();
        if (this.envelopes.amplitude.attack > 0) {
            gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
            gain.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(0, velocity, this.envelopes.amplitude.attackShape), this.audioCtx.currentTime, this.envelopes.amplitude.attack);
        } else {
            gain.gain.setValueAtTime(velocity, this.audioCtx.currentTime);
        }
        if (this.envelopes.amplitude.decay > 0) {
            gain.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(velocity, velocity * this.envelopes.amplitude.sustain, this.envelopes.amplitude.decayShape), this.audioCtx.currentTime + this.envelopes.amplitude.attack, this.envelopes.amplitude.decay);
        } else {
            gain.gain.setValueAtTime(velocity * this.envelopes.amplitude.sustain, this.audioCtx.currentTime + this.envelopes.amplitude.attack);
        }
        const frequency = createConstantSource(this.audioCtx, noteNumberToFrequency(noteNumber, this.tuning));
        const oscillators = [];
        for (let settings of this.oscillatorSettings) {
            if (!settings.on) { continue; }
            const voices = [];
            const oscillator_gain = this.audioCtx.createGain();
            oscillator_gain.gain.setValueAtTime(calculateUnisonGain(settings.unison), this.audioCtx.currentTime);
            oscillator_gain.connect(gain);
            const oscillator_frequency = this.audioCtx.createGain();
            oscillator_frequency.gain.setValueAtTime(0, this.audioCtx.currentTime);
            settings.pitch.connect(oscillator_frequency.gain);
            frequency.connect(oscillator_frequency);
            for (let i = 0; i < settings.unison; i++) {
                const panner = this.audioCtx.createStereoPanner();
                panner.pan.setValueAtTime(settings.unison > 1 ? i / (settings.unison - 1) * 2 - 1 : 0, this.audioCtx.currentTime);
                const oscillator = this.audioCtx.createOscillator();
                oscillator.setPeriodicWave(createPeriodicWave(this.audioCtx, settings.waveform, Math.random(), settings.pwm));
                oscillator.frequency.setValueAtTime(0, this.audioCtx.currentTime);
                oscillator_frequency.connect(oscillator.frequency);
                oscillator.detune.setValueAtTime(calculateDetune(settings.unison, i) * settings.detune, this.audioCtx.currentTime);
                oscillator.connect(panner);
                panner.connect(oscillator_gain);
                oscillator.start();
                voices.push({ oscillator, panner });
            }
            oscillators.push({ voices, frequency: oscillator_frequency, gain: oscillator_gain });
        }
        // Node to convert exponential value 0-1 to frequency between 20 Hz and 20 kHz
        let filter_cutoff: AudioWorkletNode;
        try {
            filter_cutoff = new AudioWorkletNode(this.audioCtx, "exponential-processor", { processorOptions: { coefficient: 20, base: 1000 } });
        } catch (error) {
            throw new Error(`Failed to create AudioWorkletNode "exponential-processor". Did you run and await init()?`);
        }
        const filter = this.audioCtx.createBiquadFilter();
        filter.type = "lowpass";
        this.filterSettings.cutoff.connect(filter_cutoff);
        this.filterSettings.resonance.connect(filter.Q);
        const filter_envelope = this.audioCtx.createGain();
        if (this.envelopes.filter.attack > 0) {
            filter_envelope.gain.setValueAtTime(0, this.audioCtx.currentTime);
            filter_envelope.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(0, 1, this.envelopes.filter.attackShape), this.audioCtx.currentTime, this.envelopes.filter.attack);
        } else {
            filter_envelope.gain.setValueAtTime(1, this.audioCtx.currentTime);
        }
        if (this.envelopes.filter.decay > 0) {
            filter_envelope.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(1, this.envelopes.filter.sustain, this.envelopes.filter.decayShape), this.audioCtx.currentTime + this.envelopes.filter.attack, this.envelopes.filter.decay);
        } else {
            filter_envelope.gain.setValueAtTime(this.envelopes.filter.sustain, this.audioCtx.currentTime + this.envelopes.filter.attack);
        }
        this.filterSettings.envelope.connect(filter_envelope);
        filter_envelope.connect(filter_cutoff);
        filter_cutoff.connect(filter.frequency);
        gain.connect(filter);
        filter.connect(this.masterGain);

        this.noteAbort(noteNumber);
        this.notes.set(noteNumber, { noteNumber, gain, filter, filter_cutoff, filter_envelope, frequency, oscillators });
    }

    noteOff(noteNumber: number) {
        const note = this.notes.get(noteNumber);
        if (note) {
            const currentGain = note.gain.gain.value;
            note.gain.gain.cancelScheduledValues(this.audioCtx.currentTime);
            if (this.envelopes.amplitude.release > 0) {
                note.gain.gain.setValueAtTime(currentGain, this.audioCtx.currentTime);
                note.gain.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(currentGain, 0, this.envelopes.filter.releaseShape), this.audioCtx.currentTime, this.envelopes.amplitude.release);
            } else {
                note.gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
            }
            const currentEnvelope = note.filter_envelope.gain.value;
            note.filter_envelope.gain.cancelScheduledValues(this.audioCtx.currentTime);
            if (this.envelopes.filter.release > 0) {
                note.filter_envelope.gain.setValueAtTime(currentEnvelope, this.audioCtx.currentTime);
                note.filter_envelope.gain.setValueCurveAtTime(calculateEnvelopeCurveArray(currentEnvelope, 0, this.envelopes.filter.releaseShape), this.audioCtx.currentTime, this.envelopes.filter.release);
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

    noteAbort(noteNumber: number) {
        const note = this.notes.get(noteNumber);
        if (note) {
            if (note.oscillators.length > 0 && note.oscillators[0].voices.length > 0) {
                // Reset in case of multiple calls
                note.oscillators[0].voices[0].oscillator.onended = null;
            }
            for (let oscillator of note.oscillators) {
                if (oscillator.voices.length > 0) {
                    for (let voice of oscillator.voices) {
                        voice.oscillator.disconnect();
                        voice.panner.disconnect();
                    }
                    note.gain.disconnect();
                    note.filter.disconnect();
                    note.filter_cutoff.disconnect();
                    note.filter_envelope.disconnect();
                    for (let oscillator of note.oscillators) {
                        oscillator.frequency.disconnect();
                        oscillator.gain.disconnect();
                    }
                    note.frequency.disconnect();
                    this.notes.delete(noteNumber);
                }
            }
        }
    }

    panic() {
        for (let note of this.notes.values()) {
            this.noteAbort(note.noteNumber);
        }
    }

    getMasterVolume(): number {
        return this.masterVolume;
    }

    setMasterVolume(volume: number) {
        this.masterVolume = volume;
        this.masterGain.gain.setValueAtTime(dBToGain(this.masterVolume), this.audioCtx.currentTime);
    }
}
