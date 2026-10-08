import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { Window } from "happy-dom";
import * as React from "react";
import type { Root } from "react-dom/client";
import type { GatewayModel, ProjectSummary } from "../src/shared/contracts";
import type { ResearchResult, ResearchSuite, ResearchTool } from "../src/shared/research";
import { LOCAL_RETRIEVAL, type RetrievalSettings, type RetrievalStatus } from "../src/shared/document-retrieval";
const browser = new Window({ url: "https://mm-llm.local/" });
browser.document.write("<!doctype html><html><body></body></html>");
for (const [name, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement, HTMLButtonElement: browser.HTMLButtonElement,
  Event: browser.Event, KeyboardEvent: browser.KeyboardEvent, MouseEvent: browser.MouseEvent,
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle }))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
const { act } = React;
let createRoot: typeof import("react-dom/client")["createRoot"];
let ResearchPanel: typeof import("../src/renderer/src/ResearchPanel")["ResearchPanel"];
let ProjectRetrievalSettings: typeof import("../src/renderer/src/ProjectRetrievalSettings")["ProjectRetrievalSettings"];
let ConfirmProvider: typeof import("../src/renderer/src/components/ConfirmDialog")["ConfirmProvider"];
let root: Root | null = null; let host: HTMLDivElement | null = null;
before(async () => {
  ({ createRoot } = await import("react-dom/client"));
  ({ ResearchPanel } = await import("../src/renderer/src/ResearchPanel"));
  ({ ProjectRetrievalSettings } = await import("../src/renderer/src/ProjectRetrievalSettings"));
  ({ ConfirmProvider } = await import("../src/renderer/src/components/ConfirmDialog"));
});
async function render(ui: React.ReactNode) { if (!host) { host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => { root!.render(ui); }); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); }
async function click(element: Element) { await act(async () => { (element as HTMLElement).focus(); (element as HTMLElement).click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes(text))!;
const field = (text: string) => [...document.querySelectorAll("label")].find((label) => label.textContent?.includes(text))!;
async function select(element: HTMLSelectElement, value: string) { await act(async () => { element.value = value; element.dispatchEvent(new browser.Event("change", { bubbles: true })); }); }
async function input(element: HTMLInputElement, value: string) { await act(async () => {
  Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new browser.Event("input", { bubbles: true })); }); }
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; host?.remove(); host = null; });
const tool: ResearchTool = { token: "synthetic-token", name: "synthetic_search", description: "합성 읽기 전용 검색", schema: "{ synthetic: true }", executable: true,
  fields: [{ name: "words", type: "string", required: true, maxLength: 2000 }] };
const suite: ResearchSuite = { slug: "synthetic", title: "합성 논문·법령", description: "" };
const result: ResearchResult = { id: "synthetic", suite: suite.slug, tool: tool.name, query: "합성 질의", searchedAt: "2026-10-08T10:00:00Z", rawText: "합성 초록",
  notice: "검색 결과·초록은 원문 전체가 아닙니다. 법령 현행 여부 미확인", sources: [{ title: "합성 논문 <script>unsafe</script>", url: "https://example.org/original", dates: { published_date: "2026-02-03" }, text: "합성 초록 본문", searchedAt: "2026-10-08T10:00:00Z", kind: "search-result" }] };
