import assert, { assertFocused } from "./dom-assert.ts";
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
let DeidCheck: typeof import("../src/renderer/src/ui-shared")["DeidCheck"];
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
  ({ MarkdownText, DeidCheck } = await import("../src/renderer/src/ui-shared"));
  ({ Notice } = await import("../src/renderer/src/components/Notice"));
});
async function render(ui: React.ReactNode) {
  if (!host) { host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => root!.render(ui));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}
async function key(value: string, modifiers: { shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}) {
  await act(async () => { (document.activeElement ?? document.body).dispatchEvent(new browser.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...modifiers })); });
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
  const trigger = document.querySelector(".composer-model-token")!;
  await click(trigger);
  const input = document.querySelector('[role="combobox"]')!;
  assertFocused(input);
  assert.equal(trigger.getAttribute("aria-haspopup"), "dialog");
  await key("End");
  assert.match(input.getAttribute("aria-activedescendant")!, /-2$/);
  await key("Home"); await key("ArrowDown"); await key("Enter");
  assert.deepEqual(chosen, ["b"]); assertFocused(trigger);
  assert.equal(document.querySelector('[role="dialog"]'), null);
});
test("confirmation cancels with Escape and requires explicit destructive action", async () => {
  const answers: boolean[] = [];
  function Harness() { const confirm = useConfirm(); return <button onClick={async () => {
    answers.push(await confirm({ title: "삭제 확인", message: "되돌릴 수 없습니다.", confirmLabel: "대화 삭제", danger: true }));
  }}>열기</button>; }
  await render(<ConfirmProvider><Harness /></ConfirmProvider>);
  const trigger = document.querySelector("button")!; await click(trigger); await key("Escape");
  assert.deepEqual(answers, [false]); assertFocused(trigger);
  await click(trigger); await click(document.querySelector(".danger-button")!);
  assert.deepEqual(answers, [false, true]); assertFocused(trigger);
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
  await render(<Harness />); await click(document.querySelector(".composer-model-token")!);
  assert.ok(document.querySelector('[role="group"][aria-label="최근 사용"]'));
  const favorite = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("즐겨찾기 추가"))!;
  await click(favorite); assert.ok(document.querySelector('[role="group"][aria-label="즐겨찾기"]'));
  await click(document.querySelector('[role="option"]')!);
  assert.deepEqual(changes, [["b", "favorite"], ["b", "recent"]]);
});
test("model picker Shift+Enter adds the active row to the comparison and announces the three-model limit without closing", async () => {
  const added: string[] = [];
  function Harness() {
    const [ids, setIds] = React.useState(["a"]);
    return <ModelPreferences.Provider value={{ favorites: [], recent: [], update: () => {} }}>
      <ModelPicker models={["a", "b", "c", "d"].map((id) => ({ id, type: "llm" }))} selected="a" onSelect={() => {}}
        compare={{ ids, onAdd: (id) => {
          if (ids.includes(id)) return "이미 비교 목록에 있는 모델입니다.";
          if (ids.length >= 3) return "비교는 최대 3개 모델까지 할 수 있습니다.";
          added.push(id); setIds([...ids, id]); return `${id} 비교에 추가 · ${ids.length + 1}/3`;
        } }} /></ModelPreferences.Provider>;
  }
  await render(<Harness />);
  await click(document.querySelector(".composer-model-token")!);
  const input = document.querySelector('[role="combobox"]')!;
  await key("ArrowDown"); await key("Enter", { shiftKey: true });
  await key("ArrowDown"); await key("Enter", { shiftKey: true });
  assert.deepEqual(added, ["b", "c"]);
  assert.ok(document.querySelector(".model-popover"), "Shift+Enter never closes the picker");
  await key("ArrowDown"); await key("Enter", { shiftKey: true });
  assert.deepEqual(added, ["b", "c"], "a fourth model is refused");
  assert.match(document.querySelector('.model-popover [role="status"]')!.textContent!, /최대 3개/);
  assert.ok(document.querySelector(".model-popover"), "the limit notice keeps the picker open");
  assertFocused(input);
  assert.match(document.querySelector(".model-picker-footer")!.textContent!, /⇧↵ 비교에 추가 · ⌥↵ 즐겨찾기/);
});

