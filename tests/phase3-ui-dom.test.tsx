import assert, { assertFocused } from "./dom-assert.ts";
import test, { afterEach, before } from "node:test";
import { Window } from "happy-dom";
import type { ThreadSnapshot } from "../src/shared/contracts";
import type { ResearchResult } from "../src/shared/research";
import * as React from "react";
import type { Root } from "react-dom/client";
const { act } = React;
const browser = new Window({ url: "https://mm-llm.local/" });
browser.document.write("<!doctype html><html><body></body></html>");
for (const [name, value] of Object.entries({
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  Node: browser.Node,
  Element: browser.Element,
  HTMLElement: browser.HTMLElement,
  HTMLButtonElement: browser.HTMLButtonElement,
  Event: browser.Event,
  KeyboardEvent: browser.KeyboardEvent,
  MouseEvent: browser.MouseEvent,
  PointerEvent: browser.PointerEvent ?? browser.MouseEvent,
  getComputedStyle: browser.getComputedStyle
})) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
let animationId = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
browser.requestAnimationFrame = (callback) => {
  const id = ++animationId;
  timers.set(id, setTimeout(() => { timers.delete(id); callback(Date.now()); }, 0));
  return id;
};
browser.cancelAnimationFrame = (id) => {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
};

Object.defineProperty(globalThis, "requestAnimationFrame", { value: browser.requestAnimationFrame, writable: true, configurable: true });
Object.defineProperty(globalThis, "cancelAnimationFrame", { value: browser.cancelAnimationFrame, writable: true, configurable: true });

let createRoot: typeof import("react-dom/client")["createRoot"];
let MediaPanel: typeof import("../src/renderer/src/MediaPanel")["MediaPanel"];
let ChatPanel: typeof import("../src/renderer/src/ChatPanel")["ChatPanel"];
let ConfirmProvider: typeof import("../src/renderer/src/components/ConfirmDialog")["ConfirmProvider"];
let root: Root | null = null;
let host: HTMLDivElement | null = null;
before(async () => {
  Object.defineProperty(globalThis, "MutationObserver", { value: browser.MutationObserver, configurable: true });
  Object.defineProperty(globalThis, "ResizeObserver", { value: browser.ResizeObserver, configurable: true });
  Object.defineProperty(globalThis, "IntersectionObserver", { value: browser.IntersectionObserver, configurable: true });
  ({ createRoot } = await import("react-dom/client"));
  ({ MediaPanel } = await import("../src/renderer/src/MediaPanel"));
  ({ ChatPanel } = await import("../src/renderer/src/ChatPanel"));
  ({ ConfirmProvider } = await import("../src/renderer/src/components/ConfirmDialog"));
});
async function render(ui: React.ReactNode) {
  if (!host) { host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => root!.render(ui));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}
async function key(value: string) {
  await act(async () => { document.activeElement?.dispatchEvent(new browser.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })); });
}
async function click(element: Element) {
  await act(async () => { (element as HTMLElement).focus(); (element as HTMLElement).click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount()); root = null; host?.remove(); host = null;
  for (const timer of timers.values()) clearTimeout(timer); timers.clear();
});

const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((item) => item.textContent?.includes(text))!;
const composer = () => document.querySelector<HTMLTextAreaElement>(".composer-input")!;
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto = element.tagName === "TEXTAREA" ? browser.HTMLTextAreaElement.prototype : browser.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
}
async function select(element: HTMLSelectElement, value: string) {
  await act(async () => { element.value = value; element.dispatchEvent(new browser.Event("change", { bubbles: true })); });
}
const now = '2026-10-08T00:00:00Z';
const thread: ThreadSnapshot = {id:'synthetic-thread',modelId:'gpt-6-astra',title:'Synthetic',createdAt:now,updatedAt:now,
  webSearchMode:'off',instruction:'',reasoningMode:'auto',advanced:{},attachmentConsent:false,messages:[],messageCount:0};
