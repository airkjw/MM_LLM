import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle, Bot, ChevronUp, Columns3, Download, Edit3, FolderOpen, LogOut, Menu, MoreHorizontal,
  Pin, PinOff, Plus, RefreshCw, Search, Settings, ShieldCheck, Sparkles, Trash2
} from "lucide-react";
import type { CreditBalance, ThreadSummary, UpdateState } from "../../../shared/contracts";
import { creditBalancePresentation, creditPresentation } from "../../../shared/credit-usage";
import { useFocusLayer } from "../use-focus-layer";
import { COMPACT_SIDEBAR_QUERY } from "../sidebar-responsive";

export type SidebarScreen = "chat" | "image" | "audio" | "video";
export type FocusReturnTarget = () => HTMLElement | null;
export type SidebarNavItem = { id: Exclude<SidebarScreen, "chat">; label: string; icon: LucideIcon };
export type SidebarThreadGroup = { label: string; items: ThreadSummary[] };
export type SidebarWorkspaceModel = {
  open: boolean; screen: SidebarScreen; navItems: readonly SidebarNavItem[]; projectCount: number;
};
export type SidebarWorkspaceActions = {
  onToggle: () => void; onNewThread: () => void; onOpenProjects: (returnFocus: FocusReturnTarget) => void;
  onOpenCompare: (returnFocus: FocusReturnTarget) => void; onOpenChatbot: (returnFocus: FocusReturnTarget) => void;
  onScreenChange: (screen: SidebarScreen) => void;
};
export type SidebarHistoryModel = {
  threadCount: number; threadGroups: SidebarThreadGroup[]; selectedThreadId?: string;
};
export type SidebarHistoryActions = {
  onOpenSearch: (returnFocus: FocusReturnTarget) => void; onSelectThread: (id: string) => void;
  onPinThread: (thread: ThreadSummary) => void;
  onRenameThread: (thread: ThreadSummary, returnFocus: FocusReturnTarget) => void;
  onExportThread: (thread: ThreadSummary) => void;
  onDeleteThread: (id: string) => void;
};
export type SidebarAccountModel = { credits?: CreditBalance; updateState: UpdateState | null };
export type SidebarAccountActions = {
  onRefreshCredits: () => void; onOpenKeyReplace: (returnFocus: FocusReturnTarget) => void;
  onRefreshModels: () => void; onOpenSettings: (returnFocus: FocusReturnTarget) => void;
  onUpdateAction: () => void; onLogout: () => void;
};
export type SidebarProps = {
  workspace: SidebarWorkspaceModel; workspaceActions: SidebarWorkspaceActions;
  history: SidebarHistoryModel; historyActions: SidebarHistoryActions;
  account: SidebarAccountModel; accountActions: SidebarAccountActions;
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

function formatCredit(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) : "-";
}
function CreditMeter({ label, bucket }: {
  label: string; bucket: CreditBalance["total"] | CreditBalance["monthly_allocated"] | CreditBalance["purchased"];
}) {
  const { quota, used, remaining, empty, low } = creditPresentation(bucket);
  const status = empty ? "empty" : low ? "low" : "normal";
  return <div className={`credit-meter credit-${status}`}>
    <span><b>{label}</b><strong>{formatCredit(remaining)}</strong></span>
    {quota !== undefined && remaining !== undefined && <progress
      aria-label={`${label} 남은 크레딧 ${formatCredit(remaining)}, 총 ${formatCredit(quota)}`}
      max={quota} value={Math.min(quota, remaining)} />}
    <small>{remaining === undefined ? "잔액 정보 없음" : remaining === 0 ? "잔액 없음"
      : status === "low" ? "잔액 10% 이하"
        : quota !== undefined && used !== undefined ? `사용 ${formatCredit(used)} / 총 ${formatCredit(quota)}`
          : quota !== undefined ? `총 ${formatCredit(quota)}` : "남은 잔액"}</small>
  </div>;
}

