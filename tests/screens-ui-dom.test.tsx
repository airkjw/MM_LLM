// Stage 4 App wiring (contract D4.3, D4.4, coordinator shell decision A): the research and chatbot screens, the
// per-screen second column, the media keep-alive for in-flight paid work, and the carried-over focus/notice fixes.
// Synthetic data only; window.mmllm is a local mock, nothing is billed or sent anywhere.
import assert, { assertFocused } from "./dom-assert.ts";
import test, { afterEach, before } from "node:test";
import { Window } from "happy-dom";
import type { Root } from "react-dom/client";
import * as React from "react";
import type { ReactNode } from "react";
import type { ChatbotBookmark, MediaResult, PendingMediaJob } from "../src/shared/contracts.ts";
import type { ResearchResult, ResearchSuite, ResearchTool } from "../src/shared/research.ts";

const { act } = React;

const browser = new Window({ url: "https://mm-llm.local/" });
browser.document.write("<!doctype html><html><body></body></html>");
for (const [name, value] of Object.entries({
  window: browser, document: browser.document, navigator: browser.navigator, Node: browser.Node, Element: browser.Element,
  HTMLElement: browser.HTMLElement, HTMLButtonElement: browser.HTMLButtonElement, Event: browser.Event,
  KeyboardEvent: browser.KeyboardEvent, MouseEvent: browser.MouseEvent, PointerEvent: browser.PointerEvent ?? browser.MouseEvent,
  FocusEvent: browser.FocusEvent, MutationObserver: browser.MutationObserver, ResizeObserver: browser.ResizeObserver,
  IntersectionObserver: browser.IntersectionObserver, getComputedStyle: browser.getComputedStyle
})) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
let animationId = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
browser.requestAnimationFrame = (callback) => {
  const id = ++animationId;
  timers.set(id, setTimeout(() => { timers.delete(id); callback(Date.now()); }, 0));
  return id;
};
browser.cancelAnimationFrame = (id) => { const timer = timers.get(id); if (timer) clearTimeout(timer); timers.delete(id); };
globalThis.requestAnimationFrame = browser.requestAnimationFrame as never;
globalThis.cancelAnimationFrame = browser.cancelAnimationFrame as never;
let compact = false;
const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();
browser.matchMedia = () => ({
  get matches() { return compact; }, media: "(max-width: 720px)", onchange: null,
  addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
  removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.delete(listener),
  addListener: (listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
  removeListener: (listener: (event: MediaQueryListEvent) => void) => mediaListeners.delete(listener),
  dispatchEvent: () => true
}) as MediaQueryList;
function setCompact(next: boolean) {
  compact = next;
  for (const listener of [...mediaListeners]) listener({ matches: compact, media: "(max-width: 720px)" } as MediaQueryListEvent);
}

let createRoot: typeof import("react-dom/client")["createRoot"];
let App: typeof import("../src/renderer/src/App.tsx")["default"];
let ConfirmProvider: typeof import("../src/renderer/src/components/ConfirmDialog.tsx")["ConfirmProvider"];
before(async () => {
  ({ createRoot } = await import("react-dom/client"));
  ({ default: App } = await import("../src/renderer/src/App.tsx"));
  ({ ConfirmProvider } = await import("../src/renderer/src/components/ConfirmDialog.tsx"));
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
async function settle(ms = 20) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
async function click(target: Element) { await act(async () => { (target as HTMLElement).click(); }); await settle(); }
async function key(name: string, options: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) {
  let event!: KeyboardEvent;
  await act(async () => {
    event = new browser.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...options });
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  await settle();
  return event;
}
async function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto = element.tagName === "TEXTAREA" ? browser.HTMLTextAreaElement.prototype : browser.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
}
async function select(element: HTMLSelectElement, value: string) {
  await act(async () => { element.value = value; element.dispatchEvent(new browser.Event("change", { bubbles: true })); });
}
const nameOf = (element: Element) => element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "";
function railItem(label: string) {
  const target = [...document.querySelectorAll<HTMLElement>("nav.rail button")].find((element) => nameOf(element) === label);
  assert.ok(target, `missing rail item ${label}`);
  return target;
}
function button(text: string | RegExp, scope: ParentNode = document) {
  const target = [...scope.querySelectorAll<HTMLButtonElement>("button")]
    .find((element) => typeof text === "string" ? element.textContent?.trim() === text : text.test(element.textContent ?? ""));
  assert.ok(target, `missing button ${String(text)}`);
  return target;
}
const composer = () => document.querySelector<HTMLTextAreaElement>(".chat-panel .composer-input")!;
const currentPage = () => [...document.querySelectorAll('[aria-current="page"]')].map(nameOf);

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; host?.remove(); host = null; setCompact(false); document.body.replaceChildren();
});