test("model picker Alt+Enter toggles the active favorite and every row star is a pressed-state button reachable by Tab", async () => {
  const changes: Array<[string, string]> = [];
  function Harness() {
    const [favorites, setFavorites] = React.useState<string[]>([]);
    return <ModelPreferences.Provider value={{ favorites, recent: [], update: (id, action) => {
      changes.push([id, action]);
      if (action === "favorite") setFavorites((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
    } }}><ModelPicker models={["a", "b"].map((id) => ({ id, type: "llm" }))} selected="a" onSelect={() => {}} /></ModelPreferences.Provider>;
  }
  await render(<Harness />);
  await click(document.querySelector(".composer-model-token")!);
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await key("ArrowDown"); await key("Enter", { altKey: true });
  assert.deepEqual(changes, [["b", "favorite"]]);
  assert.ok(document.querySelector(".model-popover"), "the favorite shortcut keeps the picker open");
  assert.equal(input.value, "", "Alt+Enter does not type into the search field");
  const stars = [...document.querySelectorAll<HTMLButtonElement>(".model-favorite-action")];
  assert.equal(stars.length, 2);
  assert.ok(stars.every((star) => star.tabIndex !== -1 && star.hasAttribute("aria-pressed")));
  assert.deepEqual(stars.map((star) => star.getAttribute("aria-pressed")), ["true", "false"], "favorite b now sorts first");
  // The modal focus trap wraps from the last row star back to the search field, so the stars are in its Tab sequence.
  stars[1].focus(); assertFocused(stars[1]);
  await key("Tab");
  assertFocused(input);
});

test("model picker listbox holds only options and groups; each favorite star is a sibling aligned to its row", async () => {
  await render(<ModelPicker models={["a", "b", "c"].map((id) => ({ id, type: "llm" }))} selected="a" onSelect={() => {}} />);
  await click(document.querySelector(".composer-model-token")!);
  const listbox = document.querySelector('[role="listbox"]')!;
  assert.equal(listbox.querySelectorAll("button, input, a, [tabindex]").length, 0, "no interactive child inside the listbox");
  const allowed = new Set(["option", "group"]);
  for (const child of listbox.querySelectorAll("[role]")) assert.ok(allowed.has(child.getAttribute("role")!), `unexpected role ${child.getAttribute("role")}`);
  const options = [...listbox.querySelectorAll<HTMLElement>('[role="option"]')];
  const stars = [...document.querySelectorAll<HTMLElement>(".model-favorite-action")];
  assert.equal(options.length, 3);
  assert.equal(stars.length, 3);
  for (const star of stars) assert.equal(star.closest('[role="listbox"]'), null, "stars live outside the listbox");
  options.forEach((option, index) => {
    assert.ok(option.style.gridRow, "option carries its grid row");
    assert.equal(stars[index].style.gridRow, option.style.gridRow, "the star shares its option's grid row");
  });
});

test("the media de-identification consent row is one native checkbox with the existing wording and no extra square", async () => {
  const changes: boolean[] = [];
  await render(<DeidCheck checked={false} onChange={(value) => changes.push(value)} />);
  const row = document.querySelector(".deid-check")!;
  assert.equal(row.querySelectorAll('input[type="checkbox"]').length, 1);
  assert.equal(row.querySelector(".custom-check"), null, "no second drawn box beside the native checkbox");
  assert.match(row.textContent!, /^환자 식별정보를 제거한 자료만 전송합니다$/);
  await click(row.querySelector("input")!);
  assert.deepEqual(changes, [true]);
  // Every consent checkbox row in the app is a label holding exactly one checkbox.
  const source = ["ChatPanel", "MediaPanel", "VoicePanel", "ProjectRetrievalSettings", "ui-shared"].map((name) =>
    readFileSync(new URL(`../src/renderer/src/${name}.tsx`, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(source, /className="custom-check"/);
});

test("inline comparison synthesis notice lists only the answer letters that exist", async () => {
  const { requests, emit } = await openRealComparison();
  await click(sendButton());
  const base = { id: "run-3", prompt: requests[0].prompt, webSearchMode: "off" as const, createdAt: new Date().toISOString(), attachmentNames: [] };
  await emit({ type: "done", run: { ...base, modelIds: compareModels.slice(0, 2),
    results: compareModels.slice(0, 2).map((modelId) => ({ modelId, status: "completed" as const, text: "합성" })) } });
  assert.match(document.querySelector(".compare-synthesis-bar")!.textContent!,
    /^GPT-5.6 Sol이 답변 A·B의 차이와 근거를 검토합니다. 실행 시 추가 크레딧이 사용됩니다./);
  assert.doesNotMatch(document.querySelector(".compare-synthesis-bar")!.textContent!, /A·B·C/);
});

test("inline comparison synthesis notice letters come from the answers the synthesis really reviews", async () => {
  const { requests, emit } = await openRealComparison();
  await click(sendButton());
  const base = { id: "run-4", prompt: requests[0].prompt, modelIds: compareModels, webSearchMode: "off" as const,
    createdAt: new Date().toISOString(), attachmentNames: [] };
  const notice = () => document.querySelector(".compare-synthesis-bar small")!.textContent!;
  await emit({ type: "done", run: { ...base, results: [
    { modelId: compareModels[0], status: "completed" as const, text: "합성 A" },
    { modelId: compareModels[1], status: "failed" as const, text: "", error: "합성 실패" },
    { modelId: compareModels[2], status: "completed" as const, text: "합성 C" }] } });
  assert.equal(notice(), "GPT-5.6 Sol이 답변 A·C의 차이와 근거를 검토합니다. 실행 시 추가 크레딧이 사용됩니다.",
    "a failed middle answer is not reviewed or billed, so its letter is not announced");
  await emit({ type: "done", run: { ...base, results: compareModels.map((modelId) => ({ modelId, status: "completed" as const, text: "합성" })) } });
  assert.equal(notice(), "GPT-5.6 Sol이 답변 A·B·C의 차이와 근거를 검토합니다. 실행 시 추가 크레딧이 사용됩니다.");
  await emit({ type: "done", run: { ...base, results: compareModels.slice(0, 2).map((modelId) => ({ modelId, status: "completed" as const, text: "합성" })) } });
  assert.equal(notice(), "GPT-5.6 Sol이 답변 A·B의 차이와 근거를 검토합니다. 실행 시 추가 크레딧이 사용됩니다.");
});

test("blocked links retain readable content and an explanation", async () => {
  await render(<MarkdownText text="[자료](http://example.invalid)" />);
  assert.equal(document.querySelector("a"), null);
  assert.match(document.body.textContent!, /자료.*보안상 직접 열 수 없는 링크/);
});


const compareModels = ["gpt-5.6-sol", "claude-opus-5", "gemini-3.8-flash"];
function compareFixture(extraApi: Record<string, unknown> = {}, threadOverrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const models = compareModels.map(id => ({ id, type: "llm" }));
  const thread = { id: "compare-origin", title: "새 대화", modelId: models[0].id,
    createdAt: now, updatedAt: now, webSearchMode: "off", reasoningMode: "auto",
    instruction: "", advanced: {}, attachmentConsent: true, messages: [], messageCount: 0, ...threadOverrides };
  const requests: CompareRequest[] = [];
  const continued: Array<[string, string]> = [];
  let receive: ((event: CompareEvent) => void) | undefined;
  let nextId = 0;
  const settings = { theme: "dark", fontSize: "medium", defaultInstruction: "", favoriteModels: [] as string[], recentModels: [] as string[] };
  Object.assign(browser, { mmllm: {
    getSession: async () => ({ authenticated: true, models, credits: { total: { remaining: 1000 } } }),
    getSettings: async () => settings, updateModelPreference: async () => settings,
    setThemePreference: async () => {}, listThreads: async () => [thread], loadThread: async () => thread,
    listProjects: async () => [], listBackgroundResponses: async () => [], listCompareRuns: async () => [],
    getUpdateState: async () => ({ status: "idle", currentVersion: "0.5.0" }), onUpdateChanged: () => () => {}, onThemeResolved: () => () => {},
    pickAttachment: async () => ({ id: `report-${++nextId}`, name: "report.pdf", kind: "document", size: 100 }),
    acknowledgeAttachmentPrivacy: async () => ({ ...thread, attachmentConsent: true }),
    continueCompare: async (runId: string, modelId: string) => { continued.push([runId, modelId]); return { ...thread, id: "continued", modelId }; },
    discardAttachments: async () => {}, streamCompare: (request: CompareRequest, listener: (event: CompareEvent) => void) => {
      requests.push(request); receive = listener; return () => {};
    }, ...extraApi
  } });
  return { thread, requests, continued, emit: async (event: CompareEvent) => { await act(async () => receive!(event)); } };
}
const sendButton = () => document.querySelector<HTMLButtonElement>('[aria-label="메시지 전송"]')!;
const composerInput = () => document.querySelector<HTMLTextAreaElement>(".composer-input")!;
async function typeComposer(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, "value")!.set!.call(composerInput(), value);
    composerInput().dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
}
async function addCompareModel(id: string) {
  await click(document.querySelector(".composer-model-add")!);
  await click([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent?.includes(id))!);
}
async function openRealComparison(extraApi: Record<string, unknown> = {}, threadOverrides: Record<string, unknown> = {}) {
  const fixture = compareFixture(extraApi, threadOverrides);
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  await addCompareModel(compareModels[1]); await addCompareModel(compareModels[2]);
  assert.deepEqual([...document.querySelectorAll(".composer-model-token")].map((token) => token.textContent?.replace(/[^\w.@-]/g, "")),
    compareModels.map((id) => `@${id}`));
  await typeComposer("첨부 보고서를 비교 검토해 주세요.");
  return fixture;
}
const attachButton = () => document.querySelector<HTMLButtonElement>(".attach-button")!;

test("real inline comparison requires a visible attachment consent and sends confirmed attachments", async () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");
  document.head.append(style);
  try {
    const { requests } = await openRealComparison();
    await click(attachButton());
    const checkbox = document.querySelector<HTMLInputElement>(".composer-compare-consent .deid-check input")!;
    assert.ok(checkbox, "attachments with two or more models show the existing consent checkbox below the composer");
    assert.match(checkbox.closest(".deid-check")!.textContent!, /환자 식별정보나 개인정보를 제거했습니다. 자료는 선택한 모델 수만큼 외부 전송·과금될 수 있습니다./);
    const css = window.getComputedStyle(checkbox);
    assert.notEqual(css.opacity, "0");
    assert.ok(parseFloat(css.width) > 0 && parseFloat(css.height) > 0);
    assert.equal(sendButton().disabled, true);
    await click(sendButton()); assert.equal(requests.length, 0);
    assert.match(document.querySelector("#compare-consent-hint")!.textContent!, /확인란을 체크/);
    assert.equal(checkbox.getAttribute("aria-describedby"), "compare-consent-hint");
    await click(checkbox);
    assert.equal(checkbox.checked, true); assert.equal(sendButton().disabled, false);
    await click(sendButton());
    assert.equal(requests.length, 1);
    assert.equal(requests[0].deidentifiedConfirmed, true);
    assert.deepEqual(requests[0].attachmentIds, ["report-1"]);
    assert.deepEqual(requests[0].modelIds, compareModels);
    assert.equal(requests[0].webSearchMode, "off", "the composer web toggle value is the comparison web mode");
    assert.equal(requests[0].prompt, "첨부 보고서를 비교 검토해 주세요.");
    assert.match(document.querySelector(".compare-inline .inline-progress")!.textContent!, /비교를 준비/);
    assert.equal(document.querySelector(".chat-welcome"), null, "the start screen gives way to the comparison");
  } finally { style.remove(); }
});

test("real inline comparison without attachments runs immediately and a server error releases the busy state", async () => {
  const { requests, emit } = await openRealComparison();
  assert.equal(document.querySelector(".composer-compare-consent"), null, "no attachment, no consent checkbox");
  assert.equal(sendButton().disabled, false);
  await click(sendButton());
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].attachmentIds, []);
  assert.equal(requests[0].deidentifiedConfirmed, false);
  assert.ok(document.querySelector('[aria-label="비교 중단"]'), "a running comparison offers stop in place of send");
  await emit({ type: "error", message: "공통 웹 검색 연결에 실패했습니다." });
  const alerts = [...document.querySelectorAll('[role="alert"]')];
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].textContent!, /공통 웹 검색 연결/);
  assert.equal(document.querySelector('[aria-label="비교 중단"]'), null);
  await typeComposer("다시 질문");
  assert.equal(sendButton().disabled, false);
});

