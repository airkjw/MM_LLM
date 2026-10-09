import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import type { CompareEvent, CompareRequest } from "../src/shared/contracts";
import { SearchEvidenceNormalizer } from "../src/shared/search-evidence";
import { geminiMultiQueryEvents } from "./fixtures/native-search.mjs";
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
let ModelPicker: typeof import("../src/renderer/src/ModelPicker")["ModelPicker"];
let MediaPanel: typeof import("../src/renderer/src/MediaPanel")["MediaPanel"];
let ChatPanel: typeof import("../src/renderer/src/ChatPanel")["ChatPanel"];
let ConfirmProvider: typeof import("../src/renderer/src/components/ConfirmDialog")["ConfirmProvider"];
let useConfirm: typeof import("../src/renderer/src/components/ConfirmDialog")["useConfirm"];
let ModelPreferences: typeof import("../src/renderer/src/model-preferences")["ModelPreferences"];
let MarkdownText: typeof import("../src/renderer/src/ui-shared")["MarkdownText"];
let Notice: typeof import("../src/renderer/src/components/Notice")["Notice"];
let root: Root | null = null;
let host: HTMLDivElement | null = null;
before(async () => {
  Object.defineProperty(globalThis, "MutationObserver", { value: browser.MutationObserver, configurable: true });
  Object.defineProperty(globalThis, "ResizeObserver", { value: browser.ResizeObserver, configurable: true });
  Object.defineProperty(globalThis, "IntersectionObserver", { value: browser.IntersectionObserver, configurable: true });
  ({ createRoot } = await import("react-dom/client"));
  ({ default: App } = await import("../src/renderer/src/App"));
  ({ ModelPicker } = await import("../src/renderer/src/ModelPicker"));
  ({ MediaPanel } = await import("../src/renderer/src/MediaPanel"));
  ({ ChatPanel } = await import("../src/renderer/src/ChatPanel"));
  ({ ConfirmProvider, useConfirm } = await import("../src/renderer/src/components/ConfirmDialog"));
  ({ ModelPreferences } = await import("../src/renderer/src/model-preferences"));
  ({ MarkdownText } = await import("../src/renderer/src/ui-shared"));
  ({ Notice } = await import("../src/renderer/src/components/Notice"));
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
test("real model picker uses arrow/Home/End, selects and restores focus", async () => {
  const chosen: string[] = [];
  await render(<ModelPicker models={["a", "b", "c"].map((id) => ({ id, type: "llm" }))} selected="a" onSelect={(id) => chosen.push(id)} />);
  const trigger = document.querySelector(".model-trigger")!;
  await click(trigger);
  const input = document.querySelector('[role="combobox"]')!;
  assert.equal(document.activeElement, input);
  assert.equal(trigger.getAttribute("aria-haspopup"), "dialog");
  await key("End");
  assert.match(input.getAttribute("aria-activedescendant")!, /-2$/);
  await key("Home"); await key("ArrowDown"); await key("Enter");
  assert.deepEqual(chosen, ["b"]); assert.equal(document.activeElement, trigger);
  assert.equal(document.querySelector('[role="dialog"]'), null);
});
test("confirmation cancels with Escape and requires explicit destructive action", async () => {
  const answers: boolean[] = [];
  function Harness() { const confirm = useConfirm(); return <button onClick={async () => {
    answers.push(await confirm({ title: "삭제 확인", message: "되돌릴 수 없습니다.", confirmLabel: "대화 삭제", danger: true }));
  }}>열기</button>; }
  await render(<ConfirmProvider><Harness /></ConfirmProvider>);
  const trigger = document.querySelector("button")!; await click(trigger); await key("Escape");
  assert.deepEqual(answers, [false]); assert.equal(document.activeElement, trigger);
  await click(trigger); await click(document.querySelector(".danger-button")!);
  assert.deepEqual(answers, [false, true]); assert.equal(document.activeElement, trigger);
});
test("informational notices do not announce themselves as errors", async () => {
  await render(<Notice notice={{ id: 1, tone: "info", text: "모델 변경됨" }} onClose={() => {}} />);
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.match(document.querySelector('[role="status"]')!.textContent!, /안내: 모델 변경됨/);
});
test("real ChatPanel reopens consent path after same-thread revocation", async () => {
  Object.assign(browser, { mmllm: { discardAttachments: async () => {} } });
  const thread = { id: "same-thread", title: "대화", modelId: "gpt-5.6-luna", messages: [], messageCount: 0,
    attachmentConsent: true, instruction: "", advanced: {}, reasoningMode: "auto" as const,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), webSearchMode: "off" as const, projectId: "project" };
  const props = { modelId: thread.modelId, models: [{ id: thread.modelId, type: "llm" as const }],
    onModelChange: () => {}, onThreadUpdated: () => {}, onRefreshThreads: () => {}, onUsageChanged: () => {},
    onTemplateStart: async () => {}, onDraftApplied: () => {}, initialDraft: "질문입니다" };
  await render(<ConfirmProvider><ChatPanel {...props} thread={thread} /></ConfirmProvider>);
  assert.equal(document.querySelector(".privacy-confirm-link"), null);
  assert.equal(document.querySelector<HTMLButtonElement>('[aria-label="메시지 전송"]')!.disabled, false);
  await render(<ConfirmProvider><ChatPanel {...props} thread={{ ...thread, attachmentConsent: false }} /></ConfirmProvider>);
  assert.match(document.querySelector(".privacy-confirm-link")!.textContent!, /첨부 자료 전송 확인/);
  assert.equal(document.querySelector<HTMLButtonElement>('[aria-label="메시지 전송"]')!.disabled, true);
  await click(document.querySelector(".privacy-confirm-link")!);
  assert.match(document.querySelector('[role="dialog"]')!.textContent!, /환자 식별정보/);
});

test("media polling survives unrelated rerenders and keeps background errors out of alerts", async () => {
  const original = globalThis.setInterval; const originalClear = globalThis.clearInterval;
  let tick: (() => void) | undefined; let starts = 0; let polls = 0;
  const fake = 778899;
  globalThis.setInterval = ((callback: () => void, delay?: number) => {
    if (delay === 5000) { tick = callback; starts++; return fake; }
    return original(callback, delay);
  }) as typeof setInterval;
  globalThis.clearInterval = ((id: any) => { if (id !== fake) originalClear(id); }) as typeof clearInterval;
  const now = new Date().toISOString();
  Object.assign(browser, { mmllm: { listMediaJobs: async () => [{ id: "job", kind: "video", modelId: "veo", status: "pending", createdAt: now, updatedAt: now }],
    pollMediaJob: async () => { polls++; throw new Error("offline"); }, discardAttachments: async () => {} } });
  const epoch = { current: 0 };
  const ui = () => <ConfirmProvider><MediaPanel screen="video" models={[]} workspaceEpochRef={epoch}
    onUsageChanged={() => {}} onSummarizeTranscript={async () => {}} /></ConfirmProvider>;
  try {
    await render(ui());
    assert.equal(starts, 1);
    for (let i = 0; i < 3; i++) { await render(ui()); await act(async () => { await tick!(); }); }
    assert.equal(starts, 1); assert.equal(polls, 3);
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.match(document.body.textContent!, /연결이 복구되면 자동/);
  } finally {
    if (root) await act(async () => root!.unmount()); root = null; host?.remove(); host = null;
    globalThis.setInterval = original; globalThis.clearInterval = originalClear;
  }
});

test("model favorites and recent choices appear as separate groups", async () => {
  const changes: Array<[string, string]> = [];
  function Harness() {
    const [favorites, setFavorites] = React.useState<string[]>([]);
    return <ModelPreferences.Provider value={{ favorites, recent: ["b"], update: (id, action) => {
      changes.push([id, action]); if (action === "favorite") setFavorites((items) => items.includes(id) ? [] : [id]);
    } }}><ModelPicker models={["a", "b", "c"].map((id) => ({ id, type: "llm" }))} selected="b" onSelect={() => {}} /></ModelPreferences.Provider>;
  }
  await render(<Harness />); await click(document.querySelector(".model-trigger")!);
  assert.ok(document.querySelector('[role="group"][aria-label="최근 사용"]'));
  const favorite = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("즐겨찾기 추가"))!;
  await click(favorite); assert.ok(document.querySelector('[role="group"][aria-label="즐겨찾기"]'));
  await click(document.querySelector('[role="option"]')!);
  assert.deepEqual(changes, [["b", "favorite"], ["b", "recent"]]);
});
test("blocked links retain readable content and an explanation", async () => {
  await render(<MarkdownText text="[자료](http://example.invalid)" />);
  assert.equal(document.querySelector("a"), null);
  assert.match(document.body.textContent!, /자료.*보안상 직접 열 수 없는 링크/);
});


