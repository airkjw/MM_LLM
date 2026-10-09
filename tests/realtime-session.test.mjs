import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
const hooks=registerHooks({resolve(s,c,next){if(s.endsWith('.ts'))return next(s,c);if(s.startsWith('.')&&c.parentURL?.includes('/src/')){try{return next(s+'.ts',c)}catch{}}return next(s,c)}});
const {RealtimeSessionManager,sessionSocketUrl,BOUNDED_WS_OPTIONS}=await import('../src/main/realtime-session.ts');
const ID='11111111-1111-4111-8111-111111111111';
const ID2='22222222-2222-4222-8222-222222222222';
class Socket extends EventEmitter {readyState=0;bufferedAmount=0;sent=[];send(data,options,cb){this.sent.push({data,options});cb?.()}close(){this.readyState=3;this.emit('close',1000)}terminate(){this.readyState=3}open(){this.readyState=1;this.emit('open')}message(e){this.emit('message',Buffer.from(JSON.stringify(e)),false)}}
function fixture(model='gpt-realtime-2.1-mini',fetcher){let identity={epoch:0,profileId:'synthetic',owner:1};let count=0;let sock;let clock=Date.now();const events=[];
 const response={object:'gateway.live_session',model,token:'synthetic_one_use_token_123456',expires_at:new Date(clock+60000).toISOString(),url:model.startsWith('gpt-')?`/v1/gateway/realtime?model=${model}`:model.startsWith('gemini-')?'/v1/gateway/gemini/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent':'/v1/gateway/soniox/transcribe-websocket'};
 const manager=new RealtimeSessionManager({identity:()=>identity,emit:e=>events.push(e),models:()=>[{id:model,type:'realtime'}],now:()=>clock,fetch:async(url,init)=>{count++;assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.deepEqual(JSON.parse(init.body),{model});return fetcher?fetcher(url,init):Response.json(response)},socket:url=>{const u=new URL(url);assert.equal(u.origin,'wss://factchat-cloud.mindlogic.ai');assert.equal(u.searchParams.getAll('token').length,1);assert.equal(u.searchParams.has('api_key'),false);sock=new Socket();return sock}});
 return {manager,events,response,count:()=>count,socket:()=>sock,identity:v=>identity=v,tick:n=>clock+=n};}