test("adding another comparison attachment resets consent before sending", async () => {
  const { requests } = await openRealComparison();
  await click(attachButton());
  await click(document.querySelector(".composer-compare-consent .deid-check input")!);
  await click(attachButton());
  assert.equal(document.querySelector<HTMLInputElement>(".composer-compare-consent .deid-check input")!.checked, false);
  assert.equal(sendButton().disabled, true);
  await click(sendButton()); assert.equal(requests.length, 0);
});

test("comparison startup errors release busy state and preserve attachments and the question for retry", async () => {
  await openRealComparison();
  await click(attachButton());
  await click(document.querySelector(".composer-compare-consent .deid-check input")!);
  window.mmllm.streamCompare = () => { throw new Error("비교 연결을 시작하지 못했습니다."); };
  await click(sendButton());
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /비교 연결을 시작/);
  assert.equal(sendButton().disabled, false);
  assert.ok(document.querySelector(".attachment-chip"));
  assert.equal(composerInput().value, "첨부 보고서를 비교 검토해 주세요.");
  assert.equal(document.querySelector(".compare-inline .inline-progress"), null);
});

test("inline comparison renders three columns, continues by click or digit only outside editable focus, and stacks at 960px", async () => {
  const { requests, continued, emit } = await openRealComparison({}, { attachmentConsent: false });
  await click(sendButton());
  const run = { id: "run-1", prompt: requests[0].prompt, modelIds: compareModels, webSearchMode: "off" as const,
    createdAt: new Date().toISOString(), attachmentNames: [],
    results: compareModels.map((modelId, index) => ({ modelId, status: "completed" as const, text: `합성 답변 ${index + 1}` })) };
  await emit({ type: "done", run });
  const columns = [...document.querySelectorAll(".compare-inline-columns > .compare-inline-column")];
  assert.equal(columns.length, 3);
  assert.match(document.querySelector(".compare-inline")!.textContent!, /합성 답변 2/);
  assert.match(columns[1].querySelector(".compare-inline-column-footer")!.textContent!, /이 답변으로 계속.*2/s);
  const css = readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 960px\) \{[^@]*\.compare-inline-columns \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.ok(columns[0].parentElement?.classList.contains("compare-inline-columns"), "the columns sit in the stacking grid");
  // A digit typed in the composer is text, never a column choice.
  composerInput().focus();
  await key("2");
  assert.deepEqual(continued, []);
  (document.activeElement as HTMLElement).blur();
  await act(async () => { document.body.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "2", bubbles: true, cancelable: true })); });
  assert.deepEqual(continued, [["run-1", compareModels[1]]]);
});

