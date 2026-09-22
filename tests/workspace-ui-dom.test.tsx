import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import type { CompareEvent, CompareRequest } from "../src/shared/contracts";
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


async function openRealComparison() {
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
    getUpdateState: async () => ({ status: "idle", currentVersion: "0.5.0" }), onUpdateChanged: () => () => {},
    pickAttachment: async () => ({ id: `report-${++nextId}`, name: "report.pdf", kind: "document", size: 100 }),
    discardAttachments: async () => {}, streamCompare: (request: CompareRequest, listener: (event: CompareEvent) => void) => {
      requests.push(request); receive = listener; return () => {};
    }
  } });
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  const button = [...document.querySelectorAll("button")].find(button => button.textContent?.includes("모델 비교"))!;
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
