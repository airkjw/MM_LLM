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
import { redirectFixture } from "./fixtures/gateway-redirect.mjs";

// Exercise the real IPC handlers, attachments, context, Gateway and encrypted stores.
// Only Electron startup/updater and local document extraction are fixtures.
const root = await mkdtemp(join(tmpdir(), "mmllm-phase3-estimate-"));
const handlers = new Map();
const window = { webContents: { mainFrame: { url: "mmllm://app/index.html" } } };
globalThis.__phase3EstimateMainElectron = {
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
globalThis.__phase3EstimateDocumentText = () => documentText;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron") return { url: "phase3-estimate:electron", shortCircuit: true };
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".")) {
      const url = new URL(specifier, context.parentURL);
      if (url.pathname.endsWith("/main/updates")) return { url: "phase3-estimate:updates", shortCircuit: true };
      if (url.pathname.endsWith("/main/document-text")) return { url: "phase3-estimate:document-text", shortCircuit: true };
      if (url.protocol === "file:" && !existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(url) + ".ts")) return next(url.href + ".ts", context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "phase3-estimate:electron") return { format: "module", shortCircuit: true,
      source: "export const { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, screen, shell, safeStorage } = globalThis.__phase3EstimateMainElectron;" };
    if (url === "phase3-estimate:updates") return { format: "module", shortCircuit: true,
      source: "export const checkForUpdates = () => {}, currentUpdateState = () => ({}), installUpdate = () => {}, startUpdates = () => {};" };
    if (url === "phase3-estimate:document-text") return { format: "module", shortCircuit: true,
      source: "export const configureOcrDataRoot = () => {}, extractPdf = async () => globalThis.__phase3EstimateDocumentText(), extractDocx = extractPdf, extractXlsx = extractPdf;" };
    const loaded = next(url, context);
    if (url.endsWith("/src/main/index.ts")) return { ...loaded,
      source: loaded.source.toString() + "\nexport function registerEstimateFixture(window) { mainWindow = window; registerHandlers(); }\n" };
    return loaded;
  }
});
const main = await import("../src/main/index.ts");
const storage = await import("../src/main/storage.ts");
const gateway = await import("../src/main/gateway.ts");
const attachments = await import("../src/main/attachments.ts");
main.registerEstimateFixture(window);
await storage.activateProfileForKey("synthetic-phase3-estimate-account");
const originalFetch = globalThis.fetch;
test.after(async () => {
  globalThis.fetch = originalFetch; attachments.clearAttachments(); hooks.deregister();
  delete globalThis.__phase3EstimateMainElectron; delete globalThis.__phase3EstimateDocumentText;
  await rm(root, { recursive: true, force: true });
});
let sessionId = 0;
const models = ["gpt-6-astra", "claude-sonnet-5", "gemini-3.8-flash", "sonar-pro"].map((id) => ({ id, type: "llm" }));
function session() { gateway.commitGatewaySession(`synthetic-correction-${++sessionId}`, models.map((model) => ({ ...model }))); }
async function invoke(channel, request) {
  const port = new EventEmitter(); const events = [];
  port.start = () => {};
  port.postMessage = (event) => events.push(structuredClone(event));
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


const trusted = {sender:window.webContents,senderFrame:window.webContents.mainFrame};
async function quote(request, id='11111111-1111-4111-8111-111111111111') {return handlers.get('media:estimate')(trusted,id,request);}
function quoteSession() { gateway.commitGatewaySession('synthetic-estimate-key',[{id:'gpt-image-2',type:'image'},{id:'fal-ai/vidu/q3',type:'video'},{id:'elevenlabs-music',type:'audio',audio_client:'elevenlabs'},{id:'gemini-tts',type:'audio',audio_client:'google'}]); }
const image={kind:'image',modelId:'gpt-image-2',numberOfImages:1,quality:'high',imageSize:'1536x1024'};
function response(r) {return {object:'estimate',kind:r.kind,model:r.modelId,credits:3,exact:true,bound:'exact',lines:[{item:r.kind,credits:3,exact:true,bound:'exact',basis:'fixed'}]};}
test('actual main quote accepts conservative compatible bounds and rejects total exact/opposite certainty without retry',async()=>{
  quoteSession();await storage.saveKey('synthetic-estimate-key');let posts=0;
  for(const total of ['exact','minimum','maximum','approximate']) for(const line of ['exact','minimum','maximum','approximate']) {
    const value={...response(image),credits:3.5,bound:total,exact:total==='exact',lines:[
      {item:'image',credits:3,bound:line,exact:line==='exact',basis:'fixed'},
      {item:'content_filter',credits:.5,bound:'exact',exact:true,basis:'per_request'}]};
    globalThis.fetch=async(url,init)=>{posts++;assert.match(String(url),/\/estimate\/$/);assert.equal(init.method,'POST');return Response.json(value)};
    if(total==='approximate'||line==='exact'||line===total) {
      const result=await quote(image);assert.equal(result.bound,total);assert.equal(result.exact,total==='exact');
      assert.equal(result.credits,3.5);assert.deepEqual(result.lines,value.lines);
    } else await assert.rejects(()=>quote(image),/견적.*확인할 수 없습니다/);
  }
  assert.equal(posts,16);
  // A nonexact filter cannot be hidden behind an exact generation/total either.
  globalThis.fetch=async()=>{posts++;return Response.json({...response(image),credits:3.5,lines:[...response(image).lines,
    {item:'content_filter',credits:.5,bound:'minimum',exact:false,basis:'per_request'}]})};
  await assert.rejects(()=>quote(image),/견적/);assert.equal(posts,17);
});

test('actual main estimate/image/video/music reject native redirects before a second route or paid POST',async()=>{
  quoteSession();await storage.saveKey('synthetic-estimate-key');
  const requests=[
    {channel:'media:estimate',request:image,route:'/estimate/'},
    {channel:'media:image',request:{modelId:image.modelId,numberOfImages:image.numberOfImages,quality:image.quality,imageSize:image.imageSize,prompt:'synthetic',imageAttachmentIds:[],deidentifiedConfirmed:true},route:'/images/generate/'},
    {channel:'media:video',request:{modelId:'fal-ai/vidu/q3',prompt:'synthetic',imageAttachmentIds:[],durationSeconds:8,resolution:'1080p',audio:true,deidentifiedConfirmed:true},route:'/video/generation/'},
    {channel:'media:audio',request:{lane:'music',modelId:'elevenlabs-music',prompt:'synthetic',durationSeconds:60,instrumental:true,deidentifiedConfirmed:true},route:'/audio/music/'}
  ];
  for(const status of [307,308]) for(const {channel,request,route} of requests) {
    const fixture=await redirectFixture(status);const urls=[];
    try {
      globalThis.fetch=(url,init)=>{urls.push(String(url));assert.equal(String(url),gateway.GATEWAY+route);return originalFetch(fixture.origin+'/initial',init)};
      await assert.rejects(()=>channel==='media:estimate'?quote(request):handlers.get(channel)(trusted,request),/다른 주소/);
      assert.equal(urls.length,1);assert.equal(fixture.first.length,1);assert.equal(fixture.first[0].method,'POST');
      assert.equal(fixture.first[0].headers.authorization,'Bearer synthetic-estimate-key');assert.deepEqual(fixture.target,[]);
      assert.equal(JSON.parse(fixture.first[0].body).model,request.modelId);
    } finally {globalThis.fetch=originalFetch;await fixture.close()}
  }
});
test('actual main IPC/transport sends one free estimate POST with same model options and no private payload',async()=>{
  quoteSession();await storage.saveKey('synthetic-estimate-key');let posts=[];
  globalThis.fetch=async(url,init)=>{posts.push({url:String(url),body:JSON.parse(init.body),headers:new Headers(init.headers)});return Response.json(response(image));};
  const result=await quote(image);assert.equal(result.credits,3);assert.equal(posts.length,1);
  assert.match(posts[0].url,/\/estimate\/$/);assert.deepEqual(posts[0].body,{kind:'image',model:'gpt-image-2',number_of_images:1,quality:'high',size:'1536x1024'});
  assert.equal(posts[0].headers.get('authorization'),'Bearer synthetic-estimate-key');
  for(const bad of [{...image,prompt:'synthetic private'}, {kind:'music',modelId:'gemini-tts'}, {...image,numberOfImages:2}]) await assert.rejects(async()=>quote(bad));
  assert.equal(posts.length,1);
});
test('actual estimate transport surfaces no-price/edit-only/403 failures, bad price and wrong kind without retry or zero',async()=>{
  quoteSession();let calls=0;
  for(const [status,body] of [[400,{detail:"Model edits an existing image only. Pass input_images."}],[400,{detail:'Model has no price to quote.'}],[403,{detail:'blocked'}],[200,{...response(image),credits:null}],[200,{...response(image),kind:'music'}]]) {
    globalThis.fetch=async()=>{calls++;return Response.json(body,{status});};await assert.rejects(()=>quote(image));
  }
  assert.equal(calls,5);
  globalThis.fetch=async()=>Response.json({...response(image),note:'x'.repeat(70*1024)});await assert.rejects(()=>quote(image),/한도|크기|넘/);
});
test('actual main quote reserves synchronously, cancels delayed response and allows vault reads while network pending',async()=>{
  quoteSession();let done;let posts=0;
  globalThis.fetch=async()=>{posts++;return new Promise(resolve=>{done=()=>resolve(Response.json(response(image)))});};
  const pending=quote(image);const outcome=pending.then(v=>v,e=>e);
  await assert.rejects(async()=>quote(image,'22222222-2222-4222-8222-222222222222'),/확인 중/);
  for(let tries=0; !done && tries<1000;tries++) await new Promise(resolve=>setTimeout(resolve,1));
  assert.ok(done,"synthetic fetch should start");
  await storage.loadSettings();assert.equal(posts,1);
  handlers.get('media:estimate-cancel')(trusted,'11111111-1111-4111-8111-111111111111');done();
  assert.match((await outcome).message,/취소/);
});
test('actual account identity rejects a late quote after profile switch',async()=>{
  quoteSession();let done;
  globalThis.fetch=async()=>new Promise(resolve=>{done=()=>resolve(Response.json(response(image)))});
  const pending=quote(image).then(v=>v,e=>e);for(let tries=0; !done && tries<1000;tries++) await new Promise(resolve=>setTimeout(resolve,1));
  assert.ok(done,"synthetic fetch should start");
  await storage.activateProfileForKey('synthetic-other-account');done();const outcome=await pending;assert.ok(outcome instanceof Error);assert.match(outcome.message,/계정|전환|프로필/);
});
test('actual generation transport exposes image/video body and music header credits separately from filter quote lines',async()=>{
  await storage.activateProfileForKey('synthetic-estimate-key');await storage.saveKey('synthetic-estimate-key');quoteSession();let calls=[];
  globalThis.fetch=async(url,init)=>{const body=JSON.parse(init.body);calls.push(body);
    if(String(url).includes('/images/')) return Response.json({operation_id:'synthetic_image',status:'processing',credits_charged:7});
    if(String(url).includes('/video/')) return Response.json({operation_id:'synthetic_video',status:'processing',credits_charged:9});
    const audio=Buffer.alloc(46);audio.write('RIFF',0);audio.writeUInt32LE(38,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(24000,24);audio.writeUInt32LE(48000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(2,40);
    return new Response(audio,{headers:{'content-type':'audio/wav','x-credits-charged':'11'}});
  };
  const imageResult=await handlers.get('media:image')(trusted,{modelId:image.modelId,prompt:'synthetic',imageAttachmentIds:[],numberOfImages:1,quality:'high',imageSize:'1536x1024',deidentifiedConfirmed:true});
  const videoResult=await handlers.get('media:video')(trusted,{modelId:'fal-ai/vidu/q3',prompt:'synthetic',imageAttachmentIds:[],durationSeconds:8,resolution:'1080p',audio:true,deidentifiedConfirmed:true});
  const musicResult=await handlers.get('media:audio')(trusted,{lane:'music',modelId:'elevenlabs-music',prompt:'synthetic',durationSeconds:60,instrumental:true,deidentifiedConfirmed:true});
  assert.equal(imageResult.actualCredits,7);assert.equal(videoResult.actualCredits,9);assert.equal(musicResult.actualCredits,11);
  for(const result of [imageResult,videoResult,musicResult]) assert.match(result.creditDisplay,/실제 생성.*별도 차감/);
  assert.equal(calls.length,3);assert.equal(calls[0].size,'1536x1024');assert.equal(calls[1].parameters.duration,8);assert.equal(calls[2].duration_seconds,60);
});
