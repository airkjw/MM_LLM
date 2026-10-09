import assert from 'node:assert/strict';
import test, {before,afterEach} from 'node:test';
import {Window} from 'happy-dom';
import * as React from 'react';
import type {Root} from 'react-dom/client';
const {act}=React;const browser=new Window({url:'https://mm-llm.local/'});browser.document.write('<!doctype html><html><body></body></html>');
for(const [name,value] of Object.entries({window:browser,document:browser.document,navigator:browser.navigator,Node:browser.Node,Element:browser.Element,HTMLElement:browser.HTMLElement,HTMLButtonElement:browser.HTMLButtonElement,Event:browser.Event,KeyboardEvent:browser.KeyboardEvent,MouseEvent:browser.MouseEvent,MutationObserver:browser.MutationObserver,ResizeObserver:browser.ResizeObserver,IntersectionObserver:browser.IntersectionObserver,getComputedStyle:browser.getComputedStyle}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});globalThis.requestAnimationFrame=(cb)=>setTimeout(()=>cb(Date.now()),0) as any;globalThis.cancelAnimationFrame=id=>clearTimeout(id);browser.requestAnimationFrame=globalThis.requestAnimationFrame;browser.cancelAnimationFrame=globalThis.cancelAnimationFrame;
let createRoot:typeof import('react-dom/client')['createRoot'],VoicePanel:typeof import('../src/renderer/src/VoicePanel')['VoicePanel'],App:typeof import('../src/renderer/src/App')['default'],ConfirmProvider:typeof import('../src/renderer/src/components/ConfirmDialog')['ConfirmProvider'];
let root:Root|null=null,host:HTMLDivElement|null=null;
class Track extends browser.EventTarget{enabled=true;stops=0;stop(){this.stops++}}
class AudioNode{disconnects=0;connect(){}disconnect(){this.disconnects++}}
class Context{static all:Context[]=[];sampleRate=48000;currentTime=0;destination={};closed=0;buffers:any[]=[];audioWorklet={addModule:async(url:string)=>{assert.match(url,/voice-capture\.js$/)}};constructor(){Context.all.push(this)}createMediaStreamSource(){return new AudioNode()}createGain(){return Object.assign(new AudioNode(),{gain:{value:1}})}async resume(){}async close(){this.closed++}createBuffer(_c:number,n:number){return{getChannelData:()=>new Float32Array(n)}}createBufferSource(){const s=Object.assign(new AudioNode(),{buffer:null,onended:null,stop(){this.stopped=true},start(){},stopped:false});this.buffers.push(s);return s}}
class Worklet extends AudioNode{static all:Worklet[]=[];port={onmessage:null as any,postMessage(){},closed:false,close(){this.closed=true}};constructor(){super();Worklet.all.push(this)}}
const now='2026-10-08T00:00:00Z';const thread={id:'voice-thread',title:'Synthetic',modelId:'gpt-6-astra',createdAt:now,updatedAt:now,webSearchMode:'off' as const,reasoningMode:'auto' as const,instruction:'',advanced:{},attachmentConsent:false,messages:[],messageCount:0};
const models=[{id:'gpt-6-astra',type:'llm' as const},{id:'gpt-realtime-2.1-mini',type:'realtime' as const},{id:'gemini-3.8-live',type:'realtime' as const},{id:'gpt-unknown',type:'realtime' as const},{id:'stt-rt-v5',type:'audio' as const}];
before(async()=>{({createRoot}=await import('react-dom/client'));({VoicePanel}=await import('../src/renderer/src/VoicePanel'));({default:App}=await import('../src/renderer/src/App'));({ConfirmProvider}=await import('../src/renderer/src/components/ConfirmDialog'));});
async function render(ui:React.ReactNode){if(!host){host=document.createElement('div');document.body.append(host);root=createRoot(host)}await act(async()=>root!.render(ui));await flush()}
async function flush(){await act(async()=>{await new Promise(r=>setTimeout(r,10))})}
async function click(e:Element){await act(async()=>{(e as HTMLElement).focus();(e as HTMLElement).click()});await flush()}
async function select(e:HTMLSelectElement,value:string){await act(async()=>{e.value=value;e.dispatchEvent(new browser.Event('change',{bubbles:true}))});await flush()}
const button=(s:string)=>[...document.querySelectorAll<HTMLButtonElement>('.voice-panel button')].find(b=>b.textContent===s)!;
function fixture(options:{pending?:boolean;denied?:boolean}={}){Context.all=[];Worklet.all=[];const track=new Track();let resolve:()=>void=()=>{};let listener:(e:any)=>void=()=>{};const counts={mic:0,prepare:0,connect:0,stop:0,sub:0,frames:0,save:0,apply:0,control:0,streams:0,logout:0};let id='';let applied='';const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
 Object.defineProperty(browser.navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async(request:any)=>{assert.equal(request.video,false);counts.mic++;if(options.denied)throw new Error('synthetic permission denied');if(options.pending)return new Promise(r=>resolve=()=>r(stream));return stream}}});
 Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:Context});Object.defineProperty(globalThis,'AudioWorkletNode',{configurable:true,value:Worklet});
 const emit=(e:any)=>listener({id,...e});const api={prepareVoice:async(r:any)=>{counts.prepare++;id=r.id;emit({type:'state',state:'requesting_permission'})},connectVoice:async()=>{counts.connect++;emit({type:'state',state:'active'})},stopVoice:async(_id:string,immediate:boolean)=>{counts.stop++;if(immediate||!options.pending)emit({type:'state',state:'closed'})},sendVoiceFrame:async()=>{counts.frames++},controlVoice:async()=>{counts.control++},onVoiceEvent:(cb:any)=>{listener=cb;counts.sub++;return()=>{counts.sub--}},saveVoiceText:async()=>{counts.save++;return {...thread}},
  getSession:async()=>({authenticated:true,models,credits:{total:{remaining:1000}}}),getSettings:async()=>({theme:'light',fontSize:'medium',defaultInstruction:''}),setThemePreference:async()=>{},listThreads:async()=>[thread],loadThread:async()=>thread,listProjects:async()=>[],listBackgroundResponses:async()=>[],getUpdateState:async()=>({status:'idle',currentVersion:'0.5.1'}),onUpdateChanged:()=>()=>{},onThemeResolved:()=>()=>{},discardAttachments:async()=>{},getCredits:async()=>({total:{remaining:1000}}),streamChat:()=>{counts.streams++;return()=>{}},logout:async()=>{counts.logout++;emit({type:'state',state:'closed'})},cancelLogin:async()=>false};Object.assign(browser,{mmllm:api});
 return {track,counts,resolve:()=>resolve(),emit,api,onApply:(text:string)=>{counts.apply++;applied=text},applied:()=>applied};}