test("inline comparison synthesis bar appears only when ready and keeps the existing wording", async () => {
  const { requests, emit } = await openRealComparison();
  await click(sendButton());
  const base = { id: "run-2", prompt: requests[0].prompt, modelIds: compareModels, webSearchMode: "off" as const,
    createdAt: new Date().toISOString(), attachmentNames: [] };
  await emit({ type: "snapshot", run: { ...base, results: compareModels.map((modelId) => ({ modelId, status: "running" as const, text: "" })) } });
  assert.equal(document.querySelector(".compare-synthesis-bar"), null, "not ready while answers are running");
  await emit({ type: "done", run: { ...base, results: compareModels.map((modelId) => ({ modelId, status: "completed" as const, text: "합성" })) } });
  const bar = document.querySelector(".compare-synthesis-bar")!;
  assert.ok(bar);
  assert.match(bar.textContent!, /GPT-5.6 Sol이 답변 A·B·C의 차이와 근거를 검토합니다. 실행 시 추가 크레딧이 사용됩니다./);
  assert.match(bar.querySelector("button")!.textContent!, /종합분석/);
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
  const trigger = document.querySelector(".composer-model-token")!; await click(trigger);
  assert.equal(document.querySelectorAll('[role="option"]').length, 2);
  assert.equal(document.querySelectorAll(".native-search-badge").length, 1);
  assert.doesNotMatch(document.querySelector(".model-options")!.textContent!, /aux-/);
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(input, "Claude");
    input.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
  assert.equal(checks, 0, "render, selection and typing never fetch model detail");
  await key("Escape"); assertFocused(trigger);
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
    // The globe toggle is a menu showing the current value; the four modes are its items.
    const toggle = document.querySelector<HTMLButtonElement>('.composer-toggle[aria-label^="웹 검색 방식"]')!;
    assert.equal(toggle.getAttribute("aria-haspopup"), "menu");
    assert.match(toggle.getAttribute("aria-label")!, /딥리서치/);
    await click(toggle);
    const items = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
    assert.deepEqual(items.map((item) => item.dataset.value), ["always", "auto", "deep", "off"]);
    assert.equal(items.find((item) => item.getAttribute("aria-current") === "true")?.dataset.value, "deep");
    await key("Escape"); assertFocused(toggle);
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
    send.focus(); assertFocused(send);
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

test("real App research screen stays usable in narrow windows and both themes without a modal layer", async () => {
  // Stage 4 (D4.3): research left the tools dialog for its own screen. The intent is unchanged: opening it sends
  // nothing, the limit notice is shown, it fits a narrow window in both themes and every control is keyboard reachable.
  const style = document.createElement("style"); style.textContent = readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8"); document.head.append(style);
  const originalWidth = browser.innerWidth;
  let discoveries = 0;
  try {
    compareFixture({ discoverResearch: async () => { discoveries++; return []; }, cancelResearch: async () => {} });
    await render(<ConfirmProvider><App /></ConfirmProvider>);
    await act(async () => { browser.innerWidth = 480; browser.dispatchEvent(new browser.Event("resize")); });
    const railResearch = [...document.querySelectorAll<HTMLButtonElement>(".rail .rail-item")].find((button) => button.textContent === "논문·법령 리서치")!;
    await click(railResearch); assert.equal(discoveries, 0);
    assert.equal(document.querySelector('[role="dialog"]'), null, "research is a screen, not a modal");
    const screen = document.querySelector<HTMLElement>('.research-screen')!;
    assert.ok(screen.querySelector('.research-column[aria-label="검색 설정"]'));
    for (const theme of ["light", "dark"]) {
      document.documentElement.dataset.theme = theme;
      assert.equal(Number.parseFloat(browser.getComputedStyle(screen).minWidth || "0"), 0);
      assert.match(screen.textContent!, /키 30회\/분.*200회\/일/);
    }
    const controls = [...screen.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    assert.ok(controls.length > 0);
    for (const control of controls) assert.equal(control.closest("[hidden], [inert]"), null, "no visible control sits in a hidden layer");
    assert.equal(discoveries, 0);
  } finally { browser.innerWidth = originalWidth; style.remove(); }
});

test("real App project dialog loads saved semantic settings while cached project summaries remain local", async () => {
  const now = new Date().toISOString();
  const project = { id: "synthetic-ui-project", name: "합성 연구", instruction: "", documents: [], threadCount: 0, createdAt: now, updatedAt: now };
  const settings = { mode: "semantic", embeddingModelId: "text-embedding-3-small", queryConsent: true, rerankConsent: false };
  let paid = 0;
  compareFixture({ listProjects: async () => [project], getProjectRetrieval: async () => ({ settings, documents: [], uncertain: 0, running: false }),
    startProjectIndex: async () => { paid++; }, searchProjectDocuments: async () => { paid++; } });
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  const open = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("프로젝트") && button.closest(".rail"))!;
  await click(open);
  const select = document.querySelector<HTMLSelectElement>('.retrieval-settings select')!;
  assert.equal(select.value, "semantic"); assert.equal(paid, 0);
  await key("Escape"); await click(open);
  assert.equal(document.querySelector<HTMLSelectElement>('.retrieval-settings select')!.value, "semantic"); assert.equal(paid, 0);
});

test("start cards answer digits 1–4 only when nothing editable has focus and no modal or popover is open", async () => {
  Object.assign(browser, { mmllm: { discardAttachments: async () => {} } });
  const { templates } = await import("../src/renderer/src/ui-shared");
  const chosen: string[] = [];
  const thread = syntheticChatThread({ webSearchMode: "off" });
  await render(<ConfirmProvider><ChatPanel {...syntheticChatProps} thread={thread} modelId={thread.modelId}
    models={[{ id: thread.modelId, type: "llm" }]} onTemplateStart={async (item) => { chosen.push(item.title); }} /></ConfirmProvider>);
  const cards = [...document.querySelectorAll<HTMLButtonElement>(".template-grid .template-card")];
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((card) => card.querySelector("kbd")?.textContent), ["1", "2", "3", "4"]);
  assert.deepEqual(cards.map((card) => card.getAttribute("aria-keyshortcuts")), ["1", "2", "3", "4"]);
  assert.match(document.querySelector(".chat-welcome .eyebrow")!.textContent!, /KYUNG HEE UNIVERSITY · MEDICAL MBA/);
  composerInput().focus();
  await key("1");
  assert.deepEqual(chosen, [], "a digit typed in the composer stays text");
  composerInput().blur();
  await act(async () => { document.body.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "3", bubbles: true, cancelable: true })); });
  assert.deepEqual(chosen, [templates[2].title]);
  await click(document.querySelector('.composer-toggle[aria-label^="웹 검색 방식"]')!);
  assert.ok(document.querySelector('[role="menu"]'));
  await act(async () => { document.body.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "2", bubbles: true, cancelable: true })); });
  assert.deepEqual(chosen, [templates[2].title], "an open menu blocks digit shortcuts");
});

