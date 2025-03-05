type DeepPartial<T> = T extends object ? {
    [P in keyof T]?: DeepPartial<T[P]>;
} : T;

export interface ADSR {
    attack: number; // seconds
    decay: number; // seconds
    sustain: number; // 0 to 1
    release: number; // seconds
}

interface Voice {
    oscillator: OscillatorNode;
    panner: StereoPannerNode;
}

interface Oscillator {
    voices: Voice[];
    frequency: GainNode;
    gain: GainNode;
}

export enum Waveform {
    Sawtooth = 0,
    Square = 1
}

interface Note {
    noteNumber: number;
    gain: GainNode;
    filter: BiquadFilterNode;
    filter_cutoff: GainNode;
    filter_envelope: GainNode;
    frequency: ConstantSourceNode;
    oscillators: Oscillator[];
}

interface OscillatorSettings {
    on: boolean; // on/off
    semitones: number; // transpose in semitones
    fine: number; // fine tune in cents
    unison: number; // number of voices
    detune: number; // unison detune in cents
    pitch: ConstantSourceNode; // transpose
    waveform: Waveform;
}

export interface Preset {
    envelopes: {
        amplitude: ADSR;
        filter: ADSR;
    },
    oscillators: {
        on: boolean;
        semitones: number;
        fine: number;
        unison: number;
        detune: number;
        waveform: Waveform;
    }[];
    filter: {
        cutoff: number;
        resonance: number;
        envelope: number;
    };
}

function dBToGain(value: number): number {
    return Math.pow(10, value / 20);
}

function calculateDetune(unison: number, voice: number) {
    // Asymmetric detune
    const left_gain = 0.9;
    const left_power = 1.22;
    const right_power = 1.2;
    let voice_detune = unison > 1 ? ((voice / unison * 2 - 1)) : 0;
    return voice_detune > 0 ? Math.pow(voice_detune, left_power) * left_gain : -Math.pow(-voice_detune, right_power);
}

function calculateUnisonGain(unison: number) {
    const strength = 0.7;
    return 1 - strength + strength / Math.sqrt(Math.max(unison - 1, 1));
}

function createConstantSource(audioCtx: AudioContext, value: number): ConstantSourceNode {
    const constantSource = audioCtx.createConstantSource();
    constantSource.offset.value = value;
    constantSource.start();
    return constantSource;
}

function defaultOscillatorSettings(audioCtx: AudioContext, on: boolean): OscillatorSettings {
    return { on, semitones: 0, fine: 0, unison: 1, detune: 0, pitch: createConstantSource(audioCtx, 1), waveform: Waveform.Sawtooth };
}

export class Synth {
    audioCtx: AudioContext;
    notes: Map<number, Note>;
    tuning: number;
    envelopes: {
        amplitude: ADSR,
        filter: ADSR;
    };
    oscillatorSettings: OscillatorSettings[];
    filterSettings: {
        cutoff: ConstantSourceNode; // Hz
        resonance: ConstantSourceNode; // Q
        envelope: ConstantSourceNode; // Hz
    };
    masterVolume: number; // dB
    masterGain: GainNode;

    constructor(audioCtx: AudioContext) {
        this.audioCtx = audioCtx;
        this.notes = new Map();
        this.tuning = 440;
        this.envelopes = {
            amplitude: { attack: 0.0, decay: 1.0, sustain: 1.0, release: 1.0 },
            filter: { attack: 0.0, decay: 1.0, sustain: 1.0, release: 1.0 }
        };
        this.oscillatorSettings = [];
        this.oscillatorSettings.push(defaultOscillatorSettings(audioCtx, true));
        this.oscillatorSettings.push(defaultOscillatorSettings(audioCtx, false));
        this.filterSettings = {
            cutoff: createConstantSource(audioCtx, 20000),
            resonance: createConstantSource(audioCtx, 0.5),
            envelope: createConstantSource(audioCtx, 0)
        };
        this.masterVolume = -12; // dB
        this.masterGain = audioCtx.createGain();
        this.masterGain.gain.setValueAtTime(dBToGain(this.masterVolume), audioCtx.currentTime);
        this.masterGain.connect(audioCtx.destination);
    }