async function panel(f:ReturnType<typeof fixture>){await render(<VoicePanel models={models} threadId={thread.id} canApply onApply={f.onApply} onSaved={()=>{}} onUsageChanged={()=>{}}/>);await act(async()=>{document.querySelector('details')!.open=true});await flush()}
async function start(){await click(document.querySelector('[aria-label="음성 외부 전송과 과금 동의"]')!);await click(button('시작'))}
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=null;host?.remove();host=null;});
test('actual VoicePanel dedicated catalog/consent and mode changes make no network; double Start uses one request and mic with accessible status',async()=>{
 const f=fixture();await panel(f);assert.equal(button('시작').disabled,true);const picker=document.querySelector<HTMLSelectElement>('[aria-label="실시간 음성 모델"]')!;assert.deepEqual([...picker.options].map(o=>o.value),['gpt-realtime-2.1-mini','gemini-3.8-live']);await select(picker,'gemini-3.8-live');assert.equal(f.counts.prepare,0);await click(document.querySelector('[aria-label="음성 외부 전송과 과금 동의"]')!);await act(async()=>{button('시작').click();button('시작').click()});await flush();assert.equal(f.counts.prepare,1);assert.equal(f.counts.connect,1);assert.equal(f.counts.mic,1);assert.match(document.querySelector('.voice-actions [role="status"]')!.textContent!,/마이크 사용 중.*마이크 켜짐/);assert.match(document.body.textContent!,/1분.*예약.*실제 사용량.*음소거는 과금 종료가 아닙니다/);await click(button('음소거'));assert.equal(f.track.enabled,false);assert.equal(button('마이크 다시 켜기').getAttribute('aria-pressed'),'true');await click(button('종료'));assert.equal(f.track.stops,1);assert.equal(Context.all[0].closed,1);assert.equal(Worklet.all[0].port.onmessage,null);assert.equal(f.counts.sub,0);
});
test('actual VoicePanel permission denial performs no mint/audio, and cancel/unmount before delayed getUserMedia immediately releases late track',async()=>{
 const denied=fixture({denied:true});await panel(denied);await start();assert.equal(denied.counts.connect,0);assert.equal(denied.counts.frames,0);assert.equal(denied.counts.sub,0);assert.match(document.querySelector('[role="alert"]')!.textContent!,/권한.*거부/);
 await render(<></>);const f=fixture({pending:true});await panel(f);await start();assert.equal(f.counts.mic,1);await click(button('종료'));await act(async()=>{f.emit({type:'state',state:'closed'});f.resolve()});await flush();assert.equal(f.counts.connect,0);assert.equal(f.track.stops,1);assert.equal(Context.all.length,0);assert.equal(f.counts.sub,0);
 await render(<></>);const g=fixture({pending:true});await panel(g);await start();await render(<></>);await act(async()=>g.resolve());await flush();assert.equal(g.track.stops,1);assert.equal(g.counts.connect,0);assert.equal(g.counts.sub,0);
});
test('actual voice interruption stops scheduled playback, track ended and view collapse clean mic/context/listener',async()=>{
 const f=fixture();await panel(f);await start();await act(async()=>f.emit({type:'audio',sequence:1,sampleRate:24000,bytes:new Uint8Array(4800),itemId:'item'}));Context.all[0].currentTime=.04;await act(async()=>f.emit({type:'interrupt',interruption:1,itemId:'item'}));assert.equal(Context.all[0].buffers[0].stopped,true);assert.equal(f.counts.control,1);await act(async()=>f.track.dispatchEvent(new Event('ended')));assert.equal(f.track.stops,1);assert.equal(Context.all[0].closed,1);assert.equal(f.counts.sub,0);assert.match(document.querySelector('[role="alert"]')!.textContent!,/장치.*다시 시작/);
 await render(<></>);const g=fixture();await panel(g);await start();await act(async()=>{document.querySelector('details')!.open=false});await flush();assert.equal(g.track.stops,1);assert.equal(Context.all[0].closed,1);assert.equal(g.counts.sub,0);
});
test('actual dictation finite preview needs closed final and explicit apply; conversation text save opt-in defaults off',async()=>{
 const f=fixture();await panel(f);await select(document.querySelector('[aria-label="음성 용도"]')!,'dictation');assert.equal(f.counts.prepare,0);assert.match(document.body.textContent!,/Sonioxには|Soniox에는 필터가 없습니다/);await start();await act(async()=>f.emit({type:'text',final:'synthetic final',provisional:'temporary'}));assert.equal(button('확정문을 초안에 추가').disabled,true);await click(button('종료'));await click(button('확정문을 초안에 추가'));assert.equal(f.counts.apply,1);assert.equal(f.applied(),'synthetic final');assert.equal(f.counts.streams,0);assert.equal(f.counts.save,0);
 await render(<></>);const g=fixture();await panel(g);await start();await act(async()=>g.emit({type:'text',final:'voice text',provisional:''}));await click(button('종료'));assert.equal(button('텍스트 저장').disabled,true);assert.equal(g.counts.save,0);await click(document.querySelector('[aria-label="음성 텍스트 암호화 저장 동의"]')!);await click(button('텍스트 저장'));assert.equal(g.counts.save,1);
});
test('actual App applies dictation final after existing composer draft without autosend and logout unmounts all audio',async()=>{
 const f=fixture();await render(<ConfirmProvider><App/></ConfirmProvider>);await act(async()=>{document.querySelector<HTMLDetailsElement>('.voice-panel')!.open=true});await flush();const input=document.querySelector<HTMLTextAreaElement>('.composer-input')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'existing draft');input.dispatchEvent(new browser.Event('input',{bubbles:true}))});await select(document.querySelector('[aria-label="음성 용도"]')!,'dictation');await start();await act(async()=>f.emit({type:'text',final:'accepted dictation',provisional:'not final'}));await click(button('종료'));await click(button('확정문을 초안에 추가'));assert.equal(document.querySelector<HTMLTextAreaElement>('.composer-input')!.value,'existing draft\n\naccepted dictation');assert.equal(f.counts.streams,0);
 await click(button('시작'));assert.equal(f.counts.connect,2);await click(document.querySelector('.account-trigger')!);await click(document.querySelector('.logout-action')!);assert.equal(f.counts.logout,1);assert.equal(f.counts.sub,0);assert.equal(f.track.stops,2);assert.equal(Context.all.every(c=>c.closed===1),true);assert.equal(document.querySelector('.voice-panel'),null);
});
test('actual panel keyboard focus, narrow portrait and both themes retain native controls and session cleanup on unmount',async()=>{
 for(const theme of ['light','dark']){const f=fixture();document.documentElement.dataset.theme=theme;browser.innerWidth=680;browser.innerHeight=820;await panel(f);const summary=document.querySelector('summary')!;(summary as HTMLElement).focus();assert.equal(document.activeElement,summary);await start();button('음소거').focus();assert.equal(document.activeElement,button('음소거'));assert.equal(document.querySelectorAll('.voice-panel select').length,2);assert.equal(document.querySelector('[aria-label="음성 외부 전송과 과금 동의"]')!.tagName,'INPUT');await render(<></>);assert.equal(f.track.stops,1);assert.equal(Context.all[0].closed,1);assert.equal(f.counts.sub,0);}
});

