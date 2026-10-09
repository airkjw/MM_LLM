import assert, { assertFocused } from "./dom-assert.ts";
import test, { afterEach, before } from "node:test";
import { Window } from "happy-dom";
import type { Root } from "react-dom/client";
import * as React from "react";
import type { ReactNode } from "react";
import type { CompareRun, CreditBalance, PendingMediaJob } from "../src/shared/contracts.ts";
import { appShortcutBlocked, hasBlockingModal } from "../src/renderer/src/shortcut-policy.ts";

const { act, useRef, useState } = React;

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

let compact = false;
const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();
const mediaQuery = {
  get matches() { return compact; }, media: "(max-width: 720px)", onchange: null,
  addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
  removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.delete(listener),
  addListener: (listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
  removeListener: (listener: (event: MediaQueryListEvent) => void) => mediaListeners.delete(listener),
  dispatchEvent: () => true
} as MediaQueryList;
browser.matchMedia = () => mediaQuery;

type SidebarModule = typeof import("../src/renderer/src/components/Sidebar.tsx");
let createRoot: typeof import("react-dom/client")["createRoot"];
let Sidebar: SidebarModule["Sidebar"];
let useResponsiveSidebarState: typeof import("../src/renderer/src/sidebar-responsive.ts")["useResponsiveSidebarState"];
let useDialogFocus: typeof import("../src/renderer/src/use-focus-layer.ts")["useDialogFocus"];
let App: typeof import("../src/renderer/src/App.tsx")["default"];
let ConfirmProvider: typeof import("../src/renderer/src/components/ConfirmDialog.tsx")["ConfirmProvider"];

before(async () => {
  ({ createRoot } = await import("react-dom/client"));
  ({ Sidebar } = await import("../src/renderer/src/components/Sidebar.tsx"));
  ({ useResponsiveSidebarState } = await import("../src/renderer/src/sidebar-responsive.ts"));
  ({ useDialogFocus } = await import("../src/renderer/src/use-focus-layer.ts"));
  ({ default: App } = await import("../src/renderer/src/App.tsx"));
  ({ ConfirmProvider } = await import("../src/renderer/src/components/ConfirmDialog.tsx"));
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let calls: string[] = [];
/** Ordered record of sheet closes and launched actions, used to prove the compact sheet closes first. */
let order: string[] = [];

const RAIL_ITEMS = ["대화", "모델 비교", "논문·법령 리서치", "미디어", "음성", "프로젝트", "챗봇"] as const;
// Stage 4: research, chatbot and settings are screens (D4.1/D4.3/D4.4); projects keeps its dialog until the
// W4b projects screen is wired, and voice its disclosure.
const DIALOG_DESTINATIONS = new Set(["projects"]);
const SCREEN_RAIL_ITEMS = [["논문·법령 리서치", "research"], ["챗봇", "chatbot"], ["앱 설정", "settings"]] as const;

function setCompact(next: boolean) {
  compact = next;
  const event = { matches: compact, media: mediaQuery.media } as MediaQueryListEvent;
  for (const listener of [...mediaListeners]) listener(event);
}

type CreditStatus = "default" | "monthly-zero" | "incomplete" | "total" | "low" | "renewal";
const CREDITS: Record<CreditStatus, CreditBalance> = {
  default: { monthly_allocated: { quota: 100, used: 20, remaining: 80 } },
  "monthly-zero": { monthly_allocated: { quota: 100, used: 100, remaining: 0 } },
  incomplete: { monthly_allocated: { remaining: 10 }, purchased: { used: 2 } },
  total: { total: { quota: 1000, used: 120, remaining: 880 } },
  low: { total: { quota: 1000, used: 950, remaining: 50 } },
  renewal: { total: { quota: 1000, used: 120, remaining: 880 },
    monthly_allocated: { quota: 1000, used: 120, remaining: 880, renewal_date: "2026-11-01T00:00:00Z" } }
};

const syntheticRun: CompareRun = {
  id: "run-1", prompt: "합성 비교 질문", modelIds: ["gpt-5.6-luna", "claude-opus-5"], webSearchMode: "off",
  createdAt: new Date(Date.now() - 2 * 60_000).toISOString(), attachmentNames: [], results: []
};
const syntheticJob: PendingMediaJob = {
  id: "job-1", kind: "video", modelId: "veo-synthetic", operationId: "op-1", label: "합성 영상 작업",
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), status: "pending", attempts: 0,
  nextPollAt: new Date(0).toISOString(), expiresAt: new Date(0).toISOString()
};

function Harness({ responsive = false, initialOpen = true, modalHandoff = false, removeOnDelete = false,
  updateStatus = "error", creditStatus = "default", screen = "chat" }: {
  responsive?: boolean; initialOpen?: boolean; modalHandoff?: boolean; removeOnDelete?: boolean;
  updateStatus?: "error" | "ready" | "latest"; creditStatus?: CreditStatus;
  screen?: "chat" | "compare" | "media" | "research" | "chatbot" | "settings";
}) {
  const responsiveState = useResponsiveSidebarState();
  const manualState = useState(initialOpen);
  const [open, setOpen] = responsive ? responsiveState : manualState;
  const [hasThread, setHasThread] = useState(true);
  const [dialog, setDialog] = useState<string | null>(null);
  const returnFocusRef = useRef<(() => HTMLElement | null) | null>(null);
  const dialogRef = useDialogFocus(Boolean(dialog), () => setDialog(null), true,
    () => returnFocusRef.current?.() ?? null);
  const call = (name: string) => () => { calls.push(name); order.push(name); };
  const openDialog = (name: string) => (returnFocus: () => HTMLElement | null) => {
    calls.push(name); order.push(name);
    if (!modalHandoff) return;
    returnFocusRef.current = returnFocus;
    setDialog(name);
  };
  const thread = {
    id: "thread-1", title: "첫 대화", modelId: "gpt-5.6-luna", createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(), messageCount: 1, webSearchMode: "off" as const, pinned: false
  };
  return <><Sidebar
    workspace={{ open, screen }}
    workspaceActions={{
      onToggle: () => { order.push(open ? "sheet-close" : "sheet-open"); setOpen((value) => !value); },
      onNewThread: call("new"),
      onNavigate: (destination, returnFocus) => DIALOG_DESTINATIONS.has(destination)
        ? openDialog(destination)(returnFocus) : call(destination)(),
      // The rail avatar opens the settings screen on its account category (risk 6: the popover is gone).
      onOpenAccount: call("account")
    }}
    history={{
      threadCount: hasThread ? 1 : 0, selectedThreadId: hasThread ? "thread-1" : undefined,
      threadGroups: hasThread ? [{ label: "오늘", items: [thread] }] : []
    }}
    historyActions={{
      onSelectThread: (id) => { calls.push(`select:${id}`); order.push(`select:${id}`); },
      onPinThread: call("pin"), onRenameThread: (_item, returnFocus) => openDialog("rename")(returnFocus),
      onExportThread: call("export"), onDeleteThread: () => { calls.push("delete"); if (removeOnDelete) setHasThread(false); },
      loadCompareRuns: async () => { calls.push("load-compare"); return [syntheticRun]; },
      onOpenCompareRun: (run, returnFocus) => openDialog(`compare-run:${run.id}`)(returnFocus),
      loadMediaJobs: async () => { calls.push("load-media"); return [syntheticJob]; },
      onOpenMediaJob: (job) => calls.push(`media-job:${job.id}`)
    }}
    account={{
      credits: CREDITS[creditStatus],
      updateState: updateStatus === "error" ? { status: "error", message: "network" }
        : updateStatus === "ready" ? { status: "ready", currentVersion: "0.2.0", availableVersion: "0.3.0" }
          : { status: "latest", currentVersion: "0.2.0" }
    }} />
    <main className="main-area"><button type="button" className="harness-body-control">본문</button></main>
    {dialog && <div role="dialog" aria-modal="true" aria-label={`${dialog} modal`} ref={dialogRef} tabIndex={-1}>
      <button type="button" onClick={() => setDialog(null)}>닫기</button>
    </div>}</>;
}

async function render(ui: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(ui); });
  await flushFocus();
}