async function chat(initial=thread, overrides:Record<string,unknown>={}) {
  let receive!:(event:any)=>void;let saved:any;let calls=0;
  Object.assign(browser,{mmllm:{discardAttachments:async()=>{},streamChat:(_request:any,cb:any)=>{calls++;receive=cb;return ()=>{};},
    updateThreadSettings:async(_id:string,settings:any)=>{saved=settings;return {...initial,...settings};},...overrides}});
  await render(<ConfirmProvider><ChatPanel thread={initial} models={[{id:initial.modelId,type:'llm'}]} modelId={initial.modelId}
    onModelChange={()=>{}} onThreadUpdated={()=>{}} onRefreshThreads={()=>{}} onUsageChanged={()=>{}} onTemplateStart={async()=>{}}
    onDraftApplied={()=>{}} /></ConfirmProvider>);
  return {receive:(e:any)=>receive(e),saved:()=>saved,calls:()=>calls};
}
test('actual advanced settings DOM defaults code off, shows minimum billing notice, opt-in saves and unknown is disabled',async()=>{
  const c=await chat();await click(document.querySelector('button[title="대화 설정"]')!);
  const check=document.querySelector<HTMLInputElement>('input[aria-label="서버 코드 실행 사용"]')!;
  assert.equal(check.checked,false);assert.equal(check.disabled,false);
  assert.match(document.body.textContent!,/Claude 최소 5분.*OpenAI 최소 15분.*토큰/);
  await click(check);await click(button('저장'));assert.equal(c.saved().advanced.serverCode,true);assert.equal(c.calls(),0);
  await render(<></>);await chat({...thread,modelId:'gpt-future'});await click(document.querySelector('button[title="대화 설정"]')!);
  assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="서버 코드 실행 사용"]')!.disabled,true);
});
test('actual message DOM displays delayed executing/code/output/error/artifact safely apart from manual function',async()=>{
  const c=await chat({...thread,advanced:{serverCode:true}});await input(composer(),'synthetic calculation');await click(document.querySelector('button[title="전송"]')!);
  const r={id:'ci_synthetic',provider:'responses',status:'executing',code:'print("<script>unsafe</script>")',summary:'제공사 실행 중',artifacts:[]};
  await act(async()=>c.receive({type:'server_code',result:r}));
  assert.match(document.querySelector('[aria-label="서버 코드 실행 결과"]')!.textContent!,/실행 중.*서버 실행 코드/);
  await act(async()=>c.receive({type:'server_code',result:{...r,status:'failed',stdout:'synthetic logs',stderr:'synthetic error',summary:'서버 도구 실패',artifacts:[{kind:'image'}]}}));
  assert.match(document.body.textContent!,/실패.*표준 출력.*표준 오류/);assert.match(document.body.textContent!,/메타데이터만/);
  assert.equal(document.querySelector('script'),null);
  await act(async()=>c.receive({type:'tool_call',call:{id:'manual_synthetic',name:'synthetic_metric',arguments:'{}',status:'waiting'}}));
  assert.ok(document.querySelector('[aria-label="수동 도구 호출"]'));assert.equal(c.calls(),1);
});
const field=(text:string)=>[...document.querySelectorAll('label')].find(l=>l.textContent?.includes(text))!;
const quoteFor=(r:any,bound='exact')=>({kind:r.kind,modelId:r.modelId,credits:3.5,bound,exact:bound==='exact',quotedAt:now,
  fingerprint:estimateFingerprint(r),lines:[{item:r.kind,credits:3,bound,exact:bound==='exact',basis:'synthetic'},{item:'content_filter',credits:.5,bound:'exact',exact:true,basis:'per_request',note:'SYNTHETIC_FILTER_NOTE'}],note:'SYNTHETIC_QUOTE_NOTE'});