test('actual voice save double click issues one save request',async()=>{
 const f=fixture();await panel(f);await start();await act(async()=>f.emit({type:'text',final:'synthetic text',provisional:''}));await click(button('종료'));
 await click(document.querySelector('[aria-label="음성 텍스트 암호화 저장 동의"]')!);
 let resolveSave:any;const pending=new Promise<any>(r=>resolveSave=r);f.api.saveVoiceText=async()=>{f.counts.save++;return pending};
 try{await act(async()=>{button('텍스트 저장').click();button('텍스트 저장').click()});assert.equal(f.counts.save,1)}
 finally{await act(async()=>resolveSave({...thread}));await flush()}
});
test('actual voice deferred saved state never belongs to a new session',async()=>{
 const f=fixture();await panel(f);await start();await act(async()=>f.emit({type:'text',final:'synthetic first text',provisional:''}));await click(button('종료'));
 await click(document.querySelector('[aria-label="음성 텍스트 암호화 저장 동의"]')!);
 let resolveSave:any;const pending=new Promise<any>(r=>resolveSave=r);f.api.saveVoiceText=async()=>{f.counts.save++;return pending};
 await click(button('텍스트 저장'));const prevented=button('시작').disabled;
 if(!prevented)await click(button('시작'));
 await act(async()=>resolveSave({...thread}));await flush();
 if(prevented)await click(button('시작'));
 assert.equal(f.counts.connect,2);assert.doesNotMatch(document.body.textContent!,/텍스트 저장됨/);
});
function deferredSave(){let resolve!:(value:typeof thread)=>void, reject!:(error:Error)=>void;const promise=new Promise<typeof thread>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject};}
async function readyToSave(f:ReturnType<typeof fixture>){const consent=document.querySelector<HTMLInputElement>('[aria-label="음성 외부 전송과 과금 동의"]')!;if(!consent.checked)await click(consent);await click(button('시작'));await act(async()=>f.emit({type:'text',final:'synthetic save text',provisional:''}));await click(button('종료'));await click(document.querySelector('[aria-label="음성 텍스트 암호화 저장 동의"]')!);}
test('actual failed voice save restores explicit retry and successful save remains single use',async()=>{
 const f=fixture();await panel(f);await readyToSave(f);let applied=0;
 await render(<VoicePanel models={models} threadId={thread.id} canApply onApply={f.onApply} onSaved={()=>applied++} onUsageChanged={()=>{}}/>);
 f.api.saveVoiceText=async()=>{f.counts.save++;if(f.counts.save===1)throw new Error('synthetic target failure');return{...thread}};
 await click(button('텍스트 저장'));assert.equal(f.counts.save,1);assert.equal(applied,0);assert.equal(button('텍스트 저장').disabled,false);assert.match(document.body.textContent!,/저장하지 못했습니다/);
 await act(async()=>{button('텍스트 저장').click();button('텍스트 저장').click()});await flush();assert.equal(f.counts.save,2);assert.equal(applied,1);assert.equal(button('텍스트 저장됨').disabled,true);
});
test('actual pending save synchronously blocks same-batch Start, model and mode changes and exposes disabled controls in both themes',async()=>{
 for(const theme of ['light','dark']){
  document.documentElement.dataset.theme=theme;browser.innerWidth=680;browser.innerHeight=820;
  const f=fixture();await panel(f);await readyToSave(f);const pending=deferredSave();f.api.saveVoiceText=async()=>{f.counts.save++;return pending.promise};
  const mode=document.querySelector<HTMLSelectElement>('[aria-label="음성 용도"]')!,model=document.querySelector<HTMLSelectElement>('[aria-label="실시간 음성 모델"]')!;
  await act(async()=>{button('텍스트 저장').focus();button('텍스트 저장').click();button('시작').click();mode.value='dictation';mode.dispatchEvent(new browser.Event('change',{bubbles:true}));model.value='gemini-3.8-live';model.dispatchEvent(new browser.Event('change',{bubbles:true}));});
  assert.equal(f.counts.save,1);assert.equal(f.counts.prepare,1);assert.equal(f.counts.connect,1);assert.equal(f.counts.mic,1);
  assert.equal(mode.value,'conversation');assert.equal(model.value,'gpt-realtime-2.1-mini');assert.equal(mode.disabled,true);assert.equal(model.disabled,true);assert.equal(button('시작').disabled,true);
  assert.equal(document.activeElement,button('텍스트 저장'));
  await act(async()=>pending.resolve({...thread}));await flush();assert.equal(button('시작').disabled,false);await click(button('시작'));assert.equal(f.counts.connect,2);assert.doesNotMatch(document.body.textContent!,/텍스트 저장됨/);await render(<></>);
 }
});
test('actual collapsed session drops old save success or failure without clearing a replacement pending save',async()=>{
 for(const outcome of ['success','failure']){
  const f=fixture();let applied=0;await panel(f);await readyToSave(f);
  await render(<VoicePanel models={models} threadId={thread.id} canApply onApply={f.onApply} onSaved={()=>applied++} onUsageChanged={()=>{}}/>);
  const old=deferredSave(),current=deferredSave();f.api.saveVoiceText=async()=>{f.counts.save++;return f.counts.save===1?old.promise:current.promise};
  await click(button('텍스트 저장'));await act(async()=>{document.querySelector('details')!.open=false});await flush();await act(async()=>{document.querySelector('details')!.open=true});await flush();
  await readyToSave(f);await click(button('텍스트 저장'));assert.equal(f.counts.save,2);
  await act(async()=>{if(outcome==='success')old.resolve({...thread});else old.reject(new Error('synthetic stale failure'))});await flush();
  assert.equal(applied,0);assert.doesNotMatch(document.body.textContent!,/텍스트 저장됨|저장하지 못했습니다/);assert.equal(button('시작').disabled,true);assert.equal(button('텍스트 저장').disabled,true);
  await act(async()=>current.resolve({...thread}));await flush();assert.equal(applied,1);assert.equal(button('텍스트 저장됨').disabled,true);await render(<></>);
 }
});
test('actual target replacement or unmount rejects stale save callbacks and saved state',async()=>{
 for(const change of ['target','unmount'])for(const outcome of ['success','failure']){
  const f=fixture();let applied=0;await panel(f);await readyToSave(f);
  const ui=(target:string)=><VoicePanel models={models} threadId={target} canApply onApply={f.onApply} onSaved={()=>applied++} onUsageChanged={()=>{}}/>;
  await render(ui(thread.id));const pending=deferredSave();f.api.saveVoiceText=async()=>{f.counts.save++;return pending.promise};await click(button('텍스트 저장'));
  if(change==='target')await render(ui('synthetic-new-target'));else{await render(<></>);await render(ui(thread.id));}
  await act(async()=>{if(outcome==='success')pending.resolve({...thread});else pending.reject(new Error('synthetic stale failure'))});await flush();
  assert.equal(applied,0);assert.doesNotMatch(document.body.textContent!,/텍스트 저장됨|저장하지 못했습니다/);await readyToSave(f);assert.equal(f.counts.connect,2);assert.equal(button('텍스트 저장').disabled,false);await render(<></>);
 }
});
test('actual App logout during deferred voice save unmounts the owner before its response returns',async()=>{
 browser.innerWidth=1024;browser.innerHeight=900;
 const f=fixture();await render(<ConfirmProvider><App/></ConfirmProvider>);await act(async()=>{document.querySelector<HTMLDetailsElement>('.voice-panel')!.open=true});await flush();await readyToSave(f);
 const pending=deferredSave();f.api.saveVoiceText=async()=>{f.counts.save++;return pending.promise};await click(button('텍스트 저장'));
 await click(document.querySelector('.account-trigger')!);await click(document.querySelector('.logout-action')!);assert.equal(f.counts.logout,1);assert.equal(document.querySelector('.voice-panel'),null);
 await act(async()=>pending.resolve({...thread}));await flush();assert.equal(document.querySelector('.voice-panel'),null);assert.doesNotMatch(document.body.textContent!,/텍스트 저장됨/);
});