async function flushFocus() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2)); });
}

async function click(target: Element) {
  await act(async () => { (target as HTMLElement).click(); });
  await flushFocus();
}

async function key(key: string, shiftKey = false, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}) {
  let event!: KeyboardEvent;
  await act(async () => {
    event = new browser.KeyboardEvent("keydown", { key, shiftKey, ...modifiers, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  await flushFocus();
  return event;
}

/** Keyboard activation: keydown on the focused control, then the browser's default click unless prevented. */
async function activateWithKey(target: HTMLElement, name = "Enter") {
  target.focus();
  const event = await key(name);
  if (!event.defaultPrevented) await click(target);
}

async function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto = element.tagName === "TEXTAREA" ? browser.HTMLTextAreaElement.prototype : browser.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

async function browserTabWithin(container: HTMLElement, shiftKey = false) {
  const before = document.activeElement as HTMLElement | null;
  const event = await key("Tab", shiftKey);
  if (!event.defaultPrevented) {
    const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const index = before ? items.indexOf(before) : -1;
    const next = index < 0 ? shiftKey ? items.at(-1) : items[0]
      : items[index + (shiftKey ? -1 : 1)];
    next?.focus();
  }
  return event;
}

/** Accessible name used by these checks: aria-label, else the trimmed text (rail items use sr-only text). */
function accessibleName(element: Element) {
  return element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "";
}

function byLabel(label: string | RegExp) {
  const target = [...document.querySelectorAll<HTMLElement>("[aria-label], button")]
    .find((element) => typeof label === "string"
      ? accessibleName(element) === label : label.test(accessibleName(element)));
  assert.ok(target, `missing accessible name=${String(label)}`);
  return target;
}

function railItem(label: string) {
  const target = [...document.querySelectorAll<HTMLElement>("nav.rail button")]
    .find((element) => accessibleName(element) === label);
  assert.ok(target, `missing rail item ${label}`);
  return target;
}

function railTabOrder() {
  const rail = document.querySelector<HTMLElement>("nav.rail")!;
  return [...rail.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((element) => !element.matches(".sidebar-mobile-open:not(.visible)"));
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; host?.remove(); host = null; calls = []; order = []; setCompact(false); document.body.replaceChildren();
});

test("explicit desktop collapse survives a compact round trip", async () => {
  await render(<Harness responsive />);
  await click(document.querySelector(".sidebar-toggle")!);
  assert.ok(document.querySelector(".sidebar")!.classList.contains("collapsed"));
  await act(async () => setCompact(true));
  await act(async () => setCompact(false));
  assert.ok(document.querySelector(".sidebar")!.classList.contains("collapsed"));
});

test("responsive state hands focus between visible desktop and compact sidebar controls", async () => {
  setCompact(true);
  await render(<Harness responsive />);
  let sidebar = document.querySelector<HTMLElement>(".sidebar")!;
  assert.equal(sidebar.dataset.compact, "true");
  assert.ok(sidebar.classList.contains("collapsed"));

  await act(async () => setCompact(false));
  await flushFocus();
  sidebar = document.querySelector<HTMLElement>(".sidebar")!;
  assert.equal(sidebar.dataset.compact, "false");
  assert.ok(!sidebar.classList.contains("collapsed"));

  const desktopControl = document.querySelector<HTMLButtonElement>(".new-chat-button")!;
  desktopControl.focus();
  assertFocused(desktopControl);

  await act(async () => setCompact(true));
  await flushFocus();
  sidebar = document.querySelector<HTMLElement>(".sidebar")!;
  assert.ok(sidebar.classList.contains("collapsed"));
  const mobileOpener = byLabel("사이드바 열기");
  assert.ok(mobileOpener.closest("nav.rail"), "the compact list opener lives in the rail under the logo");
  assertFocused(mobileOpener,
    "desktop sidebar focus moves to the now-visible compact opener");

  await act(async () => setCompact(false));
  await flushFocus();
  sidebar = document.querySelector<HTMLElement>(".sidebar")!;
  assert.ok(!sidebar.classList.contains("collapsed"));
  assertFocused(sidebar.querySelector(".sidebar-toggle"),
    "focus leaves the hidden mobile opener for the visible desktop toggle");
});

test("rail Tab order is the seven destinations, settings, then the avatar; the logo is not focusable", async () => {
  await render(<Harness />);
  const rail = document.querySelector<HTMLElement>("nav.rail")!;
  assert.equal(rail.getAttribute("aria-label"), "주 탐색");
  assert.ok(!rail.closest(".sidebar"), "the rail is outside the collapsible list column");
  const logo = rail.querySelector<HTMLElement>(".rail-logo")!;
  assert.ok(logo, "the rail shows the logo");
  assert.equal(logo.matches(FOCUSABLE), false);
  assert.equal(logo.getAttribute("aria-hidden"), "true");
  const names = railTabOrder().map(accessibleName);
  assert.deepEqual(names.slice(0, 8), [...RAIL_ITEMS, "앱 설정"]);
  assert.equal(names.length, 9);
  assert.match(names[8], /^설정·계정/);
  for (const item of railTabOrder().slice(0, 8)) assert.ok(item.classList.contains("rail-item"));
});

test("aria-current marks exactly one rail item and only for real screens", async () => {
  await render(<Harness />);
  let current = document.querySelectorAll('[aria-current="page"]');
  assert.equal(current.length, 1);
  assert.equal(accessibleName(current[0]), "대화");
  assert.ok(current[0].matches(".rail-item"));

  await act(async () => root!.render(<Harness screen="media" />));
  await flushFocus();
  current = document.querySelectorAll('[aria-current="page"]');
  assert.equal(current.length, 1);
  assert.equal(accessibleName(current[0]), "미디어");

  await act(async () => root!.render(<Harness screen="compare" />));
  await flushFocus();
  current = document.querySelectorAll('[aria-current="page"]');
  assert.equal(current.length, 1);
  assert.equal(accessibleName(current[0]), "모델 비교", "compare is a real screen since stage 3");

  // Stage 4: research, chatbot and settings are real screens too; their screens own the second column.
  for (const [label, screen] of SCREEN_RAIL_ITEMS) {
    await act(async () => root!.render(<Harness screen={screen} />));
    await flushFocus();
    current = document.querySelectorAll('[aria-current="page"]');
    assert.equal(current.length, 1);
    assert.equal(accessibleName(current[0]), label);
    assert.equal(document.querySelector(".sidebar"), null, `${label} does not show the chat list column`);
    assert.equal(byLabel(/^설정·계정/).hasAttribute("aria-current"), false, "the avatar is never the current page");
  }

  await act(async () => root!.render(<Harness />));
  await flushFocus();
  for (const label of ["음성", "프로젝트"]) {
    assert.equal(railItem(label).hasAttribute("aria-current"), false, `${label} still opens its existing flow`);
  }
});

test("rail destinations map to screens or the existing dialogs", async () => {
  await render(<Harness />);
  for (const label of RAIL_ITEMS) await click(railItem(label));
  await click(railItem("앱 설정"));
  assert.deepEqual(calls, ["chat", "compare", "research", "media", "voice", "projects", "chatbot", "settings"]);
});

test("compact rail navigation closes the open sheet before the action runs", async () => {
  setCompact(true);
  await render(<Harness initialOpen />);
  assert.ok(document.querySelector('.sidebar[role="dialog"]'));
  await click(railItem("미디어"));
  assert.deepEqual(order, ["sheet-close", "media"]);
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));

  order = [];
  await click(byLabel("사이드바 열기"));
  await click(railItem("프로젝트"));
  assert.deepEqual(order, ["sheet-open", "sheet-close", "projects"]);
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
});

test("collapsing the list column (Cmd/Ctrl+B path) never hides the rail", async () => {
  await render(<Harness responsive />);
  await click(byLabel("사이드바 닫기"));
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
  const rail = document.querySelector<HTMLElement>("nav.rail")!;
  assert.ok(rail && !rail.closest(".collapsed, [hidden], [aria-hidden='true']"));
  assert.equal(railTabOrder().length, 10, "the rail keeps every destination plus the visible expand control");
  assert.ok(byLabel("사이드바 펼치기").closest("nav.rail"));
  await act(async () => setCompact(true));
  assert.ok(document.querySelector("nav.rail"), "the rail stays at the compact width too");
});

// Risk 6: the account popover left the rail. The avatar keeps its place, label and update badge, and opens the
// settings screen on its account category in one click (the moved account actions are tested in settings-ui-dom).
test("the rail avatar is a plain navigation button to the account settings, not a popover", async () => {
  await render(<Harness />);
  const trigger = byLabel(/설정·계정/);
  assert.ok(trigger.closest("nav.rail"));
  assert.equal(trigger.getAttribute("aria-haspopup"), null);
  assert.equal(trigger.getAttribute("aria-expanded"), null);
  trigger.focus();
  await click(trigger);
  assert.deepEqual(calls, ["account"]);
  assert.equal(document.querySelector(".account-popover"), null);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assertFocused(trigger, "navigation keeps focus on the visible avatar");
});

test("collapsing the desktop list column keeps the avatar reachable and restores the visible toggle", async () => {
  await render(<Harness />);
  const toggle = byLabel("사이드바 닫기");
  toggle.focus();
  await click(toggle);
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
  assertFocused(byLabel("사이드바 펼치기"), "focus returns to the visible desktop toggle");
  assert.ok(railTabOrder().includes(byLabel(/설정·계정/)));
  await click(byLabel("사이드바 펼치기"));
  assert.ok(!document.querySelector(".sidebar")?.classList.contains("collapsed"));
  assertFocused(byLabel("사이드바 닫기"), "expanding returns focus to the list column toggle");
});

test("compact avatar navigation closes the sheet before opening the account settings", async () => {
  setCompact(true);
  await render(<Harness initialOpen />);
  const trigger = byLabel(/설정·계정/);
  trigger.focus();
  await click(trigger);
  assert.deepEqual(order, ["sheet-close", "account"]);
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
  assertFocused(trigger);
});

test("desktop thread actions use menu keys and Tab to actual adjacent controls", async () => {
  await render(<Harness />);
  const trigger = byLabel("첫 대화 대화 작업");
  await click(trigger);
  let menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  assert.ok(menu);
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  assert.equal(items.length, 4);
  assertFocused(items[0]);
  await key("ArrowDown"); assertFocused(items[1]);
  await key("End"); assertFocused(items[3]);
  await key("Home"); assertFocused(items[0]);
  await key("Escape"); assertFocused(trigger);

  await click(trigger);
  menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  const first = menu.querySelector<HTMLElement>('[role="menuitem"]')!; first.focus();
  const tab = await key("Tab");
  assert.equal(tab.defaultPrevented, true);
  assert.equal(document.querySelector('[role="menu"]'), null);
  assertFocused(document.querySelector(".harness-body-control"),
    "forward Tab continues to the next logical desktop control after the list column");

  await click(trigger);
  menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  menu.querySelector<HTMLElement>('[role="menuitem"]')!.focus();
  const shiftTab = await key("Tab", true);
  assert.equal(shiftTab.defaultPrevented, true);
  assert.equal(document.querySelector('[role="menu"]'), null);
  assertFocused(document.querySelector(".thread-select"),
    "Shift+Tab returns to the previous logical desktop control");
});

test("compact thread menu remains inside its aria-modal sidebar subtree", async () => {
  setCompact(true);
  await render(<Harness initialOpen />);
  await click(byLabel("첫 대화 대화 작업"));
  const sidebar = document.querySelector<HTMLElement>('.sidebar[role="dialog"]')!;
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  assert.ok(sidebar.contains(menu), "compact modal owns every interactive menu descendant");
});

test("compact pin and export commands keep the sidebar open", async () => {
  setCompact(true);
  await render(<Harness initialOpen />);
  await click(byLabel("첫 대화 대화 작업"));
  await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.includes("고정"))!);
  assert.deepEqual(calls, ["pin"]);
  assert.ok(!document.querySelector(".sidebar")?.classList.contains("collapsed"));

  await click(byLabel("첫 대화 대화 작업"));
  await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.includes("Markdown"))!);
  assert.deepEqual(calls, ["pin", "export"]);
  assert.ok(!document.querySelector(".sidebar")?.classList.contains("collapsed"));
});