test("the composer footer shows one README notice line and the web route exactly once", async () => {
  Object.assign(browser, { mmllm: { discardAttachments: async () => {} } });
  const thread = syntheticChatThread({ webSearchMode: "always" });
  await render(<ConfirmProvider><ChatPanel {...syntheticChatProps} thread={thread} modelId={thread.modelId}
    models={[{ id: thread.modelId, type: "llm" }]} /></ConfirmProvider>);
  const notices = [...document.querySelectorAll(".composer-notice")];
  assert.equal(notices.length, 1);
  assert.equal(notices[0].textContent, "환자 식별정보는 전송 전에 직접 제거해 주세요 · 대화 기록은 이 기기에 암호화 저장됩니다");
  const text = document.querySelector(".chat-panel")!.textContent!;
  assert.equal(text.split("자체 검색 미확인 · 전송 시 확인, 미확인/미지원은 Sonar 추가 요청").length - 1, 1,
    "the billing-relevant route label is visible exactly once");
  assert.ok(document.querySelector('.composer-route [role="status"]'));
  assert.doesNotMatch(text, /환자 식별정보는 입력 전에 제거해 주세요|대화 기록은 기기 안에 저장됩니다/);
  assert.match(document.querySelector(".composer-hint")!.textContent!, /↵ 전송 · ⇧↵ 줄바꿈/);
});