export function AccountMenu({ model, actions, restoreFallback }: {
  model: SidebarAccountModel; actions: SidebarAccountActions; restoreFallback: FocusReturnTarget;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const { ref: popoverRef, requestClose } = useFocusLayer<HTMLDivElement>({
    active: open, mode: "nonmodal", onClose: () => setOpen(false), closeOnOutside: true, restoreTo: triggerRef
  });
  const { credits, updateState } = model;
  const { quota, remaining, empty, low, source } = creditBalancePresentation(credits);
  const partialLabel = source === "monthly" ? "월 제공" : source === "purchased" ? "구매" : undefined;
  const statusText = partialLabel ? `${partialLabel}만 확인됨` : empty ? "잔액 없음" : low ? "잔액 10% 이하" : undefined;
  const returnFocus = () => triggerRef.current?.isConnected ? triggerRef.current : restoreFallback();
  const closeThen = (action: () => void, restore = true) => {
    requestClose("programmatic", restore); action();
  };
  const openDialog = (action: (returnTarget: FocusReturnTarget) => void) => {
    requestClose("programmatic", false); action(returnFocus);
  };
  const updateText = updateState?.status === "ready" ? `업데이트 설치 ${updateState.availableVersion ?? ""}`
    : updateState?.status === "downloading" ? `업데이트 다운로드 ${updateState.progress ?? 0}%`
      : updateState?.status === "checking" ? "업데이트 확인 중"
        : updateState?.status === "latest" ? `최신 버전 ${updateState.currentVersion}` : "업데이트 확인";
  return <section className="sidebar-account-area" aria-label="계정 및 앱 관리">
    {open && <div className="account-popover" role="dialog" aria-modal="false" aria-labelledby={titleId}
      ref={popoverRef} tabIndex={-1}>
      <div className="account-popover-heading"><strong id={titleId}>크레딧 상세 및 계정</strong>
        <button type="button" className="icon-button" onClick={() => requestClose("programmatic", true)} aria-label="계정 창 닫기">
          <ChevronUp size={16} /></button></div>
      <div className="account-credit-details">
        <CreditMeter label="전체" bucket={credits?.total} />
        <CreditMeter label="월 제공" bucket={credits?.monthly_allocated} />
        <CreditMeter label="구매" bucket={credits?.purchased} />
        {credits?.monthly_allocated?.renewal_date && <div className="credit-renewal">월 제공 크레딧 갱신 {new Date(
          credits.monthly_allocated.renewal_date).toLocaleDateString("ko-KR")}</div>}
        <button type="button" onClick={actions.onRefreshCredits}><RefreshCw size={16} /> 크레딧 새로고침</button>
      </div>
      <div className="account-actions">
        <button type="button" onClick={() => openDialog(actions.onOpenSettings)}><Settings size={16} /> 설정</button>
        <button type="button" onClick={() => openDialog(actions.onOpenKeyReplace)}><ShieldCheck size={16} /> API 키 교체</button>
        <button type="button" onClick={() => closeThen(actions.onRefreshModels)}><RefreshCw size={16} /> 모델 목록 새로고침</button>
        {updateState?.status !== "disabled" && <button type="button"
          className={updateState?.status === "ready" ? "update-ready" : ""} onClick={() => closeThen(actions.onUpdateAction)}
          disabled={updateState?.status === "checking" || updateState?.status === "downloading"}>
          {updateState?.status === "ready" ? <Download size={16} /> : <RefreshCw size={16} />}{updateText}
          {updateState?.status === "ready" && <span className="sr-only">새 업데이트를 설치할 수 있습니다.</span>}
        </button>}
        <div className="update-live">{
          updateState && ["checking", "downloading", "ready", "latest"].includes(updateState.status) ? updateText : ""
        }</div>
        {updateState?.status === "error" && <span className="update-error"
          title={updateState.message}>업데이트 확인에 실패했습니다. 다시 시도해 주세요.</span>}
        <button type="button" className="logout-action" onClick={() => closeThen(actions.onLogout)}>
          <LogOut size={16} /> 로그아웃</button>
      </div>
    </div>}
    <button type="button" className={`account-trigger${empty ? " credit-empty" : low ? " credit-low" : ""}`}
      ref={triggerRef} aria-expanded={open} aria-haspopup="dialog"
      onClick={() => open ? requestClose("programmatic", false) : setOpen(true)}
      aria-label={`설정·계정, ${remaining === undefined ? "크레딧 확인 전" : partialLabel
        ? `${partialLabel} 크레딧 ${formatCredit(remaining)}, 전체 잔액 미확인`
        : `남은 크레딧 ${formatCredit(remaining)}`}${statusText ? `, ${statusText}` : ""}${updateState?.status === "ready" ? ", 새 업데이트 준비됨" : ""}${updateState?.status === "error" ? ", 업데이트 오류" : ""}`}>
      <span className="account-trigger-label"><Settings size={18} />설정·계정
        {updateState?.status === "ready" && <span className="update-status-cue update-ready-cue"><Download size={12} />새 버전</span>}
        {updateState?.status === "error" && <span className="update-status-cue update-error-cue"><AlertCircle size={12} />확인 오류</span>}</span>
      <span className="account-credit-summary"><span>{partialLabel ?? "크레딧"}</span><strong>{empty ? "잔액 없음" : formatCredit(remaining)}</strong>
        {partialLabel ? <small>전체 미확인</small> : low && <small>10% 이하</small>}</span>
      {quota !== undefined && remaining !== undefined && <progress aria-label="전체 남은 크레딧"
        max={quota} value={Math.min(quota, remaining)} />}
    </button>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="update-status-live">
      {updateState?.status === "ready" ? `새 업데이트 ${updateState.availableVersion ?? ""} 설치 준비됨`.replace(/\s+/g, " ").trim()
        : updateState?.status === "error" ? "업데이트 확인에 실패했습니다. 다시 시도해 주세요."
          : updateState?.status === "checking" ? "업데이트 확인 중"
            : updateState?.status === "downloading" ? `업데이트 다운로드 ${updateState.progress ?? 0}%`
              : updateState?.status === "latest" ? `최신 버전 ${updateState.currentVersion}` : ""}
    </span>
  </section>;
}

function ThreadActions({ item, actions, restoreFallback, compact }: {
  item: ThreadSummary; actions: SidebarHistoryActions; restoreFallback: FocusReturnTarget; compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { ref: layerRef, requestClose } = useFocusLayer<HTMLDivElement>({
    active: open, mode: "menu", onClose: () => setOpen(false), closeOnOutside: true,
    restoreTo: triggerRef, restoreFallback
  });
  const returnFocus = () => triggerRef.current?.isConnected ? triggerRef.current : restoreFallback();
  const run = (action: () => void) => { requestClose("programmatic", true); action(); };
  const openDialog = (action: (returnTarget: FocusReturnTarget) => void) => {
    requestClose("programmatic", false); action(returnFocus);
  };
  const toggle = () => {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPosition({
        top: rect.bottom + 164 <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - 164),
        left: Math.max(8, rect.right - 188)
      });
    }
    if (open) requestClose("programmatic", true); else setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const close = () => requestClose("programmatic", true);
    const scrollElement = triggerRef.current?.closest(".thread-list");
    window.addEventListener("resize", close);
    scrollElement?.addEventListener("scroll", close);
    return () => {
      window.removeEventListener("resize", close);
      scrollElement?.removeEventListener("scroll", close);
    };
  }, [open, requestClose]);
  const menu = open ? <div className="thread-action-popover" data-sidebar-layer="thread-actions"
    role="menu" aria-label={`${item.title} 대화 작업`}
    ref={layerRef} tabIndex={-1} style={position}>
    <button type="button" role="menuitem" tabIndex={0} onClick={() => run(() => actions.onPinThread(item))}>
      {item.pinned ? <PinOff size={15} /> : <Pin size={15} />}{item.pinned ? "고정 해제" : "고정"}</button>
    <button type="button" role="menuitem" tabIndex={-1} onClick={() => openDialog((target) => actions.onRenameThread(item, target))}><Edit3 size={15} />이름 변경</button>
    <button type="button" role="menuitem" tabIndex={-1} onClick={() => run(() => actions.onExportThread(item))}><Download size={15} />Markdown 내보내기</button>
    <button type="button" role="menuitem" tabIndex={-1} className="thread-delete" onClick={() => run(() => actions.onDeleteThread(item.id))}>
      <Trash2 size={15} />대화 삭제</button>
  </div> : null;
  return <div className="thread-action-area">
    <button ref={triggerRef} type="button" className="thread-more" aria-haspopup="menu" aria-expanded={open}
      aria-label={`${item.title} 대화 작업`} title="대화 작업" onClick={toggle}>
      <MoreHorizontal size={17} /></button>
    {compact ? menu : menu && createPortal(menu, document.body)}
  </div>;
}