async function readyResearch(search: () => Promise<ResearchResult> = async () => result) {
  const counts = { discover: 0, tools: 0, search: 0, cancel: 0 }; const evidence: string[] = [];
  Object.assign(browser, { mmllm: { discoverResearch: async () => { counts.discover++; return [suite]; },
    listResearchTools: async () => { counts.tools++; return [tool, { ...tool, token: "unknown", executable: false, reason: "미검토 스키마" }]; },
    searchResearch: async () => { counts.search++; return search(); }, cancelResearch: async () => { counts.cancel++; }, openExternal: async () => {} } });
  await render(<ResearchPanel onEvidence={(text) => evidence.push(text)} />); assert.deepEqual(counts, { discover: 0, tools: 0, search: 0, cancel: 0 });
  await click(button("검색 도구 확인")); assert.equal(counts.discover, 1); assert.equal(counts.tools, 0);
  await select(field("발견한 묶음").querySelector("select")!, suite.slug); assert.equal(counts.tools, 0);
  await click(button("선택한 묶음")); await select(field("도구").querySelector("select")!, tool.token);
  return { counts, evidence };
}
test("actual research DOM only discovers selected suite by explicit action, typing is free and results preserve provenance", async () => {
  const { counts, evidence } = await readyResearch();
  await input(field("words").querySelector("input")!, "합성 질의"); assert.equal(counts.search, 0);
  await click(button("검색 실행")); assert.equal(counts.search, 1);
  assert.match(document.querySelector(".research-results")!.textContent!, /2026-02-03/);
  assert.match(document.body.textContent!, /https:\/\/example.org\/original/); assert.match(document.body.textContent!, /2026-10-08T10:00:00Z/);
  assert.match(document.body.textContent!, /초록은 원문 전체가 아닙니다.*현행 여부 미확인/);
  assert.equal(document.querySelector("script"), null);
  await click(button("근거 추가")); assert.match(evidence[0], /신뢰하지 않는 자료/); assert.match(evidence[0], /원래|example.org\/original/);
  await select(field("도구").querySelector("select")!, "unknown"); assert.equal(button("검색 실행").disabled, true);
  await click(button("검색 실행")); assert.equal(counts.search, 1);
});
test("actual research component cancels on close and drops a delayed response", async () => {
  let resolve!: (value: ResearchResult) => void;
  const { counts } = await readyResearch(() => new Promise((done) => { resolve = done; }));
  await input(field("words").querySelector("input")!, "합성 질의"); await click(button("검색 실행"));
  assert.equal(counts.search, 1); await render(<div>closed</div>); assert.equal(counts.cancel, 1);
  await act(async () => resolve(result)); assert.equal(document.querySelector(".research-results"), null);
});
const now = "2026-10-08T00:00:00Z";
const project: ProjectSummary = { id: "synthetic-project", name: "합성", instruction: "", threadCount: 0, createdAt: now, updatedAt: now,
  documents: [{ id: "synthetic-document", name: "합성.pdf", mime: "application/pdf", size: 20, createdAt: now }] };