test("composer reasoning menu lists only the selected model's choices and saves the picked value", async () => {
  const saved: unknown[] = [];
  Object.assign(browser, { mmllm: { discardAttachments: async () => {},
    updateThreadSettings: async (_id: string, value: unknown) => { saved.push(value); return syntheticChatThread({ reasoningMode: "deep" }); } } });
  const thread = syntheticChatThread({ modelId: "gemini-3.8-flash" });
  await render(<ConfirmProvider><ChatPanel {...syntheticChatProps} thread={thread} modelId={thread.modelId}
    models={[{ id: thread.modelId, type: "llm" }]} /></ConfirmProvider>);
  const toggle = document.querySelector<HTMLButtonElement>('.composer-toggle[aria-label^="사고 강도"]')!;
  await click(toggle);
  const items = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
  assert.deepEqual(items.map((item) => item.textContent?.trim().replace(/, 현재 선택$/, "")), ["자동", "빠르게", "균형", "깊게"]);
  await click(items[3]);
  assert.equal((saved[0] as { reasoningMode: string }).reasoningMode, "deep");
  assertFocused(toggle);
  await render(<ConfirmProvider><ChatPanel {...syntheticChatProps} thread={syntheticChatThread({ modelId: "claude-sonnet-5" })}
    modelId="claude-sonnet-5" models={[{ id: "claude-sonnet-5", type: "llm" }]} /></ConfirmProvider>);
  assert.equal(document.querySelector('.composer-toggle[aria-label^="사고 강도"]'), null, "Claude has no adjustable menu");
  assert.match(document.querySelector(".reasoning-unavailable")!.textContent!, /사고 강도: 자동/);
});

// Inside text fields only the platform's command key acts (R-3 F5): Cmd on macOS, Ctrl elsewhere.
const MAC_PLATFORM = navigator.platform.includes("Mac");
const MOD = MAC_PLATFORM ? { metaKey: true } : { ctrlKey: true };
const OTHER_MOD = MAC_PLATFORM ? { ctrlKey: true } : { metaKey: true };

test("real App: Cmd/Ctrl+N and Cmd/Ctrl+Shift+C work inside the composer, other shortcuts stay text", async () => {
  let creates = 0;
  const { thread } = compareFixture({ createThread: async () => { creates++; return { ...syntheticChatThread(), id: `new-${creates}`, modelId: compareModels[0] }; },
    listThreads: async () => [] });
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  assert.ok(thread);
  composerInput().focus();
  await key("n", MOD);
  assert.equal(creates, 2, "the startup thread plus one Ctrl+N from inside the composer");
  composerInput().focus();
  await key("C", { ...MOD, shiftKey: true });
  const tokens = [...document.querySelectorAll(".composer-model-token")];
  assert.equal(tokens.length, 2, "a second model token was added");
  assert.ok(document.querySelector(".model-popover"), "the picker opens on the new token");
  await key("Escape");
  assertFocused(tokens[1]);
  composerInput().focus();
  await key("b", { ctrlKey: true });
  assert.ok(!document.querySelector(".sidebar")?.classList.contains("collapsed"), "Ctrl+B stays a text-field key");
});

test("real App: the body header search stays visible while models are missing", async () => {
  compareFixture({ getSession: async () => ({ authenticated: true, models: [], credits: { total: { remaining: 1000 } } }) });
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  assert.ok(document.querySelector(".no-models"));
  const search = document.querySelector<HTMLButtonElement>(".panel-header .header-search");
  assert.ok(search, "the header Cmd+K entry is rendered in the no-models state");
  assert.equal(search.getAttribute("aria-keyshortcuts"), "Meta+K Control+K");
});

test("real App: the compare rail item is a screen listing saved runs read-only", async () => {
  const run = { id: "saved-run", prompt: "저장된 합성 비교", modelIds: compareModels.slice(0, 2), webSearchMode: "off" as const,
    createdAt: new Date().toISOString(), attachmentNames: [],
    results: compareModels.slice(0, 2).map((modelId) => ({ modelId, status: "completed" as const, text: `${modelId} 합성 답변` })) };
  let syntheses = 0; let compares = 0;
  const { continued } = compareFixture({ listCompareRuns: async () => [run], streamCompareSynthesis: () => { syntheses++; return () => {}; },
    streamCompare: () => { compares++; return () => {}; } });
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  const rail = [...document.querySelectorAll<HTMLButtonElement>(".rail .rail-item")].find((item) => item.textContent === "모델 비교")!;
  await click(rail);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.equal(rail.getAttribute("aria-current"), "page");
  assert.equal(document.querySelectorAll('[aria-current="page"]').length, 1);
  assert.ok(document.querySelector(".compare-screen .panel-header .header-search"));
  await click([...document.querySelectorAll<HTMLButtonElement>(".compare-run-list button")].find((item) => item.textContent?.includes("저장된 합성 비교"))!);
  assert.equal(document.querySelectorAll(".compare-screen .compare-inline-column").length, 2);
  assert.equal(document.querySelector(".compare-screen .compare-synthesis-bar"), null, "a saved run starts no new synthesis");
  await click([...document.querySelectorAll<HTMLButtonElement>(".compare-screen button")].find((item) => item.textContent?.includes("이 답변으로 계속"))!);
  assert.deepEqual(continued, [["saved-run", compareModels[0]]]);
  assert.equal(syntheses + compares, 0);
});

