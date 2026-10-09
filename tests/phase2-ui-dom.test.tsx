import assert, { assertFocused } from "./dom-assert.ts";
import test, { afterEach, before } from "node:test";
import { Window } from "happy-dom";
import * as React from "react";
import type { Root } from "react-dom/client";
import type { GatewayModel, ProjectSummary, ThreadSummary } from "../src/shared/contracts";
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
let ResearchScreen: typeof import("../src/renderer/src/ResearchScreen")["ResearchScreen"];
let ProjectRetrievalSettings: typeof import("../src/renderer/src/ProjectRetrievalSettings")["ProjectRetrievalSettings"];
let ProjectsScreen: typeof import("../src/renderer/src/ProjectsScreen")["ProjectsScreen"];
let ConfirmProvider: typeof import("../src/renderer/src/components/ConfirmDialog")["ConfirmProvider"];
let root: Root | null = null; let host: HTMLDivElement | null = null;
before(async () => {
  ({ createRoot } = await import("react-dom/client"));
  ({ ResearchScreen } = await import("../src/renderer/src/ResearchScreen"));
  ({ ProjectRetrievalSettings } = await import("../src/renderer/src/ProjectRetrievalSettings"));
  ({ ProjectsScreen } = await import("../src/renderer/src/ProjectsScreen"));
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
  // Stage 4 (D4.3): ResearchScreen absorbed ResearchPanel; the suite is a select, tools are a selectable list.
  await render(<ResearchScreen onEvidence={(text) => evidence.push(text)} />); assert.deepEqual(counts, { discover: 0, tools: 0, search: 0, cancel: 0 });
  await click(button("검색 도구 확인")); assert.equal(counts.discover, 1); assert.equal(counts.tools, 0);
  await select(field("검색 묶음").querySelector("select")!, suite.slug); assert.equal(counts.tools, 0);
  await click(button("선택한 묶음")); await click(toolRows()[0]);
  return { counts, evidence };
}
const toolRows = () => [...document.querySelectorAll<HTMLButtonElement>(".research-tools button")];
const resultChecks = () => [...document.querySelectorAll<HTMLInputElement>(".research-result input[type='checkbox']")];
test("actual research DOM only discovers selected suite by explicit action, typing is free and results preserve provenance", async () => {
  const { counts, evidence } = await readyResearch();
  await input(field("words").querySelector("input")!, "합성 질의"); assert.equal(counts.search, 0);
  await click(button("검색 실행")); assert.equal(counts.search, 1);
  assert.match(document.querySelector(".research-results")!.textContent!, /2026-02-03/);
  assert.match(document.body.textContent!, /https:\/\/example.org\/original/); assert.match(document.body.textContent!, /2026-10-08T10:00:00Z/);
  assert.match(document.body.textContent!, /초록은 원문 전체가 아닙니다.*현행 여부 미확인/);
  assert.equal(document.querySelector("script"), null);
  // Evidence carries only the results the student ticked (D4.3); with nothing ticked the action is disabled.
  assert.equal(button("근거 추가").disabled, true); await click(button("근거 추가")); assert.equal(evidence.length, 0);
  await click(resultChecks()[0]);
  await click(button("근거 추가")); assert.match(evidence[0], /신뢰하지 않는 자료/); assert.match(evidence[0], /원래|example.org\/original/);
  // An unreviewed tool is listed but cannot be selected or run.
  const unknown = toolRows()[1]; assert.equal(unknown.getAttribute("aria-disabled"), "true"); assert.match(unknown.textContent!, /실행 미검토/);
  await click(unknown); assert.equal(toolRows()[1].getAttribute("aria-pressed"), "false"); assert.equal(toolRows()[0].getAttribute("aria-pressed"), "true");
  assert.equal(counts.search, 1);
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
function projectApi(initial: RetrievalSettings = { ...LOCAL_RETRIEVAL }, uncertain = 0) {
  let saved = { ...initial }; const counts = { configure: 0, index: 0, search: 0, cancel: 0 }; const resumes: boolean[] = [];
  const status = (): RetrievalStatus => ({ settings: saved, documents: [{ id: "synthetic-document", name: "合成.pdf", completed: counts.index ? 1 : 0, total: 1 }], uncertain: counts.index ? 0 : uncertain, running: false });
  Object.assign(browser, { mmllm: { getProjectRetrieval: async () => status(), configureProjectRetrieval: async (_id: string, settings: RetrievalSettings) => { counts.configure++; saved = { ...settings }; },
    startProjectIndex: async (_request: string, _project: string, consent: boolean, resume: boolean) => { assert.equal(consent, true); resumes.push(resume); counts.index++; return status(); },
    searchProjectDocuments: async () => { counts.search++; return { hits: [], text: "", notice: "合成 검색" }; }, cancelResearch: async () => { counts.cancel++; } } });
  return { counts, saved: () => saved, resumes };
}
const dialogTitle = () => document.querySelector('[role="dialog"] h2')?.textContent;
const projectUi = () => <ConfirmProvider><ProjectRetrievalSettings project={project} models={models} onEvidence={() => {}} /></ConfirmProvider>;
test("actual project DOM separates query/rerank consent from index-start confirmation and sends no paid requests on edits", async () => {
  const { counts, saved, resumes } = projectApi(); await render(projectUi());
  await select(field("검색 방식").querySelector("select")!, "semantic");
  await select(field("임베딩 모델").querySelector("select")!, "text-embedding-3-small");
  assert.equal(button("검색 설정 저장").disabled, true); await click(field("질의를 선택한 모델").querySelector("input")!);
  await click(field("재정렬에 별도 동의").querySelector("input")!); await select(field("재정렬 모델").querySelector("select")!, "qwen3-rerank");
  await input(field("문서 검색어").querySelector("input")!, "合成 질의"); assert.equal(counts.index + counts.search, 0);
  await click(button("검색 설정 저장")); assert.equal(counts.configure, 1); assert.equal(saved().rerankConsent, true); assert.equal(counts.index, 0);
  await click(button("색인 시작 동의")); assert.match(document.querySelector('[role="dialog"]')!.textContent!, /중복 과금/);
  await act(async () => { document.activeElement?.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  assert.equal(counts.index, 0); await click(button("색인 시작 동의")); assert.equal(dialogTitle(), "의미 색인 시작");
  await click(button("동의하고 색인 시작")); assert.equal(counts.index, 1); assert.deepEqual(resumes, [false]);
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

// Exercise the real DOM transition, while the main IPC test independently validates the boundary.
test("actual ResearchScreen optional enum query -> papers -> omission deletes the argument", async () => {
  const { validateResearchArguments } = await import("../src/shared/research");
  const scoped = { ...tool, fields: [...tool.fields, { name: "scope", type: "string" as const, required: false, enum: ["papers", "laws"] }] };
  const args: Record<string, unknown>[] = [];
  await readyResearch();
  window.mmllm.listResearchTools = async () => [scoped];
  window.mmllm.searchResearch = async (_id, _token, value) => {
    validateResearchArguments(scoped.fields, value); args.push(structuredClone(value)); return result;
  };
  await click(button("선택한 묶음")); await click(toolRows()[0]);
  await input(field("words").querySelector("input")!, "Synthetic"); await click(button("검색 실행"));
  const scope = field("scope").querySelector("select")!;
  await select(scope, "papers"); await click(button("검색 실행"));
  await select(scope, ""); await click(button("검색 실행"));
  assert.deepEqual(args, [{ words: "Synthetic" }, { words: "Synthetic", scope: "papers" }, { words: "Synthetic" }]);
  assert.equal(Object.hasOwn(args[2], "scope"), false); assert.equal(document.querySelector('[role="alert"]'), null);
});

test("L1 project index sends resume consent only after the user approves a resume of uncertain chunks", async () => {
  const semantic: RetrievalSettings = { mode: "semantic", embeddingModelId: models[0].id, queryConsent: true, rerankConsent: false };
  const { counts, resumes } = projectApi(semantic, 3); await render(projectUi());
  assert.match(document.body.textContent!, /미확정 3청크/); await click(button("색인 재개 동의"));
  assert.equal(dialogTitle(), "의미 색인 재개"); assert.match(document.querySelector('[role="dialog"]')!.textContent!, /중복 과금/);
  await act(async () => { document.activeElement?.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  assert.equal(counts.index, 0); await click(button("색인 재개 동의")); await click(button("동의하고 색인 재개"));
  assert.equal(counts.index, 1); assert.deepEqual(resumes, [true]);
});
test("L1 a stale zero-uncertain status sends resume false, shows the main rejection and refreshes without retrying", async () => {
  const semantic: RetrievalSettings = { mode: "semantic", embeddingModelId: models[0].id, queryConsent: true, rerankConsent: false };
  const { counts, resumes } = projectApi(semantic); await render(projectUi()); let uncertain = 0;
  window.mmllm.getProjectRetrieval = async () => ({ settings: semantic, documents: [{ id: "synthetic-document", name: "合成.pdf", completed: 0, total: 1 }], uncertain, running: false });
  window.mmllm.startProjectIndex = async (_request: string, _project: string, _consent: boolean, resume: boolean) => {
    resumes.push(resume); counts.index++; uncertain = 1; throw new Error("이전 중단 요청의 과금 여부가 미확정입니다. 재개 동의가 필요합니다."); };
  await click(button("색인 시작 동의")); await click(button("동의하고 색인 시작"));
  assert.deepEqual(resumes, [false]); assert.equal(counts.index, 1);
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /재개 동의/); assert.ok(button("색인 재개 동의"));
});

// ---- Stage 4 (D4.7): ProjectsScreen (props-only) ---------------------------------------------------------------
const doc = (id: string, name: string, mime: string, size: number) => ({ id, name, mime, size, createdAt: now });
const PDF = "application/pdf"; const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const screenProject: ProjectSummary = { id: "p1", name: "졸업논문 합성", instruction: "APA 7 형식을 따른다.", threadCount: 2, createdAt: now, updatedAt: now,
  documents: [doc("d-done", "완료.xlsx", XLSX, 48 * 1024), doc("d-wait", "대기.docx", DOCX, 28 * 1024), doc("d-pdf", "스캔.pdf", PDF, 2_200_000), doc("d-docx", "텍스트없음.docx", DOCX, 1024)] };
const otherProject: ProjectSummary = { id: "p2", name: "의료정책 합성", instruction: "", threadCount: 0, createdAt: now, updatedAt: now, documents: [] };
const thr = (id: string, title: string, projectId?: string): ThreadSummary => ({ id, title, modelId: "m", createdAt: now, updatedAt: now, messageCount: 3, webSearchMode: "off", pinned: false, projectId });
function retrievalStatus(partial: Partial<RetrievalStatus> = {}): RetrievalStatus {
  return { settings: { ...LOCAL_RETRIEVAL }, documents: [{ id: "d-done", name: "완료.xlsx", completed: 24, total: 24 }, { id: "d-wait", name: "대기.docx", completed: 14, total: 38 }],
    uncertain: 0, running: false, ...partial };
}
function screenFixture(over: Record<string, unknown> = {}, api: Record<string, unknown> = {}) {
  const calls: Array<[string, ...unknown[]]> = []; const log = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  Object.assign(browser, { mmllm: { getProjectRetrieval: async () => retrievalStatus(), cancelResearch: async () => {}, ...api } });
  const props = { projects: [screenProject, otherProject], selectedProjectId: "p1", onSelectProject: log("select"), threads: [thr("t1", "대화 하나", "p1"), thr("t2", "다른 대화", "p2"), thr("t3", "미분류")],
    currentThread: { id: "t3", projectId: undefined, target: undefined }, models, busy: false, onSaveProject: log("save"), onDeleteProject: log("delete"),
    onAddDocument: log("add"), onRemoveDocument: log("remove"), onAssignCurrentThread: log("assign"), onNewThread: log("newThread"), onOpenThread: log("open"), onEvidence: log("evidence"), ...over };
  const ui = () => <ConfirmProvider><ProjectsScreen {...props as any} /></ConfirmProvider>;
  return { calls, props, ui };
}
const badge = (name: string) => [...document.querySelectorAll("tr")].find((row) => row.textContent?.includes(name))!.querySelector(".project-index-badge")!;
test("D4.7 index badge shows done, waiting and no-text states with the actual retrieval counts", async () => {
  const f = screenFixture(); await render(f.ui());
  assert.equal(badge("완료.xlsx").textContent, "완료 · 24/24"); assert.equal(badge("완료.xlsx").getAttribute("data-state"), "done");
  assert.equal(badge("대기.docx").textContent, "대기"); assert.equal(badge("대기.docx").getAttribute("data-state"), "waiting");
  assert.equal(badge("대기.docx").getAttribute("title"), "14/38청크 색인됨 · 시작 전까지 대기");
  assert.equal(badge("스캔.pdf").textContent, "텍스트 없음 · PDF 직접"); assert.equal(badge("스캔.pdf").getAttribute("data-state"), "none");
  assert.equal(badge("텍스트없음.docx").textContent, "텍스트 없음"); assert.equal(badge("텍스트없음.docx").getAttribute("data-state"), "none");
});
test("D4.7 index badge shows a real progress bar while indexing and a neutral placeholder before the status arrives", async () => {
  let release!: (status: RetrievalStatus) => void;
  const f = screenFixture({}, { getProjectRetrieval: () => new Promise<RetrievalStatus>((resolve) => { release = resolve; }) }); await render(f.ui());
  assert.equal(badge("완료.xlsx").getAttribute("data-state"), "loading"); assert.equal(badge("완료.xlsx").textContent, "확인 중");
  await act(async () => release(retrievalStatus({ running: true }))); await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const indexing = badge("대기.docx"); assert.equal(indexing.getAttribute("data-state"), "indexing"); assert.match(indexing.textContent!, /색인 중 · 14\/38/);
  const bar = indexing.parentElement!.querySelector('[role="progressbar"]')!;
  assert.deepEqual([bar.getAttribute("aria-valuemin"), bar.getAttribute("aria-valuemax"), bar.getAttribute("aria-valuenow")], ["0", "38", "14"]);
  assert.equal(badge("완료.xlsx").getAttribute("data-state"), "done"); assert.equal(document.querySelectorAll('[role="progressbar"]').length, 1);
});
test("D4.7 badges follow the status the retrieval card publishes after an index run", async () => {
  const semantic: RetrievalSettings = { mode: "semantic", embeddingModelId: models[0].id, queryConsent: true, rerankConsent: false };
  let done = false;
  const f = screenFixture({}, { getProjectRetrieval: async () => retrievalStatus({ settings: semantic, documents: [{ id: "d-wait", name: "대기.docx", completed: done ? 38 : 0, total: 38 }] }),
    startProjectIndex: async () => { done = true; return retrievalStatus({ settings: semantic, documents: [{ id: "d-wait", name: "대기.docx", completed: 38, total: 38 }] }); } });
  await render(f.ui()); assert.equal(badge("대기.docx").getAttribute("data-state"), "waiting");
  await click(button("색인 시작 동의")); assert.equal(dialogTitle(), "의미 색인 시작"); await click(button("동의하고 색인 시작"));
  assert.equal(badge("대기.docx").textContent, "완료 · 38/38");
});
test("D4.7 project tabs are a tablist with counts; arrows switch; conversations are only this project's", async () => {
  const f = screenFixture(); await render(f.ui());
  const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="프로젝트 내용"] [role="tab"]')];
  assert.deepEqual(tabs().map((tab) => tab.textContent), ["문서4", "대화1", "미디어"]); assert.deepEqual(tabs().map((tab) => tab.getAttribute("aria-selected")), ["true", "false", "false"]);
  assert.equal(document.getElementById(tabs()[0].getAttribute("aria-controls")!)!.getAttribute("role"), "tabpanel");
  await act(async () => { tabs()[0].focus(); tabs()[0].dispatchEvent(new browser.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })); });
  assert.deepEqual(tabs().map((tab) => tab.getAttribute("aria-selected")), ["false", "true", "false"]);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); assertFocused(tabs()[1]); assert.deepEqual(tabs().map((tab) => tab.tabIndex), [-1, 0, -1]);
  const rows = [...document.querySelectorAll<HTMLButtonElement>(".project-thread-row")]; assert.equal(rows.length, 1); assert.match(rows[0].textContent!, /대화 하나/);
  await click(rows[0]); assert.deepEqual(f.calls.at(-1), ["open", "t1"]);
});
test("D4.7 media tab never invents jobs: it explains the missing link unless the host supplies items", async () => {
  const f = screenFixture(); await render(f.ui());
  await click([...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === "미디어")!);
  assert.match(document.querySelector(".project-media-note")!.textContent!, /대화와 연결해 저장하지 않/); assert.equal(document.querySelector(".project-media-row"), null);
  const g = screenFixture({ mediaItems: [{ id: "j1", kind: "image", label: "병원 일러스트", status: "completed" }] }); await render(g.ui());
  await click([...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === "미디어1")!);
  assert.match(document.querySelector(".project-media-row")!.textContent!, /병원 일러스트/); assert.equal(document.querySelector(".project-media-note"), null);
});
test("D4.7 list column selects projects and the new-project form saves only a named project", async () => {
  const f = screenFixture(); await render(f.ui());
  const list = [...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="프로젝트 목록"] button')];
  assert.deepEqual(list.map((item) => item.getAttribute("aria-current")), ["true", null]); assert.match(list[0].textContent!, /문서 4 · 대화 2/);
  assert.match(document.body.textContent!, /원본·청크·벡터는 기기 안에 암호화 보관/);
  await click(list[1]); assert.deepEqual(f.calls.at(-1), ["select", "p2"]); await click(document.querySelector<HTMLButtonElement>('[aria-label="새 프로젝트"]')!); assert.deepEqual(f.calls.at(-1), ["select", null]);
  const g = screenFixture({ selectedProjectId: null }); await render(g.ui());
  assert.equal(button("프로젝트 만들기").disabled, true); await input(field("이름").querySelector("input")!, "신규 합성");
  await act(async () => { const area = field("프로젝트 지침").querySelector("textarea")!; Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, "value")!.set!.call(area, "지침 합성"); area.dispatchEvent(new browser.Event("input", { bubbles: true })); });
  await click(button("프로젝트 만들기")); assert.deepEqual(g.calls.at(-1), ["save", { name: "신규 합성", instruction: "지침 합성" }, null]);
});
test("D4.7 editing sends name and instruction for the project and closes only after the project data changes", async () => {
  const f = screenFixture(); await render(f.ui()); assert.match(document.querySelector(".project-instruction")!.textContent!, /APA 7/);
  await click(button("지침 편집")); const nameInput = field("프로젝트 이름").querySelector("input")!; assert.equal(nameInput.value, "졸업논문 합성");
  await input(nameInput, "이름 변경 합성"); await click(button("변경 저장")); assert.deepEqual(f.calls.at(-1), ["save", { name: "이름 변경 합성", instruction: "APA 7 형식을 따른다." }, "p1"]);
  assert.ok(field("프로젝트 이름"));
  await render(<ConfirmProvider><ProjectsScreen {...f.props as any} projects={[{ ...screenProject, name: "이름 변경 합성", updatedAt: "2026-10-09T00:00:00Z" }, otherProject]} /></ConfirmProvider>);
  assert.equal([...document.querySelectorAll("label")].find((label) => label.textContent?.includes("프로젝트 이름")), undefined);
  await click(button("지침 편집")); await click(button("취소")); assert.equal(f.calls.filter((call) => call[0] === "save").length, 1);
});
test("D4.7 drop zone uses the host flow: click picks, a file drop hands over the dropped files, removal goes through the host confirm", async () => {
  const f = screenFixture({ onDropDocuments: (id: string, files: File[]) => { f.calls.push(["drop", id, files.map((file) => file.name)]); } }); await render(f.ui());
  await click(document.querySelector(".project-dropzone")!); assert.deepEqual(f.calls.at(-1), ["add", "p1"]);
  const file = new browser.File(["x"], "합성.pdf", { type: PDF }); const zone = document.querySelector(".project-dropzone")!;
  await act(async () => { const event = new browser.Event("drop", { bubbles: true, cancelable: true }); Object.assign(event, { dataTransfer: { files: [file], types: ["Files"] } }); zone.dispatchEvent(event); });
  assert.deepEqual(f.calls.at(-1), ["drop", "p1", ["합성.pdf"]]);
  await click(document.querySelector('[aria-label="완료.xlsx 제거"]')!); assert.deepEqual(f.calls.at(-1), ["remove", "p1", "d-done"]);
  assert.equal(f.calls.filter((call) => call[0] === "add").length, 1);
});
test("D4.7 conversation links, new project chat and delete keep the existing guards; busy disables every action", async () => {
  const f = screenFixture(); await render(f.ui());
  await click(button("현재 대화 연결")); assert.deepEqual(f.calls.at(-1), ["assign", "p1"]); assert.equal(document.body.textContent!.includes("현재 대화 연결 해제"), false);
  await click(button("이 프로젝트에서 새 대화")); assert.deepEqual(f.calls.at(-1), ["newThread", "p1"]); await click(button("프로젝트 삭제")); assert.deepEqual(f.calls.at(-1), ["delete", "p1"]);
  assert.equal(button("프로젝트 삭제").classList.contains("danger-button"), true);
  const linked = screenFixture({ currentThread: { id: "t1", projectId: "p1", target: undefined } }); await render(linked.ui());
  assert.equal(button("현재 대화 연결").disabled, true); await click(button("현재 대화 연결 해제")); assert.deepEqual(linked.calls.at(-1), ["assign", undefined]);
  const bot = screenFixture({ currentThread: { id: "t9", projectId: undefined, target: { kind: "chatbot" } } }); await render(bot.ui()); assert.equal(button("현재 대화 연결").disabled, true);
  const busy = screenFixture({ busy: true }); await render(busy.ui());
  for (const label of ["지침 편집", "이 프로젝트에서 새 대화", "프로젝트 삭제", "현재 대화 연결"]) assert.equal(button(label).disabled, true, label);
  assert.equal((document.querySelector(".project-dropzone") as HTMLButtonElement).disabled, true);
});
