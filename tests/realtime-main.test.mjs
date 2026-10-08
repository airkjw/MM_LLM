import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp,rm,readdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
const root=await mkdtemp(join(tmpdir(),'mmllm-voice-synthetic-'));const handlers=new Map(),appEvents=new Map();const events=[];let socket;
const contents={id:77,mainFrame:{url:'mmllm://app/index.html'},send:(_name,event)=>events.push(event)};const win={webContents:contents,isDestroyed:()=>false};
const encryptionKey=randomBytes(32);
class Socket extends EventEmitter {readyState=0;bufferedAmount=0;sent=[];send(data,options,cb){this.sent.push({data,options});cb?.()}close(){this.readyState=3;this.emit('close',1000)}terminate(){this.readyState=3;this.emit('close',1000)}open(){this.readyState=1;this.emit('open')}message(e){this.emit('message',Buffer.from(JSON.stringify(e)),false)}}
globalThis.__voiceSocket=()=>{socket=new Socket();return socket};
globalThis.__voiceElectron={app:{quit:()=>{},isPackaged:true,getVersion:()=> '0.5.1',getPath:()=>root,on:(n,f)=>appEvents.set(n,f),whenReady:()=>new Promise(()=>{})},
 ipcMain:{on:(n,f)=>handlers.set(n,f),handle:(n,f)=>handlers.set(n,f)},protocol:{registerSchemesAsPrivileged:()=>{}},
 safeStorage:{isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async text=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);const out=Buffer.concat([cipher.update(text),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),out])},decryptStringAsync:async bytes=>{const cipher=createDecipheriv('aes-256-gcm',encryptionKey,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return{result:Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString(),shouldReEncrypt:false}}},BrowserWindow:class{},dialog:{},nativeTheme:{},screen:{},shell:{}};
const hooks=registerHooks({resolve(s,c,next){if(s==='electron')return{url:'voice:electron',shortCircuit:true};if(s.startsWith('.')&&c.parentURL?.includes('/src/')){const u=new URL(s,c.parentURL);if(u.pathname.endsWith('/main/updates'))return{url:'voice:updates',shortCircuit:true};if(u.pathname.endsWith('/main/document-text'))return{url:'voice:documents',shortCircuit:true};if(!existsSync(fileURLToPath(u))&&existsSync(fileURLToPath(u)+'.ts'))return next(u.href+'.ts',c)}return next(s,c)},load(url,c,next){
 if(url==='voice:electron')return{format:'module',shortCircuit:true,source:'export const {app,ipcMain,protocol,safeStorage,BrowserWindow,dialog,nativeTheme,screen,shell}=globalThis.__voiceElectron;'};
 if(url==='voice:updates')return{format:'module',shortCircuit:true,source:'export const checkForUpdates=()=>{},currentUpdateState=()=>({}),installUpdate=()=>{},startUpdates=()=>{};'};
 if(url==='voice:documents')return{format:'module',shortCircuit:true,source:"export const configureOcrDataRoot=()=>{},extractPdf=async()=>'',extractDocx=extractPdf,extractXlsx=extractPdf;"};
 const loaded=next(url,c);if(url.endsWith('/src/main/index.ts'))return{...loaded,source:loaded.source.toString().replace('new RealtimeSessionManager({','new RealtimeSessionManager({ socket: globalThis.__voiceSocket,')+'\nexport function voiceFixture(w){mainWindow=w;registerHandlers();return voiceManager;}'};return loaded;}});