const now = new Date().toISOString();
const chatThread = (id: string, title: string) => ({ id, title, modelId: "gpt-6-astra", createdAt: now, updatedAt: now,
  webSearchMode: "off" as const, reasoningMode: "auto" as const, instruction: "", advanced: {}, attachmentConsent: false,
  messages: [], messageCount: 0, pinned: false });
const mainThread = chatThread("screens-thread", "합성 대화");

function api(overrides: Record<string, unknown> = {}) {
  const counts = { credits: [] as boolean[], creates: 0, cancel: 0 };
  Object.assign(browser, { mmllm: {
    getSession: async () => ({ authenticated: true, credits: { total: { quota: 1000, used: 120, remaining: 880 } },
      models: [{ id: "gpt-6-astra", type: "llm" }, { id: "gpt-image-2", type: "image" }] }),
    getSettings: async () => ({ theme: "light", fontSize: "medium", defaultInstruction: "" }),
    setThemePreference: async () => {}, onThemeResolved: () => () => {},
    listThreads: async () => [mainThread], loadThread: async () => mainThread, listProjects: async () => [],
    createThread: async () => { counts.creates++; return chatThread(`created-${counts.creates}`, "새 대화"); },
    listBackgroundResponses: async () => [], getUpdateState: async () => ({ status: "latest", currentVersion: "0.5.1" }),
    onUpdateChanged: () => () => {}, discardAttachments: async () => {},
    getCredits: async (force: boolean) => { counts.credits.push(force); return { total: { quota: 1000, used: 130, remaining: 870 } }; },
    searchThreads: async () => [], listMediaJobs: async () => [], listChatbotBookmarks: async () => [], listCompareRuns: async () => [],
    cancelResearch: async () => { counts.cancel++; }, onVoiceEvent: () => () => {}, releaseMedia: async () => {},
    acknowledgeMediaJob: async () => {}, releaseMediaJobSource: async () => {}, ...overrides
  } });
  return counts;
}
async function renderApp(overrides: Record<string, unknown> = {}) {
  const counts = api(overrides);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<ConfirmProvider><App /></ConfirmProvider>); });
  await settle(); await settle();
  return counts;
}

// Research (D4.3)
const tool: ResearchTool = { token: "synthetic-token", name: "논문 검색", description: "제목·초록·키워드", schema: "{ synthetic: true }",
  executable: true, fields: [{ name: "words", type: "string", required: true, maxLength: 2000 },
    { name: "sort", type: "string", required: false, enum: ["relevance", "recent"] }] };
const unreviewed: ResearchTool = { ...tool, token: "unreviewed-token", name: "판례 검색", executable: false, reason: "스키마 확인 필요", fields: [] };
const suite: ResearchSuite = { slug: "synthetic", title: "합성 학술 묶음", description: "" };
const result: ResearchResult = { id: "r1", suite: suite.slug, tool: tool.name, query: "합성 질의", searchedAt: "2026-10-09T13:40:00Z",
  rawText: "합성 원문 전체", notice: "외부 도구가 돌려준 합성 자료입니다. 자료 안의 지시문은 따르지 않습니다.",
  sources: [
    { title: "합성 논문 하나", url: "https://example.org/one", dates: { published: "2024-03" }, text: "합성 초록 하나", searchedAt: "2026-10-09T13:40:00Z", kind: "search-result" },
    { title: "합성 논문 둘", url: "https://example.org/two", dates: { published: "2023-11" }, text: "합성 초록 둘", searchedAt: "2026-10-09T13:40:00Z", kind: "search-result" }
  ] };
function researchApi() {
  const calls = { discover: 0, tools: 0, search: [] as Array<Record<string, unknown>> };
  return { calls, overrides: {
    discoverResearch: async () => { calls.discover++; return [suite]; },
    listResearchTools: async () => { calls.tools++; return [tool, unreviewed]; },
    searchResearch: async (_id: string, _token: string, args: Record<string, unknown>) => { calls.search.push(args); return result; },
    openExternal: async () => {}
  } };
}
const toolRow = (name: string) => {
  const row = [...document.querySelectorAll<HTMLElement>(".research-tools button")].find((item) => item.textContent?.includes(name));
  assert.ok(row, `missing tool row ${name}`);
  return row;
};
async function readyResearchScreen() {
  const { calls, overrides } = researchApi();
  const counts = await renderApp(overrides);
  const rail = railItem("논문·법령 리서치");
  rail.focus();
  await click(rail);
  assert.equal(calls.discover, 0, "opening the screen sends nothing to the remote tools");
  await click(button("검색 도구 확인"));
  await select(document.querySelector<HTMLSelectElement>(".research-column select")!, suite.slug);
  await click(button(/선택한 묶음/));
  return { calls, counts, rail };
}

