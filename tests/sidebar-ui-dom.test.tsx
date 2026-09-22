import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { Window } from "happy-dom";
import type { Root } from "react-dom/client";
import * as React from "react";
import type { ReactNode } from "react";
import { Image as ImageIcon } from "lucide-react";
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

let createRoot: typeof import("react-dom/client")["createRoot"];
let Sidebar: typeof import("../src/renderer/src/components/Sidebar.tsx")["Sidebar"];
let useResponsiveSidebarState: typeof import("../src/renderer/src/sidebar-responsive.ts")["useResponsiveSidebarState"];
let useDialogFocus: typeof import("../src/renderer/src/use-focus-layer.ts")["useDialogFocus"];

before(async () => {
  ({ createRoot } = await import("react-dom/client"));
  ({ Sidebar } = await import("../src/renderer/src/components/Sidebar.tsx"));
  ({ useResponsiveSidebarState } = await import("../src/renderer/src/sidebar-responsive.ts"));
  ({ useDialogFocus } = await import("../src/renderer/src/use-focus-layer.ts"));
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let calls: string[] = [];

function setCompact(next: boolean) {
  compact = next;
  const event = { matches: compact, media: mediaQuery.media } as MediaQueryListEvent;
  for (const listener of [...mediaListeners]) listener(event);
}

function Harness({ responsive = false, initialOpen = true, modalHandoff = false, removeOnDelete = false,
  updateStatus = "error", creditStatus = "default" }: {
  responsive?: boolean; initialOpen?: boolean; modalHandoff?: boolean; removeOnDelete?: boolean;
  updateStatus?: "error" | "ready" | "latest";
  creditStatus?: "default" | "monthly-zero" | "incomplete";
}) {
  const responsiveState = useResponsiveSidebarState();
  const manualState = useState(initialOpen);
  const [open, setOpen] = responsive ? responsiveState : manualState;
  const [hasThread, setHasThread] = useState(true);
  const [dialog, setDialog] = useState<string | null>(null);
  const returnFocusRef = useRef<(() => HTMLElement | null) | null>(null);
  const dialogRef = useDialogFocus(Boolean(dialog), () => setDialog(null), true,
    () => returnFocusRef.current?.() ?? null);
  const call = (name: string) => () => calls.push(name);
  const openDialog = (name: string) => (returnFocus: () => HTMLElement | null) => {
    calls.push(name);
    if (!modalHandoff) return;
    returnFocusRef.current = returnFocus;
    setDialog(name);
  };
  const thread = {
    id: "thread-1", title: "첫 대화", modelId: "gpt-5.6-luna", createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(), messageCount: 1, webSearchMode: "off" as const, pinned: false
  };
  return <><Sidebar
    workspace={{ open, screen: "chat", navItems: [{ id: "image", label: "이미지", icon: ImageIcon }], projectCount: 1 }}
    workspaceActions={{
      onToggle: () => setOpen((value) => !value), onNewThread: call("new"), onOpenProjects: openDialog("projects"),
      onOpenCompare: openDialog("compare"), onOpenChatbot: openDialog("chatbot"), onScreenChange: (screen) => calls.push(screen)
    }}
    history={{
      threadCount: hasThread ? 1 : 0, selectedThreadId: hasThread ? "thread-1" : undefined,
      threadGroups: hasThread ? [{ label: "오늘", items: [thread] }] : []
    }}
    historyActions={{
      onOpenSearch: openDialog("search"), onSelectThread: (id) => calls.push(`select:${id}`),
      onPinThread: call("pin"), onRenameThread: (_item, returnFocus) => openDialog("rename")(returnFocus),
      onExportThread: call("export"), onDeleteThread: () => { calls.push("delete"); if (removeOnDelete) setHasThread(false); }
    }}
    account={{
      credits: creditStatus === "monthly-zero" ? { monthly_allocated: { quota: 100, used: 100, remaining: 0 } }
        : creditStatus === "incomplete" ? { monthly_allocated: { remaining: 10 }, purchased: { used: 2 } }
          : { monthly_allocated: { quota: 100, used: 20, remaining: 80 } },
      updateState: updateStatus === "error" ? { status: "error", message: "network" }
        : updateStatus === "ready" ? { status: "ready", currentVersion: "0.2.0", availableVersion: "0.3.0" }
          : { status: "latest", currentVersion: "0.2.0" }
    }}
    accountActions={{
      onRefreshCredits: call("credits"), onOpenKeyReplace: openDialog("key"), onRefreshModels: call("models"),
      onOpenSettings: openDialog("settings"), onUpdateAction: call("update"), onLogout: call("logout")
    }} />
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

async function key(key: string, shiftKey = false) {
  let event!: KeyboardEvent;
  await act(async () => {
    event = new browser.KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(event);
  });
  await flushFocus();
  return event;
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

function byLabel(label: string | RegExp) {
  const target = [...document.querySelectorAll<HTMLElement>("[aria-label]")]
    .find((element) => typeof label === "string"
      ? element.getAttribute("aria-label") === label : label.test(element.getAttribute("aria-label") ?? ""));
  assert.ok(target, `missing aria-label=${String(label)}`);
  return target;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; host?.remove(); host = null; calls = []; setCompact(false); document.body.replaceChildren();
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
  assert.equal(document.activeElement, desktopControl);

  await act(async () => setCompact(true));
  await flushFocus();
  sidebar = document.querySelector<HTMLElement>(".sidebar")!;
  assert.ok(sidebar.classList.contains("collapsed"));
  const mobileOpener = byLabel("사이드바 열기");
  assert.equal(document.activeElement, mobileOpener,
    "desktop sidebar focus moves to the now-visible compact opener");

  await act(async () => setCompact(false));
  await flushFocus();
  sidebar = document.querySelector<HTMLElement>(".sidebar")!;
  assert.ok(!sidebar.classList.contains("collapsed"));
  assert.equal(document.activeElement, sidebar.querySelector(".sidebar-toggle"),
    "focus leaves the hidden mobile opener for the visible desktop toggle");
});

test("account popover is nonmodal: Tab is free, Escape restores, and outside focus is preserved", async () => {
  await render(<Harness />);
  const trigger = byLabel(/설정·계정/);
  await click(trigger);
  const dialog = document.querySelector<HTMLElement>('.account-popover[role="dialog"]')!;
  assert.ok(dialog);
  assert.equal(dialog.getAttribute("aria-modal"), "false");
  assert.equal(hasBlockingModal(document), false, "the account popover cannot suppress global shortcuts");
  assert.equal(appShortcutBlocked(document, "k"), false);
  const last = [...dialog.querySelectorAll<HTMLButtonElement>("button")].at(-1)!;
  last.focus();
  const tab = await key("Tab");
  assert.equal(tab.defaultPrevented, false);
  assert.ok(document.querySelector(".account-popover"), "Tab must not close or trap the nonmodal account popover");
  await key("Escape");
  assert.equal(document.activeElement, trigger);
  assert.equal(document.querySelector(".account-popover"), null);

  await click(trigger);
  const outside = document.createElement("button"); outside.textContent = "외부"; document.body.append(outside); outside.focus();
  await act(async () => outside.dispatchEvent(new browser.Event("pointerdown", { bubbles: true })));
  assert.equal(document.querySelector(".account-popover"), null);
  assert.equal(document.activeElement, outside, "outside pointer target keeps focus");
});

test("collapsing the desktop sidebar from an open account popover restores the visible toggle", async () => {
  await render(<Harness />);
  await click(byLabel(/설정·계정/));
  const toggle = byLabel("사이드바 닫기");
  await click(toggle);
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
  assert.ok(document.activeElement === byLabel("사이드바 펼치기"), "focus returns to the visible desktop toggle");
});

test("account nonmodal shares the compact parent boundary across repeated Tab and Shift+Tab", async () => {
  setCompact(true);
  await render(<Harness initialOpen />);
  await click(byLabel(/설정·계정/));
  const sidebar = document.querySelector<HTMLElement>('.sidebar[role="dialog"]')!;
  const account = document.querySelector<HTMLElement>('.account-popover[role="dialog"]')!;
  assert.ok(sidebar && account);
  const items = [...sidebar.querySelectorAll<HTMLElement>(FOCUSABLE)];
  assert.ok(items.length > 5);

  items[0].focus();
  for (let index = 0; index < items.length + 3; index += 1) {
    await browserTabWithin(sidebar);
    assert.ok(sidebar.contains(document.activeElement), `forward Tab ${index + 1} escaped compact sidebar`);
  }
  items.at(-1)!.focus();
  for (let index = 0; index < items.length + 3; index += 1) {
    await browserTabWithin(sidebar, true);
    assert.ok(sidebar.contains(document.activeElement), `reverse Tab ${index + 1} escaped compact sidebar`);
  }
  assert.ok(document.querySelector(".account-popover"), "boundary traversal keeps the nonmodal account panel open");
});

test("desktop thread actions use menu keys and Tab to actual adjacent controls", async () => {
  await render(<Harness />);
  const trigger = byLabel("첫 대화 대화 작업");
  await click(trigger);
  let menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  assert.ok(menu);
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  assert.equal(items.length, 4);
  assert.equal(document.activeElement, items[0]);
  await key("ArrowDown"); assert.equal(document.activeElement, items[1]);
  await key("End"); assert.equal(document.activeElement, items[3]);
  await key("Home"); assert.equal(document.activeElement, items[0]);
  await key("Escape"); assert.equal(document.activeElement, trigger);

  await click(trigger);
  menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  const first = menu.querySelector<HTMLElement>('[role="menuitem"]')!; first.focus();
  const tab = await key("Tab");
  assert.equal(tab.defaultPrevented, true);
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.equal(document.activeElement, document.querySelector(".account-trigger"),
    "forward Tab continues to the next logical desktop control");

  await click(trigger);
  menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  menu.querySelector<HTMLElement>('[role="menuitem"]')!.focus();
  const shiftTab = await key("Tab", true);
  assert.equal(shiftTab.defaultPrevented, true);
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.equal(document.activeElement, document.querySelector(".thread-select"),
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
  assert.equal(document.activeElement, trigger, "pin returns to its trigger");

  await click(trigger);
  await act(async () => document.querySelector(".thread-list")!.dispatchEvent(new browser.Event("scroll")));
  await flushFocus();
  assert.equal(document.activeElement, trigger, "scroll close returns to its trigger");

  await click(trigger);
  await act(async () => window.dispatchEvent(new browser.Event("resize")));
  await flushFocus();
  assert.equal(document.activeElement, trigger, "resize close returns to its trigger");

  await click(trigger);
  await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.includes("대화 삭제"))!);
  assert.equal(document.querySelector('[aria-label="첫 대화 대화 작업"]'), null);
  assert.equal(document.activeElement, document.querySelector(".thread-list"),
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
  assert.equal(document.activeElement, focusables[0]);
  await key("Escape");
  const openButton = byLabel("사이드바 열기");
  assert.equal(document.activeElement, openButton);
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));

  await click(openButton);
  const backdrop = document.querySelector<HTMLElement>('[data-testid="sidebar-backdrop"]')!;
  await act(async () => backdrop.dispatchEvent(new browser.MouseEvent("pointerdown", { bubbles: true })));
  await flushFocus();
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
  assert.equal(document.activeElement, openButton);

  await click(openButton);
  await click(document.querySelector(".new-chat-button")!);
  assert.deepEqual(calls, ["new"]);
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
});

test("account actions close account and compact sidebar before launching the action", async () => {
  setCompact(true);
  await render(<Harness initialOpen />);
  await click(byLabel(/설정·계정/));
  const settings = [...document.querySelectorAll<HTMLButtonElement>(".account-actions button")]
    .find((button) => button.textContent?.trim() === "설정")!;
  await click(settings);
  assert.deepEqual(calls, ["settings"]);
  assert.equal(document.querySelector(".account-popover"), null);
  assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
});

const compactDialogRoutes = [
  ["settings", async () => {
    await click(byLabel(/설정·계정/));
    await click([...document.querySelectorAll<HTMLButtonElement>(".account-actions button")]
      .find((button) => button.textContent?.trim() === "설정")!);
  }],
  ["search", async () => click(byLabel("대화 검색 (⌘/Ctrl+K)"))],
  ["projects", async () => click(document.querySelector<HTMLButtonElement>(".project-button")!)],
  ["compare", async () => click([...document.querySelectorAll<HTMLButtonElement>(".workspace-link")]
    .find((button) => button.textContent?.includes("모델 비교"))!)],
  ["rename", async () => {
    await click(byLabel("첫 대화 대화 작업"));
    await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.includes("이름 변경"))!);
  }]
] as const;