async function openRealComparison(extraApi: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const models = ["gpt-5.6-sol", "claude-opus-5", "gemini-3.8-flash"].map(id => ({ id, type: "llm" }));
  const thread = { id: "compare-origin", title: "새 대화", modelId: models[0].id,
    createdAt: now, updatedAt: now, webSearchMode: "off", reasoningMode: "auto",
    instruction: "", advanced: {}, attachmentConsent: false, messages: [], messageCount: 0 };
  const requests: CompareRequest[] = [];
  let receive: ((event: CompareEvent) => void) | undefined;
  let nextId = 0;
  Object.assign(browser, { mmllm: {
    getSession: async () => ({ authenticated: true, models, credits: { total: { remaining: 1000 } } }),
    getSettings: async () => ({ theme: "dark", fontSize: "medium", defaultInstruction: "" }),
    setThemePreference: async () => {}, listThreads: async () => [thread], loadThread: async () => thread,
    listProjects: async () => [], listBackgroundResponses: async () => [],
    getUpdateState: async () => ({ status: "idle", currentVersion: "0.5.0" }), onUpdateChanged: () => () => {}, onThemeResolved: () => () => {},
    pickAttachment: async () => ({ id: `report-${++nextId}`, name: "report.pdf", kind: "document", size: 100 }),
    discardAttachments: async () => {}, streamCompare: (request: CompareRequest, listener: (event: CompareEvent) => void) => {
      requests.push(request); receive = listener; return () => {};
    }, ...extraApi
  } });
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  const button = [...document.querySelectorAll("button")].find(button => button.textContent?.includes("모델 비교") || button.getAttribute("aria-label")?.includes("모델 비교"))!;
  await click(button);
  const question = document.querySelector<HTMLTextAreaElement>(".compare-panel textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, "value")!.set!.call(question, "첨부 보고서를 비교 검토해 주세요.");
    question.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
  for (const input of [...document.querySelectorAll(".compare-models input")].slice(0, 3)) await click(input);
  return { requests, emit: async (event: CompareEvent) => { await act(async () => receive!(event)); } };
}

test("real comparison requires a visible attachment consent and sends confirmed attachments", async () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");
  document.head.append(style);
  try {
    const { requests } = await openRealComparison();
    await click(document.querySelector(".compare-controls button")!);
    const send = document.querySelector<HTMLButtonElement>(".compare-run-actions button")!;
    const checkbox = document.querySelector<HTMLInputElement>(".deid-check input")!;
    const css = window.getComputedStyle(checkbox);
    assert.notEqual(css.opacity, "0");
    assert.ok(parseFloat(css.width) > 0 && parseFloat(css.height) > 0);
    assert.equal(send.disabled, true);
    await click(send); assert.equal(requests.length, 0);
    assert.match(document.querySelector("#compare-consent-hint")!.textContent!, /확인란을 체크/);
    await click(checkbox);
    assert.equal(checkbox.checked, true); assert.equal(send.disabled, false);
    await click(send);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].deidentifiedConfirmed, true);
    assert.deepEqual(requests[0].attachmentIds, ["report-1"]);
    assert.equal(requests[0].modelIds.length, 3);
    assert.match(document.querySelector(".compare-panel .inline-progress")!.textContent!, /비교를 준비/);
  } finally { style.remove(); }
});

