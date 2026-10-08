import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { claudePauseEvents, source } from "./fixtures/native-search.mjs";

// Exercise the real IPC handlers, attachments, context, Gateway and encrypted stores.
// Only Electron startup/updater and local document extraction are fixtures.
const root = await mkdtemp(join(tmpdir(), "mmllm-phase3-code-"));
const handlers = new Map();
const window = { webContents: { mainFrame: { url: "mmllm://app/index.html" } } };
globalThis.__phase3MainElectron = {
  app: { isPackaged: true, getVersion: () => "0.5.1", getPath: () => root, on: () => {},
    whenReady: () => new Promise(() => {}) },
  ipcMain: { on: (name, handler) => handlers.set(name, handler), handle: (name, handler) => handlers.set(name, handler) },
  protocol: { registerSchemesAsPrivileged: () => {} },
  safeStorage: { isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from(`synthetic-vault\0${value}`),
    decryptStringAsync: async (bytes) => ({ result: bytes.toString().slice(16), shouldReEncrypt: false }) },
  BrowserWindow: class {}, dialog: {}, nativeTheme: {}, screen: {}, shell: {}
};
let documentText = "";
globalThis.__phase3DocumentText = () => documentText;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron") return { url: "phase3-code:electron", shortCircuit: true };
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".")) {
      const url = new URL(specifier, context.parentURL);
      if (url.pathname.endsWith("/main/updates")) return { url: "phase3-code:updates", shortCircuit: true };
      if (url.pathname.endsWith("/main/document-text")) return { url: "phase3-code:document-text", shortCircuit: true };
      if (url.protocol === "file:" && !existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(url) + ".ts")) return next(url.href + ".ts", context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "phase3-code:electron") return { format: "module", shortCircuit: true,
      source: "export const { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, screen, shell, safeStorage } = globalThis.__phase3MainElectron;" };
    if (url === "phase3-code:updates") return { format: "module", shortCircuit: true,
      source: "export const checkForUpdates = () => {}, currentUpdateState = () => ({}), installUpdate = () => {}, startUpdates = () => {};" };
    if (url === "phase3-code:document-text") return { format: "module", shortCircuit: true,
      source: "export const configureOcrDataRoot = () => {}, extractPdf = async () => globalThis.__phase3DocumentText(), extractDocx = extractPdf, extractXlsx = extractPdf;" };
    const loaded = next(url, context);
    if (url.endsWith("/src/main/index.ts")) return { ...loaded,
      source: loaded.source.toString() + "\nexport function registerCodeFixture(window) { mainWindow = window; registerHandlers(); }\n" };
    return loaded;
  }
});
const main = await import("../src/main/index.ts");
const storage = await import("../src/main/storage.ts");
const gateway = await import("../src/main/gateway.ts");
const attachments = await import("../src/main/attachments.ts");
main.registerCodeFixture(window);
await storage.activateProfileForKey("synthetic-phase3-code-account");
const originalFetch = globalThis.fetch;
test.after(async () => {
  globalThis.fetch = originalFetch; attachments.clearAttachments(); hooks.deregister();
  delete globalThis.__phase3MainElectron; delete globalThis.__phase3DocumentText;
  await rm(root, { recursive: true, force: true });
});
let sessionId = 0;
const models = ["gpt-6-astra", "claude-sonnet-5", "gemini-3.8-flash", "sonar-pro"].map((id) => ({ id, type: "llm" }));
function session() { gateway.commitGatewaySession(`synthetic-correction-${++sessionId}`, models.map((model) => ({ ...model }))); }
async function invoke(channel, request, onEvent) {
  const port = new EventEmitter(); const events = [];
  port.start = () => {};
  port.postMessage = (event) => { events.push(structuredClone(event)); onEvent?.(event,port); };
  let timeout;
  const done = new Promise((resolve, reject) => {
    port.close = () => { port.emit("close"); resolve(); };
    timeout = setTimeout(() => reject(new Error("synthetic IPC test timed out")), 5000);
  });
  try {
    handlers.get(channel)({ ports: [port], sender: window.webContents, senderFrame: window.webContents.mainFrame }, request);
    await done; return events;
  } finally { clearTimeout(timeout); }
}
function addFiles(name, count, size, prefix) {
  const picked = attachments.addDroppedAttachments(Array.from({ length: count }, (_, index) => {
    const bytes = Buffer.alloc(size); Buffer.from(prefix).copy(bytes);
    return { name: `${index}-${name}`, bytes };
  }), ["image", "document"]);
  return picked.map((item) => item.id);
}
function sse(events) { return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")); }

test('real chat main/transport emits Claude code payload/header, results/errors and encrypted restore/backup metadata', async()=>{
  session();let paid=0;let request;
  globalThis.fetch=async(url,init)=>{
    if(init?.method==='POST'){ paid++;request={url:String(url),body:JSON.parse(init.body),headers:new Headers(init.headers)};
      return sse([{type:'content_block_start',index:0,content_block:{type:'server_tool_use',id:'srv_fixture',name:'bash_code_execution',input:{command:'python synthetic.py'}}},
        {type:'content_block_stop',index:0},{type:'content_block_start',index:1,content_block:{type:'bash_code_execution_tool_result',tool_use_id:'srv_fixture',content:{type:'bash_code_execution_result',stdout:'42',stderr:'',return_code:0,content:[]}}},
        {type:'message_delta',delta:{stop_reason:'pause_turn'}}]); }
    throw new Error('unexpected synthetic GET');
  };
  const thread=await storage.createThread({modelId:'claude-sonnet-5'});
  await storage.updateThread(thread.id,t=>{t.advanced={serverCode:true};t.webSearchMode='off'});
  const events=await invoke('chat:stream',{threadId:thread.id,modelId:'claude-sonnet-5',text:'synthetic calculation',attachmentIds:[]});
  assert.equal(paid,1);assert.match(request.url,/claude\/v1\/messages\/$/);assert.match(request.headers.get('anthropic-beta'),/code-execution-2025-08-25/);
  assert.equal(request.body.betas,undefined);assert.deepEqual(request.body.tools,[{type:'code_execution_20250825',name:'code_execution'}]);
  assert.equal(events.filter(e=>e.type==='server_code').at(-1).result.stdout,'42');
  const saved=storage.snapshot(await storage.getThread(thread.id));assert.equal(saved.messages.at(-1).serverCodeResults[0].status,'completed');
  assert.equal(saved.messages.at(-1).continuationUnsupportedReason,'claude_pause_turn');assert.equal(saved.advanced.serverCode,true);
  const backup=await storage.exportPortableBackup();assert.equal(backup.threads.find(t=>t.id===thread.id).messages.at(-1).serverCodeResults[0].stdout,'42');
  paid=0;const blocked=await invoke('chat:stream',{threadId:thread.id,modelId:'claude-sonnet-5',text:'synthetic',attachmentIds:[],continueIncompleteId:saved.messages.at(-1).id});
  assert.equal(paid,0);assert.match(blocked.at(-1).message,/pause_turn|일시|이어서/);
});
test('real Responses transport uses auto container with chain, returns output/error and rejects unknown before search/retrieval paid POST',async()=>{
  session();let paid=0;let body;
  globalThis.fetch=async(url,init)=>{if(init?.method==='POST'){paid++;body=JSON.parse(init.body);return sse([
    {type:'response.code_interpreter_call.in_progress',item_id:'ci_fixture'},
    {type:'response.code_interpreter_call_code.delta',item_id:'ci_fixture',delta:'print(42)'},
    {type:'response.output_item.done',item:{type:'code_interpreter_call',id:'ci_fixture',code:'print(42)',status:'failed',outputs:[{type:'logs',logs:'synthetic failure'}]}},
    {type:'response.completed',response:{id:'resp_fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'synthetic assistant'}]}]}}
  ]);}throw new Error('unexpected GET');};
  const thread=await storage.createThread({modelId:'gpt-6-astra'});
  await storage.updateThread(thread.id,t=>{t.advanced={serverCode:true,responses:{chain:true}};t.previousResponseId='resp_previous';t.webSearchMode='off'});
  const events=await invoke('chat:stream',{threadId:thread.id,modelId:'gpt-6-astra',text:'synthetic calculation',attachmentIds:[]});
  assert.equal(paid,1);assert.deepEqual(body.tools,[{type:'code_interpreter',container:{type:'auto'}}]);assert.equal(body.previous_response_id,'resp_previous');
  assert.equal(events.filter(e=>e.type==='server_code').at(-1).result.status,'failed');assert.equal(events.at(-1).snapshot.messages.at(-1).text,'synthetic assistant');
  await storage.updateThread(thread.id,t=>{t.advanced={serverCode:true};t.webSearchMode='always'});
  gateway.commitGatewaySession('synthetic-unknown', [...models,{id:'gpt-unknown',type:'llm'}]);paid=0;
  const blocked=await invoke('chat:stream',{threadId:thread.id,modelId:'gpt-unknown',text:'latest synthetic evidence',attachmentIds:[]});
  assert.equal(paid,0);assert.match(blocked.at(-1).message,/미확인/);
});
test('actual code stream abort saves bounded cancelled metadata and does not loop or retry',async()=>{
  session();let posts=0;
  globalThis.fetch=async()=>{posts++;return sse([{type:'response.code_interpreter_call.in_progress',item_id:'ci_cancelled'},
    {type:'response.code_interpreter_call_code.done',item_id:'ci_cancelled',code:'print(42)'}]);};
  const thread=await storage.createThread({modelId:'gpt-6-astra'});await storage.updateThread(thread.id,t=>{t.advanced={serverCode:true};t.webSearchMode='off'});
  const events=await invoke('chat:stream',{threadId:thread.id,modelId:'gpt-6-astra',text:'synthetic',attachmentIds:[]},(e,port)=>{
    if(e.type==='server_code') port.emit('message',{data:{type:'cancel'}});
  });
  assert.equal(posts,1);assert.equal(events.at(-1).type,'error');assert.equal(events.at(-1).snapshot.messages.at(-1).serverCodeResults[0].status,'cancelled');
});
test('actual nonstream Claude/Responses responses merge finalized results and text without additional POST',async()=>{
  session();let posts=0;
  for(const id of ['claude-sonnet-5','gpt-6-astra']) {
    globalThis.fetch=async()=>{posts++;return Response.json(id.startsWith('claude')?{type:'message',content:[
      {type:'server_tool_use',id:'srv_json',name:'bash_code_execution',input:{command:'python synthetic.py'}},
      {type:'bash_code_execution_tool_result',tool_use_id:'srv_json',content:{type:'bash_code_execution_result',stdout:'42',stderr:'',return_code:0}},
      {type:'text',text:'synthetic Claude answer'}],stop_reason:'end_turn'}:
      {object:'response',id:'resp_json',status:'completed',output:[{type:'code_interpreter_call',id:'ci_json',code:'print(42)',status:'completed',outputs:[{type:'logs',logs:'42'}]},
        {type:'message',content:[{type:'output_text',text:'synthetic OpenAI answer'}]}]});};
    const thread=await storage.createThread({modelId:id});await storage.updateThread(thread.id,t=>{t.advanced={serverCode:true};t.webSearchMode='off'});
    const events=await invoke('chat:stream',{threadId:thread.id,modelId:id,text:'synthetic',attachmentIds:[]});const saved=events.at(-1).snapshot.messages.at(-1);
    assert.equal(saved.serverCodeResults[0].status,'completed');assert.match(saved.text,/synthetic.*answer/);
  }
  assert.equal(posts,2);
});
test('actual code file consent and account transition boundaries stop before paid work',async()=>{
  session();await storage.saveKey('synthetic-code-account');let posts=0;globalThis.fetch=async()=>{posts++;throw new Error('unexpected paid work')};
  const thread=await storage.createThread({modelId:'claude-sonnet-5'});await storage.updateThread(thread.id,t=>{t.advanced={serverCode:true};t.webSearchMode='off'});
  const attachmentIds=addFiles('synthetic.pdf',1,20,'%PDF-1.7\n');
  const events=await invoke('chat:stream',{threadId:thread.id,modelId:'claude-sonnet-5',text:'synthetic',attachmentIds});
  assert.equal(posts,0);assert.match(events.at(-1).message,/확인|동의/);
  session();const trusted={sender:window.webContents,senderFrame:window.webContents.mainFrame};
  let resolveFetch;globalThis.fetch=async()=>new Promise(resolve=>{resolveFetch=()=>resolve(sse([{type:'response.completed',response:{status:'completed'}}]));});
  await storage.updateThread(thread.id,t=>{t.advanced={serverCode:true};t.webSearchMode='off'});
  const pending=invoke('chat:stream',{threadId:thread.id,modelId:'claude-sonnet-5',text:'synthetic',attachmentIds:[]});
  for(let tries=0;!resolveFetch&&tries<1000;tries++) await new Promise(resolve=>setTimeout(resolve,1));assert.ok(resolveFetch);
  await assert.rejects(()=>handlers.get('session:replace-key')(trusted,'synthetic-new-account'),/진행 중/);
  resolveFetch();await pending;
});
test('portable backup restore retains normalized bounded code results and drops extra secret fields without schema bump',async()=>{
  const backup=await storage.exportPortableBackup();const entry=backup.threads.find(t=>t.messages.some(m=>m.serverCodeResults?.length));assert.ok(entry);
  const result=entry.messages.find(m=>m.serverCodeResults?.length).serverCodeResults[0];result.token='synthetic-secret';result.code='x'.repeat(9000);result.artifacts=[{kind:'image',url:'https://example.org/signed?token=synthetic'}];
  await storage.restorePortableBackup(backup);const restored=storage.snapshot(await storage.getThread(entry.id));const clean=restored.messages.find(m=>m.serverCodeResults?.length).serverCodeResults[0];
  assert.equal(clean.code.length,8192);assert.doesNotMatch(JSON.stringify(clean),/token|https|synthetic-secret/);assert.equal(backup.version,1);
});
