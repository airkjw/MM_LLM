// Stage 4 (contract D4.1, D4.2, D4.8, risk 6): the settings screen, the account actions that moved there from the
// rail popover, and the login screen. Synthetic data only; window.mmllm is a local mock and no request leaves it.
import assert, { assertFocused } from "./dom-assert.ts";
import test, { afterEach, before } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import type { Root } from "react-dom/client";
import * as React from "react";
import type { ReactNode } from "react";
import type { AppSettings, UpdateState } from "../src/shared/contracts.ts";

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
let Login: typeof import("../src/renderer/src/Login.tsx")["Login"];
let ConfirmProvider: typeof import("../src/renderer/src/components/ConfirmDialog.tsx")["ConfirmProvider"];
before(async () => {
  ({ createRoot } = await import("react-dom/client"));
  ({ default: App } = await import("../src/renderer/src/App.tsx"));
  ({ Login } = await import("../src/renderer/src/Login.tsx"));
  ({ ConfirmProvider } = await import("../src/renderer/src/components/ConfirmDialog.tsx"));
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
async function render(ui: ReactNode) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(ui); });
  await settle();
}
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
async function click(target: Element) {
  await act(async () => { (target as HTMLElement).click(); });
  await settle();
}
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
async function blur(element: HTMLElement) {
  await act(async () => { element.dispatchEvent(new browser.FocusEvent("focusout", { bubbles: true })); element.blur(); });
  await settle();
}
const nameOf = (element: Element) => element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "";
function railItem(label: string) {
  const target = [...document.querySelectorAll<HTMLElement>("nav.rail button")].find((element) => nameOf(element) === label);
  assert.ok(target, `missing rail item ${label}`);
  return target;
}
function avatar() {
  const target = [...document.querySelectorAll<HTMLElement>("nav.rail button")].find((element) => /^설정·계정/.test(nameOf(element)));
  assert.ok(target, "missing rail avatar");
  return target;
}
function button(text: string, scope: ParentNode = document) {
  const target = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text);
  assert.ok(target, `missing button ${text}`);
  return target;
}
function category(label: string) {
  const target = [...document.querySelectorAll<HTMLElement>(".settings-categories button")].find((element) => element.textContent?.trim() === label);
  assert.ok(target, `missing settings category ${label}`);
  return target;
}
function radios(groupLabel: string) {
  const group = document.querySelector<HTMLElement>(`[role="radiogroup"][aria-label="${groupLabel}"]`);
  assert.ok(group, `missing radiogroup ${groupLabel}`);
  return [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
}
function switchControl(label: string) {
  const target = [...document.querySelectorAll<HTMLElement>('[role="switch"]')].find((element) => nameOf(element) === label);
  assert.ok(target, `missing switch ${label}`);
  return target;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; host?.remove(); host = null; setCompact(false); document.body.replaceChildren();
  for (const name of ["fontSize", "density", "reduceMotion", "shortcutHints", "theme", "themePreference"]) {
    delete document.documentElement.dataset[name];
  }
});

const now = new Date().toISOString();
const thread = { id: "settings-thread", title: "합성 대화", modelId: "gpt-6-astra", createdAt: now, updatedAt: now,
  webSearchMode: "off" as const, reasoningMode: "auto" as const, instruction: "", advanced: {}, attachmentConsent: false,
  messages: [], messageCount: 0 };
type Calls = { settings: AppSettings[]; logout: number; models: number; check: number; install: number; credits: boolean[]; keyReplace: string[] };

