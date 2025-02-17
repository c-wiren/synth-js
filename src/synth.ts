interface ADSR {
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
}

enum Waveform {
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

function createConstantSource(audioCtx: AudioContext, value: number) {
    const constantSource = audioCtx.createConstantSource();
    constantSource.offset.value = value;
    constantSource.start();
    return constantSource;
}

function defaultOscillatorSettings(audioCtx: AudioContext, on: boolean): OscillatorSettings {
    return { on, semitones: 0, fine: 0, unison: 1, detune: 0, pitch: createConstantSource(audioCtx, 1), waveform: Waveform.Sawtooth };
}

class Synth {
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

    constructor(audioCtx: AudioContext) {
        this.audioCtx = audioCtx;
        this.notes = new Map();
        this.tuning = 440;
        this.envelopes = {
            amplitude: { attack: 0.01, decay: 1.0, sustain: 1.0, release: 1.0 },
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
    }

    createPeriodicWave(audioCtx: AudioContext, waveform: Waveform, phase: number = 0) {
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

    semitonesToMultiplier(semitones: number) {
        return Math.pow(2, semitones / 12);
    }

    noteNumberToFrequency(noteNumber: number) {
        return this.tuning * Math.pow(2, (noteNumber - 69) / 12);
    }

    noteOn(noteNumber: number, velocity: number = 1.0) {
        if (velocity === 0) {
            this.noteOff(noteNumber);
            return;
        }
        const gain = this.audioCtx.createGain();
        gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(velocity, this.audioCtx.currentTime + this.envelopes.amplitude.attack);
        gain.gain.exponentialRampToValueAtTime(velocity * this.envelopes.amplitude.sustain, this.audioCtx.currentTime + this.envelopes.amplitude.attack + this.envelopes.amplitude.decay);
        const frequency = createConstantSource(this.audioCtx, this.noteNumberToFrequency(noteNumber));
        const oscillators = [];
        for (let settings of this.oscillatorSettings) {
            if (!settings.on) { continue; }
            const voices = [];
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
                oscillator.detune.setValueAtTime(settings.unison > 1 ? ((i / settings.unison * 2 - 1) * settings.detune) : 0, this.audioCtx.currentTime);
                oscillator.connect(panner);
                panner.connect(gain);
                oscillator.start();
                voices.push({ oscillator, panner });
            }
            oscillators.push({ voices, frequency: oscillator_frequency });
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
        filter.connect(this.audioCtx.destination);

        this.notes.set(noteNumber, { noteNumber, gain, filter, filter_cutoff, filter_envelope, frequency, oscillators });
    }

    noteOff(noteNumber: number) {
        const note = this.notes.get(noteNumber);
        if (note) {
            note.gain.gain.exponentialRampToValueAtTime(1e-6, this.audioCtx.currentTime + this.envelopes.amplitude.release);
            note.gain.gain.setValueAtTime(0, this.audioCtx.currentTime + this.envelopes.amplitude.release);
            note.filter_envelope.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + this.envelopes.filter.release);
            for (let oscillator of note.oscillators) {
                for (let voice of oscillator.voices) {
                    voice.oscillator.stop(this.audioCtx.currentTime + this.envelopes.amplitude.release);
                }
                if (oscillator.voices.length > 0) {
                    oscillator.voices[0].oscillator.onended = () => {
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
                        }
                        note.frequency.disconnect();
                        this.notes.delete(noteNumber);
                    };
                }
            }
        }
    }
}
