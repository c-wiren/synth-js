const ExponentialProcessor = `class ExponentialProcessor extends AudioWorkletProcessor{constructor(e){super(),this.a=e.processorOptions.coefficient,this.b=Math.log(e.processorOptions.base)}process(e,s,o){let t=e[0],r=s[0];for(let n=0;n<r?.length;++n){let c=t[n],i=r[n];for(let l=0;l<c?.length;++l)i[l]=this.a*Math.exp(this.b*c[l])}return!0}}registerProcessor("exponential-processor",ExponentialProcessor);`;
export default ExponentialProcessor;