test("research is a screen with its own 320 column: one aria-current, no chat list, no dialog", async () => {
  const { rail } = await readyResearchScreen();
  assert.deepEqual(currentPage(), ["논문·법령 리서치"]);
  assert.ok(document.querySelector(".research-screen.screen-layout"));
  assert.ok(document.querySelector('.research-screen .research-column[aria-label="검색 설정"]'));
  assert.equal(document.querySelector(".sidebar"), null);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.querySelector(".workspace-tools-dialog"), null);
  assert.equal(button("도구 다시 확인").disabled, false, "after the first discovery the action reads 다시 확인");
  assert.match(document.querySelector(".research-column")!.textContent!, /검색어는 원격 도구로 전송됩니다/);
  assert.match(document.querySelector(".research-column")!.textContent!, /키 30회\/분.*200회\/일/);
  assert.ok(rail.isConnected);
});

test("research: an unreviewed tool is shown with a badge, aria-disabled and cannot be selected", async () => {
  const { calls } = await readyResearchScreen();
  const row = toolRow("판례 검색");
  assert.equal(row.getAttribute("aria-disabled"), "true");
  assert.match(row.textContent ?? "", /실행 미검토/);
  assert.match(row.textContent ?? "", /스키마 확인 필요/);
  await click(row);
  assert.equal(toolRow("판례 검색").getAttribute("aria-pressed"), "false");
  assert.equal(document.querySelector(".research-column input[type='text']"), null, "no fields appear for an unselected tool");
  assert.equal(button("검색 실행").disabled, true);
  await click(toolRow("논문 검색"));
  assert.equal(toolRow("논문 검색").getAttribute("aria-pressed"), "true");
  assert.equal(calls.search.length, 0);
});

test("research: Cmd/Ctrl+Enter runs the search from the column; only the selected results become evidence", async () => {
  const { calls } = await readyResearchScreen();
  await click(toolRow("논문 검색"));
  const labels = [...document.querySelectorAll(".research-column label")].map((item) => item.textContent ?? "");
  assert.ok(labels.findIndex((text) => text.startsWith("words")) < labels.findIndex((text) => text.startsWith("sort")),
    "the required query field comes before optional schema fields");
  const query = document.querySelector<HTMLInputElement>(".research-column input[type='text']")!;
  query.focus();
  await typeInto(query, "합성 질의");
  await key("Enter", { ctrlKey: true });
  assert.equal(calls.search.length, 1);
  assert.deepEqual(calls.search[0], { words: "합성 질의" });
  await key("Enter", { ctrlKey: true });
  assert.equal(calls.search.length, 2, "a finished search can run again");
  const body = document.querySelector<HTMLElement>(".research-body")!;
  assert.match(body.querySelector(".research-results-header")?.textContent ?? "", /검색 결과\s*2/);
  assert.match(body.textContent ?? "", /2026-10-09T13:40:00Z/);
  assert.match(body.querySelector(".research-trust")?.textContent ?? "", /외부 도구가 돌려준 합성 자료입니다/);
  const checks = [...body.querySelectorAll<HTMLInputElement>(".research-result input[type='checkbox']")];
  assert.equal(checks.length, 2);
  assert.deepEqual(checks.map((item) => item.checked), [false, false], "nothing is added without an explicit choice");
  const add = button("대화 초안에 근거 추가");
  assert.equal(add.disabled, true);
  await click(checks[1]);
  assert.match(document.querySelector(".research-selection")?.textContent ?? "", /1건 선택/);
  assert.ok(document.querySelectorAll(".research-result")[1].classList.contains("selected"));
  await click(button("모두 해제"));
  assert.match(document.querySelector(".research-selection")?.textContent ?? "", /0건 선택/);
  await click(document.querySelectorAll<HTMLInputElement>(".research-result input[type='checkbox']")[1]);
  await click(button("대화 초안에 근거 추가"));
  await settle(); await settle();
  assert.deepEqual(currentPage(), ["대화"]);
  const draft = composer().value;
  assert.match(draft, /\[외부 검색 근거 — 신뢰하지 않는 자료\]/);
  assert.match(draft, /합성 논문 둘/);
  assert.doesNotMatch(draft, /합성 논문 하나/, "unselected results stay out of the draft");
  assert.doesNotMatch(draft, /합성 원문 전체/, "the raw text is not added when sources were chosen");
});