test("real comparison without attachments runs immediately and shows server errors inside the dialog", async () => {
  const { requests, emit } = await openRealComparison();
  const send = document.querySelector<HTMLButtonElement>(".compare-run-actions button")!;
  assert.equal(send.disabled, false);
  await click(send);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].attachmentIds, []);
  await emit({ type: "error", message: "공통 웹 검색 연결에 실패했습니다." });
  const alert = document.querySelector('[role="alert"]')!;
  assert.ok(alert.closest(".workspace-tools-dialog"));
  assert.match(alert.textContent!, /공통 웹 검색 연결/);
  assert.equal(document.querySelectorAll('[role="alert"]').length, 1);
  assert.equal(document.querySelector<HTMLButtonElement>(".compare-run-actions button")!.disabled, false);
});

test("adding another comparison attachment resets consent before sending", async () => {
  const { requests } = await openRealComparison();
  await click(document.querySelector(".compare-controls button")!);
  await click(document.querySelector(".deid-check input")!);
  await click(document.querySelector(".compare-controls button")!);
  assert.equal(document.querySelector<HTMLInputElement>(".deid-check input")!.checked, false);
  const send = document.querySelector<HTMLButtonElement>(".compare-run-actions button")!;
  assert.equal(send.disabled, true);
  await click(send); assert.equal(requests.length, 0);
});