for (const [route, launch] of compactDialogRoutes) {
  test(`compact ${route} dialog returns to the visible sidebar opener`, async () => {
    setCompact(true);
    await render(<Harness initialOpen modalHandoff />);
    await launch();
    assert.ok(byLabel(`${route} modal`));
    assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
    await key("Escape");
    const mobile = byLabel("사이드바 열기");
    const active = document.activeElement as HTMLElement | null;
    assert.ok(active === mobile, `${route} did not restore the compact opener; active=${active?.getAttribute("aria-label") ?? active?.className ?? active?.tagName}`);
    assert.deepEqual(calls, [route]);
  });
}

test("desktop account and portalled rename dialogs return to their original triggers", async () => {
  await render(<Harness modalHandoff />);
  const accountTrigger = byLabel(/설정·계정/);
  await click(accountTrigger);
  await click([...document.querySelectorAll<HTMLButtonElement>(".account-actions button")]
    .find((button) => button.textContent?.trim() === "설정")!);
  await key("Escape");
  assert.equal(document.activeElement, accountTrigger);

  const threadTrigger = byLabel("첫 대화 대화 작업");
  await click(threadTrigger);
  await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.includes("이름 변경"))!);
  await key("Escape");
  assert.equal(document.activeElement, threadTrigger);
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
  ["new conversation", ".new-chat-button", "new"],
  ["conversation selection", ".thread-select", "select:thread-1"],
  ["media navigation", ".creation-tile", "image"]
] as const;