test("thread commands, scroll, resize, and deletion restore a stable focus target", async () => {
  await render(<Harness removeOnDelete />);
  let trigger = byLabel("첫 대화 대화 작업");
  await click(trigger);
  await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.includes("고정"))!);
  assertFocused(trigger, "pin returns to its trigger");

  await click(trigger);
  await act(async () => document.querySelector(".thread-list")!.dispatchEvent(new browser.Event("scroll")));
  await flushFocus();
  assertFocused(trigger, "scroll close returns to its trigger");

  await click(trigger);
  await act(async () => window.dispatchEvent(new browser.Event("resize")));
  await flushFocus();
  assertFocused(trigger, "resize close returns to its trigger");

  await click(trigger);
  await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.includes("대화 삭제"))!);
  assert.equal(document.querySelector('[aria-label="첫 대화 대화 작업"]'), null);
  assertFocused(document.querySelector(".thread-list"),
    "deleting the trigger falls back to the conversation list");
});

test("compact sidebar is modal/trapped, restores its toggle, and closes before navigation", async () => {
  setCompact(true);
  await render(<Harness initialOpen />);
  const sidebar = document.querySelector<HTMLElement>('.sidebar[role="dialog"]')!;
  assert.ok(sidebar); assert.equal(sidebar.getAttribute("aria-modal"), "true");
  assert.equal(appShortcutBlocked(document, "n"), true);
  assert.equal(appShortcutBlocked(document, "b"), false, "Ctrl/Cmd+B remains available to close the compact sidebar");
  const focusables = [...sidebar.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
  focusables.at(-1)!.focus();
  const tab = await key("Tab");
  assert.equal(tab.defaultPrevented, true);
  assertFocused(focusables[0]);
  await key("Escape");
  const openButton = byLabel("사이드바 열기");
  assertFocused(openButton);
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));

  await click(openButton);
  const backdrop = document.querySelector<HTMLElement>('[data-testid="sidebar-backdrop"]')!;
  await act(async () => backdrop.dispatchEvent(new browser.MouseEvent("pointerdown", { bubbles: true })));
  await flushFocus();
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
  assertFocused(openButton);

  await click(openButton);
  await click(document.querySelector(".new-chat-button")!);
  assert.deepEqual(calls, ["new"]);
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
});