test("comparison startup errors release busy state and preserve attachments for retry", async () => {
  await openRealComparison();
  await click(document.querySelector(".compare-controls button")!);
  await click(document.querySelector(".deid-check input")!);
  window.mmllm.streamCompare = () => { throw new Error("비교 연결을 시작하지 못했습니다."); };
  await click(document.querySelector(".compare-run-actions button")!);
  assert.match(document.querySelector('.workspace-tools-dialog [role="alert"]')!.textContent!, /비교 연결을 시작/);
  assert.equal(document.querySelector<HTMLButtonElement>(".compare-run-actions button")!.disabled, false);
  assert.ok(document.querySelector(".attachment-chip"));
  assert.equal(document.querySelector(".compare-panel .inline-progress"), null);
});

test("real model picker keeps auxiliary types out and only labels verified native search", async () => {
  let checks = 0;
  Object.assign(browser, { mmllm: { checkModelSearch: async () => { checks++; return {}; } } });
  const models = [
    { id: "gemini-3.8-flash", type: "llm" as const },
    { id: "claude-sonnet-5", type: "llm" as const, searchCapability: { status: "supported" as const, provider: "claude" as const, reason: "synthetic" } },
    ...(["embedding", "rerank", "decisions", "realtime", "audio", "image", "video"] as const).map((type) => ({ id: `aux-${type}`, type }))
  ];
  await render(<ModelPicker models={models} selected="gemini-3.8-flash" onSelect={() => {}} />);
  assert.equal(document.querySelector(".model-trigger-web"), null);
  const trigger = document.querySelector(".model-trigger")!; await click(trigger);
  assert.equal(document.querySelectorAll('[role="option"]').length, 2);
  assert.equal(document.querySelectorAll(".native-search-badge").length, 1);
  assert.doesNotMatch(document.querySelector(".model-options")!.textContent!, /aux-/);
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(input, "Claude");
    input.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
  assert.equal(checks, 0, "render, selection and typing never fetch model detail");
  await key("Escape"); assert.equal(document.activeElement, trigger);
});

function syntheticChatThread(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return { id: "synthetic-chat", title: "합성 대화", modelId: "gemini-3.8-flash", messages: [], messageCount: 0,
    createdAt: now, updatedAt: now, webSearchMode: "always" as const, reasoningMode: "auto" as const,
    advanced: {}, instruction: "", attachmentConsent: false, ...overrides } as import("../src/shared/contracts").ThreadSnapshot;
}
const syntheticChatProps = { onModelChange: () => {}, onThreadUpdated: () => {}, onRefreshThreads: () => {},
  onUsageChanged: () => {}, onTemplateStart: async () => {}, onDraftApplied: () => {} };

