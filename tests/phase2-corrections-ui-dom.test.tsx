import assert from "node:assert/strict";
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
let App: typeof import("../src/renderer/src/App")["default"];
let ChatPanel: typeof import("../src/renderer/src/ChatPanel")["ChatPanel"];
let ConfirmProvider: typeof import("../src/renderer/src/components/ConfirmDialog")["ConfirmProvider"];
let root: Root | null = null;
let host: HTMLDivElement | null = null;
before(async () => {
  Object.defineProperty(globalThis, "MutationObserver", { value: browser.MutationObserver, configurable: true });
  Object.defineProperty(globalThis, "ResizeObserver", { value: browser.ResizeObserver, configurable: true });
  Object.defineProperty(globalThis, "IntersectionObserver", { value: browser.IntersectionObserver, configurable: true });
  ({ createRoot } = await import("react-dom/client"));
  ({ default: App } = await import("../src/renderer/src/App"));
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
const now = "2026-10-08T00:00:00Z";
const llm: ThreadSnapshot = { id: "synthetic-llm", title: "Synthetic LLM", modelId: "gpt-5.6-luna",
  createdAt: now, updatedAt: now, webSearchMode: "off", reasoningMode: "auto", instruction: "",
  advanced: {}, attachmentConsent: true, messages: [], messageCount: 0 };
const chatbot: ThreadSnapshot = { ...llm, id: "synthetic-chatbot", title: "Synthetic chatbot", modelId: "gpt-6-astra",
  target: { kind: "chatbot", chatbotId: "synthetic-bot", bookmarkId: "synthetic-bookmark", alias: "Synthetic chatbot" } };
const target: ThreadSnapshot = { ...llm, id: "synthetic-new-llm", title: "Evidence LLM" };
const suite = { slug: "synthetic", title: "Synthetic", description: "" };
const tool = { token: "synthetic-token", name: "synthetic_search", description: "Synthetic", schema: "{}", executable: true,
  fields: [{ name: "query", type: "string" as const, required: true }] };
const result: ResearchResult = { id: "synthetic", suite: suite.slug, tool: tool.name, query: "Synthetic", searchedAt: now,
  rawText: "SYNTHETIC_EVIDENCE", sources: [], notice: "초록만 제공; 법령 현행 여부 미확인" };
async function app(initial = llm, overrides: Record<string, unknown> = {}) {
  const counts = { paid: 0, creates: 0, searches: 0 }; const discarded: string[] = [];
  const items = new Map([[initial.id, initial], [llm.id, llm]]);
  Object.assign(browser, { mmllm: {
    getSession: async () => ({ authenticated: true, models: [llm.modelId, chatbot.modelId].map((id) => ({ id, type: "llm" })), credits: { total: { remaining: 100 } } }),
    getSettings: async () => ({ theme: "dark", fontSize: "medium", defaultInstruction: "" }), setThemePreference: async () => {},
    listThreads: async () => [...items.values()], loadThread: async (id: string) => items.get(id),
    createThread: async () => { counts.creates++; items.set(target.id, target); return target; },
    listProjects: async () => [], listBackgroundResponses: async () => [],
    getUpdateState: async () => ({ status: "idle", currentVersion: "0.5.1" }), onUpdateChanged: () => () => {},
    pickAttachment: async () => ({ id: "synthetic-attachment", name: "synthetic.pdf", kind: "document", size: 100 }),
    discardAttachments: async (ids: string[]) => { discarded.push(...ids); },
    streamChat: () => { counts.paid++; return () => {}; }, streamChatbot: () => { counts.paid++; return () => {}; },
    discoverResearch: async () => [suite], listResearchTools: async () => [tool],
    searchResearch: async () => ({ ...result, rawText: `SYNTHETIC_EVIDENCE_${++counts.searches}` }), cancelResearch: async () => {},
    logout: async () => {}, ...overrides
  } });
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  return { counts, discarded, items };
}
async function research() {
  if (!document.querySelector(".workspace-tools-dialog")) await click(button("모델 비교"));
  if (!document.querySelector(".research-panel")) await click(button("논문·법령 검색"));
  await click(button("검색 도구 확인")); await select(document.querySelector<HTMLSelectElement>(".research-panel select")!, suite.slug);
  await click(button("선택한 묶음")); await select(document.querySelectorAll<HTMLSelectElement>(".research-panel select")[1], tool.token);
  await input(document.querySelector<HTMLInputElement>(".research-panel input")!, "Synthetic"); await click(button("검색 실행"));
}
test("actual App/ChatPanel preserves current draft and attachment through two research evidence insertions without sending", async () => {
  const { counts, discarded } = await app(); await input(composer(), "ORIGINAL_QUESTION"); await click(button("파일 첨부"));
  await research(); await input(composer(), "ORIGINAL_QUESTION + CONCURRENT_TYPING"); await click(button("근거 추가"));
  await input(composer(), composer().value + "\nLATER_TYPING"); await research(); await click(button("근거 추가"));
  const draft = composer().value;
  assert.ok(draft.startsWith("ORIGINAL_QUESTION + CONCURRENT_TYPING"));
  assert.match(draft, /SYNTHETIC_EVIDENCE_1[\s\S]*LATER_TYPING[\s\S]*SYNTHETIC_EVIDENCE_2/);
  assert.equal((draft.match(/\[외부 검색 근거/g) ?? []).length, 2);
  assert.equal(document.querySelectorAll(".attachment-chip").length, 1);
  assert.match(document.querySelector(".attachment-chip")!.textContent!, /synthetic.pdf/);
  assert.deepEqual(discarded, []); assert.equal(counts.paid, 0); assert.equal(counts.creates, 0);
});
test("actual App project evidence shares append semantics and preserves draft and attachment twice", async () => {
  const project = { id: "synthetic-project", name: "Synthetic project", instruction: "", documents: [], threadCount: 0, createdAt: now, updatedAt: now };
  let searches = 0;
  const { counts, discarded } = await app(llm, { listProjects: async () => [project],
    getProjectRetrieval: async () => ({ settings: { mode: "local", queryConsent: false, rerankConsent: false }, documents: [], uncertain: 0, running: false }),
    searchProjectDocuments: async () => ({ hits: [], text: `PROJECT_EVIDENCE_${++searches}`, notice: "합성 로컬 근거" }) });
  await input(composer(), "PROJECT_QUESTION"); await click(button("파일 첨부"));
  for (let i = 0; i < 2; i++) {
    await click([...document.querySelectorAll<HTMLButtonElement>(".sidebar button")].find((item) => item.textContent?.includes("프로젝트"))!);
    await input(document.querySelector<HTMLInputElement>(".project-retrieval-settings input[type=text], .project-retrieval input[type=text]") ??
      [...document.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent?.includes("문서 검색어"))!.querySelector("input")!, "Synthetic");
    await click(button("저장한 설정으로 문서 검색")); await click(button("근거 추가"));
  }
  assert.match(composer().value, /^PROJECT_QUESTION[\s\S]*PROJECT_EVIDENCE_1[\s\S]*PROJECT_EVIDENCE_2/);
  assert.equal(document.querySelectorAll(".attachment-chip").length, 1); assert.deepEqual(discarded, []); assert.equal(counts.paid, 0);
});
test("actual App selects evidence LLM/model from chatbot and restores the chatbot draft including typing during creation", async () => {
  let finish!: (value: ThreadSnapshot) => void; let creates = 0;
  const { counts, items } = await app(chatbot, { createThread: () => { creates++; return new Promise((resolve) => { finish = resolve; }); } });
  await input(composer(), "CHATBOT_QUESTION"); await research();
  const add = button("근거 추가"); await act(async () => { add.click(); add.click(); }); assert.equal(creates, 1);
  await input(composer(), "CHATBOT_QUESTION + LATE_TYPING");
  await act(async () => { items.set(target.id, target); finish(target); });
  assert.match(document.querySelector(".thread-item.selected")!.textContent!, /Evidence LLM/);
  assert.match(document.querySelector(".model-trigger")!.textContent!, /GPT-5.6 Luna/i);
  assert.equal((composer().value.match(/SYNTHETIC_EVIDENCE_1/g) ?? []).length, 2); assert.equal(counts.paid, 0);
  await click(document.querySelector<HTMLButtonElement>('.thread-select[title="Synthetic chatbot"]')!);
  assert.equal(composer().value, "CHATBOT_QUESTION + LATE_TYPING"); assert.equal(counts.paid, 0);
});
for (const change of ["close", "panel", "selection", "account"] as const) {
  test(`actual App drops late chatbot evidence creation after ${change} ownership changes`, async () => {
    let finish!: (value: ThreadSnapshot) => void;
    const { counts, items } = await app(chatbot, { createThread: () => new Promise((resolve) => { finish = resolve; }) });
    await input(composer(), "KEEP_CHATBOT"); await research(); await click(button("근거 추가"));
    if (change === "close") await click(document.querySelector('[aria-label="워크스페이스 도구 닫기"]')!);
    if (change === "panel") await click(button("기존 도구로 돌아가기"));
    if (change === "selection") {
      // A real sidebar action starts a newer selection request while creation is still pending.
      await click(document.querySelector<HTMLButtonElement>('.thread-select[title="Synthetic LLM"]')!);
    }
    if (change === "account") {
      await click(document.querySelector('[aria-label="워크스페이스 도구 닫기"]')!);
      await click(document.querySelector('[aria-label^="설정·계정"]')!); await click(button("로그아웃"));
      const accountThread = { ...llm, id: "synthetic-second-account", title: "Second account LLM" };
      items.clear(); items.set(accountThread.id, accountThread);
      window.mmllm.login = async () => ({ authenticated: true, models: [{ id: llm.modelId, type: "llm" }] });
      await input(document.querySelector<HTMLInputElement>("#api-key")!, "synthetic-second-account-key");
      await click(button("시작하기"));
    }
    await act(async () => finish(target));
    assert.equal(document.querySelector('.thread-select[title="Evidence LLM"]'), null);
    if (change === "account") assert.match(document.querySelector(".thread-item.selected")!.textContent!, /Second account LLM/);
    if (change === "selection") assert.match(document.querySelector(".thread-item.selected")!.textContent!, /Synthetic LLM/);
    assert.doesNotMatch(composer().value, /SYNTHETIC_EVIDENCE/);
    assert.equal(counts.paid, 0);
  });
}
test("actual ChatPanel keeps template replacement distinct from evidence append", async () => {
  Object.assign(browser, { mmllm: { discardAttachments: async () => {} } });
  const props = { thread: llm, modelId: llm.modelId, models: [{ id: llm.modelId, type: "llm" as const }],
    onModelChange: () => {}, onThreadUpdated: () => {}, onRefreshThreads: () => {}, onUsageChanged: () => {},
    onTemplateStart: async () => {}, onDraftApplied: () => {}, onEvidenceApplied: () => {} };
  await render(<ConfirmProvider><ChatPanel {...props} initialDraft="TEMPLATE_ONE" /></ConfirmProvider>);
  await input(composer(), "TYPED_DRAFT");
  const evidence = [{ id: "synthetic-operation", threadId: llm.id, text: "APPENDED_EVIDENCE" }];
  await render(<ConfirmProvider><ChatPanel {...props} evidenceAppends={evidence} /></ConfirmProvider>);
  assert.equal(composer().value, "TYPED_DRAFT\n\nAPPENDED_EVIDENCE");
  await render(<ConfirmProvider><ChatPanel {...props} initialDraft="TEMPLATE_TWO" evidenceAppends={evidence} /></ConfirmProvider>);
  assert.equal(composer().value, "TEMPLATE_TWO");
});