const openRenameFromThreadMenu = async () => {
  await click(byLabel("첫 대화 대화 작업"));
  await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.includes("이름 변경"))!);
};

// Launchers inside the list column disappear when the compact sheet closes, so their dialogs fall back to
// the visible opener. "desktop rename" is the known case: launched on desktop, window shrunk to <=720px.
const compactDialogRoutes = [
  ["rename", false, openRenameFromThreadMenu],
  ["desktop rename", true, openRenameFromThreadMenu]
] as const;

for (const [route, launchOnDesktop, launch] of compactDialogRoutes) {
  test(`compact ${route} dialog returns to the visible sidebar opener`, async () => {
    if (!launchOnDesktop) setCompact(true);
    await render(<Harness responsive initialOpen modalHandoff />);
    if (!launchOnDesktop) await click(byLabel("사이드바 열기"));
    await launch();
    assert.ok(byLabel("rename modal"));
    if (launchOnDesktop) { await act(async () => setCompact(true)); await flushFocus(); }
    assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
    await key("Escape");
    const mobile = byLabel("사이드바 열기");
    const active = document.activeElement as HTMLElement | null;
    assert.ok(active === mobile, `${route} did not restore the compact opener; active=${active?.getAttribute("aria-label") ?? active?.className ?? active?.tagName}`);
    assert.deepEqual(calls, ["rename"]);
  });
}