function delayed(){let reject!:(error:Error)=>void,resolve!:(value:any)=>void;const promise=new Promise<any>((yes,no)=>{reject=no;resolve=yes});return{promise,reject,resolve};}
async function startAgain(){await click(button('시작'));}
for(const type of ['played','interrupted','mute','stop'])test(`registered late old ${type} IPC rejection cannot end explicit replacement session`,async()=>{
 const f=fixture();await panel(f);await start();const pending=delayed();let sent=false;
 f.api.controlVoice=async(control:any)=>{f.counts.control++;if(control.type===type&&!sent){sent=true;return pending.promise}};
 if(type==='played'){
  await act(async()=>f.emit({type:'audio',sequence:1,sampleRate:24000,bytes:new Uint8Array(4800),itemId:'synthetic-item'}));
  await act(async()=>{Context.all[0].currentTime=.1;Context.all[0].buffers[0].onended()});
 }
 if(type==='interrupted'){
  await act(async()=>f.emit({type:'audio',sequence:1,sampleRate:24000,bytes:new Uint8Array(4800),itemId:'synthetic-item'}));
  await act(async()=>f.emit({type:'interrupt',interruption:1,itemId:'synthetic-item'}));
 }
 if(type==='mute')await click(button('음소거'));
 if(type==='stop'){
  f.api.stopVoice=async(_id:string,immediate:boolean)=>{f.counts.stop++;if(!immediate&&!sent){sent=true;f.emit({type:'state',state:'closed'});return pending.promise}};
  await click(button('종료'));
 }else await act(async()=>f.emit({type:'state',state:'closed'}));
 assert.equal(sent,true);await startAgain();assert.equal(f.counts.connect,2);assert.equal(Context.all[1].closed,0);
 await act(async()=>pending.reject(new Error('synthetic delayed old IPC rejection')));await flush();
 console.log('OLD_IPC_REJECTION',JSON.stringify({type,secondContextClosed:Context.all[1].closed,secondTrackStops:f.track.stops,state:document.querySelector('.voice-actions [role="status"]')?.textContent,error:document.querySelector('[role="alert"]')?.textContent}));
 assert.equal(Context.all[1].closed,0,'late previous-session rejection disposed the current session');assert.match(document.querySelector('.voice-actions [role="status"]')!.textContent!,/마이크 사용 중/);assert.equal(f.counts.sub,1);
});
test('registered actual voice status visibly distinguishes listening, thinking, responding alongside microphone state',async()=>{
 const f=fixture();await panel(f);await start();const observed:Record<string,string>={};for(const activity of ['listening','thinking','responding']){await act(async()=>f.emit({type:'activity',activity}));observed[activity]=document.querySelector('.voice-actions [role="status"]')!.textContent!;}
 console.log('VOICE_ACTIVITY_RENDERING',JSON.stringify(observed));assert.match(observed.thinking,/생각 중/);assert.match(observed.responding,/응답 중/);assert.match(observed.listening,/듣는 중/);
});


