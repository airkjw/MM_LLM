import { useEffect, useRef, useState } from "react";
import type { CompareRun, CreditBalance, PendingMediaJob, ThreadSummary, UpdateState } from "../../../shared/contracts";
import { useFocusLayer } from "../use-focus-layer";
import { COMPACT_SIDEBAR_QUERY } from "../sidebar-responsive";
import { ChatListColumn, type ListFilter } from "./ChatListColumn";
import { Rail } from "./Rail";

export type SidebarScreen = "chat" | "compare" | "research" | "media" | "voice" | "projects" | "chatbot" | "settings";
/**
 * Screens that show the conversation list column. Every other screen puts its own column in that slot (README
 * "rail 56 · 목록/설정 열 · 본문"); there the list, its compact sheet and Cmd/Ctrl+B do not apply.
 */
export const LIST_SCREENS: ReadonlySet<SidebarScreen> = new Set<SidebarScreen>(["chat", "compare"]);
export type MediaKind = "image" | "audio" | "video";
export type FocusReturnTarget = () => HTMLElement | null;
export type SidebarThreadGroup = { label: string; items: ThreadSummary[] };
export type SidebarWorkspaceModel = { open: boolean; screen: SidebarScreen };
export type SidebarWorkspaceActions = {
  onToggle: () => void; onNewThread: () => void;
  /** Rail destinations. The returned focus target is the rail trigger, which stays visible at every width. */
  onNavigate: (destination: SidebarScreen, returnFocus: FocusReturnTarget) => void;
  /** The rail avatar: the settings screen on its account category. */
  onOpenAccount: (returnFocus: FocusReturnTarget) => void;
};
export type SidebarHistoryModel = {
  threadCount: number; threadGroups: SidebarThreadGroup[]; selectedThreadId?: string;
};
export type SidebarHistoryActions = {
  onSelectThread: (id: string) => void;
  onPinThread: (thread: ThreadSummary) => void;
  onRenameThread: (thread: ThreadSummary, returnFocus: FocusReturnTarget) => void;
  onExportThread: (thread: ThreadSummary) => void;
  onDeleteThread: (id: string) => void;
  loadCompareRuns?: () => Promise<CompareRun[]>;
  onOpenCompareRun?: (run: CompareRun, returnFocus: FocusReturnTarget) => void;
  loadMediaJobs?: () => Promise<PendingMediaJob[]>;
  onOpenMediaJob?: (job: PendingMediaJob) => void;
};
export type SidebarAccountModel = { credits?: CreditBalance; updateState: UpdateState | null };
export type SidebarProps = {
  workspace: SidebarWorkspaceModel; workspaceActions: SidebarWorkspaceActions;
  history: SidebarHistoryModel; historyActions: SidebarHistoryActions;
  account: SidebarAccountModel;
};