// Rail launchers stay visible at every width, so rule 1 (the original trigger) applies before the opener.
// Stage 4: only projects still opens a dialog; settings, research, chatbot and the avatar navigate to screens.
const compactRailDialogRoutes = [
  ["projects", () => railItem("프로젝트"), async () => { await click(railItem("프로젝트")); }]
] as const;

for (const [route, trigger, launch] of compactRailDialogRoutes) {
  test(`compact ${route} dialog returns to its visible rail trigger`, async () => {
    setCompact(true);
    await render(<Harness initialOpen modalHandoff />);
    const expected = trigger();
    await launch();
    assert.ok(document.querySelector('[role="dialog"][aria-modal="true"]:not(.sidebar)'), `${route} modal opened`);
    assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"), "the sheet closed first");
    await key("Escape");
    assertFocused(expected);
  });
}

for (const [route, trigger, expected] of [
  ["settings", () => railItem("앱 설정"), "settings"],
  ["account settings", () => byLabel(/설정·계정/), "account"],
  ["research", () => railItem("논문·법령 리서치"), "research"],
  ["chatbot", () => railItem("챗봇"), "chatbot"]
] as const) {
  test(`compact ${route} screen closes the sheet first and keeps focus on its visible rail trigger`, async () => {
    setCompact(true);
    await render(<Harness initialOpen modalHandoff />);
    const target = trigger();
    target.focus();
    await click(target);
    assert.deepEqual(order, ["sheet-close", expected]);
    assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"), "the sheet closed first");
    assert.equal(document.querySelector('[role="dialog"][aria-modal="true"]'), null, "a screen, not a modal");
    assertFocused(target);
  });
}

test("portalled rename dialogs return to their original triggers", async () => {
  await render(<Harness modalHandoff />);
  const threadTrigger = byLabel("첫 대화 대화 작업");
  await click(threadTrigger);
  await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.includes("이름 변경"))!);
  await key("Escape");
  assertFocused(threadTrigger);
});

test("a compact thread menu releases Tab to the containing compact modal", async () => {
  setCompact(true);
  await render(<Harness initialOpen />);
  await click(byLabel("첫 대화 대화 작업"));
  const first = document.querySelector<HTMLElement>('[role="menuitem"]')!;
  first.focus();
  const tab = await key("Tab");
  assert.equal(tab.defaultPrevented, true, "the containing modal owns the boundary traversal");
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.ok(document.querySelector(".sidebar")?.contains(document.activeElement), "focus remains in compact sidebar");
});

const compactNavigationCases = [
  ["new conversation", () => document.querySelector<HTMLElement>(".new-chat-button")!, "new"],
  ["conversation selection", () => document.querySelector<HTMLElement>(".thread-select")!, "select:thread-1"]
] as const;

for (const [name, target, expectedCall] of compactNavigationCases) {
  test(`compact ${name} closes the sidebar and focuses its visible opener`, async () => {
    setCompact(true);
    await render(<Harness initialOpen />);
    await click(target());
    assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
    assert.deepEqual(calls, [expectedCall]);
    assertFocused(byLabel("사이드바 열기"));
  });
}

test("compact media navigation closes the sidebar and keeps focus on the visible rail item", async () => {
  setCompact(true);
  await render(<Harness initialOpen />);
  const media = railItem("미디어");
  media.focus();
  await click(media);
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
  assert.deepEqual(calls, ["media"]);
  assertFocused(media);
});

test("settings and the account settings are one click each and update errors remain visible on the avatar", async () => {
  await render(<Harness />);
  await click(railItem("앱 설정"));
  assert.deepEqual(calls, ["settings"]);
  calls = [];
  const trigger = byLabel(/설정·계정/);
  assert.match(trigger.textContent ?? "", /오류/);
  assert.match(trigger.getAttribute("aria-label") ?? "", /업데이트 오류/);
  const live = document.querySelectorAll<HTMLElement>('[data-testid="update-status-live"]');
  assert.equal(live.length, 1);
  assert.equal(live[0].getAttribute("role"), "status");
  assert.equal(live[0].getAttribute("aria-live"), "polite");
  assert.equal(live[0].textContent?.trim(), "업데이트 확인에 실패했습니다. 다시 시도해 주세요.");
  await click(trigger); // one click on the rail avatar
  assert.deepEqual(calls, ["account"]);
  assert.equal(document.querySelectorAll('[data-testid="update-status-live"]').length, 1);
});

test("ready update is a text badge beside the avatar and announced once while the account panel is closed", async () => {
  await render(<Harness updateStatus="ready" />);
  const trigger = byLabel(/설정·계정/);
  const badge = trigger.querySelector(".rail-update-badge");
  assert.equal(badge?.textContent?.trim(), "업데이트", "the ready state is shown as text, not color alone");
  assert.match(trigger.getAttribute("aria-label") ?? "", /새 업데이트 준비됨/);
  assert.equal(document.querySelector(".account-popover"), null);
  const live = document.querySelectorAll<HTMLElement>('[role="status"][aria-live="polite"]');
  assert.equal(live.length, 1, "one persistent live region prevents duplicate announcements");
  assert.equal(live[0].textContent?.trim(), "새 업데이트 0.3.0 설치 준비됨");
});

test("a zero monthly subtotal or incomplete component data never claims the whole account is empty", async () => {
  await render(<Harness creditStatus="monthly-zero" />);
  let trigger = byLabel(/설정·계정/);
  let card = document.querySelector<HTMLElement>(".credit-card")!;
  assert.doesNotMatch(card.textContent ?? "", /잔액 없음/);
  assert.match(card.textContent ?? "", /월 제공/);
  assert.match(card.textContent ?? "", /전체 미확인/);
  assert.equal(card.querySelector("progress"), null, "no ratio bar without a whole-account quota");
  assert.match(trigger.getAttribute("aria-label") ?? "", /전체 잔액 미확인/);

  await act(async () => root!.render(<Harness creditStatus="incomplete" />));
  await flushFocus();
  trigger = byLabel(/설정·계정/);
  card = document.querySelector<HTMLElement>(".credit-card")!;
  assert.doesNotMatch(card.textContent ?? "", /잔액 없음/);
  assert.match(card.textContent ?? "", /잔액 정보 없음/);
  assert.equal(card.querySelector("progress"), null);
  assert.match(trigger.getAttribute("aria-label") ?? "", /크레딧 확인 전/);
});