test('registered collapsed completed conversation must not offer Save after actual main IPC discarded its claim',{timeout:10000},async()=>{
 const {fork}=await import('node:child_process');const {once}=await import('node:events');const f=fixture();const child=fork('tests/fixtures/realtime-main-child.mjs',[],{execArgv:[],stdio:['ignore','pipe','pipe','ipc']});child.stdout?.on('data',b=>process.stdout.write(b));child.stderr?.on('data',b=>process.stderr.write(b));
 let seq=0;const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();let readyResolve!:(value:any)=>void,readyReject!:(e:Error)=>void;const ready=new Promise<any>((yes,no)=>{readyResolve=yes;readyReject=no});
 child.on('error',readyReject);child.on('message',(r:any)=>{if(r.kind==='ready')readyResolve(r.target);if(r.kind==='event')f.emit(r.event);if(r.kind==='response'){const p=pending.get(r.seq);pending.delete(r.seq);if(r.error)p?.reject(new Error(r.error));else p?.resolve(r.value)}});
 const invoke=(name:string,...args:any[])=>new Promise<any>((resolve,reject)=>{const n=++seq;pending.set(n,{resolve,reject});child.send({kind:'invoke',name,args,seq:n})});
 let target:any;
 try{target=await ready;
  f.api.prepareVoice=async(r:any)=>{f.counts.prepare++;return invoke('voice:prepare',r)};
  f.api.connectVoice=async(id:string)=>{f.counts.connect++;return invoke('voice:connect',id)};
  f.api.controlVoice=async(r:any)=>invoke('voice:control',r);f.api.sendVoiceFrame=async(r:any)=>invoke('voice:frame',r);
  f.api.stopVoice=async(id:string,immediate:boolean)=>{f.counts.stop++;return invoke('voice:stop',id,immediate)};
  f.api.saveVoiceText=async(id:string,threadId:string,consent:boolean)=>{f.counts.save++;return invoke('voice:save-text',id,threadId,consent)};
  await render(<VoicePanel models={models} threadId={target.id} canApply onApply={f.onApply} onSaved={()=>{}} onUsageChanged={()=>{}}/>);await act(async()=>{document.querySelector('details')!.open=true});await flush();await start();
  await act(async()=>invoke('fixture:transcript'));await flush();await click(button('종료'));await click(document.querySelector('[aria-label="음성 텍스트 암호화 저장 동의"]')!);assert.equal(button('텍스트 저장').disabled,false);assert.equal((await invoke('inspect')).hasCompleted,true);
  await act(async()=>{document.querySelector('details')!.open=false});await flush();await act(async()=>{document.querySelector('details')!.open=true});await flush();const discarded=await invoke('inspect');assert.equal(discarded.hasCompleted,false);const enabled=!button('텍스트 저장').disabled;
  if(enabled)await click(button('텍스트 저장'));const observed=await invoke('inspect');console.log('COLLAPSED_COMPLETED_SAVE_ACTUAL_MAIN',JSON.stringify({enabledAfterDiscard:enabled,hasCompleted:observed.hasCompleted,saveCalls:f.counts.save,storedMessages:observed.thread.messages.length,error:document.body.textContent?.includes('저장하지 못했습니다')}));
  assert.equal(enabled,false,'reopened conversation offers Save for a claim already discarded by actual main');
 }finally{await render(<></>);const exited=once(child,'exit');child.send({kind:'quit',seq:++seq});await exited;}
});