test("real ChatPanel explicitly checks capability, shows unsupported bridge plan and safely opens verified citations", async () => {
  let checks = 0; const opened: string[] = []; let changed: import("../src/shared/contracts").ThreadSnapshot | undefined;
  const search = { route: "sonar" as const, provider: "sonar" as const, status: "executed" as const,
    queries: ["synthetic query"], requestCount: 1, citations: [{ url: "https://example.test/public-statistic", title: "합성 출처", citedText: "합성 근거" }] };
  const thread = syntheticChatThread();
  Object.assign(browser, { mmllm: {
    discardAttachments: async () => {}, checkModelSearch: async () => { checks++; return { status: "unsupported", reason: "synthetic null price" }; },
    openExternal: async (url: string) => { opened.push(url); },
    streamChat: (_request: unknown, receive: (event: import("../src/shared/contracts").ChatEvent) => void) => {
      queueMicrotask(() => { receive({ type: "web_search", search }); receive({ type: "delta", text: "합성 답변" });
        receive({ type: "done", snapshot: { ...thread, messageCount: 2, messages: [
          { id: "u", role: "user", text: "합성 질문", createdAt: thread.createdAt },
          { id: "a", role: "assistant", modelId: thread.modelId, text: "합성 답변", createdAt: thread.createdAt, webSearch: search } ] } }); });
      return () => {};
    }
  } });
  const models = [{ id: thread.modelId, type: "llm" as const }];
  function Harness() {
    const [current, setCurrent] = React.useState(thread);
    return <ConfirmProvider><ChatPanel {...syntheticChatProps} thread={current} modelId={thread.modelId}
      models={models} initialDraft="합성 질문"
      onThreadUpdated={(value) => { changed = value; setCurrent(value); }} /></ConfirmProvider>;
  }
  await render(<Harness />);
  assert.equal(checks, 0); assert.match(document.querySelector(".chat-panel")?.textContent ?? document.body.textContent!, /자체 검색 미확인/);
  const check = [...document.querySelectorAll("button")].find((b) => b.textContent === "검색 기능 확인")!;
  await click(check); assert.equal(checks, 1); assert.match(document.body.textContent!, /자체 검색 미지원.*Sonar/s);
  await click(document.querySelector('[aria-label="메시지 전송"]')!);
  assert.ok(changed); assert.match(document.querySelector('[aria-label="웹 검색 실행 상태"]')!.textContent!, /Sonar 검색 후 선택 모델 답변 · 실행 확인/);
  const citation = [...document.querySelectorAll("button")].find((b) => b.textContent === "합성 출처")!;
  await click(citation); assert.deepEqual(opened, ["https://example.test/public-statistic"]);
});

test("real ChatPanel deep route ignores native-only setting conflicts and keeps search modes simple", async () => {
  Object.assign(browser, { mmllm: { discardAttachments: async () => {} } });
  const thread = syntheticChatThread({ webSearchMode: "deep", advanced: { tools: [{ name: "manual", parameters: {} }] }, modelId: "claude-sonnet-5" });
  for (const theme of ["light", "dark"]) {
    browser.document.documentElement.dataset.theme = theme;
    await render(<ConfirmProvider><div style={{ width: 360 }}><ChatPanel {...syntheticChatProps} thread={thread} modelId={thread.modelId}
      models={[{ id: thread.modelId, type: "llm", searchCapability: { status: "supported", provider: "claude", reason: "synthetic" } }]} /></div></ConfirmProvider>);
    assert.match(document.body.textContent!, /Sonar 공통 검색 후 선택 모델 답변/);
    assert.doesNotMatch(document.body.textContent!, /모델 자체 검색|함께 사용할 수 없습니다/);
    assert.equal([...document.querySelectorAll("button")].filter((b) => b.textContent === "검색 기능 확인").length, 0);
    const select = document.querySelector<HTMLSelectElement>('[aria-label="웹 검색 방식"]')!;
    assert.deepEqual([...select.options].map((option) => option.value), ["always", "auto", "deep", "off"]);
    select.focus(); assert.equal(document.activeElement, select);
  }
});

