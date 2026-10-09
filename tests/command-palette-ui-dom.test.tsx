import assert, { assertAbsent, assertFocused } from "./dom-assert.ts";
import test, { afterEach, before } from "node:test";
import { Window } from "happy-dom";
import type { Root } from "react-dom/client";
import * as React from "react";
import type { ThreadSummary } from "../src/shared/contracts.ts";

const { act, useState } = React;

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
  HTMLInputElement: browser.HTMLInputElement,
  Event: browser.Event,
  KeyboardEvent: browser.KeyboardEvent,
  MouseEvent: browser.MouseEvent,
  PointerEvent: browser.PointerEvent ?? browser.MouseEvent,
  MutationObserver: browser.MutationObserver,
  ResizeObserver: browser.ResizeObserver,
  IntersectionObserver: browser.IntersectionObserver,
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
globalThis.requestAnimationFrame = browser.requestAnimationFrame as never;
globalThis.cancelAnimationFrame = browser.cancelAnimationFrame as never;

type PaletteModule = typeof import("../src/renderer/src/components/CommandPalette.tsx");
type PaletteProps = import("../src/renderer/src/components/CommandPalette.tsx").CommandPaletteProps;
type PaletteCommand = import("../src/renderer/src/components/CommandPalette.tsx").PaletteCommand;
let createRoot: typeof import("react-dom/client")["createRoot"];
let CommandPalette: PaletteModule["CommandPalette"];

before(async () => {
  ({ createRoot } = await import("react-dom/client"));
  ({ CommandPalette } = await import("../src/renderer/src/components/CommandPalette.tsx"));
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let calls: string[] = [];
let searched: string[] = [];

const COMMANDS: PaletteCommand[] = [
  { id: "new-thread", label: "새 대화", shortcut: "⌘N" },
  { id: "compare", label: "모델 비교 시작", shortcut: "⌘⇧C" },
  { id: "theme-system", label: "시스템", group: "화면 모드" },
  { id: "theme-light", label: "라이트", group: "화면 모드" },
  { id: "theme-dark", label: "다크", group: "화면 모드" },
  { id: "credits", label: "크레딧 새로고침" }
];

function thread(id: string, title: string, snippet?: string): ThreadSummary & { snippet?: string } {
  return {
    id, title, modelId: "gpt-5.6-luna", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    messageCount: 2, webSearchMode: "off", pinned: false, ...(snippet === undefined ? {} : { snippet })
  };
}

const THREADS = [thread("t-1", "병원 경영 지표 정리", "운영 지표와 개선 과제"), thread("t-2", "의료 정책 변화")];
let searchImpl: PaletteProps["searchThreads"] = async () => THREADS;

function Harness({ commands = COMMANDS }: { commands?: readonly PaletteCommand[] }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" id="opener" onClick={() => setOpen(true)}>팔레트 열기</button>
    <CommandPalette open={open} searchDelayMs={0} commands={commands}
      onClose={() => { calls.push("close"); setOpen(false); }}
      searchThreads={(query) => { searched.push(query); return searchImpl(query); }}
      onSelectThread={(id) => calls.push(`thread:${id}`)}
      onRunCommand={(id) => calls.push(`command:${id}`)} />
  </>;
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}

async function render(ui: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(ui); });
  await settle();
}

async function openPalette() {
  const opener = document.getElementById("opener") as HTMLButtonElement;
  opener.focus();
  await act(async () => { opener.click(); });
  await settle();
  return opener;
}