test('registered still-owned control/stop/audio failures close resources, show an error and allow explicit restart',async()=>{
 for(const type of ['played','interrupted','mute','stop','frame']){
  const f=fixture();await panel(f);await start();
  f.api.controlVoice=async(control:any)=>{if(control.type===type)throw new Error('synthetic owned control rejection')};
  if(type==='played'||type==='interrupted')await act(async()=>f.emit({type:'audio',sequence:1,sampleRate:24000,bytes:new Uint8Array(4800),itemId:'owned'}));
  if(type==='played')await act(async()=>{Context.all[0].currentTime=.1;Context.all[0].buffers[0].onended()});
  if(type==='interrupted')await act(async()=>f.emit({type:'interrupt',interruption:1,itemId:'owned'}));
  if(type==='mute')await click(button('음소거'));
  if(type==='stop'){f.api.stopVoice=async(_id:string,immediate:boolean)=>{if(!immediate)throw new Error('synthetic owned stop rejection')};await click(button('종료'))}
  if(type==='frame'){f.api.sendVoiceFrame=async()=>{throw new Error('synthetic owned frame rejection')};await act(async()=>Worklet.all[0].port.onmessage({data:{samples:new Float32Array(4801)}}))}
  await flush();assert.equal(Context.all[0].closed,1);assert.equal(f.track.stops,1);assert.equal(f.counts.sub,0);assert.ok(document.querySelector('[role="alert"]'));assert.equal(button('시작').disabled,false);
  f.api.controlVoice=async()=>{};await click(button('시작'));assert.equal(f.counts.connect,2);assert.equal(Context.all[1].closed,0);await render(<></>);
 }
});
test('registered retired control results after target change, unmount or close do not change a replacement owner',async()=>{
 for(const boundary of ['target','unmount','collapse'])for(const outcome of ['resolve','reject']){
  const f=fixture();await panel(f);await start();const pending=delayed();
  f.api.controlVoice=async(control:any)=>control.type==='mute'?pending.promise:undefined;await click(button('음소거'));
  if(boundary==='target')await render(<VoicePanel models={models} threadId="replacement-target" canApply onApply={f.onApply} onSaved={()=>{}} onUsageChanged={()=>{}}/>);
  if(boundary==='unmount'){await render(<></>);await panel(f)}
  if(boundary==='collapse'){await act(async()=>{document.querySelector('details')!.open=false});await flush();await act(async()=>{document.querySelector('details')!.open=true});await flush()}
  const consent=document.querySelector<HTMLInputElement>('[aria-label="음성 외부 전송과 과금 동의"]')!;if(!consent.checked)await click(consent);await click(button('시작'));assert.equal(f.counts.connect,2);
  await act(async()=>{if(outcome==='resolve')pending.resolve(undefined);else pending.reject(new Error('synthetic retired rejection'))});await flush();
  assert.equal(Context.all[1].closed,0);assert.equal(f.counts.sub,1);assert.equal(document.querySelector('[role="alert"]'),null);assert.match(document.querySelector('.voice-actions [role="status"]')!.textContent!,/마이크 사용 중/);await render(<></>);
 }
});
test('registered activity remains accessible beside mic/time through queued extended-thinking filler, mute, dictation and terminal states',async()=>{
 for(const theme of ['light','dark']){
  document.documentElement.dataset.theme=theme;browser.innerWidth=420;browser.innerHeight=820;
  const f=fixture();await panel(f);const status=()=>document.querySelector('.voice-actions [role="status"]')!;
  assert.match(status().textContent!,/시작 전/);assert.doesNotMatch(status().textContent!,/응답 중|생각 중/);
  await start();button('음소거').focus();assert.equal(document.activeElement,button('음소거'));assert.equal(status().getAttribute('aria-live'),'polite');
  await act(async()=>f.emit({type:'audio',sequence:1,sampleRate:24000,bytes:new Uint8Array(4800)}));await act(async()=>f.emit({type:'activity',activity:'thinking'}));
  assert.match(status().textContent!,/마이크 켜짐.*응답 중.*0초/);
  await click(button('음소거'));assert.match(status().textContent!,/마이크 음소거.*응답 중/);
  await act(async()=>{Context.all[0].currentTime=.1;Context.all[0].buffers[0].onended()});assert.match(status().textContent!,/마이크 음소거.*생각 중/);
  await act(async()=>f.emit({type:'activity',activity:'listening'}));assert.match(status().textContent!,/마이크 음소거.*듣는 중/);
  await click(button('종료'));assert.match(status().textContent!,/종료/);assert.doesNotMatch(status().textContent!,/응답 중|생각 중|마이크 켜짐/);
  await select(document.querySelector('[aria-label="음성 용도"]')! as HTMLSelectElement,'dictation');await start();assert.match(status().textContent!,/듣는 중/);
  await act(async()=>f.emit({type:'text',final:'retained dictation',provisional:'partial'}));await act(async()=>{document.querySelector('details')!.open=false});await flush();await act(async()=>{document.querySelector('details')!.open=true});await flush();
  assert.equal(button('확정문을 초안에 추가').disabled,false);await click(button('확정문을 초안에 추가'));assert.equal(f.applied(),'retained dictation');assert.equal(f.counts.streams,0);assert.equal(f.counts.save,0);await render(<></>);
 }
 browser.innerWidth=1024;browser.innerHeight=900;
});