export function Sidebar({ workspace, workspaceActions, history, historyActions, account, accountActions }: SidebarProps) {
  const { open, screen, navItems, projectCount } = workspace;
  const { onToggle, onNewThread, onOpenProjects, onOpenCompare, onOpenChatbot, onScreenChange } = workspaceActions;
  const { threadCount, threadGroups, selectedThreadId } = history;
  const compact = useCompactSidebar();
  const mobileOpenRef = useRef<HTMLButtonElement>(null);
  const lastFocusWasInSidebarRef = useRef(false);
  const previousCompactRef = useRef(compact);
  const pendingViewportFocusRef = useRef<"mobile" | "desktop" | null>(null);
  const projectsTriggerRef = useRef<HTMLButtonElement>(null);
  const compareTriggerRef = useRef<HTMLButtonElement>(null);
  const chatbotTriggerRef = useRef<HTMLButtonElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const threadListRef = useRef<HTMLDivElement>(null);
  const { ref: sidebarRef, requestClose: closeSidebarLayer } = useFocusLayer<HTMLElement>({
    active: compact && open, mode: "modal", onClose: onToggle, closeOnOutside: true, restoreTo: mobileOpenRef
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
    const previousCompact = previousCompactRef.current;
    if (previousCompact !== compact) {
      if (compact && lastFocusWasInSidebarRef.current) pendingViewportFocusRef.current = "mobile";
      if (!compact && document.activeElement === mobileOpenRef.current) pendingViewportFocusRef.current = "desktop";
      previousCompactRef.current = compact;
    }
    const pending = pendingViewportFocusRef.current;
    if (pending === "mobile" && compact && !open) {
      pendingViewportFocusRef.current = null;
      const frame = window.requestAnimationFrame(() => mobileOpenRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    if (pending === "desktop" && !compact && open) {
      pendingViewportFocusRef.current = null;
      const frame = window.requestAnimationFrame(() =>
        sidebarRef.current?.querySelector<HTMLElement>(".sidebar-toggle:not([disabled])")?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
  }, [compact, open]);
  const restoreAfterCompactClose = () => mobileOpenRef.current;
  const restoreAfterThreadCommand = () => compact ? mobileOpenRef.current : threadListRef.current;
  const returnTo = (source: { current: HTMLElement | null }): FocusReturnTarget => () =>
    source.current?.isConnected ? source.current : restoreAfterCompactClose();
  const runNavigation = (action: () => void, restore = true) => {
    if (compact && open) closeSidebarLayer("programmatic", restore);
    action();
  };
  const runDialogNavigation = (action: (returnFocus: FocusReturnTarget) => void,
    returnFocus: FocusReturnTarget) => {
    if (compact && open) closeSidebarLayer("programmatic", false);
    action(returnFocus);
  };
  const navigableHistoryActions: SidebarHistoryActions = {
    onOpenSearch: (returnFocus) => runDialogNavigation(historyActions.onOpenSearch, returnFocus),
    onSelectThread: (id) => runNavigation(() => historyActions.onSelectThread(id)),
    onPinThread: (item) => runNavigation(() => historyActions.onPinThread(item), true),
    onRenameThread: (item, returnFocus) => runDialogNavigation(
      (target) => historyActions.onRenameThread(item, target), returnFocus),
    onExportThread: (item) => runNavigation(() => historyActions.onExportThread(item), true),
    onDeleteThread: (id) => runNavigation(() => historyActions.onDeleteThread(id), true)
  };
  const navigableAccountActions: SidebarAccountActions = {
    onRefreshCredits: accountActions.onRefreshCredits,
    onOpenKeyReplace: (returnFocus) => runDialogNavigation(accountActions.onOpenKeyReplace, returnFocus),
    onRefreshModels: () => runNavigation(accountActions.onRefreshModels, true),
    onOpenSettings: (returnFocus) => runDialogNavigation(accountActions.onOpenSettings, returnFocus),
    onUpdateAction: () => runNavigation(accountActions.onUpdateAction, true),
    onLogout: () => runNavigation(accountActions.onLogout, false)
  };
  return <>
    {compact && open && <div className="sidebar-overlay-backdrop" data-testid="sidebar-backdrop" aria-hidden="true"
      onPointerDown={(event) => { event.stopPropagation(); closeSidebarLayer("outside", true); }} />}
    <button ref={mobileOpenRef} type="button" className={`sidebar-mobile-open icon-button${open ? "" : " visible"}`}
      onClick={onToggle} aria-label="사이드바 열기" title="사이드바 열기"><Menu size={19} /></button>
    <aside className={open ? "sidebar" : "sidebar collapsed"} ref={sidebarRef}
      data-compact={compact ? "true" : "false"}
      role={compact && open ? "dialog" : undefined} aria-modal={compact && open ? true : undefined}
      aria-label={compact && open ? "주 메뉴" : undefined} tabIndex={compact && open ? -1 : undefined}>
      <div className="sidebar-top"><div className="brand"><span className="brand-mark"><Sparkles size={19} /></span>
        <strong>MM<span className="brand-underscore">_</span>LLM</strong></div>
        <button type="button" className="icon-button sidebar-toggle"
          onClick={() => compact && open ? closeSidebarLayer("programmatic", true) : onToggle()}
          aria-label={open ? "사이드바 닫기" : "사이드바 펼치기"} title={open ? "사이드바 닫기" : "사이드바 펼치기"}>
          <Menu size={18} /></button></div>
      {open && <>
        <div className="sidebar-fixed-content">
          <button type="button" className="new-chat-button" onClick={() => runNavigation(onNewThread)}><Plus size={18} /> 새 대화</button>
          <button ref={projectsTriggerRef} type="button" className="project-button"
            onClick={() => runDialogNavigation(onOpenProjects, returnTo(projectsTriggerRef))}>
            <FolderOpen size={18} /> 프로젝트 <small>{projectCount}</small></button>
          <button ref={compareTriggerRef} type="button" className="workspace-link"
            onClick={() => runDialogNavigation(onOpenCompare, returnTo(compareTriggerRef))}><Columns3 size={18} /> 모델 비교</button>
          <button ref={chatbotTriggerRef} type="button" className="workspace-link"
            onClick={() => runDialogNavigation(onOpenChatbot, returnTo(chatbotTriggerRef))}><Bot size={18} /> 챗봇</button>
          <div className="sidebar-section-label">만들기</div>
          <nav className="creation-tiles" aria-label="미디어 만들기">{navItems.map(({ id, label, icon: Icon }) =>
            <button type="button" key={id} className={screen === id ? "creation-tile active" : "creation-tile"}
              onClick={() => runNavigation(() => onScreenChange(id))}><Icon size={18} /><span>{label}</span></button>)}</nav>
          <div className="sidebar-section-label history-title"><span>대화 <b>{threadCount}</b></span>
            <button ref={searchTriggerRef} type="button" className="history-search"
              onClick={() => runDialogNavigation(historyActions.onOpenSearch, returnTo(searchTriggerRef))}
              aria-label="대화 검색 (⌘/Ctrl+K)" title="대화 검색 (⌘/Ctrl+K)"><Search size={16} /></button></div>
        </div>
        <div className="thread-list" ref={threadListRef} tabIndex={0} aria-label="대화 목록">{threadGroups.map((group) =>
          <section className="thread-group" key={group.label} aria-label={group.label}>
            <div className="thread-group-label">{group.label}</div>
            {group.items.map((item) => <div
              className={selectedThreadId === item.id && screen === "chat" ? "thread-item selected" : "thread-item"}
              key={item.id}>
              <button type="button" className="thread-select" onClick={() => runNavigation(() => historyActions.onSelectThread(item.id))}
                title={item.title}><span>{item.title}</span></button>
              <ThreadActions item={item} actions={navigableHistoryActions} restoreFallback={restoreAfterThreadCommand}
                compact={compact} />
            </div>)}
          </section>)}</div>
        <AccountMenu model={account} actions={navigableAccountActions} restoreFallback={restoreAfterCompactClose} />
      </>}
    </aside>
  </>;
}