async function wait(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const paletteInput = () => document.querySelector<HTMLInputElement>('.command-palette [role="combobox"]')!;
async function typePalette(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(paletteInput(), value);
    paletteInput().dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
}

test("real App: Cmd/Ctrl+K inside the composer opens the palette and Escape returns focus to the composer", async () => {
  compareFixture({ searchThreads: async () => [] });
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  assert.equal(document.querySelector("#search-title"), null, "the old search dialog is gone");
  const composer = composerInput();
  composer.focus();
  await key("k", MOD);
  await wait(5);
  assert.ok(document.querySelector('.command-palette[role="dialog"][aria-modal="true"]'), "the palette opens from inside a text field");
  assertFocused(paletteInput());
  await key("Escape");
  assert.equal(document.querySelector(".command-palette"), null);
  assertFocused(composer);
});

test("real App: choosing a conversation in the palette selects that thread", async () => {
  const other = { id: "palette-other", title: "외래 대기시간 합성 대화", modelId: compareModels[0], createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), webSearchMode: "off", reasoningMode: "auto", instruction: "", advanced: {},
    attachmentConsent: true, messages: [], messageCount: 0 };
  const loaded: string[] = []; const queries: string[] = [];
  const { thread } = compareFixture({
    searchThreads: async (query: string) => { queries.push(query); return [{ ...other, snippet: "합성 대기 지표" }]; }
  });
  window.mmllm.loadThread = async (id: string) => { loaded.push(id); return id === other.id ? other : thread; };
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  loaded.length = 0;
  document.body.focus();
  await key("k", { ctrlKey: true });
  await typePalette("대기");
  await wait(220);
  assert.deepEqual(queries, ["대기"]);
  const option = [...document.querySelectorAll('.command-palette [role="option"][data-kind="thread"]')][0]!;
  assert.match(option.textContent!, /외래 대기시간 합성 대화/);
  assert.equal(option.querySelector("mark")?.textContent, "대기");
  await key("Enter");
  await wait(10);
  assert.deepEqual(loaded, [other.id], "the palette uses the existing selectThread path");
  assert.equal(document.querySelector(".command-palette"), null);
  assert.match(document.querySelector(".chat-panel .panel-header h2")!.textContent!, /외래 대기시간 합성 대화/);
});

test("real App: palette commands run new thread, theme, credits and compare through the existing paths", async () => {
  let creates = 0; const settingsWrites: unknown[] = []; const creditCalls: boolean[] = [];
  const { thread } = compareFixture({
    searchThreads: async () => { throw new Error("commands must not search"); },
    createThread: async () => { creates++; return { ...syntheticChatThread(), id: `palette-new-${creates}`, modelId: compareModels[0] }; },
    updateSettings: async (next: Record<string, unknown>) => { settingsWrites.push(next); return next; },
    getCredits: async (force: boolean) => { creditCalls.push(force); return { total: { remaining: 900 } }; }
  });
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  const run = async (label: RegExp) => {
    document.body.focus();
    await key("k", { metaKey: true });
    await typePalette("/");
    const option = [...document.querySelectorAll<HTMLElement>('.command-palette [role="option"][data-kind="command"]')]
      .find((item) => label.test(item.textContent!))!;
    assert.ok(option, `command ${label} is listed`);
    await click(option);
    await wait(10);
  };
  const labels = () => [...document.querySelectorAll('.command-palette [role="option"]')].map((item) => item.textContent);
  document.body.focus();
  await key("k", { metaKey: true });
  assert.deepEqual(labels(), ["새 대화⌘N", "모델 비교 시작⌘⇧C", "화면 모드 › 시스템", "화면 모드 › 라이트", "화면 모드 › 다크", "크레딧 새로고침"]
    .map((text) => navigator.platform.includes("Mac") ? text : text.replace("⌘⇧", "Ctrl+Shift+").replace("⌘", "Ctrl+")));
  assert.doesNotMatch(document.querySelector(".command-palette")!.textContent!, /새 창/);
  await key("Escape");
  await run(/새 대화/);
  assert.equal(creates, 1);
  await run(/화면 모드 › 다크/);
  assert.equal(settingsWrites.length, 0, "choosing the saved theme writes nothing");
  await run(/화면 모드 › 라이트/);
  assert.equal((settingsWrites.at(-1) as { theme: string }).theme, "light");
  assert.equal(document.documentElement.dataset.themePreference, "light", "the saved preference flows through the existing theme effect");
  await run(/크레딧 새로고침/);
  assert.deepEqual(creditCalls, [true]);
  await run(/모델 비교 시작/);
  assert.equal(document.querySelectorAll(".composer-model-token").length, 2);
  assert.ok(document.querySelector(".model-popover"), "the compare command opens the picker on the second token");
  assert.ok(thread);
});

test("R-3 F5: inside text fields only the platform command key acts; outside, Cmd and Ctrl both still work", async () => {
  const { platformCommandModifier } = await import("../src/renderer/src/shortcut-policy");
  assert.equal(platformCommandModifier({ metaKey: true, ctrlKey: false }, true), true);
  assert.equal(platformCommandModifier({ metaKey: false, ctrlKey: true }, true), false, "macOS keeps Ctrl+K/Ctrl+N for Cocoa editing");
  assert.equal(platformCommandModifier({ metaKey: false, ctrlKey: true }, false), true);
  assert.equal(platformCommandModifier({ metaKey: true, ctrlKey: false }, false), false);
  assert.equal(platformCommandModifier({ metaKey: true, ctrlKey: true }, true), false);
  compareFixture({ searchThreads: async () => [] });
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  composerInput().focus();
  await key("k", OTHER_MOD);
  assert.equal(document.querySelector(".command-palette"), null, "the other platform's modifier stays a field key");
  for (const modifier of [MOD, OTHER_MOD]) {
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.focus();
    await act(async () => { document.body.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true, ...modifier })); });
    assert.ok(document.querySelector(".command-palette"), "outside fields either modifier opens the palette");
    await key("Escape");
  }
});

async function compareRouteApp(webSearchMode: string) {
  // A fresh App per mode: re-rendering the same root keeps the previously loaded thread.
  if (root) await act(async () => root!.unmount()); root = null; host?.remove(); host = null;
  compareFixture({ getSession: async () => ({ authenticated: true, credits: { total: { remaining: 1000 } }, models: [
    { id: compareModels[0], type: "llm", searchCapability: { status: "supported", provider: "openai", reason: "synthetic" } },
    ...compareModels.slice(1).map((id) => ({ id, type: "llm" }))] }) }, { webSearchMode });
  await render(<ConfirmProvider><App /></ConfirmProvider>);
}
const routeText = () => document.querySelector(".composer-route [role=\"status\"]")?.textContent ?? "";