const frame=(id=ID,sequence=1,rate=24000)=>({id,sequence,format:'pcm_s16le',sampleRate:rate,channels:1,bytes:new Uint8Array(rate/10*2)});
test('actual OpenAI manager single POST, exact init, waits for session.updated, audio/output/stop and no renderer secrets',async()=>{
 const f=fixture();f.manager.begin({id:ID,modelId:f.response.model,consent:true});assert.equal(f.manager.permissionPending,true);assert.throws(()=>f.manager.begin({id:ID2,modelId:f.response.model,consent:true}));await f.manager.connect(ID,'synthetic_key');assert.equal(f.count(),1);f.socket().open();const init=JSON.parse(f.socket().sent[0].data);assert.equal(init.type,'session.update');assert.equal(init.session.type,'realtime');assert.deepEqual(init.session.output_modalities,['audio']);assert.equal(init.session.audio.input.format.rate,24000);assert.deepEqual(init.session.tools,[]);
 f.manager.frame(frame());assert.equal(f.socket().sent.length,1);f.socket().message({type:'session.updated'});f.manager.frame(frame());assert.equal(JSON.parse(f.socket().sent[1].data).type,'input_audio_buffer.append');
 f.socket().message({type:'response.output_audio.delta',item_id:'item1',delta:Buffer.alloc(4800).toString('base64')});assert.equal(f.events.filter(e=>e.type==='audio').length,1);
 f.socket().message({type:'response.output_audio_transcript.done',transcript:'synthetic answer'});f.socket().message({type:'response.done',response:{status:'completed'}});
 assert.equal(JSON.stringify(f.events).includes('synthetic_one_use_token'),false);assert.equal(JSON.stringify(f.events).includes('synthetic_key'),false);assert.equal(JSON.stringify(f.events).includes('wss:'),false);
 f.manager.stop(ID);assert.equal(f.manager.size,0);assert.equal(f.socket().eventNames().length,0);assert.equal(f.manager.claimText(ID).text,'AI: synthetic answer\n');assert.throws(()=>f.manager.claimText(ID));
});
test('token response rejects expiry, reuse, model echo, arbitrary host/path/query credentials and fragments without remint',async()=>{
 const f=fixture();for(const change of [{expires_at:new Date(Date.now()-31000).toISOString()},{expires_at:new Date(Date.now()+301000).toISOString()},{model:'gpt-wrong'},{url:'wss://evil.test/'},{url:'//evil.test/'},{url:f.response.url+'&token=extra'},{url:f.response.url+'#x'},{url:'/v1/gateway/realtime?model=other'},{object:'session'},{token:3}])assert.throws(()=>sessionSocketUrl({...f.response,...change},f.response.model,Date.now()),()=>true);
 f.manager.begin({id:ID,modelId:f.response.model,consent:true});await f.manager.connect(ID,'synthetic');f.manager.stop(ID);f.manager.begin({id:ID2,modelId:f.response.model,consent:true});await f.manager.connect(ID2,'synthetic');assert.equal(f.count(),2);assert.equal(f.manager.size,0);assert.equal(f.events.at(-1).state,'error');
});
test('pending token cancellation and epoch switch ignore late responses with zero sockets',async()=>{
 for(const change of ['cancel','epoch']){let resolve;const f=fixture(undefined,()=>new Promise(r=>resolve=r));f.manager.begin({id:ID,modelId:f.response.model,consent:true});const p=f.manager.connect(ID,'synthetic');await new Promise(r=>setImmediate(r));if(change==='cancel')f.manager.stop(ID,true);else{f.identity({epoch:1,profileId:'other',owner:1});f.manager.abort()}resolve(Response.json(f.response));await p;assert.equal(f.manager.size,0);assert.equal(f.socket(),undefined);assert.equal(f.count(),1);}
});
test('OpenAI interruption drops queued/old audio and truncates at renderer actual played duration',async()=>{
 const f=fixture();f.manager.begin({id:ID,modelId:f.response.model,consent:true});await f.manager.connect(ID,'synthetic');f.socket().open();f.socket().message({type:'session.updated'});
 f.socket().message({type:'response.output_audio.delta',item_id:'item1',delta:Buffer.alloc(4800).toString('base64')});f.socket().message({type:'input_audio_buffer.speech_started'});const e=f.events.at(-2);assert.equal(e.type,'interrupt');f.manager.control({id:ID,type:'interrupted',interruption:e.interruption,playedMs:35});assert.deepEqual(JSON.parse(f.socket().sent.at(-1).data),{type:'conversation.item.truncate',item_id:'item1',content_index:0,audio_end_ms:35});const n=f.events.filter(e=>e.type==='audio').length;f.socket().message({type:'response.output_audio.delta',item_id:'item1',delta:Buffer.alloc(4800).toString('base64')});assert.equal(f.events.filter(e=>e.type==='audio').length,n);f.manager.abort();
});
test('bounded options and invalid input/backpressure/oversize/output backlog/inbound flood close safely',async()=>{
 assert.deepEqual(BOUNDED_WS_OPTIONS,{maxPayload:262144,handshakeTimeout:10000,followRedirects:false,perMessageDeflate:false});
 for(const mode of ['format','odd','flood','buffer','oversize','output','receive']){const f=fixture();f.manager.begin({id:ID,modelId:f.response.model,consent:true});await f.manager.connect(ID,'synthetic');f.socket().open();f.socket().message({type:'session.updated'});
 if(mode==='format')f.manager.frame({...frame(),sampleRate:16000});if(mode==='odd')f.manager.frame({...frame(),bytes:new Uint8Array(3)});if(mode==='buffer'){f.socket().bufferedAmount=131072;f.manager.frame(frame())}
 if(mode==='flood')for(let n=1;n<=16&&f.manager.size;n++)f.manager.frame(frame(ID,n));if(mode==='oversize')f.socket().emit('message',Buffer.alloc(262145),false);
 if(mode==='output')for(let n=0;n<11;n++)f.socket().message({type:'response.output_audio.delta',item_id:'item',delta:Buffer.alloc(24000).toString('base64')});
 if(mode==='receive')for(let n=0;n<201;n++)f.socket().message({type:'unknown'});
 assert.equal(f.manager.size,0);assert.equal(f.events.at(-1).state,'error');assert.equal(JSON.stringify(f.events).includes('token='),false);}
});
test('close codes mapped with sanitized messages and no reconnect',async()=>{for(const code of [1000,1008,1011,1013,4402]){const f=fixture();f.manager.begin({id:ID,modelId:f.response.model,consent:true});await f.manager.connect(ID,'synthetic');f.socket().emit('close',code,Buffer.from('secret token URL'));assert.equal(f.manager.size,0);assert.equal(f.count(),1);assert.equal(f.events.at(-1).state,code===1000?'closed':'error');assert.equal(JSON.stringify(f.events).includes('secret'),false)}});
test.after(()=>hooks.deregister());
test('actual Gemini init/setup acknowledgement, 16k input, 24k binary JSON output, transcript and audioStreamEnd mute',async()=>{
 const f=fixture('gemini-3.8-live');f.manager.begin({id:ID,modelId:f.response.model,consent:true});await f.manager.connect(ID,'synthetic');f.socket().open();assert.deepEqual(JSON.parse(f.socket().sent[0].data),{setup:{model:'models/gemini-3.8-live',generationConfig:{responseModalities:['AUDIO']},inputAudioTranscription:{},outputAudioTranscription:{}}});f.manager.frame(frame(ID,1,16000));assert.equal(f.socket().sent.length,1);f.socket().message({setupComplete:{}});f.manager.frame(frame(ID,1,16000));assert.equal(JSON.parse(f.socket().sent.at(-1).data).realtimeInput.audio.mimeType,'audio/pcm;rate=16000');
 f.socket().emit('message',Buffer.from(JSON.stringify({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:Buffer.alloc(4800).toString('base64')}}]},outputTranscription:{text:'synthetic'},turnComplete:true}})),true);
 assert.equal(f.events.filter(e=>e.type==='audio').length,1);assert.equal(f.events.filter(e=>e.type==='text').at(-1).final,'AI: synthetic\n');
 f.manager.control({id:ID,type:'mute',muted:true});assert.deepEqual(JSON.parse(f.socket().sent.at(-1).data),{realtimeInput:{audioStreamEnd:true}});f.socket().message({serverContent:{interrupted:true}});assert.equal(f.events.some(e=>e.type==='interrupt'),true);f.manager.stop(ID);assert.equal(f.manager.size,0);
});
test('Gemini setup timeout 10s, extended-thinking fillers remain thinking until interaction IDLE and unknown tools fail safely',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture('gemini-3.8-live-extended-thinking');f.manager.begin({id:ID,modelId:f.response.model,consent:true});await f.manager.connect(ID,'synthetic');f.socket().open();t.mock.timers.tick(10000);assert.equal(f.manager.size,0);assert.equal(f.events.at(-1).state,'error');
 const g=fixture('gemini-3.8-live-extended-thinking');g.manager.begin({id:ID,modelId:g.response.model,consent:true});await g.manager.connect(ID,'synthetic');g.socket().open();g.socket().message({setupComplete:{}});g.socket().message({serverContent:{interactionStatus:'IN_PROGRESS',outputTranscription:{text:'filler'},turnComplete:true}});assert.equal(g.events.at(-1).activity,'thinking');g.socket().message({serverContent:{turnComplete:true}});assert.equal(g.events.at(-1).activity,'thinking');g.socket().message({serverContent:{interactionStatus:'IDLE',turnComplete:true}});assert.equal(g.events.at(-1).activity,'listening');g.socket().message({toolCall:{functionCalls:[{name:'arbitrary'}]}});assert.equal(g.manager.size,0);
});
test('active session survives 60-second mint expiry with no refresh or reconnect',async(t)=>{t.mock.timers.enable({apis:['setTimeout']});const f=fixture();f.manager.begin({id:ID,modelId:f.response.model,consent:true});await f.manager.connect(ID,'synthetic');f.socket().open();f.socket().message({type:'session.updated'});f.tick(61000);t.mock.timers.tick(61000);f.manager.frame(frame());assert.equal(f.manager.size,1);assert.equal(f.count(),1);f.manager.abort();});
test('actual Soniox separate catalog permission, exact JSON then binary 0.1s PCM, empty TEXT stop with bounded final drain',async()=>{
 const f=fixture('stt-rt-v5');f.manager.begin({id:ID,modelId:'stt-rt-v5',consent:true});await f.manager.connect(ID,'synthetic');f.socket().open();assert.deepEqual(JSON.parse(f.socket().sent[0].data),{model:'stt-rt-v5',audio_format:'pcm_s16le',sample_rate:24000,num_channels:1,language_hints:['ko']});assert.equal(f.socket().sent[0].data.includes('api_key'),false);f.manager.frame(frame());assert.equal(f.socket().sent.at(-1).options.binary,true);assert.equal(f.socket().sent.at(-1).data.length,4800);
 const msg=tokens=>({tokens,final_audio_proc_ms:200,total_audio_proc_ms:300});f.socket().message(msg([{text:'yes ',is_final:true,start_ms:0,end_ms:100},{text:'pre',is_final:false}]));f.socket().message(msg([{text:'yes ',is_final:true,start_ms:0,end_ms:100},{text:'yes ',is_final:true,start_ms:100,end_ms:200},{text:'preview',is_final:false}]));assert.equal(f.events.filter(e=>e.type==='text').at(-1).final,'yes yes ');assert.equal(f.events.filter(e=>e.type==='text').at(-1).provisional,'preview');
 f.manager.stop(ID);assert.equal(f.manager.size,1);assert.equal(f.events.at(-1).state,'stopping');assert.equal(f.socket().sent.at(-1).data,'');assert.equal(f.socket().sent.at(-1).options.binary,false);
 f.socket().message({...msg([{text:'done<end><fin>',is_final:true}]),finished:true});assert.equal(f.manager.size,0);assert.equal(f.events.filter(e=>e.type==='text').at(-1).final,'yes yes done');assert.equal(f.events.filter(e=>e.type==='text').at(-1).provisional,'');assert.equal(f.manager.claimText(ID).text,'yes yes done');
});
test('Soniox preserves repeated final words without timestamps, interim replacement, muted keepalive, stop timeout, teardown drops late final',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const f=fixture('stt-rt-v5');f.manager.begin({id:ID,modelId:'stt-rt-v5',consent:true});await f.manager.connect(ID,'synthetic');f.socket().open();f.manager.control({id:ID,type:'mute',muted:true});t.mock.timers.tick(10000);assert.deepEqual(JSON.parse(f.socket().sent.at(-1).data),{type:'keepalive'});
 f.socket().message({tokens:[{text:'again ',is_final:true},{text:'again ',is_final:true},{text:'draft',is_final:false}],final_audio_proc_ms:0,total_audio_proc_ms:0});f.socket().message({tokens:[{text:'better',is_final:false}],final_audio_proc_ms:0,total_audio_proc_ms:0});assert.equal(f.events.filter(e=>e.type==='text').at(-1).final,'again again ');assert.equal(f.events.filter(e=>e.type==='text').at(-1).provisional,'better');f.manager.stop(ID);t.mock.timers.tick(5000);assert.equal(f.manager.size,0);assert.match(f.events.at(-1).message,/초과/);
 const g=fixture('stt-rt-v5');g.manager.begin({id:ID,modelId:'stt-rt-v5',consent:true});await g.manager.connect(ID,'synthetic');g.socket().open();g.manager.stop(ID);g.manager.abort();g.socket().message({tokens:[{text:'late old',is_final:true}],finished:true,final_audio_proc_ms:0,total_audio_proc_ms:0});assert.equal(g.manager.size,0);assert.equal(g.events.filter(e=>e.type==='text').length,0);assert.throws(()=>g.manager.claimText(ID));
});
test('HTTP mint denial is sanitized and one POST; no Soniox automatic permission probe or model change network',async()=>{
 for(const status of [400,401,403,429]){const f=fixture('stt-rt-v5',()=>Response.json({detail:'synthetic sensitive raw reason'},{status}));assert.equal(f.count(),0);f.manager.begin({id:ID,modelId:'stt-rt-v5',consent:true});assert.equal(f.count(),0);await f.manager.connect(ID,'synthetic');assert.equal(f.manager.size,0);assert.equal(f.count(),1);assert.equal(JSON.stringify(f.events).includes('raw reason'),false);}
});
test('renderer delivery backlog is bounded; typed acknowledgements release slots and old profile commands cannot forward frames',async()=>{
 const f=fixture('stt-rt-v5');f.manager.begin({id:ID,modelId:'stt-rt-v5',consent:true});await f.manager.connect(ID,'synthetic');f.socket().open();
 for(let n=0;n<40;n++){for(const e of f.events.filter(e=>e.delivery))if(!e.acked){f.manager.control({id:ID,type:'received',sequence:e.delivery});e.acked=true;}f.socket().message({tokens:[{text:'temporary',is_final:false}],final_audio_proc_ms:0,total_audio_proc_ms:0});}assert.equal(f.manager.size,1);
 for(let n=0;n<33;n++)f.socket().message({tokens:[{text:'temporary',is_final:false}],final_audio_proc_ms:0,total_audio_proc_ms:0});assert.equal(f.manager.size,0);assert.match(f.events.at(-1).message,/수신.*지연/);
 const g=fixture();g.manager.begin({id:ID,modelId:g.response.model,consent:true});await g.manager.connect(ID,'synthetic');g.socket().open();g.socket().message({type:'session.updated'});g.identity({epoch:1,profileId:'other',owner:1});assert.throws(()=>g.manager.frame(frame()));assert.equal(g.manager.size,0);assert.equal(g.socket().sent.length,1);
});
async function completed(f,id=ID){f.manager.begin({id,modelId:f.response.model,consent:true});await f.manager.connect(id,'synthetic');f.socket().open();f.socket().message({type:'session.updated'});f.socket().message({type:'response.output_audio_transcript.done',transcript:'synthetic completed'});f.manager.stop(id);}
test('actual completed-text reservation excludes duplicates, rollback enables retry, and commit alone consumes it',async()=>{
 const f=fixture();await completed(f);const first=f.manager.claimText(ID);assert.deepEqual(first.identity,{epoch:0,profileId:'synthetic',owner:1});assert.throws(()=>f.manager.claimText(ID));
 first.assertCurrent();first.rollback();const second=f.manager.claimText(ID);first.rollback();first.commit();assert.throws(()=>first.assertCurrent());assert.throws(()=>f.manager.claimText(ID));
 second.assertCurrent();second.commit();second.rollback();assert.throws(()=>f.manager.claimText(ID));
});
test('actual rollback/commit cannot affect a replacement completed object even when it reuses the session UUID',async()=>{
 const f=fixture();await completed(f);const old=f.manager.claimText(ID);f.response.token='synthetic_fresh_one_use_token_654321';await completed(f);
 const current=f.manager.claimText(ID);old.rollback();old.commit();assert.throws(()=>old.assertCurrent());current.assertCurrent();assert.throws(()=>f.manager.claimText(ID));current.rollback();const retry=f.manager.claimText(ID);retry.commit();assert.throws(()=>f.manager.claimText(ID));
});
test('actual completed reservations lose ownership on epoch, profile, window owner or immediate teardown',async()=>{
 for(const change of [{epoch:1,profileId:'synthetic',owner:1},{epoch:0,profileId:'other',owner:1},{epoch:0,profileId:'synthetic',owner:2},'teardown']){
  const f=fixture();await completed(f);const claim=f.manager.claimText(ID);
  if(change==='teardown')f.manager.stop(ID,true);else f.identity(change);
  assert.throws(()=>claim.assertCurrent());claim.rollback();claim.commit();assert.throws(()=>f.manager.claimText(ID));
 }
});