    applyPreset(preset: DeepPartial<Preset>) {
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
                        this.oscillatorSettings[i].pitch.offset.setValueAtTime(this.semitonesToMultiplier(this.oscillatorSettings[i].semitones + this.oscillatorSettings[i].fine / 100), this.audioCtx.currentTime);
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
                waveform: settings.waveform
            })),
            filter: {
                cutoff: this.filterSettings.cutoff.offset.value,
                resonance: this.filterSettings.resonance.offset.value,
                envelope: this.filterSettings.envelope.offset.value
            }
        };
    }

    createPeriodicWave(audioCtx: AudioContext, waveform: Waveform, phase: number = 0): PeriodicWave {
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
                for (let i = 1; i < size; i += 2) {
                    const coefficient = 4 / (i * Math.PI);
                    const phaseAngle = phase * 2 * Math.PI;
                    real[i] = -coefficient * Math.sin(i * phaseAngle);
                    imag[i] = coefficient * Math.cos(i * phaseAngle);
                }
                break;
        }
        return audioCtx.createPeriodicWave(real, imag);
    }

    semitonesToMultiplier(semitones: number): number {
        return Math.pow(2, semitones / 12);
    }

    noteNumberToFrequency(noteNumber: number): number {
        return this.tuning * Math.pow(2, (noteNumber - 69) / 12);
    }

    noteOn(noteNumber: number, velocity: number = 1.0) {
        if (velocity === 0) {
            this.noteOff(noteNumber);
            return;
        }
        // TODO: This should instead reuse the oscillators
        const gain = this.audioCtx.createGain();
        gain.gain.setValueAtTime(1e-5, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(velocity, this.audioCtx.currentTime + this.envelopes.amplitude.attack);
        gain.gain.exponentialRampToValueAtTime(velocity * this.envelopes.amplitude.sustain, this.audioCtx.currentTime + this.envelopes.amplitude.attack + this.envelopes.amplitude.decay);
        const frequency = createConstantSource(this.audioCtx, this.noteNumberToFrequency(noteNumber));
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
                oscillator.setPeriodicWave(this.createPeriodicWave(this.audioCtx, settings.waveform, Math.random()));
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
        const filter_cutoff = this.audioCtx.createGain();
        filter_cutoff.gain.setValueAtTime(1, this.audioCtx.currentTime);
        const filter = this.audioCtx.createBiquadFilter();
        filter.type = "lowpass";
        this.filterSettings.cutoff.connect(filter_cutoff);
        this.filterSettings.resonance.connect(filter.Q);
        const filter_envelope = this.audioCtx.createGain();
        filter_envelope.gain.setValueAtTime(0, this.audioCtx.currentTime);
        // TODO: Why does this sound correct with linear?
        filter_envelope.gain.linearRampToValueAtTime(1, this.audioCtx.currentTime + this.envelopes.filter.attack);
        filter_envelope.gain.linearRampToValueAtTime(this.envelopes.filter.sustain, this.audioCtx.currentTime + this.envelopes.filter.attack + this.envelopes.filter.decay);
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
            note.gain.gain.setValueAtTime(currentGain, this.audioCtx.currentTime);
            note.gain.gain.exponentialRampToValueAtTime(1e-5, this.audioCtx.currentTime + this.envelopes.amplitude.release);
            note.gain.gain.setValueAtTime(0, this.audioCtx.currentTime + this.envelopes.amplitude.release);
            const currentEnvelope = note.filter_envelope.gain.value;
            note.filter_envelope.gain.cancelScheduledValues(this.audioCtx.currentTime);
            note.filter_envelope.gain.setValueAtTime(currentEnvelope, this.audioCtx.currentTime);
            note.filter_envelope.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + this.envelopes.filter.release);
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
}