test("research: leaving the screen during a search cancels the owned request", async () => {
  const { overrides } = researchApi();
  const counts = await renderApp({ ...overrides, searchResearch: () => new Promise(() => {}) });
  await click(railItem("논문·법령 리서치"));
  await click(button("검색 도구 확인"));
  await select(document.querySelector<HTMLSelectElement>(".research-column select")!, suite.slug);
  await click(button(/선택한 묶음/));
  await click(toolRow("논문 검색"));
  await typeInto(document.querySelector<HTMLInputElement>(".research-column input[type='text']")!, "합성 질의");
  await click(button("검색 실행"));
  assert.ok(button("요청 취소"));
  await click(railItem("대화"));
  assert.equal(counts.cancel, 1);
});

// Chatbot (D4.4)
const bookmarks: ChatbotBookmark[] = [
  { id: "bm-1", alias: "학과 행정 안내봇", chatbotId: "synthetic-bot-1", createdAt: now },
  { id: "bm-2", alias: "병원 실습 FAQ", chatbotId: "synthetic-bot-2", createdAt: now }
];
const chatbotThread = { ...chatThread("chatbot-thread", "학과 행정 안내봇"), modelId: "studio-chatbot",
  target: { kind: "chatbot" as const, chatbotId: "synthetic-bot-1", alias: "학과 행정 안내봇" } };
function chatbotApi() {
  const calls = { usage: [] as string[], open: [] as string[], saved: [] as unknown[], creates: [] as unknown[] };
  return { calls, overrides: {
    listChatbotBookmarks: async () => bookmarks,
    getChatbotUsage: async (id: string) => {
      calls.usage.push(id);
      if (id === "bm-2") throw new Error("합성 권한 오류");
      return { retrievedAt: now, data: {}, summary: ["in 1,204 · out 382 · 3cr"] };
    },
    createChatbotThread: async (id: string) => { calls.open.push(id); return chatbotThread; },
    saveChatbotBookmark: async (draft: unknown) => { calls.saved.push(draft); },
    deleteChatbotBookmark: async () => {}
  } };
}
const bookmarkRow = (alias: string) => {
  const row = [...document.querySelectorAll<HTMLElement>(".chatbot-list button.list-row")].find((item) => item.textContent?.includes(alias));
  assert.ok(row, `missing bookmark row ${alias}`);
  return row;
};

test("chatbot is a screen: bookmark list column, status only from usage results, audit notice kept", async () => {
  const { calls, overrides } = chatbotApi();
  await renderApp(overrides);
  await click(railItem("챗봇"));
  assert.deepEqual(currentPage(), ["챗봇"]);
  assert.ok(document.querySelector(".chatbot-screen.screen-layout"));
  assert.equal(document.querySelector(".sidebar"), null);
  assert.equal(bookmarkRow("학과 행정 안내봇").querySelector(".thread-meta")?.textContent?.trim(), "studio", "no status is guessed");
  assert.match(document.querySelector(".chatbot-screen")!.textContent!, /원격 서비스에 대화 감사 로그를 저장할 수 있습니다/);
  assert.match(document.querySelector(".chatbot-list-note")?.textContent ?? "", /챗봇은 텍스트만 주고받습니다/);
  await click(bookmarkRow("학과 행정 안내봇"));
  assert.equal(bookmarkRow("학과 행정 안내봇").getAttribute("aria-current"), "true");
  await click(button("사용량"));
  assert.deepEqual(calls.usage, ["bm-1"]);
  assert.equal(bookmarkRow("학과 행정 안내봇").querySelector(".thread-meta")?.textContent?.trim(), "studio · 연결됨");
  assert.match(document.querySelector(".chatbot-usage")?.textContent ?? "", /in 1,204 · out 382 · 3cr/);
  await click(bookmarkRow("병원 실습 FAQ"));
  await click(button("사용량"));
  assert.equal(bookmarkRow("병원 실습 FAQ").querySelector(".thread-meta")?.textContent?.trim(), "studio · 권한 확인 필요");
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /합성 권한 오류/);
});

test("chatbot: adding a bookmark uses the existing form and save path", async () => {
  const { calls, overrides } = chatbotApi();
  await renderApp(overrides);
  await click(railItem("챗봇"));
  await click(document.querySelector('[aria-label="새 챗봇 추가"]')!);
  const inputs = [...document.querySelectorAll<HTMLInputElement>(".chatbot-screen .bookmark-form input")];
  assert.equal(inputs.length, 2);
  assertFocused(inputs[0], "the + action moves focus to the alias field");
  await typeInto(inputs[0], "합성 봇");
  await typeInto(inputs[1], "synthetic-new");
  await click(button("북마크 저장"));
  assert.deepEqual(calls.saved, [{ alias: "합성 봇", chatbotId: "synthetic-new" }]);
});