function appApi(options: { settings?: Partial<AppSettings>; update?: UpdateState; updateSettings?: (value: AppSettings) => Promise<AppSettings>; keyReplaceOk?: boolean } = {}) {
  const calls: Calls = { settings: [], logout: 0, models: 0, check: 0, install: 0, credits: [], keyReplace: [] };
  let stored: AppSettings = { theme: "light", fontSize: "medium", defaultInstruction: "합성 기본 지침", ...options.settings };
  const sessionState = { authenticated: true, credits: { total: { quota: 1000, used: 120, remaining: 880 },
    monthly_allocated: { quota: 500, used: 100, remaining: 400, renewal_date: "2026-11-01T00:00:00Z" } },
    models: [{ id: "gpt-6-astra", type: "llm" }] };
  Object.assign(browser, { mmllm: {
    getSession: async () => sessionState, login: async () => sessionState,
    getSettings: async () => stored,
    updateSettings: async (value: AppSettings) => {
      calls.settings.push(value);
      if (options.updateSettings) return options.updateSettings(value);
      stored = { ...value }; return stored;
    },
    setThemePreference: async () => {}, onThemeResolved: () => () => {},
    listThreads: async () => [thread], loadThread: async () => thread, listProjects: async () => [],
    listBackgroundResponses: async () => [], getUpdateState: async () => options.update ?? { status: "latest", currentVersion: "0.5.1" },
    onUpdateChanged: () => () => {}, discardAttachments: async () => {},
    getCredits: async (force: boolean) => { calls.credits.push(force); return { total: { quota: 1000, used: 130, remaining: 870 } }; },
    searchThreads: async () => [], listMediaJobs: async () => [], listChatbotBookmarks: async () => [], listCompareRuns: async () => [],
    cancelResearch: async () => {}, onVoiceEvent: () => () => {},
    logout: async () => { calls.logout++; }, refreshModels: async () => { calls.models++; return [{ id: "gpt-6-astra", type: "llm" }]; },
    checkForUpdates: async () => { calls.check++; }, installUpdate: async () => { calls.install++; },
    replaceApiKey: async (value: string) => { 
      calls.keyReplace.push(value);
      if (options.keyReplaceOk) return sessionState;
      throw new Error("합성 키 검증 실패");
    },
    getDiagnostics: async () => "synthetic diagnostics"
  } });
  return calls;
}
async function renderApp(options: Parameters<typeof appApi>[0] = {}) {
  const calls = appApi(options);
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  await settle();
  return calls;
}
async function openSettings(label?: string) {
  await click(railItem("앱 설정"));
  if (label) await click(category(label));
}

test("the settings rail item opens the settings screen: one aria-current, its own 240 column, no chat list", async () => {
  await renderApp();
  const trigger = railItem("앱 설정");
  trigger.focus();
  await click(trigger);
  const current = document.querySelectorAll('[aria-current="page"]');
  assert.equal(current.length, 1);
  assert.equal(nameOf(current[0]), "앱 설정");
  assert.ok(document.querySelector(".settings-screen"), "settings is a screen, not a dialog");
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.querySelector(".sidebar"), null, "the chat list column gives its slot to the settings column");
  assert.equal(document.querySelector(".sidebar-mobile-open.visible"), null, "no opener for a list that is not shown");
  const nav = document.querySelector<HTMLElement>('nav.settings-categories[aria-label="설정 분류"]')!;
  assert.ok(nav);
  assert.deepEqual([...nav.querySelectorAll("button")].map((item) => item.textContent?.trim()),
    ["일반", "화면", "응답 기본값", "계정 · API 키", "크레딧", "백업 · 복원", "진단"]);
  assert.equal(nav.querySelectorAll('[aria-current="true"]').length, 1);
  assert.equal(nav.querySelector('[aria-current="true"]')?.textContent?.trim(), "일반");
  assert.equal(document.querySelector(".settings-footer")?.textContent?.replace(/\s+/g, " ").trim(), "MM_LLM v0.5.1 · 최신");
  assertFocused(trigger, "rail navigation keeps focus on the rail trigger");
  // Back to the conversation: the chat list returns.
  await click(railItem("대화"));
  assert.ok(document.querySelector(".sidebar"));
});

test("the footer version and status come from the update state, never a hard-coded version", async () => {
  await renderApp({ update: { status: "ready", currentVersion: "0.7.3", availableVersion: "0.7.4" } });
  await openSettings();
  assert.equal(document.querySelector(".settings-footer")?.textContent?.replace(/\s+/g, " ").trim(), "MM_LLM v0.7.3 · 업데이트 설치 0.7.4");
});

test("every update status shows its footer label and a 업데이트 row on 일반, with the version taken from the update state", async () => {
  const cases: Array<[UpdateState, string, string]> = [
    [{ status: "disabled", currentVersion: "9.8.7" }, "자동 업데이트 꺼짐", "이 실행 환경에서는 자동 업데이트를 사용하지 않습니다."],
    [{ status: "idle", currentVersion: "9.8.7" }, "업데이트 확인 전", "아직 업데이트를 확인하지 않았습니다."],
    [{ status: "checking", currentVersion: "9.8.7" }, "확인 중", "새 버전을 확인하는 중입니다."],
    [{ status: "downloading", currentVersion: "9.8.7", availableVersion: "9.9.0", progress: 40 }, "다운로드 40%", "9.9.0 버전을 내려받는 중입니다."],
    [{ status: "ready", currentVersion: "9.8.7", availableVersion: "9.9.0" }, "업데이트 설치 9.9.0", "9.9.0 버전을 설치할 수 있습니다."],
    [{ status: "latest", currentVersion: "9.8.7" }, "최신", "현재 최신 버전입니다."],
    [{ status: "error", currentVersion: "9.8.7", message: "합성 오류" }, "확인 실패", "업데이트 확인에 실패했습니다. 다시 시도해 주세요."]
  ];
  for (const [update, label, description] of cases) {
    await renderApp({ update });
    await openSettings();
    assert.equal(document.querySelector(".settings-footer")?.textContent?.replace(/\s+/g, " ").trim(), `MM_LLM v9.8.7 · ${label}`, update.status);
    const row = [...document.querySelectorAll(".settings-row")].find((item) => item.querySelector("strong")?.textContent === "업데이트");
    assert.ok(row, `${update.status}: the update row is visible`);
    assert.equal(row!.querySelector("small")?.textContent, description, update.status);
    const busyStatus = update.status === "checking" || update.status === "downloading" || update.status === "disabled";
    assert.equal(row!.querySelector("button")!.disabled, busyStatus, `${update.status}: the action is ${busyStatus ? "off" : "available"}`);
    assert.equal(document.querySelectorAll('[data-testid="update-status-live"]').length, 1, "still one live region in the app");
    await act(async () => root!.unmount()); root = null; host?.remove(); host = null; document.body.replaceChildren();
  }
});

