// Only test wiring reused; actual main/manager/storage/atomic-file are imported. No product implementation is copied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp,rm,readdir,readFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
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
 const loaded=next(url,c);if(url.endsWith('/src/main/atomic-file.ts'))return{...loaded,source:loaded.source.toString().replace('io = { open, rename, unlink }','io = globalThis.__voiceAtomicIO ?? { open, rename, unlink }')};
 if(url.endsWith('/src/main/index.ts'))return{...loaded,source:loaded.source.toString().replace('new RealtimeSessionManager({','new RealtimeSessionManager({ socket: globalThis.__voiceSocket,')+'\nexport function voiceFixture(w){mainWindow=w;registerHandlers();return voiceManager;}'};return loaded;}});
const main=await import('../../src/main/index.ts'),storage=await import('../../src/main/storage.ts'),gateway=await import('../../src/main/gateway.ts');
const {installVoicePermissions}=await import('../../src/main/voice-permissions.ts');const manager=main.voiceFixture(win);const originalFetch=globalThis.fetch;
const trusted={sender:contents,senderFrame:contents.mainFrame};const ID='11111111-1111-4111-8111-111111111111';
const models=[{id:'gpt-6-astra',type:'llm'},{id:'gpt-realtime-2.1-mini',type:'realtime'},{id:'gemini-3.8-live',type:'realtime'}];
async function session(){manager.abort();events.length=0;await storage.activateProfileForKey('synthetic-voice-profile');await storage.saveKey('synthetic-voice-profile');gateway.commitGatewaySession('synthetic-voice-profile',models);}
let mintCounter=0;
function mint(model='gpt-realtime-2.1-mini'){return{object:'gateway.live_session',model,token:`synthetic_ipc_one_use_token_${++mintCounter}`,expires_at:new Date(Date.now()+60000).toISOString(),url:model==='stt-rt-v5'?'/v1/gateway/soniox/transcribe-websocket':model.startsWith('gemini-')?'/v1/gateway/gemini/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent':`/v1/gateway/realtime?model=${model}`};}
const call=(n,...args)=>handlers.get(n)(trusted,...args);
async function start(model='gpt-realtime-2.1-mini'){call('voice:prepare',{id:ID,modelId:model,consent:true});await call('voice:connect',ID);socket.open();if(model.startsWith('gpt-'))socket.message({type:'session.updated'});if(model.startsWith('gemini-'))socket.message({setupComplete:{}});}


await session();globalThis.fetch=async(_url,init)=>Response.json(mint(JSON.parse(init.body).model));const target=await storage.createThread({modelId:'gpt-6-astra'});
let saveHold;const originalEncrypt=globalThis.__voiceElectron.safeStorage.encryptStringAsync;
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
contents.send=(_name,event)=>process.send({kind:'event',event});process.send({kind:'ready',target});
process.on('message',async message=>{try{
 if(message.kind==='quit'){manager.abort();globalThis.fetch=originalFetch;hooks.deregister();await rm(root,{recursive:true,force:true});process.send({kind:'response',seq:message.seq,value:true});process.disconnect();return;}
 let value;
 if(message.name==='fixture:hold-save'){
  saveHold={entered:deferred(),release:deferred()};const held=saveHold;
  globalThis.__voiceElectron.safeStorage.encryptStringAsync=async text=>{held.entered.resolve();await held.release.promise;return originalEncrypt(text)};value=true;
 }
 else if(message.name==='fixture:wait-save'){await saveHold.entered.promise;value=true;}
 else if(message.name==='fixture:release-save'){saveHold.release.resolve();globalThis.__voiceElectron.safeStorage.encryptStringAsync=originalEncrypt;value=true;}
 else if(message.name==='fixture:fail-save'){globalThis.__voiceAtomicIO={...fs,rename:async()=>{throw new Error('synthetic retryable rename failure')}};value=true;}
 else if(message.name==='fixture:repair-save'){delete globalThis.__voiceAtomicIO;value=true;}
 else if(message.name==='fixture:transition'){
  const [operation]=message.args;globalThis.__voiceElectron.dialog.showSaveDialog=async()=>({canceled:true});globalThis.__voiceElectron.dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});
  const mintFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('synthetic failed read')};
  try{value=await call(operation,...(operation==='session:get'?[]:['synthetic-backup-password']))}
  finally{globalThis.fetch=mintFetch;gateway.commitGatewaySession('synthetic-voice-profile',models)}
 }
 else if(message.name==='inspect'){value={size:manager.size,hasCompleted:!!manager.completed,thread:await storage.getThread(target.id)}}
 else if(message.name==='fixture:transcript'){socket.message({type:'response.output_audio_transcript.done',item_id:'synthetic-item',transcript:'SYNTHETIC_CLOSED_PREVIEW'});value=true;}
 else {value=await call(message.name,...message.args);if(message.name==='voice:connect'){socket.open();socket.message({type:'session.updated'});}if(message.name==='server:text')throw new Error('incorrect fixture route');}
 process.send({kind:'response',seq:message.seq,value});
 }catch(error){process.send({kind:'response',seq:message.seq,error:error.message})}});