test("real ChatPanel shows Sonar restrictions, allows auto and blocks unavailable stored models", async () => {
  Object.assign(browser, { mmllm: { discardAttachments: async () => {} } });
  const thread = syntheticChatThread({ modelId: "sonar-pro", webSearchMode: "off" });
  const models = [{ id: thread.modelId, type: "llm" as const }];
  await render(<ConfirmProvider><ChatPanel {...syntheticChatProps} thread={thread} modelId={thread.modelId} models={models} initialDraft="합성 일반 질문" /></ConfirmProvider>);
  assert.match(document.body.textContent!, /Sonar는 검색 끄기/); assert.equal(document.querySelector<HTMLButtonElement>('[aria-label="메시지 전송"]')!.disabled, true);
  await render(<ConfirmProvider><ChatPanel {...syntheticChatProps} thread={{ ...thread, webSearchMode: "auto" }} modelId={thread.modelId} models={models} initialDraft="합성 일반 질문" /></ConfirmProvider>);
  assert.match(document.body.textContent!, /일반 질문에서도 모델 자체 검색이 실행될 수/);
  assert.doesNotMatch(document.body.textContent!, /최신 정보가 필요한 질문만 웹 검색/);
  await render(<ConfirmProvider><ChatPanel {...syntheticChatProps} thread={syntheticChatThread()} modelId="removed-model" models={models} /></ConfirmProvider>);
  assert.match(document.body.textContent!, /모델을 직접 선택/); assert.equal(document.querySelector<HTMLButtonElement>('[aria-label="메시지 전송"]')!.disabled, true);
});

test("real ChatPanel distinguishes unexecuted native search, failure and cached evidence", async () => {
  Object.assign(browser, { mmllm: { discardAttachments: async () => {} } });
  for (const [status, route, expected] of [["missing", "native", "실행 미확인"], ["failed", "native", "실패"], ["cached", "cache", "새 검색 없음"]] as const) {
    const thread = syntheticChatThread({ id: `synthetic-${status}`, messages: [{ id: "a", role: "assistant", modelId: "gemini-3.8-flash",
      text: "합성 답변", createdAt: new Date().toISOString(), webSearch: { route, provider: "gemini", status, queries: [], citations: [] } }] });
    await render(<ConfirmProvider><ChatPanel {...syntheticChatProps} thread={thread} modelId={thread.modelId} models={[{ id: thread.modelId, type: "llm" }]} /></ConfirmProvider>);
    assert.match(document.querySelector('[aria-label="웹 검색 실행 상태"]')!.textContent!, new RegExp(expected));
    assert.equal(document.querySelector('[aria-label="웹 검색 실행 상태"] details'), null);
  }
});

test("real ChatPanel multi-query Gemini evidence never displays an unverified search count", async () => {
  Object.assign(browser, { mmllm: { discardAttachments: async () => {} } });
  const normalizer = new SearchEvidenceNormalizer("gemini");
  geminiMultiQueryEvents.forEach((event) => normalizer.accept(event));
  const search = normalizer.snapshot(true);
  for (const legacyCount of [undefined, 1]) {
    const thread = syntheticChatThread({ messages: [{ id: "a", role: "assistant", text: "합성 다중 검색 답변", createdAt: new Date().toISOString(),
      webSearch: { ...search, ...(legacyCount !== undefined ? { requestCount: legacyCount } : {}) } }] });
    await render(<ConfirmProvider><ChatPanel {...syntheticChatProps} thread={thread} modelId={thread.modelId} models={[{ id: thread.modelId, type: "llm" }]} /></ConfirmProvider>);
    const status = document.querySelector('[aria-label="웹 검색 실행 상태"]')!.textContent!;
    assert.match(status, /실행 확인/); assert.doesNotMatch(status, /검색 \d+회/);
    assert.match(status, /확인된 웹 출처 1개/);
    assert.equal(search.queries.length, 3);
  }
});

