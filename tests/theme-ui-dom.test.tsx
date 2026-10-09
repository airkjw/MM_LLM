import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { Window } from "happy-dom";
import * as React from "react";
import type { Root } from "react-dom/client";
const { act } = React;
const browser = new Window({ url: "https://mm-llm.local/" });
browser.document.write("<!doctype html><html><body></body></html>");
for (const [name, value] of Object.entries({
  window: browser, document: browser.document, navigator: browser.navigator, Node: browser.Node,
  Element: browser.Element, HTMLElement: browser.HTMLElement, HTMLButtonElement: browser.HTMLButtonElement,
  Event: browser.Event, KeyboardEvent: browser.KeyboardEvent, MouseEvent: browser.MouseEvent,
  PointerEvent: browser.PointerEvent ?? browser.MouseEvent, MutationObserver: browser.MutationObserver,
  ResizeObserver: browser.ResizeObserver, IntersectionObserver: browser.IntersectionObserver,
  getComputedStyle: browser.getComputedStyle
})) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0)) as never;
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
browser.requestAnimationFrame = globalThis.requestAnimationFrame as never;
browser.cancelAnimationFrame = globalThis.cancelAnimationFrame;
const nativeMatchMedia = browser.matchMedia.bind(browser);
const mediaQueries: string[] = [];
browser.matchMedia = (query: string) => { mediaQueries.push(query); return nativeMatchMedia(query); };

let createRoot: typeof import("react-dom/client")["createRoot"];
let App: typeof import("../src/renderer/src/App")["default"];
let ConfirmProvider: typeof import("../src/renderer/src/components/ConfirmDialog")["ConfirmProvider"];
let root: Root | null = null;
let host: HTMLDivElement | null = null;
before(async () => {
  ({ createRoot } = await import("react-dom/client"));
  ({ default: App } = await import("../src/renderer/src/App"));
  ({ ConfirmProvider } = await import("../src/renderer/src/components/ConfirmDialog"));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; host?.remove(); host = null;
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
});
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); }
async function render(ui: React.ReactNode) {
  if (!host) { host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => root!.render(ui));
  await flush();
}
async function click(element: Element) {
  await act(async () => { (element as HTMLElement).focus(); (element as HTMLElement).click(); });
  await flush();
}

const now = "2026-10-09T00:00:00Z";
const thread = { id: "theme-thread", title: "Synthetic", modelId: "gpt-6-astra", createdAt: now, updatedAt: now,
  webSearchMode: "off" as const, reasoningMode: "auto" as const, instruction: "", advanced: {},
  attachmentConsent: false, messages: [], messageCount: 0 };
const models = [{ id: "gpt-6-astra", type: "llm" as const }, { id: "claude-opus-5", type: "llm" as const }];

function fixture(theme: "system" | "light" | "dark", onSetTheme?: (theme: string) => void) {
  const counts = { subscribe: 0, unsubscribe: 0 };
  const themeWrites: string[] = [];
  let push: ((theme: "light" | "dark") => void) | null = null;
  Object.assign(browser, { mmllm: {
    getSession: async () => ({ authenticated: true, models, credits: { total: { remaining: 1000 } } }),
    getSettings: async () => ({ theme, fontSize: "medium", defaultInstruction: "" }),
    setThemePreference: async (value: string) => { themeWrites.push(value); onSetTheme?.(value); },
    onThemeResolved: (listener: (theme: "light" | "dark") => void) => {
      counts.subscribe++; push = listener;
      return () => { counts.unsubscribe++; if (push === listener) push = null; };
    },
    listThreads: async () => [thread], loadThread: async () => thread, listProjects: async () => [],
    listBackgroundResponses: async () => [], getUpdateState: async () => ({ status: "idle", currentVersion: "0.5.1" }),
    onUpdateChanged: () => () => {}, discardAttachments: async () => {}, getCredits: async () => ({ total: { remaining: 1000 } })
  } });
  return { counts, themeWrites, push: async (value: "light" | "dark") => { await act(async () => push?.(value)); } };
}

test("a main-process theme push changes only the root dataset and keeps the open popover, focus, and draft", async () => {
  document.documentElement.dataset.theme = "light";
  const f = fixture("dark");
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  assert.deepEqual(f.themeWrites, ["dark"]);
  assert.equal(document.documentElement.dataset.themePreference, "dark");
  assert.equal(document.documentElement.dataset.theme, "light", "settings never write data-theme; the bootstrap value stays until main resolves it");
  const input = document.querySelector<HTMLTextAreaElement>(".composer-input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, "value")!.set!.call(input, "합성 초안");
    input.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
  await click(document.querySelector(".model-trigger")!);
  const popover = document.querySelector(".model-popover");
  assert.ok(popover, "the model picker popover is open");
  const focused = document.activeElement;
  assert.ok(focused && focused !== document.body && popover.contains(focused), "focus is inside the open popover");
  const writesBefore = [...f.themeWrites];

  await f.push("dark");

  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(document.querySelector(".model-popover"), popover, "the popover is not remounted");
  assert.equal(document.activeElement, focused, "focus stays on the same element");
  assert.equal(document.querySelector(".composer-input"), input, "the composer is not remounted");
  assert.equal(input.value, "합성 초안");
  assert.deepEqual(f.themeWrites, writesBefore, "a push never sends a theme back to main");
  assert.equal(f.counts.subscribe, 1);
});

test("the renderer only mirrors resolved pushes, skips identical writes, and never reads the OS color scheme", async () => {
  mediaQueries.length = 0;
  document.documentElement.dataset.theme = "light";
  let resolve: ((theme: "light" | "dark") => Promise<void>) | null = null;
  const f = fixture("dark", (value) => { if (value === "dark") void resolve?.("dark"); });
  resolve = f.push;
  const records: MutationRecord[] = [];
  const observer = new browser.MutationObserver((items) => records.push(...(items as unknown as MutationRecord[])));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  try {
    await render(<ConfirmProvider><App /></ConfirmProvider>);
    assert.deepEqual(f.themeWrites, ["dark"], "the saved preference is still synchronized to main");
    assert.equal(document.documentElement.dataset.themePreference, "dark");
    assert.equal(document.documentElement.dataset.theme, "dark", "the resolved push applied the theme");
    await flush();
    const writes = records.length;
    await f.push("dark");
    await flush();
    assert.equal(records.length, writes, "an identical push does not rewrite data-theme");
    assert.equal(mediaQueries.some((query) => /prefers-color-scheme/.test(query)), false);
  } finally { observer.disconnect(); }
  await act(async () => root!.unmount()); root = null;
  assert.equal(f.counts.unsubscribe, f.counts.subscribe, "unmount releases the theme listener");
});