test("credit card is pinned to the list column and shows n / m only with a real quota", async () => {
  await render(<Harness creditStatus="total" />);
  const card = document.querySelector<HTMLElement>(".sidebar .credit-card")!;
  assert.ok(card, "the credit card lives in the list column");
  assert.match(card.textContent ?? "", /880\s*\/\s*1,000/);
  const bar = card.querySelector<HTMLProgressElement>("progress")!;
  assert.equal(bar.getAttribute("max"), "1000");
  assert.equal(bar.getAttribute("value"), "880");
  assert.equal(card.querySelector(".credit-renewal"), null, "no renewal copy without renewal data");
  assert.ok(!card.classList.contains("credit-low"));

  await act(async () => root!.render(<Harness creditStatus="low" />));
  await flushFocus();
  const low = document.querySelector<HTMLElement>(".credit-card")!;
  assert.ok(low.classList.contains("credit-low"), "10% or less switches to the danger state");
  assert.match(low.textContent ?? "", /10% 이하/);

  await act(async () => root!.render(<Harness creditStatus="renewal" />));
  await flushFocus();
  assert.match(document.querySelector(".credit-card .credit-renewal")?.textContent ?? "", /갱신/);
});

test("list filters are pressed toggle buttons and load comparison and media rows on demand", async () => {
  await render(<Harness />);
  const group = document.querySelector<HTMLElement>('.list-filters[role="group"]')!;
  assert.ok(group);
  assert.equal(group.querySelector('[role="tab"], [role="tablist"]'), null);
  const chips = [...group.querySelectorAll<HTMLButtonElement>("button")];
  assert.deepEqual(chips.map((chip) => chip.textContent?.trim()), ["전체", "고정", "비교", "미디어"]);
  assert.deepEqual(chips.map((chip) => chip.getAttribute("aria-pressed")), ["true", "false", "false", "false"]);
  assert.deepEqual(calls, [], "comparison and media lists are not loaded before they are requested");

  await click(chips[1]);
  assert.deepEqual(chips.map((chip) => chip.getAttribute("aria-pressed")), ["false", "true", "false", "false"]);
  assert.equal(document.querySelector(".thread-select"), null, "the unpinned synthetic thread is filtered out");

  await click(chips[2]);
  assert.deepEqual(calls, ["load-compare"]);
  const runRow = document.querySelector<HTMLButtonElement>(".compare-run-row")!;
  assert.match(runRow.textContent ?? "", /합성 비교 질문/);
  assert.match(runRow.textContent ?? "", /2 models/);
  await click(runRow);
  assert.deepEqual(calls, ["load-compare", "compare-run:run-1"]);

  await click(chips[3]);
  assert.deepEqual(calls, ["load-compare", "compare-run:run-1", "load-media"]);
  const jobRow = document.querySelector<HTMLButtonElement>(".media-job-row")!;
  assert.match(jobRow.textContent ?? "", /합성 영상 작업/);
  await click(jobRow);
  assert.equal(calls.at(-1), "media-job:job-1");

  await click(chips[0]);
  assert.ok(document.querySelector(".thread-select"));
});

test("thread rows show the model id and a relative time as metadata", async () => {
  await render(<Harness />);
  const row = document.querySelector<HTMLElement>(".thread-select")!;
  assert.equal(row.querySelector(".thread-title")?.textContent, "첫 대화");
  assert.match(row.querySelector(".thread-meta")?.textContent ?? "", /^gpt-5\.6-luna · \d+d$/);
});

// Stage 4: projects still opens a dialog; research and settings are screens (focus stays on the trigger).
for (const [label, screen] of SCREEN_RAIL_ITEMS) {
  test(`collapsed rail ${label} opens its screen and keeps focus on the visible trigger`, async () => {
    await render(<Harness />);
    await click(byLabel("사이드바 닫기"));
    const trigger = railItem(label);
    await activateWithKey(trigger);
    assert.deepEqual(calls, [screen]);
    assertFocused(trigger);
  });
}
for (const label of ["프로젝트"]) {
  const modal = "projects";
  test(`collapsed rail ${label} opens a dialog and restores its visible trigger`, async () => {
    await render(<Harness modalHandoff />);
    await click(byLabel("사이드바 닫기"));
    const trigger = railItem(label);
    // Collapsing hands focus to the expand control; a pointer click in Chromium then focuses the
    // rail button, which happy-dom's click() does not, so model that focus move explicitly.
    trigger.focus();
    await click(trigger);
    assert.ok(document.querySelector(`[aria-label="${modal} modal"]`));
    await key("Escape");
    assertFocused(trigger);
  });
  test(`collapsed rail ${label} activated with Enter restores its visible trigger`, async () => {
    await render(<Harness modalHandoff />);
    await click(byLabel("사이드바 닫기"));
    const trigger = railItem(label);
    await activateWithKey(trigger);
    assert.ok(document.querySelector(`[aria-label="${modal} modal"]`));
    await key("Escape");
    assertFocused(trigger);
  });
}

test("dialog focus skips controls inside a closed disclosure", async () => {
  function DisclosureHarness() {
    const ref = useDialogFocus(true, () => {});
    return <div role="dialog" aria-modal="true" ref={ref} tabIndex={-1}>
      <details><summary>백업 · 복원</summary><button>숨긴 복원 버튼</button></details>
      <button data-close>닫기</button>
    </div>;
  }
  await render(<DisclosureHarness />);
  const summary = document.querySelector("summary")!;
  const close = document.querySelector<HTMLElement>("[data-close]")!;
  assertFocused(summary);
  await key("Tab", true);
  assertFocused(close);
  await key("Tab");
  assertFocused(summary);
});