test("real ChatPanel explains unsupported Claude paused search and sends a fresh question without continuation", async () => {
  for (const theme of ["light", "dark"]) {
    browser.document.documentElement.dataset.theme = theme;
    const thread = syntheticChatThread({ id: `paused-${theme}`, modelId: "claude-sonnet-5", messages: [
      { id: "u", role: "user", text: "합성 질문", createdAt: new Date().toISOString() },
      { id: "a", role: "assistant", text: "합성 부분 답변", createdAt: new Date().toISOString(), status: "incomplete",
        continuationUnsupportedReason: "claude_pause_turn", webSearch: { route: "native", provider: "claude", status: "executed",
          queries: ["synthetic query"], citations: [{ url: "https://example.test/source", title: "합성 출처" }] } }
    ] });
    const requests: import("../src/shared/contracts").ChatRequest[] = [];
    Object.assign(browser, { mmllm: { discardAttachments: async () => {},
      streamChat: (request: import("../src/shared/contracts").ChatRequest, receive: (event: import("../src/shared/contracts").ChatEvent) => void) => {
        requests.push(request); queueMicrotask(() => receive({ type: "done", snapshot: { ...thread, messages: [...thread.messages,
          { id: "u-new", role: "user", text: request.text, createdAt: thread.createdAt },
          { id: "a-new", role: "assistant", text: "합성 새 답변", createdAt: thread.createdAt, status: "complete" }] } }));
        return () => {};
      }
    } });
    function Harness() {
      const [current, setCurrent] = React.useState(thread);
      return <ConfirmProvider><div style={{ width: 360 }}><ChatPanel {...syntheticChatProps} thread={current} modelId={thread.modelId}
        onThreadUpdated={setCurrent} models={[{ id: thread.modelId, type: "llm" }]} initialDraft="새 합성 질문" /></div></ConfirmProvider>;
    }
    await render(<Harness />);
    assert.match(document.body.textContent!, /합성 부분 답변/);
    assert.match(document.body.textContent!, /이 검색 턴의 이어 생성은 지원하지 않습니다.*별도 요청으로 추가 과금/);
    assert.equal([...document.querySelectorAll("button")].some((button) => button.textContent === "이어서 생성"), false);
    assert.match(document.querySelector('[aria-label="웹 검색 실행 상태"]')!.textContent!, /실행 확인.*합성 출처/s);
    assert.equal(requests.length, 0, "render/restore does not retry the paused turn");
    const send = document.querySelector<HTMLButtonElement>('[aria-label="메시지 전송"]')!;
    send.focus(); assert.equal(document.activeElement, send);
    await click(send);
    assert.equal(requests.length, 1); assert.equal(requests[0].text, "새 합성 질문");
    assert.equal(requests[0].continueIncompleteId, undefined);
  }
});

test("real ChatPanel keeps generic continuation for max_tokens and Responses incomplete answers", async () => {
  Object.assign(browser, { mmllm: { discardAttachments: async () => {} } });
  for (const modelId of ["claude-sonnet-5", "gpt-6-astra"]) {
    const thread = syntheticChatThread({ modelId, messages: [{ id: "a", role: "assistant", text: "합성 부분 답변",
      createdAt: new Date().toISOString(), status: "incomplete" }] });
    await render(<ConfirmProvider><ChatPanel {...syntheticChatProps} thread={thread} modelId={thread.modelId}
      models={[{ id: thread.modelId, type: "llm" }]} /></ConfirmProvider>);
    const continuation = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "이어서 생성");
    assert.ok(continuation); assert.equal(continuation.disabled, false);
    assert.doesNotMatch(document.body.textContent!, /이어 생성은 지원하지 않습니다/);
  }
});

