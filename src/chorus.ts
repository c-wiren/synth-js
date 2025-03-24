export class Chorus {
    private maxDelay = 0.01;
    private delayDepth = 0.004;
    private minDelay = 0.0015;
    private delayRateMode0 = 0.5;
    private delayRateMode1 = 0.8;
    private filterFrequency = 10000;

    private audioCtx: AudioContext;
    private splitter: ChannelSplitterNode;
    private merger: ChannelMergerNode;
    private lfo: OscillatorNode;
    private lfoFilter: BiquadFilterNode;
    private lfoGainLeft: GainNode;
    private lfoGainRight: GainNode;
    private delayLeft: DelayNode;
    private delayRight: DelayNode;
    private filter: BiquadFilterNode;
    private _gain: GainNode;
    private mode: 0 | 1 = 0;

    constructor(audioCtx: AudioContext) {
        this.audioCtx = audioCtx;
        this.splitter = audioCtx.createChannelSplitter(2);
        this.merger = audioCtx.createChannelMerger(2);
        this.delayLeft = audioCtx.createDelay(this.maxDelay);
        this.delayRight = audioCtx.createDelay(this.maxDelay);
        this.lfoGainLeft = audioCtx.createGain();
        this.lfoGainRight = audioCtx.createGain();
        this.filter = audioCtx.createBiquadFilter();
        this._gain = audioCtx.createGain();
        this._gain.gain.value = 0;

        this.filter.type = 'lowpass';
        this.filter.frequency.value = this.filterFrequency;
        this.filter.Q.value = -6;
        this.lfoFilter = audioCtx.createBiquadFilter();
        this.lfoFilter.type = 'lowpass';
        this.lfoFilter.Q.value = -6;
        this.lfoFilter.connect(this.lfoGainLeft);
        this.lfoFilter.connect(this.lfoGainRight);
        this.lfo = audioCtx.createOscillator();
        this.setMode(0);
        this.lfo.type = 'triangle';
        this.lfo.connect(this.lfoFilter);
        this.lfo.start();
        this.lfoGainLeft.gain.value = this.delayDepth / 2;
        this.lfoGainRight.gain.value = -this.delayDepth / 2;
        this.delayLeft.delayTime.value = this.delayDepth / 4 + this.minDelay;
        this.delayRight.delayTime.value = this.delayDepth / 4 + this.minDelay;
        this.lfoGainLeft.connect(this.delayLeft.delayTime);
        this.lfoGainRight.connect(this.delayRight.delayTime);

        this.splitter.connect(this.delayLeft, 0);
        this.splitter.connect(this.delayRight, 1);
        this.delayLeft.connect(this.merger, 0, 0);
        this.delayRight.connect(this.merger, 0, 1);
        this.merger.connect(this.filter);
        this.filter.connect(this._gain);
    }

    disconnect() {
        this._gain.disconnect();
    }

    stop() {
        this.splitter.disconnect();
        this.merger.disconnect();
        this.lfo.stop();
        this.lfo.disconnect();
        this.lfoFilter.disconnect();
        this.lfoGainLeft.disconnect();
        this.lfoGainRight.disconnect();
        this.delayLeft.disconnect();
        this.delayRight.disconnect();
        this.filter.disconnect();
        this._gain.disconnect();
    }

    connect(output: AudioNode) {
        this._gain.connect(output);
    }

    get input(): AudioNode {
        return this.splitter;
    }

    get gain(): AudioParam {
        return this._gain.gain;
    }

    setMode(mode: 0 | 1) {
        if (mode === 0) {
            this.lfo.frequency.setValueAtTime(this.delayRateMode0, this.audioCtx.currentTime);
            this.lfoFilter.frequency.setValueAtTime(this.delayRateMode0 * 20, this.audioCtx.currentTime);
        } else if (mode === 1) {
            this.lfo.frequency.setValueAtTime(this.delayRateMode1, this.audioCtx.currentTime);
            this.lfoFilter.frequency.setValueAtTime(this.delayRateMode1 * 20, this.audioCtx.currentTime);
        }
        else {
            throw new Error('Invalid mode');
        }
        this.mode = mode;
    }

    getMode(): 0 | 1 {
        return this.mode;
    }
}