// Real App wiring: the shell, Cmd/Ctrl shortcuts, the body header Cmd+K button and rail-to-dialog mapping.
const appNow = new Date().toISOString();
const appThread = { id: "app-thread", title: "합성 대화", modelId: "gpt-6-astra", createdAt: appNow, updatedAt: appNow,
  webSearchMode: "off" as const, reasoningMode: "auto" as const, instruction: "", advanced: {},
  attachmentConsent: false, messages: [], messageCount: 0 };

function appFixture(overrides: Record<string, unknown> = {}) {
  Object.assign(browser, { mmllm: {
    getSession: async () => ({ authenticated: true, credits: { total: { quota: 1000, used: 120, remaining: 880 } },
      models: [{ id: "gpt-6-astra", type: "llm" }, { id: "synthetic-image", type: "image" }] }),
    getSettings: async () => ({ theme: "light", fontSize: "medium", defaultInstruction: "" }),
    setThemePreference: async () => {}, onThemeResolved: () => () => {},
    listThreads: async () => [appThread], loadThread: async () => appThread, listProjects: async () => [],
    listBackgroundResponses: async () => [], getUpdateState: async () => ({ status: "idle", currentVersion: "0.5.1" }),
    onUpdateChanged: () => () => {}, discardAttachments: async () => {},
    getCredits: async () => ({ total: { quota: 1000, used: 120, remaining: 880 } }),
    searchThreads: async () => [], listMediaJobs: async () => [], listChatbotBookmarks: async () => [], listCompareRuns: async () => [],
    cancelResearch: async () => {}, onVoiceEvent: () => () => {}, ...overrides
  } });
}