async function key(name: string, init: { shiftKey?: boolean; isComposing?: boolean } = {}) {
  let event!: KeyboardEvent;
  await act(async () => {
    event = new browser.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  await settle();
  return event;
}

async function typeQuery(value: string) {
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
  await settle();
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const optionTexts = () => options().map((option) => option.textContent ?? "");
const activeOption = () => options().find((option) => option.getAttribute("aria-selected") === "true");
const sectionLabels = () => [...document.querySelectorAll('[role="group"]')]
  .map((group) => document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent ?? "");

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; host?.remove(); host = null; calls = []; searched = [];
  searchImpl = async () => THREADS;
  document.body.replaceChildren();
});

test("closed palette renders nothing; open palette is a named modal dialog with a combobox over a listbox", async () => {
  await render(<Harness />);
  assert.equal(dialog(), null);
  await openPalette();
  const card = dialog()!;
  assert.equal(card.getAttribute("aria-modal"), "true");
  assert.equal(card.getAttribute("aria-label"), "명령 팔레트");
  const input = card.querySelector<HTMLInputElement>("input")!;
  assert.equal(input.getAttribute("role"), "combobox");
  assert.equal(input.getAttribute("aria-expanded"), "true");
  assert.equal(input.getAttribute("aria-label"), "대화 검색 또는 명령 실행");
  const listbox = card.querySelector('[role="listbox"]')!;
  assert.equal(input.getAttribute("aria-controls"), listbox.id);
  assertFocused(input);
  assert.equal(searched.length, 0, "an empty query must not search conversations");
  assert.deepEqual(sectionLabels(), ["명령"]);
  assert.ok(!(card.textContent ?? "").includes("새 창"), "single-window app: no ⌘↵ 새 창 hint");
});

test("empty query lists commands with shortcuts and grouped labels, first row active via aria-activedescendant", async () => {
  await render(<Harness />);
  await openPalette();
  assert.deepEqual(optionTexts().map((text) => text.replace("↵", "")), [
    "새 대화⌘N", "모델 비교 시작⌘⇧C", "화면 모드 › 시스템", "화면 모드 › 라이트", "화면 모드 › 다크", "크레딧 새로고침"
  ]);
  const input = document.querySelector("input")!;
  assert.equal(activeOption(), options()[0]);
  assert.equal(input.getAttribute("aria-activedescendant"), options()[0].id);
  assert.equal(new Set(options().map((option) => option.id)).size, options().length, "option ids are unique");
});

test("Escape closes the palette and restores focus to the opener", async () => {
  await render(<Harness />);
  const opener = await openPalette();
  assert.ok(dialog());
  await key("Escape");
  assert.equal(dialog(), null);
  assert.deepEqual(calls, ["close"]);
  assertFocused(opener);
});

test("backdrop mouse-down closes but a mouse-down inside the card does not", async () => {
  await render(<Harness />);
  const opener = await openPalette();
  await act(async () => {
    document.querySelector(".command-palette")!.dispatchEvent(new browser.MouseEvent("mousedown", { bubbles: true }));
  });
  assert.ok(dialog(), "inside click keeps it open");
  await act(async () => {
    document.querySelector(".command-palette-backdrop")!.dispatchEvent(new browser.MouseEvent("mousedown", { bubbles: true }));
  });
  await settle();
  assert.equal(dialog(), null);
  assertFocused(opener);
});

test("Tab keeps focus inside the palette", async () => {
  await render(<Harness />);
  await openPalette();
  const input = document.querySelector("input")!;
  assertFocused(input);
  await key("Tab");
  assert.ok(dialog()!.contains(document.activeElement), "focus did not leave the dialog");
});

test("typing searches conversations once per query and shows 대화 above 명령 with matches", async () => {
  await render(<Harness />);
  await openPalette();
  await typeQuery("지표");
  assert.deepEqual(searched, ["지표"]);
  assert.deepEqual(sectionLabels(), ["대화"], "no command matches 지표, so the 명령 section is omitted");
  assert.deepEqual(optionTexts().slice(0, 2).map((text) => text.replace("↵", "")),
    ["병원 경영 지표 정리운영 지표와 개선 과제", "의료 정책 변화"]);
  assert.equal(options().length, 2);
});

test("conversations are listed before commands and both sections are labelled", async () => {
  await render(<Harness />);
  await openPalette();
  await typeQuery("새");
  assert.deepEqual(sectionLabels(), ["대화", "명령"]);
  const kinds = options().map((option) => option.getAttribute("data-kind"));
  assert.deepEqual(kinds, ["thread", "thread", "command", "command"], "새 대화 and 크레딧 새로고침 match");
});

test("conversation selection: Enter on the active conversation calls onSelectThread and closes", async () => {
  await render(<Harness />);
  await openPalette();
  await typeQuery("병원");
  assert.equal(activeOption()!.getAttribute("data-kind"), "thread");
  await key("Enter");
  assert.deepEqual(calls, ["thread:t-1", "close"]);
  assert.equal(dialog(), null);
});

test("clicking a conversation selects it; mouse hover only moves the active row", async () => {
  await render(<Harness />);
  await openPalette();
  await typeQuery("정책");
  const second = options()[1];
  await act(async () => { second.dispatchEvent(new browser.MouseEvent("mousemove", { bubbles: true })); });
  assert.equal(activeOption(), second);
  assert.deepEqual(calls, []);
  await act(async () => { second.click(); });
  await settle();
  assert.deepEqual(calls, ["thread:t-2", "close"]);
});

test("command run: filtering by label and Enter calls onRunCommand and closes", async () => {
  searchImpl = async () => [];
  await render(<Harness />);
  await openPalette();
  await typeQuery("크레딧");
  assert.deepEqual(optionTexts().map((text) => text.replace("↵", "")), ["크레딧 새로고침"]);
  await key("Enter");
  assert.deepEqual(calls, ["command:credits", "close"]);
});

test("grouped command is found by its group name and keeps the 화면 모드 › label", async () => {
  searchImpl = async () => [];
  await render(<Harness />);
  await openPalette();
  await typeQuery("화면 라이트");
  assert.deepEqual(optionTexts().map((text) => text.replace("↵", "")), ["화면 모드 › 라이트"]);
  await key("Enter");
  assert.deepEqual(calls, ["command:theme-light", "close"]);
});

test("a leading / shows commands only and never searches conversations", async () => {
  await render(<Harness />);
  await openPalette();
  await typeQuery("/");
  assert.deepEqual(sectionLabels(), ["명령"]);
  assert.equal(options().length, COMMANDS.length);
  await typeQuery("/다크");
  assert.deepEqual(optionTexts().map((text) => text.replace("↵", "")), ["화면 모드 › 다크"]);
  assert.deepEqual(searched, [], "/ mode must not call searchThreads");
  await key("Enter");
  assert.deepEqual(calls, ["command:theme-dark", "close"]);
});

test("/ followed by nothing matching shows an empty status instead of conversations", async () => {
  await render(<Harness />);
  await openPalette();
  await typeQuery("/없는명령");
  assert.equal(options().length, 0);
  const status = document.querySelector('[role="status"]')!;
  assert.match(status.textContent ?? "", /일치하는 명령이 없습니다/);
});

test("an older search resolving after a newer one never overwrites the newer results", async () => {
  const pending = new Map<string, ReturnType<typeof deferred<(ThreadSummary & { snippet?: string })[]>>>();
  searchImpl = (query) => { const entry = deferred<(ThreadSummary & { snippet?: string })[]>(); pending.set(query, entry); return entry.promise; };
  await render(<Harness />);
  await openPalette();
  await typeQuery("의료");
  await typeQuery("의료 정책");
  assert.deepEqual(searched, ["의료", "의료 정책"]);
  await act(async () => { pending.get("의료 정책")!.resolve([thread("new", "의료 정책 최신")]); });
  await settle();
  await act(async () => { pending.get("의료")!.resolve([thread("old", "의료 오래된 결과")]); });
  await settle();
  const texts = optionTexts().join("|");
  assert.ok(texts.includes("의료 정책 최신"), texts);
  assert.ok(!texts.includes("오래된"), "stale response replaced the newer one");
  await key("Enter");
  assert.deepEqual(calls, ["thread:new", "close"]);
});

test("a search resolving after the query was cleared is ignored", async () => {
  const slow = deferred<(ThreadSummary & { snippet?: string })[]>();
  searchImpl = () => slow.promise;
  await render(<Harness />);
  await openPalette();
  await typeQuery("정책");
  await typeQuery("");
  await act(async () => { slow.resolve([thread("late", "늦은 결과")]); });
  await settle();
  assert.ok(!optionTexts().join("|").includes("늦은 결과"));
  assert.deepEqual(sectionLabels(), ["명령"]);
});

test("a search resolving after the palette closed does not touch state or throw", async () => {
  const slow = deferred<(ThreadSummary & { snippet?: string })[]>();
  searchImpl = () => slow.promise;
  await render(<Harness />);
  await openPalette();
  await typeQuery("정책");
  await key("Escape");
  await act(async () => { slow.resolve(THREADS); });
  await settle();
  assert.equal(dialog(), null);
  await openPalette();
  assert.equal(document.querySelector<HTMLInputElement>("input")!.value, "");
  assert.deepEqual(sectionLabels(), ["명령"]);
});

test("loading, empty and error states are announced through role=status and commands stay usable", async () => {
  const slow = deferred<(ThreadSummary & { snippet?: string })[]>();
  searchImpl = () => slow.promise;
  await render(<Harness />);
  await openPalette();
  await typeQuery("크레딧");
  assert.match(document.querySelector('[role="status"]')!.textContent ?? "", /검색하는 중/);
  assert.deepEqual(optionTexts().map((text) => text.replace("↵", "")), ["크레딧 새로고침"], "commands do not wait for the search");
  await act(async () => { slow.resolve([]); });
  await settle();
  assert.ok(!/검색하는 중/.test(document.querySelector('[role="status"]')!.textContent ?? ""));

  await typeQuery("전혀없는검색어");
  await act(async () => { slow.resolve([]); });
  await settle();
  assert.equal(options().length, 0);
  assert.match(document.querySelector('[role="status"]')!.textContent ?? "", /일치하는 항목이 없습니다/);
});

test("a failing search shows a generic error without leaking the raw message and keeps commands", async () => {
  searchImpl = async () => { throw new Error("SECRET-internal-detail"); };
  await render(<Harness />);
  await openPalette();
  await typeQuery("크레딧");
  const status = document.querySelector('[role="status"]')!;
  assert.match(status.textContent ?? "", /대화 검색에 실패했습니다/);
  assert.ok(!(dialog()!.textContent ?? "").includes("SECRET-internal-detail"));
  assert.equal(options().length, 1);
  await key("Enter");
  assert.deepEqual(calls, ["command:credits", "close"]);
});

test("a synchronously throwing searchThreads is treated as an error, not a crash", async () => {
  searchImpl = () => { throw new Error("boom"); };
  await render(<Harness />);
  await openPalette();
  await typeQuery("정책");
  assert.match(document.querySelector('[role="status"]')!.textContent ?? "", /대화 검색에 실패했습니다/);
  assert.ok(dialog());
});

test("highlighting uses <mark> and is text-safe: markup in titles and snippets stays inert text", async () => {
  searchImpl = async () => [
    thread("x", '<img src=x onerror="window.__pwned=1"> 경영', "<b>굵게</b> 경영 요약")
  ];
  await render(<Harness />);
  await openPalette();
  await typeQuery("경영");
  const row = options()[0];
  assert.equal(row.querySelector("img"), null);
  assert.equal(row.querySelector("b"), null);
  assert.ok((row.textContent ?? "").includes('<img src=x onerror="window.__pwned=1">'));
  assert.ok((row.textContent ?? "").includes("<b>굵게</b>"));
  const marks = [...row.querySelectorAll("mark")].map((mark) => mark.textContent);
  assert.deepEqual(marks, ["경영", "경영"]);
  assert.equal((globalThis as unknown as { __pwned?: number }).__pwned, undefined);
});

test("highlighting is case-insensitive, handles regex metacharacters and several tokens", async () => {
  searchImpl = async () => [thread("r", "Report (Q3) [draft] a+b")];
  await render(<Harness />);
  await openPalette();
  await typeQuery("report (q3) a+b");
  const marks = [...options()[0].querySelectorAll("mark")].map((mark) => mark.textContent);
  assert.deepEqual(marks, ["Report", "(Q3)", "a+b"]);
  await typeQuery(".*");
  assert.equal(options().filter((option) => option.getAttribute("data-kind") === "command").length, 0);
});

test("a command label match is highlighted and the group prefix is not marked unless it matches", async () => {
  searchImpl = async () => [];
  await render(<Harness />);
  await openPalette();
  await typeQuery("라이");
  const row = options()[0];
  assert.deepEqual([...row.querySelectorAll("mark")].map((mark) => mark.textContent), ["라이"]);
  assert.equal(row.textContent?.replace("↵", ""), "화면 모드 › 라이트");
});

test("keyboard navigation: ArrowDown/ArrowUp wrap, Home and End jump, aria-activedescendant follows", async () => {
  await render(<Harness />);
  await openPalette();
  const input = document.querySelector("input")!;
  const count = options().length;
  assert.equal(count, COMMANDS.length);
  await key("ArrowDown");
  assert.equal(activeOption(), options()[1]);
  assert.equal(input.getAttribute("aria-activedescendant"), options()[1].id);
  await key("ArrowUp"); await key("ArrowUp");
  assert.equal(activeOption(), options()[count - 1], "ArrowUp wraps to the last row");
  await key("ArrowDown");
  assert.equal(activeOption(), options()[0], "ArrowDown wraps to the first row");
  await key("End");
  assert.equal(activeOption(), options()[count - 1]);
  await key("Home");
  assert.equal(activeOption(), options()[0]);
  assertFocused(input, "focus stays in the input while the active row moves");
  assert.equal(document.querySelectorAll('[role="option"][aria-selected="true"]').length, 1);
});

test("arrow keys and Home/End are consumed (no caret jump) while Enter on an empty list does nothing", async () => {
  searchImpl = async () => [];
  await render(<Harness />);
  await openPalette();
  assert.equal((await key("ArrowDown")).defaultPrevented, true);
  assert.equal((await key("Home")).defaultPrevented, true);
  assert.equal((await key("End")).defaultPrevented, true);
  await typeQuery("/존재하지않음");
  await key("ArrowDown"); await key("Home"); await key("End");
  await key("Enter");
  assert.deepEqual(calls, []);
  assert.ok(dialog());
});

test("Enter during IME composition does not run the active row", async () => {
  await render(<Harness />);
  await openPalette();
  await key("Enter", { isComposing: true });
  assert.deepEqual(calls, []);
  assert.ok(dialog());
});

test("typing keeps exactly one active row and resets it to the first result", async () => {
  searchImpl = async () => [];
  await render(<Harness />);
  await openPalette();
  await key("End");
  await typeQuery("새 대화");
  assert.equal(options().length, 1);
  assert.equal(activeOption(), options()[0]);
  await typeQuery("");
  assert.equal(document.querySelectorAll('[role="option"][aria-selected="true"]').length, 1);
  assert.equal(activeOption(), options()[0], "typing resets the active row to the first result");
  await key("End");
  await typeQuery("크레딧");
  await typeQuery("");
  assert.equal(activeOption(), options()[0], "a stale active row does not reappear after the filter changes");
});

test("reopening starts from a clean state", async () => {
  await render(<Harness />);
  const opener = await openPalette();
  await typeQuery("정책");
  await key("Escape");
  assertFocused(opener);
  await openPalette();
  assert.equal(document.querySelector<HTMLInputElement>("input")!.value, "");
  assert.equal(options().length, COMMANDS.length);
});

test("palette without commands still works for conversations and shows only the 대화 section", async () => {
  await render(<Harness commands={[]} />);
  await openPalette();
  assert.equal(options().length, 0);
  await typeQuery("병원");
  assert.deepEqual(sectionLabels(), ["대화"]);
  assertAbsent(document, '[data-kind="command"]');
});

test("the footer documents the keys without a new-window hint", async () => {
  await render(<Harness />);
  await openPalette();
  const footer = document.querySelector(".command-palette-footer")!;
  const text = footer.textContent ?? "";
  assert.match(text, /↑↓ 이동/);
  assert.match(text, /↵ 열기/);
  assert.match(text, /\/ 로 명령만 보기/);
  assert.ok(!text.includes("새 창"));
});