test("display mode is a radiogroup with a single tab stop; arrow keys move and save immediately", async () => {
  const calls = await renderApp();
  await openSettings("화면");
  const options = radios("화면 모드");
  assert.deepEqual(options.map((item) => item.querySelector(".theme-card-label")?.textContent?.trim()), ["시스템", "라이트", "다크"]);
  assert.match(options[0].textContent ?? "", /권장/);
  assert.deepEqual(options.map((item) => item.getAttribute("aria-checked")), ["false", "true", "false"]);
  assert.deepEqual(options.map((item) => item.tabIndex), [-1, 0, -1], "roving tab stop on the checked radio");
  assert.equal(document.querySelector('.settings-screen button[type="submit"], .settings-screen .settings-save'), null, "no save button");
  options[1].focus();
  await key("ArrowRight");
  let next = radios("화면 모드");
  assertFocused(next[2]);
  assert.deepEqual(next.map((item) => item.getAttribute("aria-checked")), ["false", "false", "true"]);
  assert.equal(calls.settings.length, 1);
  assert.deepEqual(calls.settings[0], { theme: "dark", fontSize: "medium", defaultInstruction: "합성 기본 지침" });
  assert.equal(document.documentElement.dataset.themePreference, "dark");
  await key("ArrowRight");
  next = radios("화면 모드");
  assertFocused(next[0], "arrow keys wrap");
  assert.equal(calls.settings.at(-1)?.theme, "system");
  await key("End");
  assertFocused(radios("화면 모드")[2]);
  await key("Home");
  assertFocused(radios("화면 모드")[0]);
  await key("ArrowLeft");
  assertFocused(radios("화면 모드")[2]);
  assert.equal(calls.settings.at(-1)?.theme, "dark");
});

test("font size, density, reduce motion and shortcut hints save at once and drive the root data attributes", async () => {
  const calls = await renderApp();
  await openSettings("화면");
  assert.equal(document.documentElement.dataset.density, "default");
  assert.equal(document.documentElement.dataset.reduceMotion, "false");
  assert.equal(document.documentElement.dataset.shortcutHints, "true");
  const font = radios("글자 크기");
  assert.deepEqual(font.map((item) => item.textContent?.trim()), ["작게", "기본", "크게"]);
  await click(font[2]);
  assert.equal(document.documentElement.dataset.fontSize, "large");
  assert.equal(calls.settings.at(-1)?.fontSize, "large");
  const density = radios("밀도");
  assert.deepEqual(density.map((item) => item.textContent?.trim()), ["기본", "촘촘"]);
  await click(density[1]);
  assert.equal(document.documentElement.dataset.density, "compact");
  assert.equal(calls.settings.at(-1)?.density, "compact");
  const motion = switchControl("동작 줄이기");
  assert.equal(motion.getAttribute("aria-checked"), "false", "follows the OS until the student turns it on");
  await click(motion);
  assert.equal(switchControl("동작 줄이기").getAttribute("aria-checked"), "true");
  assert.equal(document.documentElement.dataset.reduceMotion, "true");
  assert.equal(calls.settings.at(-1)?.reduceMotion, true);
  const hints = switchControl("단축키 힌트 표시");
  assert.equal(hints.getAttribute("aria-checked"), "true", "hints are shown by default");
  await click(hints);
  assert.equal(document.documentElement.dataset.shortcutHints, "false");
  assert.deepEqual(calls.settings.at(-1), { theme: "light", fontSize: "large", defaultInstruction: "합성 기본 지침",
    density: "compact", reduceMotion: true, shortcutHints: false });
  assert.equal(calls.settings.length, 4, "one save per change");
});