const main=await import('../src/main/index.ts'),storage=await import('../src/main/storage.ts'),gateway=await import('../src/main/gateway.ts');
const {installVoicePermissions}=await import('../src/main/voice-permissions.ts');const manager=main.voiceFixture(win);const originalFetch=globalThis.fetch;
const trusted={sender:contents,senderFrame:contents.mainFrame};const ID='11111111-1111-4111-8111-111111111111';
const models=[{id:'gpt-6-astra',type:'llm'},{id:'gpt-realtime-2.1-mini',type:'realtime'},{id:'gemini-3.8-live',type:'realtime'}];
async function session(){manager.abort();events.length=0;await storage.activateProfileForKey('synthetic-voice-profile');await storage.saveKey('synthetic-voice-profile');gateway.commitGatewaySession('synthetic-voice-profile',models);}
let mintCounter=0;
function mint(model='gpt-realtime-2.1-mini'){return{object:'gateway.live_session',model,token:`synthetic_ipc_one_use_token_${++mintCounter}`,expires_at:new Date(Date.now()+60000).toISOString(),url:model==='stt-rt-v5'?'/v1/gateway/soniox/transcribe-websocket':model.startsWith('gemini-')?'/v1/gateway/gemini/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent':`/v1/gateway/realtime?model=${model}`};}
const call=(n,...args)=>handlers.get(n)(trusted,...args);
async function start(model='gpt-realtime-2.1-mini'){call('voice:prepare',{id:ID,modelId:model,consent:true});await call('voice:connect',ID);socket.open();if(model.startsWith('gpt-'))socket.message({type:'session.updated'});if(model.startsWith('gemini-'))socket.message({setupComplete:{}});}
test('actual IPC validates trusted senderFrame and strict allowlists; synchronous prepare guard, one paid POST, no generic socket or key exposure',async()=>{
 await session();let count=0;globalThis.fetch=async(url,init)=>{count++;assert.equal(url,'https://factchat-cloud.mindlogic.ai/v1/gateway/realtime/sessions/');assert.equal(init.redirect,'error');return Response.json(mint())};
 for(const n of ['voice:prepare','voice:connect','voice:frame','voice:control','voice:stop','voice:save-text'])await assert.rejects(async()=>handlers.get(n)({sender:contents,senderFrame:{url:contents.mainFrame.url}},ID),/허용되지 않은 창/);
 for(const bad of [{id:ID,modelId:models[1].id,consent:false},{id:ID,modelId:models[1].id,consent:true,url:'ws://evil'},{id:ID,modelId:'gpt-unknown',consent:true}])assert.throws(()=>call('voice:prepare',bad));
 call('voice:prepare',{id:ID,modelId:models[1].id,consent:true});assert.throws(()=>call('voice:prepare',{id:ID,modelId:models[1].id,consent:true}));await call('voice:connect',ID);await assert.rejects(()=>call('voice:connect',ID));assert.equal(count,1);socket.open();socket.message({type:'session.updated'});
 assert.equal(JSON.stringify(events).includes('token='),false);assert.equal(JSON.stringify(events).includes('synthetic-voice-profile'),false);call('voice:stop',ID,true);assert.equal(manager.size,0);assert.equal(manager.permissionPending,false);
});
test('real Electron44 check/request handlers allow only pending trusted top-frame audio and sanitized clipboard write; deny null/camera/mixed/subframe/read',async()=>{
 await session();let check,request;installVoicePermissions({setPermissionCheckHandler:f=>check=f,setPermissionRequestHandler:f=>request=f},(c,url)=>c===contents&&url===contents.mainFrame.url,()=>manager.permissionPending);
 const d={isMainFrame:true,requestingUrl:contents.mainFrame.url,mediaType:'audio'};assert.equal(check(contents,'media','',d),false);call('voice:prepare',{id:ID,modelId:models[1].id,consent:true});assert.equal(check(contents,'media','',d),true);
 for(const [c,p,v] of [[null,'media',d],[contents,'media',{...d,mediaType:'video'}],[contents,'media',{...d,mediaType:'unknown'}],[contents,'media',{...d,isMainFrame:false}],[contents,'media',{...d,requestingUrl:'https://evil.test'}],[contents,'clipboard-read',d]])assert.equal(check(c,p,'',v),false);
 assert.equal(check(contents,'clipboard-sanitized-write','',d),true);function allowed(permission,details){let answer;request(contents,permission,v=>answer=v,details);return answer;}
 assert.equal(allowed('media',{isMainFrame:true,requestingUrl:d.requestingUrl,mediaTypes:['audio']}),true);for(const mediaTypes of [undefined,[],['video'],['audio','video']])assert.equal(allowed('media',{isMainFrame:true,requestingUrl:d.requestingUrl,mediaTypes}),false);assert.equal(allowed('clipboard-sanitized-write',d),true);assert.equal(allowed('clipboard-read',d),false);call('voice:stop',ID,true);assert.equal(check(contents,'media','',d),false);
});
test('actual logout/key replace/window teardown stops pending/active sessions and old frames or final transcript cannot survive account change',async()=>{
 for(const mode of ['logout','key','window']){await session();globalThis.fetch=async()=>Response.json(mint());await start();socket.message({type:'response.output_audio_transcript.done',transcript:'synthetic old text'});
 if(mode==='logout')await call('session:logout');if(mode==='key'){globalThis.fetch=async()=>Response.json({data:models});await call('session:replace-key','synthetic-replacement-profile');}if(mode==='window')appEvents.get('window-all-closed')();
 assert.equal(manager.size,0);assert.equal(socket.eventNames().length,0);assert.throws(()=>manager.claimText(ID));const previous=events.length;socket.message({type:'response.output_audio.delta',item_id:'old',delta:'AAAA'});assert.equal(events.length,previous);assert.throws(()=>call('voice:frame',{id:ID}));}
});
test('opt-in text save uses actual encrypted storage and backup; no default persistence or raw audio and duplicate save denied',async()=>{
 await session();globalThis.fetch=async()=>Response.json(mint());const thread=await storage.createThread({modelId:'gpt-6-astra'});await start();const pcm=Buffer.alloc(4800,91);
 call('voice:frame',{id:ID,sequence:1,format:'pcm_s16le',sampleRate:24000,channels:1,bytes:new Uint8Array(pcm)});socket.message({type:'response.output_audio_transcript.done',transcript:'SYNTHETIC_VOICE_TEXT_ONLY'});call('voice:stop',ID,false);
 assert.equal((await storage.getThread(thread.id)).messages.length,0);await assert.rejects(async()=>call('voice:save-text',ID,thread.id,false));const saved=await call('voice:save-text',ID,thread.id,true);assert.equal(saved.messages[0].text,'AI: SYNTHETIC_VOICE_TEXT_ONLY\n');await assert.rejects(async()=>call('voice:save-text',ID,thread.id,true));
 const backup=await storage.exportPortableBackup();const plain=JSON.stringify(backup);assert.equal(plain.includes('SYNTHETIC_VOICE_TEXT_ONLY'),true);assert.equal(plain.includes(pcm.toString('base64')),false);assert.equal(plain.includes('synthetic_ipc_one_use_token'),false);
 for(const file of await readdir(join(root,'private'),{recursive:true,withFileTypes:true})){if(!file.isFile())continue;const bytes=await readFile(join(file.parentPath,file.name));assert.equal(bytes.includes(Buffer.from('SYNTHETIC_VOICE_TEXT_ONLY')),false);assert.equal(bytes.includes(pcm),false);}
});
test('actual IPC delayed token after logout never creates a socket or posts twice',async()=>{
 await session();let resolve,count=0;globalThis.fetch=()=>{count++;return new Promise(r=>resolve=r)};call('voice:prepare',{id:ID,modelId:models[1].id,consent:true});const before=socket;const p=call('voice:connect',ID);while(!resolve)await new Promise(r=>setTimeout(r,1));await call('session:logout');resolve(Response.json(mint()));await p;assert.equal(manager.size,0);assert.equal(socket,before);assert.equal(count,1);
});
test.after(async()=>{manager.abort();globalThis.fetch=originalFetch;hooks.deregister();delete globalThis.__voiceElectron;delete globalThis.__voiceSocket;await rm(root,{recursive:true,force:true});});
test('actual trusted IPC owns Gemini and Soniox adapters with no key setup field, exact frames and stop/final drain',async()=>{
 for(const model of ['gemini-3.8-live','stt-rt-v5']){
  await session();globalThis.fetch=async(_url,init)=>{assert.deepEqual(JSON.parse(init.body),{model});return Response.json(mint(model))};await start(model);
  const init=JSON.parse(socket.sent[0].data);assert.equal(JSON.stringify(init).includes('synthetic-voice-profile'),false);assert.equal('api_key' in init,false);
  if(model.startsWith('gemini-')){assert.equal(init.setup.model,'models/'+model);call('voice:frame',{id:ID,sequence:1,format:'pcm_s16le',sampleRate:16000,channels:1,bytes:new Uint8Array(3200)});assert.equal(JSON.parse(socket.sent.at(-1).data).realtimeInput.audio.mimeType,'audio/pcm;rate=16000');socket.message({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:Buffer.alloc(2400).toString('base64')}}]}}});assert.equal(events.some(e=>e.type==='audio'),true);call('voice:stop',ID,false);assert.equal(manager.size,0)}
  else {assert.equal(init.model,'stt-rt-v5');call('voice:frame',{id:ID,sequence:1,format:'pcm_s16le',sampleRate:24000,channels:1,bytes:new Uint8Array(4800)});assert.equal(socket.sent.at(-1).options.binary,true);call('voice:stop',ID,false);assert.equal(socket.sent.at(-1).data,'');assert.equal(socket.sent.at(-1).options.binary,false);assert.equal(manager.size,1);socket.message({tokens:[{text:'final',is_final:true}],final_audio_proc_ms:100,total_audio_proc_ms:100,finished:true});assert.equal(manager.size,0);assert.equal(events.filter(e=>e.type==='text').at(-1).final,'final');}
 }
});
test('actual realtime mint POST inherits mandatory native Fetch no-redirect transport and never replays billed body',async()=>{
 const {redirectFixture}=await import('./fixtures/gateway-redirect.mjs');
 for(const status of [307,308]){await session();const server=await redirectFixture(status);let posts=0;
  try{globalThis.fetch=(_url,init)=>{posts++;return originalFetch(server.origin+'/initial',init)};call('voice:prepare',{id:ID,modelId:models[1].id,consent:true});await call('voice:connect',ID);assert.equal(manager.size,0);assert.equal(posts,1);assert.equal(server.first.length,1);assert.equal(server.target.length,0);assert.equal(JSON.parse(server.first[0].body).model,models[1].id);assert.equal(events.at(-1).state,'error');}
  finally{globalThis.fetch=originalFetch;await server.close()}
 }
});