for (const [name, selector, expectedCall] of compactNavigationCases) {
  test(`compact ${name} closes the sidebar and focuses its visible opener`, async () => {
    setCompact(true);
    await render(<Harness initialOpen />);
    await click(document.querySelector<HTMLElement>(selector)!);
    assert.ok(document.querySelector(".sidebar")?.classList.contains("collapsed"));
    assert.deepEqual(calls, [expectedCall]);
    assert.equal(document.activeElement, byLabel("사이드바 열기"));
  });
}

test("desktop visible-sidebar settings path is honestly two clicks and update errors remain visible when closed", async () => {
  await render(<Harness />);
  const trigger = byLabel(/설정·계정/);
  assert.match(trigger.textContent ?? "", /확인 오류/);
  assert.match(trigger.getAttribute("aria-label") ?? "", /업데이트 오류/);
  const live = document.querySelectorAll<HTMLElement>('[data-testid="update-status-live"]');
  assert.equal(live.length, 1);
  assert.equal(live[0].getAttribute("role"), "status");
  assert.equal(live[0].getAttribute("aria-live"), "polite");
  assert.equal(live[0].textContent?.trim(), "업데이트 확인에 실패했습니다. 다시 시도해 주세요.");
  await click(trigger); // click 1 from an already open/visible desktop sidebar
  const settings = [...document.querySelectorAll<HTMLButtonElement>(".account-actions button")]
    .find((button) => button.textContent?.trim() === "설정")!;
  await click(settings); // click 2
  assert.deepEqual(calls, ["settings"]);
});

