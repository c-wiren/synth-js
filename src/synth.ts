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
    noteNumber: number;
    voices: Voice[];
    gain: GainNode;
    filter: BiquadFilterNode;
    filter_cutoff: GainNode;
    filter_envelope: GainNode;
}

interface OscillatorSettings {
    on: boolean; // on/off
    unison: number; // number of voices
    detune: number; // cents
    semitones: number; // transpose
}

function createConstantSource(audioCtx: AudioContext, value: number) {
    const constantSource = audioCtx.createConstantSource();
    constantSource.offset.value = value;
    constantSource.start();
    return constantSource;
}

class Synth {
    audioCtx: AudioContext;
    oscillators: Map<number, Oscillator>;
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

    constructor(audioCtx: AudioContext, numOscillators: number = 2) {
        this.audioCtx = audioCtx;
        this.oscillators = new Map();
        this.tuning = 440;
        this.envelopes = {
            amplitude: { attack: 0.01, decay: 1.0, sustain: 1.0, release: 1.0 },
            filter: { attack: 0.0, decay: 1.0, sustain: 1.0, release: 1.0 }
        };
        this.oscillatorSettings = [];
        for (let i = 0; i < numOscillators; i++) {
            this.oscillatorSettings.push({ on: i === 0, unison: 1, detune: 0, semitones: 0 });
        }
        this.filterSettings = {
            cutoff: createConstantSource(audioCtx, 20000),
            resonance: createConstantSource(audioCtx, 0.5),
            envelope: createConstantSource(audioCtx, 0)
        };
    }

    createSawtooth(audioCtx: AudioContext, phase: number = 0) {
        const size = 1048;
        const real = new Float32Array(size);
        const imag = new Float32Array(size);
        for (let i = 1; i < size; i++) {
            real[i] = Math.cos(phase + Math.PI * i) / i;
            imag[i] = Math.sin(phase + Math.PI * i) / i;
        }
        return audioCtx.createPeriodicWave(real, imag);
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
        const voices = [];
        for (let settings of this.oscillatorSettings) {
            if (!settings.on) { continue; }
            for (let i = 0; i < settings.unison; i++) {
                const panner = this.audioCtx.createStereoPanner();
                panner.pan.setValueAtTime(settings.unison > 1 ? i / (settings.unison - 1) * 2 - 1 : 0, this.audioCtx.currentTime);
                const oscillator = this.audioCtx.createOscillator();
                oscillator.setPeriodicWave(this.createSawtooth(this.audioCtx, Math.random() * Math.PI * 2));
                oscillator.frequency.setValueAtTime(this.noteNumberToFrequency(noteNumber + settings.semitones), this.audioCtx.currentTime);
                oscillator.detune.setValueAtTime(settings.unison > 1 ? ((i / settings.unison * 2 - 1) * settings.detune) : 0, this.audioCtx.currentTime);
                oscillator.connect(panner);
                panner.connect(gain);
                oscillator.start();
                voices.push({ oscillator, panner });
            }
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

        this.oscillators.set(noteNumber, { noteNumber, voices, gain, filter, filter_cutoff, filter_envelope });
    }

    noteOff(noteNumber: number) {
        const oscillator = this.oscillators.get(noteNumber);
        if (oscillator) {
            oscillator.gain.gain.exponentialRampToValueAtTime(1e-6, this.audioCtx.currentTime + this.envelopes.amplitude.release);
            oscillator.gain.gain.setValueAtTime(0, this.audioCtx.currentTime + this.envelopes.amplitude.release);
            oscillator.filter_envelope.gain.exponentialRampToValueAtTime(0, this.audioCtx.currentTime + this.envelopes.filter.release);
            for (let voice of oscillator.voices) {
                voice.oscillator.stop(this.audioCtx.currentTime + this.envelopes.amplitude.release);
            }
            if (oscillator.voices.length > 0) {
                oscillator.voices[0].oscillator.onended = () => {
                    for (let voice of oscillator.voices) {
                        voice.oscillator.disconnect();
                        voice.panner.disconnect();
                    }
                    oscillator.gain.disconnect();
                    oscillator.filter.disconnect();
                    oscillator.filter_cutoff.disconnect();
                    oscillator.filter_envelope.disconnect();
                    this.oscillators.delete(noteNumber);
                };
            }
        }
    }
}