import { estimateFingerprint, estimatePayload } from '../src/shared/media-estimate';
async function media(screen:'image'|'video'|'audio'='image',overrides:Record<string,unknown>={}) {
  const counts={estimate:0,generation:0,cancel:0,uploads:0};const estimates:any[]=[];const generations:any[]=[];const epoch={current:1};
  Object.assign(browser,{mmllm:{listMediaJobs:async()=>[],estimateMedia:async(_id:string,r:any)=>{counts.estimate++;estimates.push(r);return quoteFor(r);},
    cancelMediaEstimate:async()=>{counts.cancel++;},generateImage:async(r:any)=>{counts.generation++;generations.push(r);return {status:'completed',actualCredits:3,creditDisplay:'실제 차감 3 크레딧'};},
    generateVideo:async(r:any)=>{counts.generation++;generations.push(r);return {status:'completed'};},runAudio:async(r:any)=>{counts.generation++;generations.push(r);return {status:'completed'};},
    discardAttachments:async()=>{},releaseMedia:async()=>{},...overrides}});
  const models=[{id:'gpt-image-2',type:'image' as const},{id:'fal-ai/vidu/q3',type:'video' as const},{id:'elevenlabs-music',type:'audio' as const,audio_client:'elevenlabs'}];
  const ui=()=> <ConfirmProvider><MediaPanel screen={screen} models={models} workspaceEpochRef={epoch} onUsageChanged={()=>{}} onSummarizeTranscript={async()=>{}} /></ConfirmProvider>;
  await render(ui()); if(screen==='audio') await click(button('음악'));
  return {counts,estimates,generations,epoch,ui};
}
test('actual MediaPanel typing/options/render make zero quote calls; explicit quote lines/bound then generation options match',async()=>{
  const m=await media();await input(document.querySelector('.media-form textarea')!,'SYNTHETIC_PRIVATE_PROMPT');
  assert.equal(m.counts.estimate,0);assert.equal(m.counts.generation,0);
  await click(button('비용 확인'));assert.equal(m.counts.estimate,1);assert.doesNotMatch(JSON.stringify(m.estimates),/PRIVATE|prompt|bytes|attachment/);
  assert.match(document.querySelector('[aria-label="공식 생성 견적"]')!.textContent!,/확정 견적.*프롬프트 검사.*SYNTHETIC_FILTER_NOTE.*SYNTHETIC_QUOTE_NOTE/);
  await click(field('환자 식별정보').querySelector('input')!);
  await act(async()=>{button('생성하기').click();button('생성하기').click();});
  assert.equal(m.counts.generation,1);assert.equal(estimateFingerprint({...m.estimates[0],...Object.fromEntries(Object.entries(m.generations[0]).filter(([k])=>!['prompt','imageAttachmentIds','deidentifiedConfirmed'].includes(k)))}),estimateFingerprint(m.estimates[0]));
  assert.match(document.body.textContent!,/실제 차감 3 크레딧/);
});
test('actual video and music panels quote nested normalized generation options, changing options clears quote without auto calls',async()=>{
  for(const screen of ['video','audio'] as const) {
    const m=await media(screen);await input(document.querySelector('.media-form textarea')!,'SYNTHETIC');await click(button('비용 확인'));
    const r=m.estimates[0];assert.equal(r.kind,screen==='audio'?'music':'video');const payload=estimatePayload(r);
    if(screen==='video') assert.equal((payload.parameters as any).duration,2);else assert.equal(payload.duration_seconds,30);
    await click(field('환자 식별정보').querySelector('input')!);await click(button('생성하기'));assert.equal(m.counts.generation,1);
    const generation=m.generations[0];assert.equal(generation.durationSeconds,r.durationSeconds);
    await input(field(screen==='video'?'길이':'길이').querySelector('input')!,'8');assert.equal(m.counts.estimate,1);
    assert.doesNotMatch(document.querySelector('[aria-label="공식 생성 견적"]')!.textContent!,/확정 견적/);
    await render(<></>);
  }
});
test('actual quote double click only one request, cancel/option edit/account epoch discard late answers',async()=>{
  for(const action of ['cancel','edit','account']) {
    let done!:(v:any)=>void;let request:any;let calls=0;
    const m=await media('image',{estimateMedia:async(_id:string,r:any)=>{calls++;request=r;return new Promise(resolve=>{done=resolve;});}});
    await act(async()=>{button('비용 확인').click();button('비용 확인').click();});assert.equal(calls,1);
    if(action==='cancel') await click(button('비용 확인 취소'));
    if(action==='edit') await select(field('품질').querySelector('select')!,'high');
    if(action==='account') {m.epoch.current++;await render(m.ui());}
    await act(async()=>done(quoteFor(request)));assert.doesNotMatch(document.querySelector('[aria-label="공식 생성 견적"]')!.textContent!,/확정 견적/);
    assert.equal(calls,1);await render(<></>);
  }
});
test('actual MediaPanel quote unavailable supports explicit unquoted generation and no automatic retry',async()=>{
  const m=await media('image',{estimateMedia:async()=>{throw new Error('403 권한 없음 · 가격 미확인');}});
  await input(document.querySelector('.media-form textarea')!,'SYNTHETIC');await click(button('비용 확인'));
  assert.match(document.body.textContent!,/견적 불가.*403/);assert.doesNotMatch(document.body.textContent!,/견적 0 크레딧/);assert.equal(m.counts.generation,0);
  await click(field('환자 식별정보').querySelector('input')!);await click(button('견적 없이 생성'));assert.equal(m.counts.generation,1);
});
test('actual MediaPanel rejects certainty contradicted by generation/filter lines without confirmed cost or invented zero',async()=>{
  for(const [total,line,item] of [
    ['exact','minimum',0],['exact','maximum',0],['exact','approximate',0],
    ['minimum','maximum',0],['minimum','approximate',0],['maximum','minimum',0],['maximum','approximate',0],
    ['exact','minimum',1]
  ] as const) {
    let calls=0;
    const m=await media('image',{estimateMedia:async(_id:string,r:any)=>{
      calls++;const value=quoteFor(r,total);value.lines[item]={...value.lines[item],bound:line,exact:false};return value;
    }});
    await click(button('비용 확인'));
    const text=document.querySelector('[aria-label="공식 생성 견적"]')!.textContent!;
    assert.match(text,/견적 불가.*비용을 확인할 수 없습니다/);assert.doesNotMatch(text,/확정 견적|0 크레딧/);
    assert.equal(calls,1);assert.equal(m.counts.generation,0);assert.equal(m.counts.uploads,0);
    await render(<></>);
  }
});
test('actual MediaPanel malformed certainty retains separate explicit unquoted generation with normalized options once',async()=>{
  let calls=0;
  const m=await media('image',{estimateMedia:async(_id:string,r:any)=>{
    calls++;const value=quoteFor(r);value.lines[0]={...value.lines[0],bound:'minimum',exact:false};return value;
  }});
  await input(document.querySelector('.media-form textarea')!,'SYNTHETIC');await select(field('품질').querySelector('select')!,'high');
  await click(button('비용 확인'));assert.match(document.body.textContent!,/견적 불가/);assert.equal(m.counts.generation,0);
  await click(field('환자 식별정보').querySelector('input')!);
  await act(async()=>{button('견적 없이 생성').click();button('견적 없이 생성').click()});
  assert.equal(calls,1);assert.equal(m.counts.generation,1);assert.equal(m.generations[0].quality,'high');
  assert.equal(m.generations[0].deidentifiedConfirmed,true);assert.equal(m.counts.uploads,0);
});
test('actual quote DOM labels all four bounds and rejects model-kind/absent price instead of displaying zero',async()=>{
  for(const [bound,label] of [['exact','확정'],['minimum','최소'],['maximum','최대'],['approximate','대략']]) {
    await media('image',{estimateMedia:async(_id:string,r:any)=>quoteFor(r,bound)});await click(button('비용 확인'));
    assert.match(document.querySelector('[aria-label="공식 생성 견적"]')!.textContent!,new RegExp(label+' 견적'));
    await render(<></>);
  }
  for(const patch of [{modelId:'wrong'},{kind:'music'},{credits:undefined},{credits:-1},{credits:NaN}]) {
    await media('image',{estimateMedia:async(_id:string,r:any)=>({...quoteFor(r),...patch})});await click(button('비용 확인'));
    assert.match(document.querySelector('[aria-label="공식 생성 견적"]')!.textContent!,/견적 불가/);
    assert.doesNotMatch(document.querySelector('[aria-label="공식 생성 견적"]')!.textContent!,/확정 견적|0 크레딧/);
    await render(<></>);
  }
});
test('actual code/quote UI keeps keyboard focus, narrow layout and theme token styling',async()=>{
  await chat();const trigger=document.querySelector('button[title="대화 설정"]')!;await click(trigger);
  const checkbox=document.querySelector<HTMLInputElement>('input[aria-label="서버 코드 실행 사용"]')!;
  checkbox.focus();assertFocused(checkbox);await key('Escape');assert.equal(document.querySelector('input[aria-label="서버 코드 실행 사용"]'),null);
  assertFocused(trigger);
  browser.happyDOM.setWindowSize({width:390,height:780});await render(<></>);await media();await click(button('비용 확인'));
  const quote=document.querySelector<HTMLElement>('.media-quote')!;assert.match(quote.textContent!,/확정 견적/);
  const css=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../src/renderer/src/styles.css',import.meta.url),'utf8'));
  assert.match(css,/\.media-quote[^}]*var\(--color-border\)[^}]*var\(--color-text-secondary\)[^}]*overflow-wrap: anywhere/s);
  browser.happyDOM.setWindowSize({width:1280,height:800});
});

test('L10: MediaPanel with a reference image shows a minimum quote, never a confirmed one',async()=>{
  const m=await media('image',{pickAttachment:async()=>({id:'att_ref',name:'ref.png',kind:'image',size:10})});
  await click(document.querySelector<HTMLElement>('.reference-button')!);
  await click(button('비용 확인'));assert.equal(m.counts.estimate,1);
  const text=document.querySelector('[aria-label="공식 생성 견적"]')!.textContent!;
  assert.match(text,/참고 이미지 제외 · 최소 견적/);assert.doesNotMatch(text,/확정 견적|생성 · 확정/);
});