function useCompactSidebar() {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_SIDEBAR_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(COMPACT_SIDEBAR_QUERY);
    const changed = () => setCompact(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  return compact;
}

/**
 * App shell navigation: the always-visible rail plus the list column. The list column keeps the
 * `.sidebar` contract — a modal overlay sheet at the compact width, collapsible on desktop.
 */
export function Sidebar({ workspace, workspaceActions, history, historyActions, account }: SidebarProps) {
  const { open, screen } = workspace;
  const { onToggle, onNewThread, onNavigate, onOpenAccount } = workspaceActions;
  const compact = useCompactSidebar();
  const listVisible = LIST_SCREENS.has(screen);
  const [filter, setFilter] = useState<ListFilter>("all");
  const compactRef = useRef(compact);
  const openRef = useRef(open);
  compactRef.current = compact;
  openRef.current = open;
  const mobileOpenRef = useRef<HTMLButtonElement>(null);
  const lastFocusWasInSidebarRef = useRef(false);
  const previousCompactRef = useRef(compact);
  const previousOpenRef = useRef(open);
  const pendingFocusRef = useRef<"opener" | "toggle" | null>(null);
  const threadListRef = useRef<HTMLDivElement>(null);
  const { ref: sidebarRef, requestClose: closeSidebarLayer } = useFocusLayer<HTMLElement>({
    active: compact && open && listVisible, mode: "modal", onClose: onToggle, closeOnOutside: true, restoreTo: mobileOpenRef
  });
  useEffect(() => {
    const trackFocus = (event: FocusEvent) => {
      lastFocusWasInSidebarRef.current = event.target instanceof Node &&
        (Boolean(sidebarRef.current?.contains(event.target)) ||
          event.target instanceof Element && Boolean(event.target.closest("[data-sidebar-layer]")));
    };
    document.addEventListener("focusin", trackFocus);
    return () => document.removeEventListener("focusin", trackFocus);
  }, []);
  useEffect(() => {
    if (previousCompactRef.current !== compact) {
      if (compact && lastFocusWasInSidebarRef.current) pendingFocusRef.current = "opener";
      if (!compact && document.activeElement === mobileOpenRef.current) pendingFocusRef.current = "toggle";
      previousCompactRef.current = compact;
    } else if (!compact && previousOpenRef.current && !open && lastFocusWasInSidebarRef.current) {
      // Desktop collapse (toggle or Cmd/Ctrl+B) removes the focused list control; keep focus on the expand control.
      pendingFocusRef.current = "opener";
    }
    previousOpenRef.current = open;
    const pending = pendingFocusRef.current;
    if (pending === "opener" && !open) {
      pendingFocusRef.current = null;
      const frame = window.requestAnimationFrame(() => mobileOpenRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    if (pending === "toggle" && !compact && open) {
      pendingFocusRef.current = null;
      const frame = window.requestAnimationFrame(() =>
        sidebarRef.current?.querySelector<HTMLElement>(".sidebar-toggle:not([disabled])")?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
  }, [compact, open]);
  const currentRailItem = () => document.querySelector<HTMLElement>('nav.rail .rail-item[aria-current="page"]');
  // A screen without the list removes the list's controls: focus that was in them moves to the current rail item.
  const listVisibleRef = useRef(listVisible);
  useEffect(() => {
    if (listVisibleRef.current === listVisible) return;
    listVisibleRef.current = listVisible;
    if (listVisible || !lastFocusWasInSidebarRef.current) return;
    lastFocusWasInSidebarRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) currentRailItem()?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [listVisible]);
  // Focus fallbacks read live refs: a dialog launched on desktop may close after the window became compact.
  const visibleListControl: FocusReturnTarget = () => (compactRef.current || !openRef.current
    ? mobileOpenRef.current : sidebarRef.current?.querySelector<HTMLElement>(".sidebar-toggle") ?? null) ?? currentRailItem();
  const restoreAfterListCommand: FocusReturnTarget = () => compactRef.current ? mobileOpenRef.current
    : threadListRef.current?.isConnected ? threadListRef.current : visibleListControl();
  const closeSheetFirst = (restore: boolean) => {
    if (compact && open) closeSidebarLayer("programmatic", restore);
  };
  const runNavigation = (action: () => void, restore = true) => {
    closeSheetFirst(restore);
    action();
  };
  const runDialogNavigation = (action: (returnFocus: FocusReturnTarget) => void,
    returnFocus: FocusReturnTarget) => {
    closeSheetFirst(false);
    action(returnFocus);
  };
  const navigableHistoryActions: SidebarHistoryActions = {
    ...historyActions,
    onSelectThread: (id) => runNavigation(() => historyActions.onSelectThread(id)),
    onRenameThread: (item, returnFocus) => runDialogNavigation(
      (target) => historyActions.onRenameThread(item, target), returnFocus),
    onDeleteThread: (id) => runNavigation(() => historyActions.onDeleteThread(id), true),
    onOpenCompareRun: (run, returnFocus) => runDialogNavigation(
      (target) => historyActions.onOpenCompareRun?.(run, target), returnFocus),
    onOpenMediaJob: (job) => runNavigation(() => historyActions.onOpenMediaJob?.(job))
  };
  return <>
    {listVisible && compact && open && <div className="sidebar-overlay-backdrop" data-testid="sidebar-backdrop" aria-hidden="true"
      onPointerDown={(event) => { event.stopPropagation(); closeSidebarLayer("outside", true); }} />}
    <Rail screen={screen} compact={compact} listOpen={open} listAvailable={listVisible} openerRef={mobileOpenRef}
      onOpenList={() => { if (!compact) pendingFocusRef.current = "toggle"; onToggle(); }}
      onNavigate={(destination, returnFocus) => { closeSheetFirst(false); onNavigate(destination, returnFocus); }}
      onOpenAccount={(returnFocus) => runDialogNavigation(onOpenAccount, returnFocus)}
      account={account} />
    {listVisible && <aside className={open ? "sidebar" : "sidebar collapsed"} ref={sidebarRef}
      data-compact={compact ? "true" : "false"} aria-label="대화 목록 열"
      role={compact && open ? "dialog" : undefined} aria-modal={compact && open ? true : undefined}
      tabIndex={compact && open ? -1 : undefined}>
      {open && <ChatListColumn screen={screen} compact={compact} filter={filter} onFilterChange={setFilter}
        history={history} actions={navigableHistoryActions} credits={account.credits}
        onNewThread={() => runNavigation(onNewThread)}
        onClose={() => {
          if (compact) closeSidebarLayer("programmatic", true);
          else { pendingFocusRef.current = "opener"; onToggle(); }
        }}
        threadListRef={threadListRef} restoreAfterListCommand={restoreAfterListCommand} />}
    </aside>}
  </>;
}