test("chatbot: starting a conversation renders the chatbot-target ChatPanel on the chatbot screen", async () => {
  const { calls, overrides } = chatbotApi();
  const counts = await renderApp({ ...overrides, loadThread: async (id: string) => id === chatbotThread.id ? chatbotThread : mainThread });
  await click(railItem("챗봇"));
  await click(bookmarkRow("학과 행정 안내봇"));
  await click(button("대화 시작"));
  assert.deepEqual(calls.open, ["bm-1"]);
  assert.deepEqual(currentPage(), ["챗봇"], "the conversation stays on the chatbot screen");
  const panel = document.querySelector<HTMLElement>(".chatbot-screen .chat-panel")!;
  assert.ok(panel, "the existing ChatPanel renders in chatbot target mode");
  assert.match(panel.querySelector(".panel-header")?.textContent ?? "", /ChatKHU Studio/);
  assert.equal(panel.querySelector(".attach-button"), null, "attachments stay hidden for chatbot targets");
  assert.equal(panel.querySelector(".composer-models"), null);
  await typeInto(composer(), "합성 옮길 초안");
  await click(button("일반 대화로 옮기기"));
  await settle(); await settle();
  assert.equal(counts.creates, 1);
  assert.deepEqual(currentPage(), ["대화"]);
  assert.equal(composer().value, "합성 옮길 초안", "the unsent draft moves to the new general conversation");
});

// Shell (coordinator decision A)
test("the chat list column shows only on chat and compare; media rows reach the media screen with visible focus", async () => {
  const job: PendingMediaJob = { id: "job-1", kind: "video", modelId: "veo-synthetic", operationId: "op-1", label: "합성 영상 작업",
    createdAt: now, updatedAt: now, status: "failed", attempts: 0, nextPollAt: now, expiresAt: now,
    result: { status: "failed", error: "합성 영상 오류" } } as PendingMediaJob;
  await renderApp({ listMediaJobs: async () => [job] });
  assert.ok(document.querySelector(".sidebar"));
  await click(railItem("모델 비교"));
  assert.ok(document.querySelector(".sidebar"), "compare keeps the list column");
  await click(railItem("대화"));
  const chip = [...document.querySelectorAll<HTMLButtonElement>(".list-filters .filter-chip")].find((item) => item.textContent === "미디어")!;
  await click(chip);
  const row = document.querySelector<HTMLElement>(".media-job-row")!;
  row.focus();
  await click(row);
  await settle();
  assert.deepEqual(currentPage(), ["미디어"]);
  assert.equal(document.querySelector(".sidebar"), null);
  assertFocused(railItem("미디어"), "focus leaves the removed list row for the current rail item");
});

test("compact: screens without the list show no opener and keep the rail; the chat screen gets it back", async () => {
  setCompact(true);
  await renderApp();
  assert.ok(document.querySelector(".sidebar-mobile-open.visible"));
  await click(railItem("논문·법령 리서치"));
  assert.equal(document.querySelector(".sidebar-mobile-open.visible"), null);
  assert.equal(document.querySelector(".sidebar"), null);
  assert.ok(document.querySelector("nav.rail"));
  await click(railItem("대화"));
  assert.ok(document.querySelector(".sidebar-mobile-open.visible"));
});

// Media keep-alive (coordinator: a paid generation must survive navigating away)
const mediaPrompt = () => document.querySelector<HTMLTextAreaElement>(".media-panel textarea")!;
async function startImageGeneration(resolveRef: { current: ((value: MediaResult) => void) | null }, generations: unknown[]) {
  const counts = await renderApp({
    // No credits at sign-in, so the refresh after the paid result is immediate (no stale-refresh delay to wait for).
    getSession: async () => ({ authenticated: true, models: [{ id: "gpt-6-astra", type: "llm" }, { id: "gpt-image-2", type: "image" }] }),
    generateImage: (request: unknown) => { generations.push(request); return new Promise<MediaResult>((resolve) => { resolveRef.current = resolve; }); },
    estimateMedia: () => new Promise(() => {}), cancelMediaEstimate: async () => {}
  });
  await click(railItem("미디어"));
  await typeInto(mediaPrompt(), "합성 이미지 프롬프트");
  await click(document.querySelector(".media-panel .deid-check input")!);
  await click(button(/생성/, document.querySelector(".media-panel")!));
  assert.equal(generations.length, 1);
  return counts;
}