test("a failed immediate save shows an inline error and returns the control to the previous value", async () => {
  const calls = await renderApp({ updateSettings: async () => { throw new Error("합성 설정 저장 실패"); } });
  await openSettings("화면");
  await click(radios("밀도")[1]);
  assert.equal(calls.settings.length, 1);
  assert.match(document.querySelector('.settings-screen [role="alert"]')?.textContent ?? "", /합성 설정 저장 실패/);
  assert.deepEqual(radios("밀도").map((item) => item.getAttribute("aria-checked")), ["true", "false"]);
  assert.equal(document.documentElement.dataset.density, "default");
  await click(switchControl("단축키 힌트 표시"));
  assert.equal(switchControl("단축키 힌트 표시").getAttribute("aria-checked"), "true");
  assert.equal(document.documentElement.dataset.shortcutHints, "true");
});

test("a second change while a save is in flight is not sent twice (settingsSaving guard)", async () => {
  let release!: (value: AppSettings) => void;
  const calls = await renderApp({ updateSettings: (value) => new Promise((resolve) => { release = () => resolve(value); }) });
  await openSettings("화면");
  await click(radios("밀도")[1]);
  await click(radios("글자 크기")[0]);
  await click(switchControl("동작 줄이기"));
  assert.equal(calls.settings.length, 1);
  await act(async () => release(calls.settings[0]));
  await settle();
  assert.equal(document.documentElement.dataset.density, "compact");
  await click(radios("글자 크기")[0]);
  assert.equal(calls.settings.length, 2);
});

test("the response default instruction saves when the field is left, without a save button", async () => {
  const calls = await renderApp();
  await openSettings("응답 기본값");
  const field = document.querySelector<HTMLTextAreaElement>(".settings-screen .settings-field textarea")!;
  assert.ok(field);
  assert.equal(field.value, "합성 기본 지침");
  field.focus();
  await typeInto(field, "합성 새 지침");
  assert.equal(calls.settings.length, 0, "typing does not save on every keystroke");
  await blur(field);
  assert.equal(calls.settings.length, 1);
  assert.equal(calls.settings[0].defaultInstruction, "합성 새 지침");
  await blur(field);
  assert.equal(calls.settings.length, 1, "leaving an unchanged field does not save again");
});

test("a default-instruction blur refused during another save waits, shows it is pending, and saves after the in-flight save", async () => {
  const releases: Array<() => void> = [];
  const calls = await renderApp({ updateSettings: (value) => new Promise((resolve) => { releases.push(() => resolve(value)); }) });
  await openSettings("화면");
  await click(radios("밀도")[1]);
  assert.equal(calls.settings.length, 1, "the density save is in flight");
  await click(category("응답 기본값"));
  const field = document.querySelector<HTMLTextAreaElement>(".settings-screen .settings-field textarea")!;
  field.focus();
  await typeInto(field, "대기 중에 입력한 합성 지침");
  await blur(field);
  assert.equal(calls.settings.length, 1, "refused while the first save runs");
  assert.equal(field.value, "대기 중에 입력한 합성 지침", "the typed text is kept");
  const pending = document.querySelector<HTMLElement>(".settings-field-pending")!;
  assert.match(pending.textContent ?? "", /저장 대기 중/, "an inline pending state is shown");
  assert.equal(pending.getAttribute("role"), "status");
  assert.equal(pending.closest("label"), null, "the status is outside the field label, so the textarea name does not grow");
  assert.doesNotMatch(document.querySelector(".settings-screen .settings-field")!.textContent ?? "", /저장 대기 중/);
  await act(async () => releases[0]());
  await settle();
  assert.equal(calls.settings.length, 2, "the instruction is saved right after the in-flight save");
  assert.equal(calls.settings[1].defaultInstruction, "대기 중에 입력한 합성 지침");
  assert.equal(calls.settings[1].density, "compact", "the finished save is kept");
  await act(async () => releases[1]());
  await settle();
  assert.equal(document.querySelector(".settings-field-pending")?.textContent, "", "the pending text clears once saved; the status element stays");
  assert.equal(document.querySelector<HTMLTextAreaElement>(".settings-screen .settings-field textarea")!.value, "대기 중에 입력한 합성 지침");
});

test("the pending-save status is a live region that already exists before it has text (announced once)", async () => {
  await renderApp();
  await openSettings("응답 기본값");
  const regions = document.querySelectorAll(".settings-screen .settings-field-pending");
  assert.equal(regions.length, 1);
  assert.equal(regions[0].getAttribute("role"), "status");
  assert.equal(regions[0].textContent, "", "empty until a save is pending");
});