test("ready update is visible without color and announced once while the account panel is closed", async () => {
  await render(<Harness updateStatus="ready" />);
  const trigger = byLabel(/설정·계정/);
  assert.match(trigger.textContent ?? "", /새 버전/);
  assert.match(trigger.getAttribute("aria-label") ?? "", /새 업데이트 준비됨/);
  assert.equal(document.querySelector(".account-popover"), null);
  const live = document.querySelectorAll<HTMLElement>('[role="status"][aria-live="polite"]');
  assert.equal(live.length, 1, "one persistent live region prevents duplicate announcements");
  assert.equal(live[0].textContent?.trim(), "새 업데이트 0.3.0 설치 준비됨");
});

test("a zero monthly subtotal or incomplete component data never claims the whole account is empty", async () => {
  await render(<Harness creditStatus="monthly-zero" />);
  let trigger = byLabel(/설정·계정/);
  assert.doesNotMatch(trigger.textContent ?? "", /잔액 없음/);
  assert.match(trigger.textContent ?? "", /월 제공0전체 미확인/);
  assert.match(trigger.getAttribute("aria-label") ?? "", /전체 잔액 미확인/);

  await act(async () => root!.render(<Harness creditStatus="incomplete" />));
  await flushFocus();
  trigger = byLabel(/설정·계정/);
  assert.doesNotMatch(trigger.textContent ?? "", /잔액 없음/);
  assert.match(trigger.textContent ?? "", /크레딧-/);
  assert.match(trigger.getAttribute("aria-label") ?? "", /크레딧 확인 전/);
});

for (const [label, modal] of [["프로젝트", "projects"], ["모델 비교", "compare"], ["앱 설정", "settings"]]) {
  test(`collapsed rail ${label} opens a dialog and restores its visible trigger`, async () => {
    await render(<Harness modalHandoff />);
    await click(byLabel("사이드바 닫기"));
    const trigger = byLabel(label);
    await click(trigger);
    assert.ok(document.querySelector(`[aria-label="${modal} modal"]`));
    await key("Escape");
    assert.equal(document.activeElement, trigger);
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
  assert.equal(document.activeElement, summary);
  await key("Tab", true);
  assert.equal(document.activeElement, close);
  await key("Tab");
  assert.equal(document.activeElement, summary);
});