test('registered saturated delivery budget cannot suppress terminal discard or recreate a completed claim during abort',async()=>{
 const f=fixture();await completed(f);f.response.token='synthetic_fresh_saturation_token';
 f.manager.begin({id:ID2,modelId:f.response.model,consent:true});await f.manager.connect(ID2,'synthetic');f.socket().open();f.socket().message({type:'session.updated'});
 f.socket().message({type:'response.output_audio_transcript.done',transcript:'SYNTHETIC_SATURATED_FINAL'});
 while(f.manager.current.deliveries.size<32)f.socket().message({type:'response.done',response:{status:'completed'}});
 assert.equal(f.manager.size,1);const before=f.events.length;f.manager.abort();
 assert.equal(f.manager.size,0);assert.equal(f.socket().readyState,3);assert.equal(f.socket().eventNames().length,0);assert.throws(()=>f.manager.claimText(ID2));
 assert.ok(f.events.slice(before).some(e=>e.type==='discard'));assert.equal(f.events.at(-1).state,'closed');assert.match(f.events.at(-1).message,/폐기/);
});
test('registered Gemini confirmed streams stay bounded and interim or interrupted output never becomes final at Stop',async()=>{
 for(const model of ['gemini-3.8-live','gemini-3.8-live-extended-thinking']){
  const f=fixture(model);f.manager.begin({id:ID,modelId:model,consent:true});await f.manager.connect(ID,'synthetic');f.socket().open();f.socket().message({setupComplete:{}});
  f.socket().message({serverContent:{inputTranscription:{text:'confirmed'},interimInputTranscription:{text:'draft'}}});
  f.socket().message({serverContent:{outputTranscription:{text:'unfinished'}}});f.socket().message({serverContent:{interrupted:true,turnComplete:true,interactionStatus:'IDLE'}});
  f.socket().message({serverContent:{interimInputTranscription:{text:'only partial'}}});f.manager.stop(ID);
  assert.equal(f.manager.claimText(ID).text,'나: confirmed\n');assert.equal(f.manager.size,0);
  const g=fixture(model);g.manager.begin({id:ID,modelId:model,consent:true});await g.manager.connect(ID,'synthetic');g.socket().open();g.socket().message({setupComplete:{}});
  g.socket().message({serverContent:{inputTranscription:{text:'x'.repeat(11995)}}});assert.equal(g.manager.size,1);
  g.socket().message({serverContent:{interimInputTranscription:{text:'y'.repeat(10)}}});assert.equal(g.manager.size,0);assert.equal(g.events.at(-1).state,'error');
  const claim=g.manager.claimText(ID);assert.equal(claim.text.length,11999);assert.doesNotMatch(claim.text,/y/);
 }
});
async function activeOpenAI(f){f.manager.begin({id:ID,modelId:f.response.model,consent:true});await f.manager.connect(ID,'synthetic');f.socket().open();f.socket().message({type:'session.updated'});}
const truncates=f=>f.socket().sent.filter(m=>typeof m.data==='string'&&JSON.parse(m.data).type==='conversation.item.truncate').map(m=>JSON.parse(m.data));
// Mirrors VoicePanel: only an interrupt that names an item asks the renderer for its played duration.
function rendererInterrupt(f,playedMs){const e=f.events.filter(e=>e.type==='interrupt').at(-1);if(e.itemId)f.manager.control({id:ID,type:'interrupted',interruption:e.interruption,playedMs:playedMs()});return e;}
test('M4 second interruption after fully played item sends no truncate',async()=>{
 const f=fixture();await activeOpenAI(f);
 f.socket().message({type:'response.output_audio.delta',item_id:'item1',delta:Buffer.alloc(48000).toString('base64')});
 const audio=f.events.filter(e=>e.type==='audio');assert.equal(audio.length,2);for(const a of audio)f.manager.control({id:ID,type:'played',sequence:a.sequence,playedSamples:12000});
 // Renderer reports the whole second for its first interrupt, then 0 after it clears its played map.
 let rendererMs=[1000,0];
 f.socket().message({type:'input_audio_buffer.speech_started'});const first=rendererInterrupt(f,()=>rendererMs.shift());assert.equal(first.itemId,undefined);
 f.socket().message({type:'input_audio_buffer.speech_started'});const second=rendererInterrupt(f,()=>rendererMs.shift());assert.equal(second.itemId,undefined);
 assert.equal(truncates(f).length,0);assert.equal(f.manager.size,1);
 // Unplayed audio remains: exactly one truncate at the renderer's played duration, and none on a following interrupt.
 const g=fixture();await activeOpenAI(g);
 g.socket().message({type:'response.output_audio.delta',item_id:'item2',delta:Buffer.alloc(48000).toString('base64')});
 const first2=g.events.filter(e=>e.type==='audio')[0];g.manager.control({id:ID,type:'played',sequence:first2.sequence,playedSamples:12000});
 g.socket().message({type:'input_audio_buffer.speech_started'});const e=rendererInterrupt(g,()=>500);assert.equal(e.itemId,'item2');
 g.socket().message({type:'input_audio_buffer.speech_started'});rendererInterrupt(g,()=>0);
 assert.deepEqual(truncates(g),[{type:'conversation.item.truncate',item_id:'item2',content_index:0,audio_end_ms:500}]);assert.equal(g.manager.size,1);
 g.manager.abort();f.manager.abort();
});
test('M4 repeated speech_started before the renderer reply keeps one pending truncate and the session alive',async()=>{
 const f=fixture();await activeOpenAI(f);
 f.socket().message({type:'response.output_audio.delta',item_id:'item1',delta:Buffer.alloc(48000).toString('base64')});
 f.socket().message({type:'input_audio_buffer.speech_started'});const first=f.events.filter(e=>e.type==='interrupt').at(-1);assert.equal(first.itemId,'item1');
 f.socket().message({type:'input_audio_buffer.speech_started'});
 f.manager.control({id:ID,type:'interrupted',interruption:first.interruption,playedMs:250});
 assert.deepEqual(truncates(f).map(t=>t.audio_end_ms),[250]);assert.equal(f.manager.size,1);f.manager.abort();
});
test('M6 token expiry tolerates client clock skew and keeps one-use digests for two minutes',()=>{
 const f=fixture();const now=Date.now();const at=ms=>({...f.response,expires_at:new Date(now+ms).toISOString()});
 assert.equal(sessionSocketUrl(at(62000),f.response.model,now).expires,now+62000);
 assert.equal(sessionSocketUrl(at(-20000),f.response.model,now).expires,now-20000);
 assert.equal(sessionSocketUrl(at(300000),f.response.model,now).expires,now+300000);
 for(const ms of [301000,-31000,-30000])assert.throws(()=>sessionSocketUrl(at(ms),f.response.model,now),/만료/);
});
test('M6 fast client clock still connects once and same token digest is rejected on reuse',async()=>{
 const f=fixture();f.response.expires_at=new Date(Date.now()-20000).toISOString();
 await activeOpenAI(f);await new Promise(r=>setImmediate(r));assert.equal(f.manager.size,1);assert.equal(f.manager.current.state,'active');
 const first=f.socket();f.manager.stop(ID);f.tick(60000);
 f.manager.begin({id:ID2,modelId:f.response.model,consent:true});await f.manager.connect(ID2,'synthetic');
 assert.equal(f.socket(),first);assert.equal(f.manager.size,0);assert.equal(f.events.at(-1).state,'error');assert.equal(f.count(),2);
});
test('L8 OpenAI transcripts render in conversation item order, not arrival order',async()=>{
 for(const created of ['conversation.item.created','conversation.item.added','input_audio_buffer.committed']){
  const f=fixture();await activeOpenAI(f);
  if(created==='input_audio_buffer.committed')f.socket().message({type:created,item_id:'userA'});
  else f.socket().message({type:created,item:{id:'userA',type:'message',role:'user'}});
  f.socket().message({type:'conversation.item.added',item:{id:'aiB',type:'message',role:'assistant'}});
  f.socket().message({type:'response.output_audio_transcript.done',item_id:'aiB',transcript:'응답'});
  f.socket().message({type:'conversation.item.input_audio_transcription.completed',item_id:'userA',transcript:'질문'});
  assert.equal(f.events.filter(e=>e.type==='text').at(-1).final,'나: 질문\nAI: 응답\n');
  f.socket().message({type:'conversation.item.input_audio_transcription.completed',item_id:'unknown',transcript:'뒤'});
  f.manager.stop(ID);assert.equal(f.manager.claimText(ID).text,'나: 질문\nAI: 응답\n나: 뒤\n');
 }
});
test('L8 interruption clears the AI transcript preview with one text event',async()=>{
 const f=fixture();await activeOpenAI(f);
 f.socket().message({type:'response.output_audio.delta',item_id:'aiB',delta:Buffer.alloc(4800).toString('base64')});
 f.socket().message({type:'response.output_audio_transcript.delta',item_id:'aiB',delta:'미리'});assert.equal(f.events.filter(e=>e.type==='text').at(-1).provisional,'미리');
 const before=f.events.length;f.socket().message({type:'input_audio_buffer.speech_started'});
 const texts=f.events.slice(before).filter(e=>e.type==='text');assert.equal(texts.length,1);assert.equal(texts[0].provisional,'');assert.equal(texts[0].final,'');
 f.socket().message({type:'response.output_audio_transcript.delta',item_id:'aiB',delta:'잔존'});assert.equal(f.events.filter(e=>e.type==='text').length,2);f.manager.abort();
});
test('L8 turn list stays bounded and unfilled placeholders never block later text',async()=>{
 const f=fixture();await activeOpenAI(f);
 for(let n=0;n<300;n++){if(n%100===0)f.tick(1000);f.socket().message({type:'conversation.item.added',item:{id:`synthetic-${n}`,type:'message',role:'assistant'}});}
 assert.equal(f.manager.current.turns.length,256);
 f.socket().message({type:'conversation.item.input_audio_transcription.completed',item_id:'synthetic-299',transcript:'late'});
 assert.equal(f.events.filter(e=>e.type==='text').at(-1).final,'나: late\n');f.manager.abort();
});
test('F1 eight queued frames arriving at once after an 800ms stall keep the session alive at any window phase',async()=>{
 for(const phase of [0,100,300,500,900]){
  const f=fixture();await activeOpenAI(f);let seq=0;const send=()=>f.manager.frame(frame(ID,++seq));
  for(let t=0;t<phase;t+=100){send();f.tick(100);}
  f.tick(800);for(let n=0;n<8;n++)send();
  for(let n=0;n<30;n++){f.tick(100);send();}
  // Two stalls back to back recover too: the backlog budget refills faster than real time.
  f.tick(800);for(let n=0;n<8;n++)send();for(let n=0;n<20;n++){f.tick(100);send();}
  assert.equal(f.manager.size,1,`phase ${phase}`);assert.equal(f.manager.current.inputSequence,seq);f.manager.abort();
 }
});
test('F1 sustained over-real-time input is still rejected',async()=>{
 // About twice real time (a 100ms frame every 50ms) for two seconds.
 const f=fixture();await activeOpenAI(f);let seq=0;
 for(let n=0;n<40&&f.manager.size;n++){f.tick(50);f.manager.frame(frame(ID,++seq));}
 assert.equal(f.manager.size,0);assert.match(f.events.at(-1).message,/빈도/);
 // A single burst beyond the renderer's 8-frame backlog plus margin is rejected immediately.
 const g=fixture();await activeOpenAI(g);for(let n=1;n<=16&&g.manager.size;n++)g.manager.frame(frame(ID,n));assert.equal(g.manager.size,0);
});
test('F3 initial setup timer does not shrink with local token remaining time',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();f.response.expires_at=new Date(Date.now()+1000).toISOString();
 f.manager.begin({id:ID,modelId:f.response.model,consent:true});await f.manager.connect(ID,'synthetic');f.socket().open();
 t.mock.timers.tick(5000);assert.equal(f.manager.size,1);f.socket().message({type:'session.updated'});assert.equal(f.manager.current.state,'active');
 const g=fixture();g.manager.begin({id:ID,modelId:g.response.model,consent:true});await g.manager.connect(ID,'synthetic');g.socket().open();
 t.mock.timers.tick(10000);assert.equal(g.manager.size,0);assert.equal(g.events.at(-1).state,'error');
});