test("a default-instruction value waiting behind a save survives leaving the settings screen and is saved afterwards", async () => {
  const releases: Array<() => void> = [];
  const calls = await renderApp({ updateSettings: (value) => new Promise((resolve) => { releases.push(() => resolve(value)); }) });
  await openSettings("화면");
  await click(radios("밀도")[1]);
  assert.equal(calls.settings.length, 1, "the density save is in flight");
  await click(category("응답 기본값"));
  const field = document.querySelector<HTMLTextAreaElement>(".settings-screen .settings-field textarea")!;
  field.focus();
  await typeInto(field, "화면을 떠나도 남는 합성 지침");
  await blur(field);
  assert.equal(calls.settings.length, 1, "refused while the first save runs");
  await click(railItem("대화"));
  assert.equal(document.querySelector(".settings-screen"), null, "the settings screen is gone");
  await act(async () => releases[0]());
  await settle();
  assert.equal(calls.settings.length, 2, "App applies the held instruction after the in-flight save");
  assert.equal(calls.settings[1].defaultInstruction, "화면을 떠나도 남는 합성 지침");
  assert.equal(calls.settings[1].density, "compact", "the finished save is kept");
  await act(async () => releases[1]());
  await settle();
  await openSettings("응답 기본값");
  assert.equal(document.querySelector<HTMLTextAreaElement>(".settings-screen .settings-field textarea")!.value, "화면을 떠나도 남는 합성 지침");
  assert.equal(calls.settings.length, 2, "nothing is saved twice");
});

test("returning to the settings screen while an instruction waits shows the waiting value and the pending status", async () => {
  const releases: Array<() => void> = [];
  const calls = await renderApp({ updateSettings: (value) => new Promise((resolve) => { releases.push(() => resolve(value)); }) });
  await openSettings("화면");
  await click(radios("밀도")[1]);
  await click(category("응답 기본값"));
  const field = document.querySelector<HTMLTextAreaElement>(".settings-screen .settings-field textarea")!;
  field.focus();
  await typeInto(field, "돌아와서 확인할 합성 지침");
  await blur(field);
  await click(railItem("대화"));
  await openSettings("응답 기본값");
  assert.equal(document.querySelector<HTMLTextAreaElement>(".settings-screen .settings-field textarea")!.value, "돌아와서 확인할 합성 지침");
  assert.match(document.querySelector(".settings-field-pending")?.textContent ?? "", /저장 대기 중/);
  await act(async () => releases[0]());
  await settle();
  assert.equal(calls.settings.at(-1)?.defaultInstruction, "돌아와서 확인할 합성 지침");
});

const heldValue = "세션이 바뀌면 버려질 합성 지침";
// A default instruction is refused by the settingsSaving guard while a density save is still in flight; returns the
// releases of the pending updateSettings calls (the density save is releases[0]).
async function holdInstructionBehindSave() {
  const releases: Array<() => void> = [];
  const calls = await renderApp({ keyReplaceOk: true, updateSettings: (value) => new Promise((resolve) => { releases.push(() => resolve(value)); }) });
  await openSettings("화면");
  await click(radios("밀도")[1]);
  assert.equal(calls.settings.length, 1, "the density save is in flight");
  await click(category("응답 기본값"));
  const field = document.querySelector<HTMLTextAreaElement>(".settings-screen .settings-field textarea")!;
  field.focus();
  await typeInto(field, heldValue);
  await blur(field);
  assert.equal(calls.settings.length, 1, "refused while the first save runs");
  assert.match(document.querySelector(".settings-field-pending")?.textContent ?? "", /저장 대기 중/);
  await click(category("계정 · API 키"));
  return { calls, releases };
}
async function assertHeldValueDropped(calls: Calls, releases: Array<() => void>) {
  await act(async () => releases[0]());
  await settle();
  await openSettings("응답 기본값");
  const field = document.querySelector<HTMLTextAreaElement>(".settings-screen .settings-field textarea")!;
  assert.notEqual(field.value, heldValue, "the dropped value is not shown in the next session");
  assert.equal(document.querySelector(".settings-field-pending")?.textContent, "", "the settings screen does not show it as pending");
  assert.equal(calls.settings.some((value) => value.defaultInstruction === heldValue), false, "no updateSettings call carries the held value");
  assert.equal(calls.settings.length, 1, "only the original in-flight save was ever sent");
}

test("logout while a default instruction waits behind a save drops it: never saved in the next session", async () => {
  const { calls, releases } = await holdInstructionBehindSave();
  await click(button("로그아웃"));
  assert.equal(calls.logout, 1);
  assert.ok(document.querySelector(".login-page"));
  await act(async () => releases[0]());
  await settle();
  assert.equal(calls.settings.length, 1, "nothing is saved while logged out");
  await typeInto(document.querySelector<HTMLInputElement>("#api-key")!, "synthetic-key");
  await act(async () => { document.querySelector("form")!.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true })); });
  await settle();
  assert.ok(document.querySelector("nav.rail"), "logged back in");
  await assertHeldValueDropped(calls, [() => {}]);
});