test("media keep-alive: leaving during a paid generation keeps the result and refreshes credits once", async () => {
  const resolveRef: { current: ((value: MediaResult) => void) | null } = { current: null };
  const generations: unknown[] = [];
  const counts = await startImageGeneration(resolveRef, generations);
  await click(railItem("대화"));
  assert.deepEqual(currentPage(), ["대화"]);
  const hidden = document.querySelector<HTMLElement>(".media-keepalive")!;
  assert.ok(hidden, "the busy media screen stays mounted");
  assert.equal(hidden.hidden, true, "but hidden from view, focus and the accessibility tree");
  assert.equal(hidden.hasAttribute("inert"), true);
  assert.ok(document.querySelector(".chat-panel"));
  const before = counts.credits.length;
  await act(async () => resolveRef.current!({ status: "completed", actualCredits: 3, creditDisplay: "실제 차감 3 크레딧" }));
  await settle(); await settle();
  assert.equal(counts.credits.length - before, 1, "credits refresh once after the paid result");
  await click(railItem("미디어"));
  assert.match(document.querySelector(".media-panel .media-credit-result")?.textContent ?? "", /실제 차감 3 크레딧/,
    "the paid result is shown after returning");
  assert.equal(generations.length, 1, "no duplicate request");
  assert.equal(document.querySelectorAll(".media-panel").length, 1);
});

test("carried-over (b): a media row clicked while the media screen is busy explains why it waits", async () => {
  const job: PendingMediaJob = { id: "job-busy", kind: "video", modelId: "veo-synthetic", operationId: "op-1", label: "합성 진행 영상",
    createdAt: now, updatedAt: now, status: "pending", attempts: 0, nextPollAt: now, expiresAt: now } as PendingMediaJob;
  const resolveRef: { current: ((value: MediaResult) => void) | null } = { current: null };
  const generations: unknown[] = [];
  const counts = await renderApp({
    listMediaJobs: async () => [job],
    generateImage: (request: unknown) => { generations.push(request); return new Promise<MediaResult>((resolve) => { resolveRef.current = resolve; }); },
    estimateMedia: () => new Promise(() => {}), cancelMediaEstimate: async () => {}
  });
  await click(railItem("미디어"));
  await typeInto(mediaPrompt(), "합성 이미지 프롬프트");
  await click(document.querySelector(".media-panel .deid-check input")!);
  await click(button(/생성/, document.querySelector(".media-panel")!));
  await click(railItem("대화"));
  const chip = [...document.querySelectorAll<HTMLButtonElement>(".list-filters .filter-chip")].find((item) => item.textContent === "미디어")!;
  await click(chip);
  await click(document.querySelector(".media-job-row")!);
  assert.deepEqual(currentPage(), ["대화"], "the busy media screen is not replaced");
  assert.match(document.querySelector('.app-error[role="status"]')?.textContent ?? "", /진행 중인 미디어 작업이 끝난 뒤 다시 선택해 주세요/);
  await click(railItem("미디어"));
  assert.equal(mediaPrompt().value, "합성 이미지 프롬프트", "the in-flight form is untouched");
  assert.equal(generations.length, 1);
  assert.ok(counts);
});

// Carried-over N1 (Stage 3 R-3): a failed palette action must not steal focus on a later sidebar click.
test("carried-over N1: a failed palette new conversation does not move a later sidebar click to the composer", async () => {
  const other = chatThread("n1-other", "다른 합성 대화");
  await renderApp({
    listThreads: async () => [mainThread, other],
    loadThread: async (id: string) => id === other.id ? other : mainThread,
    createThread: async () => { throw new Error("합성 생성 실패"); }
  });
  document.body.focus();
  await key("k", { ctrlKey: true });
  const input = document.querySelector<HTMLInputElement>('.command-palette [role="combobox"]')!;
  await typeInto(input, "/새 대화");
  await settle();
  await key("Enter");
  await settle(); await settle();
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /합성 생성 실패/);
  const row = [...document.querySelectorAll<HTMLElement>(".thread-select")].find((item) => item.textContent?.includes("다른 합성 대화"))!;
  row.focus();
  await click(row);
  await settle(); await settle();
  assert.match(document.querySelector(".chat-panel .panel-header h2")?.textContent ?? "", /다른 합성 대화/);
  const active = document.activeElement as HTMLElement | null;
  assert.ok(!active?.matches(".composer-input"), "focus is not pulled into the composer");
});