// Synthetic process/device wiring only; every invoke below uses registered main,
// the actual manager, encrypted vault and atomic replacement.
async function withMainPanel(run:(f:ReturnType<typeof fixture>,invoke:(name:string,...args:any[])=>Promise<any>)=>Promise<void>){
 const {fork}=await import('node:child_process');const {once}=await import('node:events');const f=fixture();
 const child=fork('tests/fixtures/realtime-main-child.mjs',[],{execArgv:[],stdio:['ignore','pipe','pipe','ipc']});
 child.stdout?.on('data',b=>process.stdout.write(b));child.stderr?.on('data',b=>process.stderr.write(b));let seq=0;
 const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();let readyResolve!:(v:any)=>void,readyReject!:(e:Error)=>void;
 const ready=new Promise<any>((yes,no)=>{readyResolve=yes;readyReject=no});child.on('error',readyReject);
 child.on('message',(r:any)=>{if(r.kind==='ready')readyResolve(r.target);if(r.kind==='event')f.emit(r.event);if(r.kind==='response'){const p=pending.get(r.seq);pending.delete(r.seq);if(r.error)p?.reject(new Error(r.error));else p?.resolve(r.value)}});
 const invoke=(name:string,...args:any[])=>new Promise<any>((resolve,reject)=>{const n=++seq;pending.set(n,{resolve,reject});child.send({kind:'invoke',name,args,seq:n})});
 try{
  const target=await ready;
  f.api.prepareVoice=async(r:any)=>{f.counts.prepare++;return invoke('voice:prepare',r)};f.api.connectVoice=async(id:string)=>{f.counts.connect++;return invoke('voice:connect',id)};
  f.api.controlVoice=async(r:any)=>invoke('voice:control',r);f.api.sendVoiceFrame=async(r:any)=>invoke('voice:frame',r);f.api.stopVoice=async(id:string,immediate:boolean)=>{f.counts.stop++;return invoke('voice:stop',id,immediate)};
  f.api.saveVoiceText=async(id:string,threadId:string,consent:boolean)=>{f.counts.save++;return invoke('voice:save-text',id,threadId,consent)};
  await render(<VoicePanel models={models} threadId={target.id} canApply onApply={f.onApply} onSaved={()=>{}} onUsageChanged={()=>{}}/>);
  await act(async()=>{document.querySelector('details')!.open=true});await flush();await run(f,invoke);
 }finally{await render(<></>);const exited=once(child,'exit');child.send({kind:'quit',seq:++seq});await exited}
}
async function mainReadyToSave(invoke:(name:string,...args:any[])=>Promise<any>){
 const consent=document.querySelector<HTMLInputElement>('[aria-label="음성 외부 전송과 과금 동의"]')!;if(!consent.checked)await click(consent);await click(button('시작'));
 await act(async()=>invoke('fixture:transcript'));await flush();await click(button('종료'));await click(document.querySelector('[aria-label="음성 텍스트 암호화 저장 동의"]')!);
}
test('registered actual main/component completed claims are discarded on cancelled backups or failed refresh with no invalid save action',{timeout:20000},async()=>{
 for(const operation of ['backup:export','backup:restore','session:get'])await withMainPanel(async(f,invoke)=>{
  await mainReadyToSave(invoke);assert.equal(button('텍스트 저장').disabled,false);assert.equal(f.counts.sub,1);
  await act(async()=>invoke('fixture:transition',operation));await flush();assert.equal((await invoke('inspect')).hasCompleted,false);
  assert.equal(button('텍스트 저장').disabled,true);assert.equal(document.querySelector('[aria-label="음성 텍스트 미리보기"]'),null);
  assert.match(document.body.textContent!,/확정문.*폐기/);assert.equal(f.counts.sub,0);assert.equal(f.counts.save,0);
  await mainReadyToSave(invoke);await click(button('텍스트 저장'));assert.equal((await invoke('inspect')).thread.messages.length,1);assert.equal(button('텍스트 저장됨').disabled,true);
 });
});
test('registered actual main/component active transition releases microphone, playback, timers and listener before explicit restart',{timeout:20000},async()=>{
 for(const operation of ['backup:export','backup:restore','session:get'])await withMainPanel(async(f,invoke)=>{
  await start();await click(button('음소거'));await act(async()=>invoke('fixture:transition',operation));await flush();
  assert.equal((await invoke('inspect')).size,0);assert.equal(Context.all[0].closed,1);assert.equal(f.track.stops,1);assert.equal(f.counts.sub,0);
  assert.match(document.querySelector('.voice-actions [role="status"]')!.textContent!,/종료/);assert.match(document.body.textContent!,/폐기/);
  const status=document.querySelector('.voice-actions [role="status"]')!.textContent;await flush();assert.equal(document.querySelector('.voice-actions [role="status"]')!.textContent,status);assert.equal(f.counts.connect,1);
  await click(button('시작'));assert.equal(f.counts.connect,2);assert.equal(Context.all[1].closed,0);
 });
});
test('registered actual main/component failed save retries, collapse invalidates pending result, and a new pending claim survives it',{timeout:20000},async()=>{
 await withMainPanel(async(f,invoke)=>{
  await mainReadyToSave(invoke);await invoke('fixture:fail-save');await click(button('텍스트 저장'));assert.equal(button('텍스트 저장').disabled,false);assert.equal((await invoke('inspect')).thread.messages.length,0);
  await invoke('fixture:repair-save');await invoke('fixture:hold-save');await click(button('텍스트 저장'));await invoke('fixture:wait-save');
  await act(async()=>{document.querySelector('details')!.open=false});await flush();await act(async()=>{document.querySelector('details')!.open=true});await flush();
  assert.equal(button('텍스트 저장').disabled,true);assert.match(document.body.textContent!,/폐기/);assert.equal((await invoke('inspect')).hasCompleted,false);
  await mainReadyToSave(invoke);await click(button('텍스트 저장'));assert.equal(f.counts.save,3);assert.equal(button('시작').disabled,true);
  await act(async()=>invoke('fixture:release-save'));await flush();assert.equal((await invoke('inspect')).thread.messages.length,1);assert.equal(button('텍스트 저장됨').disabled,true);assert.equal(f.counts.sub,0);
 });
});
test('registered actual main/component pending encrypted save invalidated by transition cannot silently re-enable discarded text',{timeout:20000},async()=>{
 await withMainPanel(async(f,invoke)=>{
  await mainReadyToSave(invoke);await invoke('fixture:hold-save');await click(button('텍스트 저장'));await invoke('fixture:wait-save');
  await act(async()=>invoke('fixture:transition','backup:export'));await act(async()=>invoke('fixture:release-save'));await flush();
  assert.equal((await invoke('inspect')).thread.messages.length,0);assert.equal(button('텍스트 저장').disabled,true);assert.match(document.body.textContent!,/폐기/);assert.doesNotMatch(document.body.textContent!,/저장하지 못했습니다/);
  await mainReadyToSave(invoke);await click(button('텍스트 저장'));assert.equal((await invoke('inspect')).thread.messages.length,1);assert.equal(f.counts.save,2);
 });
});