test("replacing the API key while a default instruction waits behind a save drops it: never saved in the next session", async () => {
  const { calls, releases } = await holdInstructionBehindSave();
  await click(button("API 키 교체"));
  const input = document.querySelector<HTMLInputElement>('.key-replace-dialog input[type="password"]')!;
  await typeInto(input, "synthetic-replacement-key");
  await click(button("검증하고 교체"));
  assert.deepEqual(calls.keyReplace, ["synthetic-replacement-key"]);
  assert.equal(document.querySelector(".key-replace-dialog"), null);
  assert.ok(document.querySelector("nav.rail"), "the new session is running");
  await assertHeldValueDropped(calls, releases);
});

test("general: app info, update check/install and model refresh live on the settings screen", async () => {
  const calls = await renderApp();
  await openSettings();
  assert.match(document.querySelector(".settings-body")?.textContent ?? "", /MM_LLM v0\.5\.1/);
  await click(button("모델 목록 새로고침"));
  assert.equal(calls.models, 1);
  await click(button("업데이트 확인"));
  assert.equal(calls.check, 1);
});

test("general: a ready update installs from the settings screen and an update error stays readable", async () => {
  const calls = await renderApp({ update: { status: "ready", currentVersion: "0.5.1", availableVersion: "0.6.0" } });
  await openSettings();
  await click(button("업데이트 설치 0.6.0"));
  assert.equal(calls.install, 1);
  assert.equal(calls.check, 0);
});

test("the rail avatar opens the settings screen on 계정 · API 키 in one click", async () => {
  await renderApp();
  const trigger = avatar();
  assert.equal(trigger.getAttribute("aria-haspopup"), null, "no popover remains on the avatar");
  assert.equal(trigger.getAttribute("aria-expanded"), null);
  await click(trigger);
  assert.equal(document.querySelector(".account-popover"), null);
  assert.ok(document.querySelector(".settings-screen"));
  assert.equal(document.querySelector('.settings-categories [aria-current="true"]')?.textContent?.trim(), "계정 · API 키");
  assert.equal(nameOf(document.querySelector('[aria-current="page"]')!), "앱 설정", "aria-current goes through the settings item");
  assert.equal(trigger.hasAttribute("aria-current"), false);
});

function footerAction() {
  return document.querySelector<HTMLButtonElement>(".settings-footer button");
}
function updateRowButton() {
  const row = [...document.querySelectorAll(".settings-body .settings-row")].find((item) => item.querySelector("strong")?.textContent === "업데이트");
  assert.ok(row, "the update row is visible on 일반");
  return row!.querySelector<HTMLButtonElement>("button")!;
}

test("update ready: the rail avatar opens 일반 and focuses the install button of the update row", async () => {
  const calls = await renderApp({ update: { status: "ready", currentVersion: "0.6.0", availableVersion: "0.6.1" } });
  const trigger = avatar();
  assert.match(nameOf(trigger), /새 업데이트 준비됨/);
  await click(trigger);
  assert.ok(document.querySelector(".settings-screen"));
  assert.equal(document.querySelector('.settings-categories [aria-current="true"]')?.textContent?.trim(), "일반");
  const install = updateRowButton();
  assert.equal(install.textContent?.trim(), "업데이트 설치 0.6.1");
  assertFocused(install, "focus lands on the install action, not on the rail avatar");
  assert.equal(calls.install, 0, "opening settings never installs by itself");
  assert.equal(document.querySelectorAll('[data-testid="update-status-live"]').length, 1, "still one live region");
});

test("update ready: the footer status is the same install action, and a quick double click installs once", async () => {
  const calls = await renderApp({ update: { status: "ready", currentVersion: "0.6.0", availableVersion: "0.6.1" } });
  await openSettings();
  const action = footerAction();
  assert.ok(action, "the ready footer status is a button");
  assert.equal(action!.textContent?.trim(), "업데이트 설치 0.6.1");
  assert.equal(document.querySelectorAll(".settings-footer button").length, 1);
  await act(async () => { action!.click(); action!.click(); });
  await settle();
  assert.equal(calls.install, 1, "two quick clicks send one install request");
  assert.equal(calls.check, 0, "the install path never falls back to a check");
});

test("update ready: an install request still in flight ignores further clicks from the footer and the 일반 row", async () => {
  const calls = await renderApp({ update: { status: "ready", currentVersion: "0.6.0", availableVersion: "0.6.1" } });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  (browser as unknown as { mmllm: { installUpdate: () => Promise<void> } }).mmllm.installUpdate = () => { calls.install++; return held; };
  await openSettings("일반");
  await click(footerAction()!);
  await click(updateRowButton());
  await click(footerAction()!);
  assert.equal(calls.install, 1, "no second request while the first one is running");
  await act(async () => { release(); await held; });
  await settle();
  await click(updateRowButton());
  assert.equal(calls.install, 2, "a finished request can be retried");
});