test("R-3 F1/F2: compare mode shows the billed shared Sonar search route, not the native-search primary route", async () => {
  await compareRouteApp("always");
  assert.match(routeText(), /모델 자체 검색/, "a single chat with a native-search model shows its own route");
  await addCompareModel(compareModels[1]);
  assert.equal(routeText(), "비교 웹 근거: 항상 검색 · 공통 1회 · Sonar 공통 검색 후 2개 모델에 동일하게 제공 · 추가 요청");
  assert.doesNotMatch(document.querySelector(".chat-panel")!.textContent!, /모델 자체 검색/);
  assert.equal([...document.querySelectorAll("button")].filter((b) => b.textContent === "검색 기능 확인").length, 0);
  await compareRouteApp("deep");
  await addCompareModel(compareModels[1]); await addCompareModel(compareModels[2]);
  assert.equal(routeText(), "비교 웹 근거: 딥리서치 · 최대 5회 조사 + 모델별 합성 · Sonar 공통 검색 추가 요청");
  await compareRouteApp("auto");
  await addCompareModel(compareModels[2]);
  assert.match(routeText(), /^비교 웹 근거: 필요할 때 검색 · Sonar 공통 검색 1회 후 2개 모델에 동일하게 제공 · 추가 요청$/);
});

test("R-3 F2: a single-chat deep route shows its call cap in the visible route line", async () => {
  Object.assign(browser, { mmllm: { discardAttachments: async () => {} } });
  const thread = syntheticChatThread({ webSearchMode: "deep" });
  await render(<ConfirmProvider><ChatPanel {...syntheticChatProps} thread={thread} modelId={thread.modelId}
    models={[{ id: thread.modelId, type: "llm" }]} /></ConfirmProvider>);
  assert.match(routeText(), /Sonar 공통 검색 후 선택 모델 답변 · 3~4개 검색어 교차 조사 · 총 최대 6회 API 호출/);
});

test("R-3 F3: project retrieval consent labels keep their layout; the composer consent has its own class", async () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");
  document.head.append(style);
  try {
    const now = new Date().toISOString();
    const project = { id: "synthetic-layout-project", name: "합성 연구", instruction: "", documents: [], threadCount: 0, createdAt: now, updatedAt: now };
    compareFixture({ listProjects: async () => [project], getProjectRetrieval: async () => ({
      settings: { mode: "semantic", embeddingModelId: "text-embedding-3-small", queryConsent: false, rerankConsent: false },
      documents: [], uncertain: 0, running: false }) });
    await render(<ConfirmProvider><App /></ConfirmProvider>);
    await click([...document.querySelectorAll("button")].find((button) => button.textContent?.includes("프로젝트") && button.closest(".rail"))!);
    await wait(10);
    const labels = [...document.querySelectorAll<HTMLElement>(".retrieval-settings label.compare-consent")];
    assert.equal(labels.length, 2);
    for (const label of labels) {
      assert.notEqual(browser.getComputedStyle(label).display, "grid", "the checkbox stays on the consent sentence's line");
      assert.equal(label.classList.contains("composer-compare-consent"), false);
    }
    const css = style.textContent;
    assert.doesNotMatch(css, /(^|\n)\.compare-consent\s*\{/, "no unscoped .compare-consent base rule");
    assert.match(css, /\.composer-compare-consent \{ display: grid;/);
  } finally { style.remove(); }
});

test("R-3 F4: a held digit and a continuation already in progress never start a second continuation", async () => {
  let calls = 0;
  const { requests, emit } = await openRealComparison({ continueCompare: () => { calls++; return new Promise(() => {}); } });
  await click(sendButton());
  await emit({ type: "done", run: { id: "run-f4", prompt: requests[0].prompt, modelIds: compareModels, webSearchMode: "off",
    createdAt: new Date().toISOString(), attachmentNames: [],
    results: compareModels.map((modelId) => ({ modelId, status: "completed" as const, text: "합성" })) } });
  (document.activeElement as HTMLElement | null)?.blur?.();
  const press = async (repeat: boolean) => act(async () => {
    document.body.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "2", repeat, bubbles: true, cancelable: true }));
  });
  await press(true);
  assert.equal(calls, 0, "an auto-repeated keydown is ignored");
  await press(false); await press(false); await press(false);
  await click([...document.querySelectorAll<HTMLButtonElement>(".compare-continue")][0]);
  assert.equal(calls, 1, "one continuation while the first is still in flight");
});

test("R-3 F7: switching or creating a conversation from the palette focuses the new composer", async () => {
  const other = { id: "palette-focus-other", title: "포커스 합성 대화", modelId: compareModels[0], createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), webSearchMode: "off", reasoningMode: "auto", instruction: "", advanced: {},
    attachmentConsent: true, messages: [], messageCount: 0 };
  let creates = 0;
  const { thread } = compareFixture({ searchThreads: async () => [{ ...other, snippet: "합성" }],
    createThread: async () => { creates++; return { ...syntheticChatThread(), id: `palette-focus-new-${creates}`, modelId: compareModels[0] }; } });
  window.mmllm.loadThread = async (id: string) => id === other.id ? other : thread;
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  composerInput().focus();
  const before = composerInput();
  await key("k", MOD);
  await typePalette("포커스");
  await wait(220);
  await key("Enter");
  await wait(20);
  assert.match(document.querySelector(".chat-panel .panel-header h2")!.textContent!, /포커스 합성 대화/);
  assert.notEqual(composerInput() === before, true, "the composer was replaced with the thread");
  assertFocused(composerInput());
  await key("k", MOD);
  await typePalette("/새 대화");
  await key("Enter");
  await wait(20);
  assert.equal(creates, 1);
  assertFocused(composerInput());
});