test('registered Stop retires pending controls during Soniox final drain while the owned stop failure still reports truthfully',async()=>{
 const f=fixture();await panel(f);await select(document.querySelector('[aria-label="음성 용도"]')! as HTMLSelectElement,'dictation');await start();
 const mutePending=delayed(),stopPending=delayed();f.api.controlVoice=async(control:any)=>control.type==='mute'?mutePending.promise:undefined;
 f.api.stopVoice=async(_id:string,immediate:boolean)=>{f.counts.stop++;if(!immediate)return stopPending.promise};
 await click(button('음소거'));await click(button('종료'));await act(async()=>mutePending.reject(new Error('synthetic retired mute during drain')));await flush();
 assert.equal(f.counts.sub,1);assert.equal(document.querySelector('[role="alert"]'),null);assert.match(document.querySelector('.voice-actions [role="status"]')!.textContent!,/확정문 수신 중/);
 await act(async()=>f.emit({type:'text',final:'SYNTHETIC_DRAIN_FINAL',provisional:''}));
 await act(async()=>stopPending.reject(new Error('synthetic owned stop failure')));await flush();
 assert.match(document.querySelector('[role="alert"]')!.textContent!,/종료.*확인/);assert.equal(f.counts.sub,0);assert.equal(button('확정문을 초안에 추가').disabled,false);
 await click(button('확정문을 초안에 추가'));assert.equal(f.applied(),'SYNTHETIC_DRAIN_FINAL');assert.equal(f.counts.save,0);assert.equal(f.counts.streams,0);
});
