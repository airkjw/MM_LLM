import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const hooks=registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL?.includes('/src/')&&!s.endsWith('.ts')){try{return next(s+'.ts',c)}catch{}}return next(s,c)}});
const {PcmResampler,VoiceAudio}=await import('../src/renderer/src/voice-audio.ts');
const pcm=b=>Array.from({length:b.length/2},(_,i)=>new DataView(b.buffer,b.byteOffset,b.length).getInt16(i*2,true));
test('actual resampler signed16LE clipping, arbitrary context rates and cross-frame fractional remainder match continuous input',()=>{
 for(const rate of [44100,48000,32000,22050])for(const target of [16000,24000]){const samples=Float32Array.from({length:9011},(_,i)=>Math.sin(i/17));const full=new PcmResampler(rate,target).push(samples);const r=new PcmResampler(rate,target);const chunks=[];for(let at=0;at<samples.length;at+=127)chunks.push(r.push(samples.subarray(at,at+127)));const split=Buffer.concat(chunks);assert.equal(split.length,full.length);const a=pcm(full),b=pcm(split);assert.equal(a.every((n,i)=>Math.abs(n-b[i])<=1),true);}
 const r=new PcmResampler(24000,24000),out=pcm(r.push(new Float32Array([-2,-1,0,1,2,0])));assert.deepEqual(out,[-32768,-32768,0,32767,32767]);assert.throws(()=>new PcmResampler(200000,24000));r.clear();
});
test('static packaged worklet emits finite mono frames and stops on unacknowledged backlog',()=>{
 let Processor;const sent=[];class Base{port={onmessage:null,postMessage:e=>sent.push(e)}};vm.runInNewContext(readFileSync('src/renderer/public/voice-capture.js','utf8'),{AudioWorkletProcessor:Base,sampleRate:48000,Float32Array,registerProcessor:(_n,p)=>Processor=p});const processor=new Processor();const block=[new Float32Array(128).fill(1),new Float32Array(128).fill(-1)];for(let n=0;n<38;n++)assert.equal(processor.process([block]),true);assert.equal(sent.length,1);assert.equal(sent[0].samples.length,4800);assert.equal(sent[0].samples.every(v=>v===0),true);let alive=true;for(let n=0;n<38&&alive;n++)alive=processor.process([block]);assert.equal(alive,false);assert.equal(sent.at(-1).type,'overflow');
});
class Track extends EventTarget{enabled=true;stops=0;stop(){this.stops++}}
class Node {connections=0;disconnects=0;connect(){this.connections++}disconnect(){this.disconnects++}}
class Context {static all=[];sampleRate=48000;currentTime=0;destination={};closed=0;audioWorklet={addModule:async()=>{}};sources=[];constructor(){Context.all.push(this)}createMediaStreamSource(){return new Node()}createGain(){return Object.assign(new Node(),{gain:{value:1}})}createBuffer(_channels,n){return{getChannelData:()=>new Float32Array(n)}}createBufferSource(){const n=Object.assign(new Node(),{buffer:null,onended:null,start(t){this.started=t},stop(){this.stopped=true}});this.sources.push(n);return n}async resume(){}async close(){this.closed++}}
class Worklet extends Node{static all=[];port={onmessage:null,postMessage:()=>{},close(){this.closed=true}};constructor(){super();Worklet.all.push(this)}}
let resolveMic;let track;function install(pending=false){Context.all=[];Worklet.all=[];track=new Track();const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>pending?new Promise(r=>resolveMic=()=>r(stream)):stream}}});Object.defineProperty(globalThis,'document',{configurable:true,value:{baseURI:'mmllm://app/index.html'}});globalThis.AudioContext=Context;globalThis.AudioWorkletNode=Worklet;return stream;}
const ID='11111111-1111-4111-8111-111111111111';
test('actual capture cancel before getUserMedia resolution stops new tracks with zero contexts/frames',async()=>{install(true);let frames=0;const a=new VoiceAudio(ID,24000,{frame:async()=>frames++,played:()=>{},failed:()=>{},ended:()=>{}});const p=a.prepare();a.close();resolveMic();await p;assert.equal(track.stops,1);assert.equal(Context.all.length,0);assert.equal(frames,0)});
test('actual AudioContext capture acknowledges single finite frame, mute stops forwarding, input disconnect and close release listeners/context',async()=>{
 install();const frames=[];let failed=0;const a=new VoiceAudio(ID,24000,{frame:async f=>frames.push(f),played:()=>{},failed:()=>failed++,ended:()=>{}});await a.prepare();const w=Worklet.all[0];a.setActive(true);
 w.port.onmessage({data:{samples:new Float32Array(4800)}});await new Promise(r=>setImmediate(r));w.port.onmessage({data:{samples:new Float32Array(4800)}});await new Promise(r=>setImmediate(r));assert.equal(frames.length,2);assert.equal(frames[0].bytes.length,4800);a.mute(true);assert.equal(track.enabled,false);w.port.onmessage({data:{samples:new Float32Array(4800)}});assert.equal(frames.length,2);a.close();assert.equal(track.stops,1);assert.equal(w.port.onmessage,null);assert.equal(w.port.closed,true);assert.equal(Context.all[0].closed,1);assert.equal(failed,0);
});
test('actual ephemeral playback clears queued buffers and reports actual partial played milliseconds on interruption',async()=>{
 install();const played=[];let failed=0;const a=new VoiceAudio(ID,24000,{frame:async()=>{},played:(n,s)=>played.push([n,s]),failed:()=>failed++,ended:()=>{}});await a.prepare();for(let n=1;n<=3;n++)a.play({id:ID,type:'audio',sequence:n,bytes:new Uint8Array(4800),sampleRate:24000,itemId:'item'});
 Context.all[0].currentTime=.135;const ms=a.interrupt('item');assert.equal(ms,135);assert.equal(Context.all[0].sources.every(s=>s.stopped&&s.onended===null&&s.disconnects===1),true);assert.equal(played.length,0);a.close();assert.equal(Context.all[0].closed,1);assert.equal(failed,0);
});
test('actual device track ended closes stream/worklet/context immediately and calls restart explanation hook',async()=>{install();let ended=0;const a=new VoiceAudio(ID,16000,{frame:async()=>{},played:()=>{},failed:()=>{},ended:()=>ended++});await a.prepare();track.dispatchEvent(new Event('ended'));assert.equal(ended,1);assert.equal(track.stops,1);assert.equal(Context.all[0].closed,1);assert.equal(Worklet.all[0].port.onmessage,null);track.dispatchEvent(new Event('ended'));assert.equal(ended,1)});
test.after(()=>hooks.deregister());