const models: GatewayModel[] = [{ id: "text-embedding-3-small", type: "embedding" }, { id: "qwen3-rerank", type: "rerank" }];
function projectApi(initial: RetrievalSettings = { ...LOCAL_RETRIEVAL }) {
  let saved = { ...initial }; const counts = { configure: 0, index: 0, search: 0, cancel: 0 };
  const status = (): RetrievalStatus => ({ settings: saved, documents: [{ id: "synthetic-document", name: "合成.pdf", completed: counts.index ? 1 : 0, total: 1 }], uncertain: 0, running: false });
  Object.assign(browser, { mmllm: { getProjectRetrieval: async () => status(), configureProjectRetrieval: async (_id: string, settings: RetrievalSettings) => { counts.configure++; saved = { ...settings }; },
    startProjectIndex: async (_request: string, _project: string, consent: boolean, resume: boolean) => { assert.equal(consent, true); assert.equal(resume, true); counts.index++; return status(); },
    searchProjectDocuments: async () => { counts.search++; return { hits: [], text: "", notice: "合成 검색" }; }, cancelResearch: async () => { counts.cancel++; } } });
  return { counts, saved: () => saved };
}
const projectUi = () => <ConfirmProvider><ProjectRetrievalSettings project={project} models={models} onEvidence={() => {}} /></ConfirmProvider>;
test("actual project DOM separates query/rerank consent from index-start confirmation and sends no paid requests on edits", async () => {
  const { counts, saved } = projectApi(); await render(projectUi());
  await select(field("검색 방식").querySelector("select")!, "semantic");
  await select(field("임베딩 모델").querySelector("select")!, "text-embedding-3-small");
  assert.equal(button("검색 설정 저장").disabled, true); await click(field("질의를 선택한 모델").querySelector("input")!);
  await click(field("재정렬에 별도 동의").querySelector("input")!); await select(field("재정렬 모델").querySelector("select")!, "qwen3-rerank");
  await input(field("문서 검색어").querySelector("input")!, "合成 질의"); assert.equal(counts.index + counts.search, 0);
  await click(button("검색 설정 저장")); assert.equal(counts.configure, 1); assert.equal(saved().rerankConsent, true); assert.equal(counts.index, 0);
  await click(button("색인 시작 동의")); assert.match(document.querySelector('[role="dialog"]')!.textContent!, /중복 과금/);
  await act(async () => { document.activeElement?.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  assert.equal(counts.index, 0); await click(button("색인 시작 동의")); await click(button("동의하고 색인 시작")); assert.equal(counts.index, 1);
  assert.match(document.body.textContent!, /1\/1청크/); await click(button("저장한 설정으로 문서 검색")); assert.equal(counts.search, 1);
  assert.match(document.body.textContent!, /후보 최대 20개 전체.*최종 5개/);
});
test("actual project settings reopen uses authoritative saved mode and manual status refresh preserves dirty edits", async () => {
  projectApi({ mode: "semantic", embeddingModelId: models[0].id, queryConsent: true, rerankConsent: false });
  await render(projectUi()); assert.equal(field("검색 방식").querySelector<HTMLSelectElement>("select")!.value, "semantic");
  await render(<div>closed</div>); await render(projectUi());
  assert.equal(field("검색 방식").querySelector<HTMLSelectElement>("select")!.value, "semantic");
  assert.equal(field("질의를 선택한 모델").querySelector<HTMLInputElement>("input")!.checked, true);
  await select(field("검색 방식").querySelector("select")!, "local"); await click(button("색인 상태 확인"));
  assert.equal(field("검색 방식").querySelector<HTMLSelectElement>("select")!.value, "local");
});
test("actual restored project DOM says rebuild-required, starts local and has zero paid requests", async () => {
  const { counts } = projectApi({ ...LOCAL_RETRIEVAL, rebuildRequired: true }); await render(projectUi());
  assert.match(document.body.textContent!, /재구축이 필요/); assert.equal(button("색인 시작 동의").disabled, true);
  assert.equal(counts.index + counts.search, 0); assert.match(document.body.textContent!, /대기 1/);
});
test("actual research back-to-back DOM clicks make one paid call and keep cancellation ownership", async () => {
  let resolve!: (value: ResearchResult) => void;
  const { counts } = await readyResearch(() => new Promise((done) => { resolve = done; }));
  await input(field("words").querySelector("input")!, "合成 질의");
  const send = button("검색 실행");
  await act(async () => { send.click(); send.click(); });
  assert.equal(counts.search, 1);
  await render(<div>closed</div>); assert.equal(counts.cancel, 1);
  await act(async () => resolve(result)); assert.equal(document.querySelector(".research-results"), null);
});
test("actual project back-to-back search clicks make one call and cancel the same owned request", async () => {
  const { counts } = projectApi(); let resolve!: (value: any) => void;
  window.mmllm.searchProjectDocuments = async () => { counts.search++; return new Promise((done) => { resolve = done; }); };
  await render(projectUi()); await input(field("문서 검색어").querySelector("input")!, "合成 질의");
  const send = button("저장한 설정으로 문서 검색"); await act(async () => { send.click(); send.click(); }); assert.equal(counts.search, 1);
  await render(<div>closed</div>); assert.equal(counts.cancel, 1);
  await act(async () => resolve({ hits: [], text: "late", notice: "late" })); assert.equal(document.querySelector(".research-results"), null);
});