async function renderApp(overrides: Record<string, unknown> = {}) {
  appFixture(overrides);
  await render(<ConfirmProvider><App /></ConfirmProvider>);
  await flushFocus();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

test("real App: Ctrl/Cmd+B collapses only the list column and the rail stays", async () => {
  await renderApp();
  assert.ok(document.querySelector("nav.rail"));
  assert.ok(!document.querySelector(".sidebar")?.classList.contains("collapsed"));
  document.body.focus();
  await key("b", false, { ctrlKey: true });
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
  assert.equal(railTabOrder().filter((item) => item.matches(".rail-item")).length, 8, "every rail item is still reachable");
  await key("b", false, { metaKey: true });
  assert.ok(!document.querySelector(".sidebar")?.classList.contains("collapsed"));
});

test("real App: the body header Cmd+K button opens the command palette and focus returns to it, also after shrinking", async () => {
  await renderApp();
  const header = document.querySelector<HTMLElement>(".panel-header")!;
  const search = header.querySelector<HTMLButtonElement>(".header-search")!;
  assert.ok(search, "the Cmd+K field sits in the body header");
  assert.equal(search.getAttribute("aria-keyshortcuts"), "Meta+K Control+K");
  assert.equal(search.getAttribute("role"), null);
  search.focus();
  await click(search);
  // Stage 3 (D3.7): the Cmd+K entry opens the command palette that replaced the search dialog.
  assert.ok(document.querySelector('.command-palette[role="dialog"]'), "the command palette opens");
  assert.equal(document.querySelector("#search-title"), null);
  await key("Escape");
  assertFocused(search);

  await click(search);
  await act(async () => setCompact(true));
  await flushFocus();
  await key("Escape");
  assertFocused(search, "the header trigger stays visible at the compact width");
});

test("real App: rail research, compare and voice reach their flows", async () => {
  await renderApp();
  const research = railItem("논문·법령 리서치");
  research.focus();
  await click(research);
  // Stage 4 (D4.3): research is a screen with aria-current; focus stays on its rail trigger.
  assert.ok(document.querySelector(".research-screen"), "research opens its screen");
  assert.equal(document.querySelector(".workspace-tools-dialog"), null);
  assert.equal(research.getAttribute("aria-current"), "page");
  assertFocused(research);

  // Stage 3: compare is a screen with aria-current; focus stays on its rail trigger.
  const compare = railItem("모델 비교");
  compare.focus();
  await click(compare);
  assert.equal(compare.getAttribute("aria-current"), "page");
  assert.ok(document.querySelector(".compare-screen"), "compare opens its screen, not a dialog");
  assert.equal(document.querySelector(".workspace-tools-dialog"), null);
  assertFocused(compare);

  await click(railItem("음성"));
  await flushFocus();
  const voice = document.querySelector<HTMLDetailsElement>("details.voice-panel")!;
  assert.ok(voice?.open, "the voice disclosure opens in the current conversation");
  assert.equal(document.querySelectorAll('[aria-current="page"]').length, 1);
  assert.equal(accessibleName(document.querySelector('[aria-current="page"]')!), "대화");
});

test("real App: the media rail item switches to one media screen with a kind selector", async () => {
  await renderApp();
  await click(railItem("미디어"));
  assert.equal(accessibleName(document.querySelector('[aria-current="page"]')!), "미디어");
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.panel-header [role="tablist"] [role="tab"]')];
  assert.deepEqual(tabs.map((tab) => tab.textContent?.trim()), ["이미지", "오디오", "비디오"]);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  const panel = document.getElementById(tabs[0].getAttribute("aria-controls") ?? "");
  assert.ok(panel, "every kind tab controls the media body");
  assert.equal(panel.getAttribute("role"), "tabpanel");
  assert.equal(panel.getAttribute("aria-labelledby"), tabs[0].id);
  // Manual activation: arrows, Home and End move focus only; Enter, Space or a click selects.
  tabs[0].focus();
  await key("ArrowRight");
  assertFocused(tabs[1]);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true", "arrow keys do not switch the media kind");
  await key("End");
  assertFocused(tabs[2]);
  await key("Home");
  assertFocused(tabs[0]);
  await key("ArrowLeft");
  assertFocused(tabs[2]);
  await activateWithKey(tabs[1]);
  const next = [...document.querySelectorAll<HTMLButtonElement>('.panel-header [role="tab"]')];
  assert.equal(next[1].getAttribute("aria-selected"), "true");
  assert.equal(document.getElementById("media-kind-panel")?.getAttribute("aria-labelledby"), next[1].id);
  assert.match(document.querySelector(".media-panel .panel-header h2")?.textContent ?? "", /오디오|음성/);
});

const mediaFilter = () => [...document.querySelectorAll<HTMLButtonElement>(".list-filters .filter-chip")]
  .find((chip) => chip.textContent === "미디어")!;
const mediaTabs = () => [...document.querySelectorAll<HTMLButtonElement>('.panel-header [role="tablist"] [role="tab"]')];
const mediaPrompt = () => document.querySelector<HTMLTextAreaElement>(".media-form textarea")!;
const imageModels = { getSession: async () => ({ authenticated: true, credits: { total: { quota: 1000, used: 120, remaining: 880 } },
  models: [{ id: "gpt-6-astra", type: "llm" }, { id: "gpt-image-2", type: "image" }] }) };

test("real App: media kind arrow navigation keeps the prompt", async () => {
  await renderApp(imageModels);
  await click(railItem("미디어"));
  await typeInto(mediaPrompt(), "합성 프롬프트");
  mediaTabs()[0].focus();
  await key("ArrowRight");
  await key("ArrowLeft");
  assertFocused(mediaTabs()[0]);
  assert.equal(mediaTabs()[0].getAttribute("aria-selected"), "true");
  assert.equal(mediaPrompt().value, "합성 프롬프트", "moving focus between kind tabs never resets the media form");
});

test("real App: media kind switching and media rows are refused while an estimate is in flight", async () => {
  let estimates = 0;
  const videoJob = { ...syntheticJob, id: "video-busy", label: "합성 진행 영상" };
  await renderApp({ ...imageModels, listMediaJobs: async () => [videoJob],
    estimateMedia: () => { estimates++; return new Promise(() => {}); }, cancelMediaEstimate: async () => {} });
  await click(railItem("미디어"));
  await typeInto(mediaPrompt(), "합성 프롬프트");
  const cost = [...document.querySelectorAll<HTMLButtonElement>(".media-panel button")].find((item) => item.textContent === "비용 확인")!;
  await click(cost);
  assert.equal(estimates, 1);
  const tabs = mediaTabs();
  assert.equal(tabs[0].hasAttribute("aria-disabled"), false, "the selected kind stays available");
  assert.equal(tabs[1].getAttribute("aria-disabled"), "true");
  assert.equal(tabs[2].getAttribute("aria-disabled"), "true");
  await activateWithKey(tabs[2]);
  await click(tabs[1]);
  assert.equal(mediaTabs()[0].getAttribute("aria-selected"), "true", "the kind does not change while busy");
  assert.equal(mediaPrompt().value, "합성 프롬프트");
  // Stage 4: the list column is shown on the chat screen only; the busy media screen stays mounted meanwhile.
  await click(railItem("대화"));
  await click(mediaFilter());
  const row = document.querySelector<HTMLElement>(".media-job-row")!;
  assert.ok(row, "the media filter lists the synthetic job");
  await click(row);
  assert.equal(accessibleName(document.querySelector('[aria-current="page"]')!), "대화", "a media row cannot interrupt a busy screen");
  assert.match(document.querySelector('.app-error[role="status"]')?.textContent ?? "", /진행 중인 미디어 작업이 끝난 뒤 다시 선택해 주세요/);
  await click(railItem("미디어"));
  assert.equal(mediaTabs()[0].getAttribute("aria-selected"), "true");
  assert.equal(mediaPrompt().value, "합성 프롬프트");
});

test("real App: a media row opens the clicked job, STT jobs in the STT lane", async () => {
  const failed = (id: string, kind: PendingMediaJob["kind"], label: string, error: string) =>
    ({ ...syntheticJob, id, kind, label, status: "failed", result: { status: "failed", error } }) as PendingMediaJob;
  const jobs = [failed("stt-1", "stt", "합성 받아쓰기", "합성 받아쓰기 오류"),
    failed("video-1", "video", "합성 영상 1", "합성 영상 오류 1"), failed("video-2", "video", "합성 영상 2", "합성 영상 오류 2")];
  await renderApp({ listMediaJobs: async () => jobs, releaseMediaJobSource: async () => {}, releaseMedia: async () => {},
    acknowledgeMediaJob: async () => {} });
  const resultText = () => document.querySelector(".media-result")?.textContent ?? "";
  const row = (label: string) => [...document.querySelectorAll<HTMLElement>(".media-job-row")]
    .find((item) => item.textContent?.includes(label))!;
  const settle = async () => { await flushFocus(); await flushFocus(); };
  // Stage 4: rows live in the chat screen's list column, so each pick starts from the conversation screen.
  const fromChat = async () => { await click(railItem("대화")); await click(mediaFilter()); };
  await fromChat();
  await click(row("합성 받아쓰기"));
  await settle();
  assert.equal(document.querySelector('[data-audio-lane="stt"]')?.getAttribute("aria-selected"), "true", "STT opens its lane");
  assert.match(resultText(), /합성 받아쓰기 오류/);

  await fromChat();
  await click(row("합성 영상 2"));
  await settle();
  assert.equal(mediaTabs()[2].getAttribute("aria-selected"), "true");
  assert.match(resultText(), /합성 영상 오류 2/, "the clicked job is shown, not the first of its kind");
  assert.match(document.querySelector('.job-list [aria-current="true"]')?.textContent ?? "", /합성 영상 2/);

  await fromChat();
  await click(row("합성 영상 1"));
  await settle();
  assert.match(resultText(), /합성 영상 오류 1/, "a second job of the same kind opens on the same screen");
  await fromChat();
  await click(row("합성 영상 2"));
  await settle();
  assert.match(resultText(), /합성 영상 오류 2/);
});

test("real App: rail voice explains why it cannot open without a conversation panel", async () => {
  await renderApp({ getSession: async () => ({ authenticated: true, credits: { total: { quota: 1000, used: 120, remaining: 880 } },
    models: [{ id: "synthetic-image", type: "image" }] }) });
  assert.equal(document.querySelector("details.voice-panel"), null, "no LLM models means no conversation panel");
  await click(railItem("음성"));
  await flushFocus();
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /음성은 대화 화면에서 사용할 수 있습니다/);
});
