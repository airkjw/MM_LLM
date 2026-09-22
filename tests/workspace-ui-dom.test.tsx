import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { Window } from "happy-dom";
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