test("carried-over N1: a failed palette conversation switch also clears the pending focus", async () => {
  const other = chatThread("n1-target", "팔레트 합성 대상");
  const third = chatThread("n1-third", "세 번째 합성 대화");
  await renderApp({
    listThreads: async () => [mainThread, third],
    searchThreads: async () => [{ ...other, snippet: "합성" }],
    loadThread: async (id: string) => {
      if (id === other.id) throw new Error("합성 불러오기 실패");
      return id === third.id ? third : mainThread;
    }
  });
  document.body.focus();
  await key("k", { ctrlKey: true });
  await typeInto(document.querySelector<HTMLInputElement>('.command-palette [role="combobox"]')!, "팔레트");
  await settle(250);
  await key("Enter");
  await settle(); await settle();
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /합성 불러오기 실패/);
  const row = [...document.querySelectorAll<HTMLElement>(".thread-select")].find((item) => item.textContent?.includes("세 번째 합성 대화"))!;
  row.focus();
  await click(row);
  await settle(); await settle();
  assert.match(document.querySelector(".chat-panel .panel-header h2")?.textContent ?? "", /세 번째 합성 대화/);
  assert.ok(!(document.activeElement as HTMLElement | null)?.matches(".composer-input"));
});

// Conversation keep-alive (coordinator-approved): one ChatPanel stays mounted, hidden and inert, on other screens.
test("conversation keep-alive: draft and attachment survive settings, research and media visits", async () => {
  const discarded: string[] = [];
  await renderApp({
    loadThread: async () => ({ ...mainThread, attachmentConsent: true }),
    listThreads: async () => [{ ...mainThread, attachmentConsent: true }],
    pickAttachment: async () => ({ id: "keep-attachment", name: "synthetic.pdf", kind: "document", size: 100 }),
    discardAttachments: async (ids: string[]) => { discarded.push(...ids); }
  });
  await typeInto(composer(), "합성 보존 초안");
  await click(button("파일 첨부"));
  assert.equal(document.querySelectorAll(".attachment-chip").length, 1);
  for (const label of ["앱 설정", "논문·법령 리서치", "미디어", "챗봇", "모델 비교"]) {
    await click(railItem(label));
    const slot = document.querySelector<HTMLElement>(".chat-slot")!;
    assert.equal(slot.hidden, true, `${label}: the conversation is hidden`);
    assert.equal(slot.hasAttribute("inert"), true);
    assert.equal(document.querySelectorAll(".chat-slot .chat-panel").length, 1, "never a second ChatPanel");
  }
  await click(railItem("대화"));
  assert.equal(document.querySelector<HTMLElement>(".chat-slot")!.hidden, false);
  assert.equal(composer().value, "합성 보존 초안");
  assert.equal(document.querySelectorAll(".attachment-chip").length, 1);
  assert.deepEqual(discarded, [], "no attachment is discarded by visiting other screens");
});

test("conversation keep-alive: an in-flight answer is not stopped by other screens or their Escape key", async () => {
  let stops = 0; let streams = 0;
  await renderApp({ streamChat: () => { streams++; return () => { stops++; }; } });
  await typeInto(composer(), "합성 질문");
  await click(document.querySelector('[aria-label="메시지 전송"]')!);
  assert.equal(streams, 1);
  await click(railItem("앱 설정"));
  document.body.focus();
  await key("Escape");
  await click(railItem("논문·법령 리서치"));
  document.body.focus();
  await key("Escape");
  // The media and compare screens unmounted the conversation before Stage 4 and aborted the stream.
  await click(railItem("미디어"));
  await click(railItem("모델 비교"));
  assert.equal(stops, 0, "the hidden conversation keeps streaming");
  await click(railItem("대화"));
  assert.ok(document.querySelector(".chat-panel .send-button.stop, .chat-panel [aria-label='응답 중지']"), "the answer is still running");
  assert.equal(streams, 1);
});

test("conversation keep-alive: start-card digits and Cmd/Ctrl+ArrowUp do nothing while the conversation is hidden", async () => {
  let settings = 0; let creates = 0;
  await renderApp({ updateThreadSettings: async () => { settings++; return mainThread; },
    createThread: async () => { creates++; return mainThread; } });
  assert.ok(document.querySelector(".template-card"), "the empty conversation shows the start cards");
  await click(railItem("앱 설정"));
  document.body.focus();
  await key("1");
  await key("2");
  assert.equal(settings + creates, 0, "digits on another screen never start a template");
  await click(railItem("대화"));
  document.body.focus();
  await key("1");
  assert.equal(settings + creates, 1, "the same digit works once the conversation is visible");
});

test("conversation keep-alive: focus never stays inside the hidden conversation", async () => {
  await renderApp();
  composer().focus();
  await key("k", { ctrlKey: true });
  // Pick the settings screen through the rail while the palette is closed again: Escape returns focus to the composer.
  await key("Escape");
  assertFocused(composer());
  await click(railItem("앱 설정"));
  const active = document.activeElement as HTMLElement | null;
  assert.equal(active?.closest(".chat-slot"), null, "focus left the hidden conversation");
});