test("real native citations explain blocked HTTP links and handle external-open failure", async () => {
  let attempts = 0;
  Object.assign(browser, { mmllm: { discardAttachments: async () => {}, openExternal: async () => { attempts++; throw new Error("synthetic OS failure"); } } });
  const thread = syntheticChatThread({ messages: [{ id: "a", role: "assistant", text: "합성 답변", createdAt: new Date().toISOString(),
    webSearch: { route: "native", provider: "gemini", status: "executed", queries: [], citations: [
      { url: "http://example.test/source", title: "HTTP 출처" }, { url: "https://example.test/source", title: "HTTPS 출처" } ] } }] });
  await render(<ConfirmProvider><ChatPanel {...syntheticChatProps} thread={thread} modelId={thread.modelId} models={[{ id: thread.modelId, type: "llm" }]} /></ConfirmProvider>);
  const http = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "HTTP 출처")!;
  assert.equal(http.disabled, true); assert.match(document.body.textContent!, /HTTP 출처는 열 수 없습니다/);
  await click(http); assert.equal(attempts, 0);
  await click([...document.querySelectorAll("button")].find((button) => button.textContent === "HTTPS 출처")!);
  assert.equal(attempts, 1); assert.match(document.querySelector('[role="alert"]')!.textContent!, /출처를 열지 못했습니다/);
});

test("real App research results use the existing modal focus layer in narrow windows and both themes", async () => {
  const style = document.createElement("style"); style.textContent = readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8"); document.head.append(style);
  const originalWidth = browser.innerWidth;
  let discoveries = 0;
  try {
    await openRealComparison({ discoverResearch: async () => { discoveries++; return []; }, cancelResearch: async () => {} });
    await act(async () => { browser.innerWidth = 480; browser.dispatchEvent(new browser.Event("resize")); });
    const toggle = [...document.querySelectorAll("button")].find((button) => button.textContent === "논문·법령 검색")!;
    await click(toggle); assert.equal(discoveries, 0);
    const dialog = document.querySelector<HTMLElement>('.workspace-tools-dialog[role="dialog"]')!;
    assert.ok(dialog.querySelector('.research-panel[aria-label="논문·법령 검색"]'));
    for (const theme of ["light", "dark"]) {
      document.documentElement.dataset.theme = theme;
      assert.equal(Number.parseFloat(browser.getComputedStyle(dialog.querySelector('.research-panel')!).minWidth), 0);
      assert.match(dialog.textContent!, /키 30회\/분.*200회\/일/);
    }
    const controls = [...dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    await act(async () => controls.at(-1)!.focus()); await key("Tab");
    assert.equal(document.activeElement, controls[0]);
    await key("Escape"); assert.equal(document.querySelector('.workspace-tools-dialog'), null);
    assert.equal(discoveries, 0);
  } finally { browser.innerWidth = originalWidth; style.remove(); }
});

test("real App project dialog loads saved semantic settings while cached project summaries remain local", async () => {
  const now = new Date().toISOString();
  const project = { id: "synthetic-ui-project", name: "합성 연구", instruction: "", documents: [], threadCount: 0, createdAt: now, updatedAt: now };
  const settings = { mode: "semantic", embeddingModelId: "text-embedding-3-small", queryConsent: true, rerankConsent: false };
  let paid = 0;
  await openRealComparison({ listProjects: async () => [project], getProjectRetrieval: async () => ({ settings, documents: [], uncertain: 0, running: false }),
    startProjectIndex: async () => { paid++; }, searchProjectDocuments: async () => { paid++; } });
  await key("Escape");
  const open = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("프로젝트") && button.closest(".rail"))!;
  await click(open);
  const select = document.querySelector<HTMLSelectElement>('.retrieval-settings select')!;
  assert.equal(select.value, "semantic"); assert.equal(paid, 0);
  await key("Escape"); await click(open);
  assert.equal(document.querySelector<HTMLSelectElement>('.retrieval-settings select')!.value, "semantic"); assert.equal(paid, 0);
});