test("update error: the rail avatar opens 일반 on the retry action; the footer stays plain text", async () => {
  const calls = await renderApp({ update: { status: "error", currentVersion: "0.6.0", message: "합성 오류" } });
  await click(avatar());
  assert.equal(document.querySelector('.settings-categories [aria-current="true"]')?.textContent?.trim(), "일반");
  const retry = updateRowButton();
  assert.equal(retry.textContent?.trim(), "업데이트 확인");
  assertFocused(retry);
  assert.equal(footerAction(), null, "only a ready update turns the footer into an action");
  await click(retry);
  assert.equal(calls.check, 1);
  assert.equal(calls.install, 0);
});

test("other update states keep the avatar on 계정 · API 키 and the footer as plain text", async () => {
  const states: UpdateState[] = [
    { status: "disabled", currentVersion: "0.6.0" }, { status: "idle", currentVersion: "0.6.0" },
    { status: "checking", currentVersion: "0.6.0" }, { status: "downloading", currentVersion: "0.6.0", availableVersion: "0.6.1", progress: 40 },
    { status: "latest", currentVersion: "0.6.0" }
  ];
  for (const update of states) {
    await renderApp({ update });
    await click(avatar());
    assert.equal(document.querySelector('.settings-categories [aria-current="true"]')?.textContent?.trim(), "계정 · API 키", update.status);
    assert.equal(footerAction(), null, `${update.status}: the footer is not a button`);
    assert.equal(document.querySelector(".settings-footer")?.textContent?.includes("업데이트 설치"), false, update.status);
    await act(async () => root!.unmount()); root = null; host?.remove(); host = null; document.body.replaceChildren();
  }
});

test("account: the API key replace dialog opens from the settings screen and returns focus to its trigger", async () => {
  const calls = await renderApp();
  await openSettings("계정 · API 키");
  const replace = button("API 키 교체");
  replace.focus();
  await click(replace);
  const dialog = document.querySelector<HTMLElement>('.key-replace-dialog[role="dialog"][aria-modal="true"]')!;
  assert.ok(dialog);
  const input = dialog.querySelector<HTMLInputElement>('input[type="password"]')!;
  assert.ok(input, "the replacement key stays a password field");
  await key("Escape");
  assert.equal(document.querySelector(".key-replace-dialog"), null);
  assertFocused(button("API 키 교체"));
  assert.deepEqual(calls.keyReplace, []);
});

test("account: logout from the settings screen returns to the login screen", async () => {
  const calls = await renderApp();
  await openSettings("계정 · API 키");
  await click(button("로그아웃"));
  assert.equal(calls.logout, 1);
  assert.ok(document.querySelector(".login-page"));
  assert.equal(document.querySelector("nav.rail"), null);
});

test("credits: the three meters and the manual refresh moved from the popover", async () => {
  const calls = await renderApp();
  await openSettings("크레딧");
  const meters = [...document.querySelectorAll<HTMLElement>(".settings-body .credit-meter")];
  assert.deepEqual(meters.map((meter) => meter.querySelector("b")?.textContent), ["전체", "월 제공", "구매"]);
  assert.match(meters[0].textContent ?? "", /880/);
  assert.match(meters[2].textContent ?? "", /잔액 정보 없음/, "no numbers are invented for a missing bucket");
  assert.match(document.querySelector(".settings-body .credit-renewal")?.textContent ?? "", /갱신/);
  await click(button("크레딧 새로고침"));
  assert.deepEqual(calls.credits, [true]);
});

test("backup and diagnostics categories host the existing panels", async () => {
  await renderApp();
  await openSettings("백업 · 복원");
  assert.ok(document.querySelector(".settings-body fieldset.backup-panel"));
  await click(category("진단"));
  assert.ok(button("진단 정보 복사", document.querySelector(".settings-body")!));
});

test("settings categories stack above the body at the compact width and keep keyboard order", async () => {
  setCompact(true);
  await renderApp();
  await openSettings("화면");
  const screen = document.querySelector<HTMLElement>(".settings-screen")!;
  assert.ok(screen.classList.contains("screen-layout"));
  const css = readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");
  const compactBlock = css.slice(css.indexOf("@media (max-width: 720px)"));
  assert.match(compactBlock, /\.screen-layout[^{}]*\{[^}]*flex-direction:\s*column/);
  const focusables = [...screen.querySelectorAll<HTMLElement>("button, [tabindex='0']")];
  assert.ok(focusables.indexOf(category("화면")) < focusables.indexOf(radios("화면 모드")[1]), "categories come before the body");
});