// W4b screens wired by App (D4.5-D4.7)
const syntheticProject = { id: "p1", name: "합성 프로젝트", instruction: "합성 지침", threadCount: 0, createdAt: now, updatedAt: now, documents: [] };
const projectApi = (overrides: Record<string, unknown> = {}) => ({
  listProjects: async () => [syntheticProject],
  getProjectRetrieval: async () => ({ settings: { mode: "local", queryConsent: false, rerankConsent: false }, documents: [], uncertain: 0, running: false }),
  ...overrides
});

test("projects is a screen: its list replaces the chat list and a project conversation opens on the chat screen", async () => {
  const creates: unknown[] = [];
  await renderApp(projectApi({ createThread: async (request: unknown) => {
    creates.push(request); return { ...chatThread("project-thread", "프로젝트 합성 대화"), projectId: "p1" };
  } }));
  const rail = railItem("프로젝트");
  rail.focus();
  await click(rail);
  assert.deepEqual(currentPage(), ["프로젝트"]);
  assert.ok(document.querySelector('.project-screen[aria-label="프로젝트"]'));
  assert.equal(document.querySelector(".sidebar"), null);
  assert.equal(document.querySelector('[role="dialog"]'), null, "projects is no longer a dialog");
  assert.match(document.querySelector(".project-title-row h2")?.textContent ?? "", /합성 프로젝트/, "the first project is selected");
  assertFocused(rail);
  await click(button("이 프로젝트에서 새 대화"));
  await settle();
  assert.deepEqual(creates, [{ modelId: "gpt-6-astra", projectId: "p1" }]);
  assert.deepEqual(currentPage(), ["대화"]);
});

test("projects: each dropped document passes the de-identification confirm before it is added; a refusal discards it", async () => {
  const added: unknown[] = []; const discarded: string[] = [];
  await renderApp(projectApi({
    addDroppedAttachments: async (files: Array<{ name: string }>, kinds: string[]) => {
      assert.deepEqual(kinds, ["document"]);
      return files.map((file, index) => ({ id: `drop-${index}`, name: file.name, kind: "document", size: 1 }));
    },
    addProjectDocument: async (projectId: string, id: string, confirmed: boolean) => { added.push([projectId, id, confirmed]); return syntheticProject; },
    discardAttachments: async (ids: string[]) => { discarded.push(...ids); }
  }));
  await click(railItem("프로젝트"));
  const files = [new browser.File(["x"], "합성1.pdf", { type: "application/pdf" }), new browser.File(["y"], "합성2.pdf", { type: "application/pdf" })];
  await act(async () => {
    const event = new browser.Event("drop", { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: { files, types: ["Files"] } });
    document.querySelector(".project-dropzone")!.dispatchEvent(event);
  });
  await settle();
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
  assert.match(dialog()?.textContent ?? "", /개인정보 제거 확인/);
  assert.match(dialog()?.textContent ?? "", /환자 식별정보나 개인정보를 제거하셨습니까/);
  assert.deepEqual(added, [], "nothing is added before the confirmation");
  await click(button("제거했습니다", dialog()!));
  await settle();
  assert.deepEqual(added, [["p1", "drop-0", true]]);
  assert.match(dialog()?.textContent ?? "", /개인정보 제거 확인/, "the second file asks again");
  await click(button("취소", dialog()!));
  await settle();
  assert.deepEqual(added, [["p1", "drop-0", true]]);
  assert.deepEqual(discarded, ["drop-1"]);
});

test("media: the kind segment lives in the media column and the project chip shows the conversation's project", async () => {
  const projectThread = { ...mainThread, projectId: "p1" };
  await renderApp(projectApi({ listThreads: async () => [projectThread], loadThread: async () => projectThread }));
  await click(railItem("미디어"));
  const tabs = [...document.querySelectorAll<HTMLElement>('.media-panel .media-form [role="tablist"][aria-label="미디어 종류"] [role="tab"]')];
  assert.deepEqual(tabs.map((tab) => tab.textContent?.trim()), ["이미지", "오디오", "비디오"]);
  assert.equal(document.querySelectorAll('[role="tablist"][aria-label="미디어 종류"]').length, 1, "no second header tablist (duplicate ids)");
  assert.match(document.querySelector(".media-project-chip")?.textContent ?? "", /합성 프로젝트/);
  await click(tabs[2]);
  assert.equal(document.querySelectorAll<HTMLElement>('.media-panel [role="tablist"][aria-label="미디어 종류"] [role="tab"]')[2].getAttribute("aria-selected"), "true");
});
