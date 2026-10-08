import { VOICE_QUEUE_SAMPLES, type VoiceEvent, type VoiceFrame } from '../../shared/realtime';
// Linear streaming resampler carries a fractional source position and the last sample across frames.
// Context sampleRate is authoritative, not the requested getUserMedia/AudioContext rate.
export class PcmResampler {
  private samples: number[] = []; private position = 0;
  readonly inputRate: number; readonly outputRate: 16000 | 24000;
  constructor(inputRate: number, outputRate: 16000 | 24000) {
    this.inputRate=inputRate;this.outputRate=outputRate;
    if(!Number.isFinite(inputRate)||inputRate<8000||inputRate>96000) throw new Error('마이크 샘플 속도를 지원하지 않습니다.');
  }
  push(input: Float32Array): Uint8Array {
    if(input.length>this.inputRate) throw new Error('마이크 프레임이 너무 큽니다.');
    this.samples.push(...input); const output: number[]=[];const step=this.inputRate/this.outputRate;
    while(this.position+1<this.samples.length){const at=Math.floor(this.position),fraction=this.position-at;
      const value=this.samples[at]*(1-fraction)+this.samples[at+1]*fraction;
      const clipped=Math.max(-1,Math.min(1,Number.isFinite(value)?value:0));output.push(Math.round(clipped*(clipped<0?32768:32767)));this.position+=step;}
    const drop=Math.min(Math.floor(this.position),Math.max(0,this.samples.length-1));this.samples.splice(0,drop);this.position-=drop;
    const bytes=new Uint8Array(output.length*2);const view=new DataView(bytes.buffer);
    output.forEach((v,i)=>view.setInt16(i*2,v,true));return bytes;
  }
  clear():void {this.samples=[];this.position=0;}
}
export type VoiceAudioHooks = { frame: (frame:VoiceFrame)=>Promise<void>; played:(sequence:number,samples:number)=>void; failed:()=>void; ended:()=>void };
export class VoiceAudio {
  private stream?: MediaStream; private context?: AudioContext; private source?: MediaStreamAudioSourceNode; private worklet?: AudioWorkletNode; private silence?: GainNode;
  private closed=false; private active=false;private muted=false;private sending=false;private sequence=0;
  private remainder=new Uint8Array();private resampler?:PcmResampler;
  private outputs=new Map<number,{source:AudioBufferSourceNode;start:number;samples:number;itemId?:string}>();private nextAt=0;
  private itemPlayed=new Map<string,number>();
  private id:string;private rate:16000|24000;private hooks:VoiceAudioHooks;
  constructor(id:string,rate:16000|24000,hooks:VoiceAudioHooks) {this.id=id;this.rate=rate;this.hooks=hooks;}
  async prepare():Promise<void> {
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
    if(this.closed){stream.getTracks().forEach(t=>t.stop());return;}
    this.stream=stream;stream.getAudioTracks().forEach(t=>t.addEventListener('ended',this.trackEnded));
    const context=new AudioContext();this.context=context;
    this.resampler=new PcmResampler(context.sampleRate,this.rate);
    await context.audioWorklet.addModule(new URL('./voice-capture.js',document.baseURI).href);
    if(this.closed)return;
    this.source=context.createMediaStreamSource(stream);this.worklet=new AudioWorkletNode(context,'voice-capture');
    this.silence=context.createGain();this.silence.gain.value=0;
    this.worklet.port.onmessage=event=>{
      if(this.closed)return;
      this.worklet?.port.postMessage({ack:true});
      if(event.data?.type==='overflow'||!(event.data?.samples instanceof Float32Array)){this.hooks.failed();return;}
      if(this.active&&!this.muted)this.capture(event.data.samples);
    };
    this.source.connect(this.worklet);this.worklet.connect(this.silence);this.silence.connect(context.destination);
    await context.resume();
  }
  private trackEnded=()=>{if(!this.closed){this.close();this.hooks.ended();}};
  setActive(active:boolean):void{this.active=active;}
  mute(muted:boolean):void {this.muted=muted;this.stream?.getAudioTracks().forEach(t=>{t.enabled=!muted;});this.remainder=new Uint8Array();this.resampler?.clear();}
  private capture(samples:Float32Array):void {
    try {
      const bytes=this.resampler!.push(samples);const combined=new Uint8Array(this.remainder.length+bytes.length);combined.set(this.remainder);combined.set(bytes,this.remainder.length);
      const size=this.rate/10*2;let at=0;
      while(combined.length-at>=size){
        if(this.sending)throw new Error('음성 전송 지연');this.sending=true;
        void this.hooks.frame({id:this.id,sequence:++this.sequence,format:'pcm_s16le',sampleRate:this.rate,channels:1,bytes:combined.slice(at,at+size)})
          .catch(()=>{if(!this.closed)this.hooks.failed();}).finally(()=>{this.sending=false;});at+=size;
      }
      this.remainder=combined.slice(at);
    }catch {this.hooks.failed();}
  }
  play(event:Extract<VoiceEvent,{type:'audio'}>):void {
    if(this.closed||!this.context)return;
    try {
      if(!(event.bytes instanceof Uint8Array)||event.bytes.length%2||event.bytes.length>24000||event.sampleRate!==24000||this.outputs.has(event.sequence))throw new Error();
      if([...this.outputs.values()].reduce((n,v)=>n+v.samples,0)+event.bytes.length/2>VOICE_QUEUE_SAMPLES)throw new Error();
      const context=this.context;const buffer=context.createBuffer(1,event.bytes.length/2,24000);const data=buffer.getChannelData(0);const view=new DataView(event.bytes.buffer,event.bytes.byteOffset,event.bytes.byteLength);
      for(let i=0;i<data.length;i++){const n=view.getInt16(i*2,true);data[i]=n/(n<0?32768:32767);}
      const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);
      const start=Math.max(context.currentTime,this.nextAt);this.nextAt=start+data.length/24000;
      this.outputs.set(event.sequence,{source,start,samples:data.length,itemId:event.itemId});
      source.onended=()=>{const entry=this.outputs.get(event.sequence);if(!entry)return;this.outputs.delete(event.sequence);source.disconnect();source.onended=null;
        if(entry.itemId){this.itemPlayed.set(entry.itemId,(this.itemPlayed.get(entry.itemId)??0)+entry.samples);if(this.itemPlayed.size>128)this.itemPlayed.delete(this.itemPlayed.keys().next().value!);}
        this.hooks.played(event.sequence,entry.samples);
      };source.start(start);
    } catch {this.hooks.failed();}
  }
  interrupt(itemId?:string):number {
    let samples=itemId?this.itemPlayed.get(itemId)??0:0;const now=this.context?.currentTime??0;
    for(const [sequence,entry] of this.outputs){const played=Math.max(0,Math.min(entry.samples,Math.floor((now-entry.start)*24000)));
      if(entry.itemId===itemId)samples+=played;entry.source.onended=null;entry.source.stop();entry.source.disconnect();this.outputs.delete(sequence);}
    this.nextAt=now;this.itemPlayed.clear();return Math.floor(samples/24);
  }
  stopInput():void {
    this.active=false;this.stream?.getAudioTracks().forEach(t=>{t.removeEventListener('ended',this.trackEnded);t.stop();});this.stream=undefined;
    if(this.worklet){this.worklet.port.onmessage=null;this.worklet.port.close();this.worklet.disconnect();this.worklet=undefined;}
    this.source?.disconnect();this.source=undefined;this.silence?.disconnect();this.silence=undefined;
    this.remainder=new Uint8Array();this.resampler?.clear();
  }
  close():void {if(this.closed)return;this.closed=true;this.stopInput();this.interrupt();const context=this.context;this.context=undefined;void context?.close().catch(()=>{});}
}