test("Cmd/Ctrl+B is a no-op on a screen without the chat list and never hides the rail", async () => {
  await renderApp();
  await openSettings();
  document.body.focus();
  await key("b", { ctrlKey: true });
  assert.ok(document.querySelector("nav.rail"));
  await click(railItem("대화"));
  assert.ok(document.querySelector(".sidebar:not(.collapsed)"), "the list was not toggled while it was not shown");
});

const css = () => readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");
test("the shortcut-hint, density and reduce-motion attributes have CSS behind them", () => {
  assert.match(css(), /:root\[data-shortcut-hints="false"\][^{]*kbd[^{]*\{[^}]*display:\s*none/);
  assert.match(css(), /:root\[data-density="compact"\]/);
  assert.match(css(), /:root\[data-reduce-motion="true"\]/);
});

// Login (D4.8)
type LoginCalls = { login: string[]; cancel: number; guide: number };
function loginApi(login: (key: string) => Promise<unknown>) {
  const calls: LoginCalls = { login: [], cancel: 0, guide: 0 };
  Object.assign(browser, { mmllm: {
    login: async (value: string) => { calls.login.push(value); return login(value); },
    cancelLogin: async () => { calls.cancel++; return true; }, openKeyGuide: async () => { calls.guide++; },
    getDiagnostics: async () => "synthetic diagnostics"
  } });
  return calls;
}

test("login keeps the password field, visibility toggle, cancel and error-only diagnostics", async () => {
  let reject!: (error: Error) => void;
  const calls = loginApi(() => new Promise((_resolve, fail) => { reject = fail; }));
  await render(<Login onLogin={async () => {}} />);
  const input = document.querySelector<HTMLInputElement>("#api-key")!;
  assert.equal(input.type, "password");
  assert.equal(input.getAttribute("autocomplete"), "off");
  assert.equal(document.querySelector('.login-page input[type="checkbox"]'), null, "no auto-login option (login() has none)");
  const toggle = document.querySelector<HTMLButtonElement>(".key-visibility")!;
  assert.equal(toggle.getAttribute("aria-label"), "API 키 보기");
  await click(toggle);
  assert.equal(document.querySelector<HTMLInputElement>("#api-key")!.type, "text");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  await click(toggle);
  assert.equal(document.querySelector<HTMLInputElement>("#api-key")!.type, "password");
  assert.equal([...document.querySelectorAll("button")].some((item) => item.textContent?.includes("진단 정보 복사")), false);
  await typeInto(document.querySelector<HTMLInputElement>("#api-key")!, "  synthetic-key  ");
  await act(async () => { document.querySelector("form")!.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true })); });
  await settle();
  assert.deepEqual(calls.login, ["synthetic-key"]);
  await click(button("로그인 확인 취소"));
  assert.equal(calls.cancel, 1);
  await act(async () => reject(new Error("합성 로그인 실패")));
  await settle();
  assert.match(document.querySelector('.login-page [role="alert"]')?.textContent ?? "", /합성 로그인 실패/);
  assert.ok(button("진단 정보 복사"));
});

test("login: two columns from 900px, one column below; issuance card uses only openKeyGuide", async () => {
  const calls = loginApi(async () => ({ authenticated: false, models: [] }));
  await render(<Login onLogin={async () => {}} />);
  const layout = document.querySelector<HTMLElement>(".login-layout")!;
  assert.ok(layout.querySelector(".login-intro") && layout.querySelector(".login-card"));
  const style = css();
  assert.match(style, /\.login-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.1fr\)\s+minmax\(0,\s*1fr\)/);
  const narrow = style.slice(style.indexOf("@media (max-width: 899px)"));
  assert.ok(style.includes("@media (max-width: 899px)"));
  assert.match(narrow, /\.login-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  const card = document.querySelector<HTMLElement>(".login-guide")!;
  assert.ok(card);
  assert.deepEqual([...card.querySelectorAll(".login-guide-step b")].map((item) => item.textContent), ["01", "02", "03"]);
  const links = [...card.querySelectorAll("button")];
  assert.equal(links.length, 1);
  await click(links[0]);
  assert.equal(calls.guide, 1);
  assert.equal(document.querySelector(".login-page a[href]"), null, "no new URL is added to the renderer");
  const notes = [...document.querySelectorAll(".login-security li")].map((item) => item.textContent?.trim());
  assert.deepEqual(notes, ["키는 이 기기의 운영체제 보안 저장소로 보호됩니다.", "대화 기록은 이 기기 안에서 암호화해 보관합니다."]);
});
