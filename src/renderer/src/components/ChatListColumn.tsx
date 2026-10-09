import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Download, Edit3, MoreHorizontal, PanelLeftClose, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import type { CompareRun, CreditBalance, PendingMediaJob, ThreadSummary } from "../../../shared/contracts";
import { creditBalancePresentation } from "../../../shared/credit-usage";
import { useFocusLayer } from "../use-focus-layer";
import type { FocusReturnTarget, SidebarHistoryActions, SidebarHistoryModel, SidebarScreen } from "./Sidebar";

export type ListFilter = "all" | "pinned" | "compare" | "media";
const FILTERS: ReadonlyArray<readonly [ListFilter, string]> = [
  ["all", "전체"], ["pinned", "고정"], ["compare", "비교"], ["media", "미디어"]
];

export function formatCredit(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) : "-";
}

/** Compact mono metadata such as `now`, `2m`, `1h`, `6d`; an unreadable date yields no time. */
export function relativeTime(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const minutes = Math.floor(Math.max(0, now - time) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function metaLine(...parts: string[]) {
  return parts.filter(Boolean).join(" · ");
}

function ThreadActions({ item, actions, restoreFallback, compact }: {
  item: ThreadSummary; actions: SidebarHistoryActions; restoreFallback: FocusReturnTarget; compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
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
    if (open) requestClose("programmatic", true);
    else { setPosition(null); setOpen(true); }
  };
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !layerRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const menu = layerRef.current.getBoundingClientRect();
    const margin = 8; const gap = 4;
    const top = window.innerHeight - trigger.bottom - gap >= menu.height
      ? trigger.bottom + gap : Math.max(margin, trigger.top - menu.height - gap);
    const left = Math.min(Math.max(margin, trigger.right - menu.width),
      Math.max(margin, window.innerWidth - menu.width - margin));
    setPosition({ top, left });
  }, [open, layerRef]);
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
    ref={layerRef} tabIndex={-1} style={position ?? { top: 0, left: 0, visibility: "hidden" }}>
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

/** Bottom-pinned summary. Numbers come only from the gateway; a ratio needs both quota and remaining. */
function CreditCard({ credits }: { credits?: CreditBalance }) {
  const { quota, remaining, empty, low, source } = creditBalancePresentation(credits);
  const partialLabel = source === "monthly" ? "월 제공" : source === "purchased" ? "구매" : undefined;
  const ratio = quota !== undefined && remaining !== undefined;
  const status = remaining === undefined ? "잔액 정보 없음" : partialLabel ? "전체 미확인"
    : empty ? "잔액 없음" : low ? "잔액 10% 이하" : undefined;
  const renewal = credits?.monthly_allocated?.renewal_date;
  return <section className={`credit-card${empty ? " credit-empty" : low ? " credit-low" : ""}`} aria-label="크레딧">
    <div className="credit-card-row">
      <span className="credit-card-label">{partialLabel ? `${partialLabel} 크레딧` : "크레딧"}</span>
      {remaining !== undefined && <span className="credit-card-value"><strong>{formatCredit(remaining)}</strong>
        {ratio && <small> / {formatCredit(quota)}</small>}</span>}
    </div>
    {ratio && <progress className="credit-card-bar" max={quota} value={Math.min(quota, remaining)}
      aria-label={`남은 크레딧 ${formatCredit(remaining)}, 총 ${formatCredit(quota)}`} />}
    {status && <small className="credit-card-status">{status}</small>}
    {renewal && <p className="credit-renewal">월 제공 크레딧 갱신 {new Date(renewal).toLocaleDateString("ko-KR")}</p>}
  </section>;
}

type RemoteList = {
  filter: "compare" | "media"; status: "loading" | "error" | "ready"; runs: CompareRun[]; jobs: PendingMediaJob[];
};

export type ChatListColumnProps = {
  screen: SidebarScreen; compact: boolean; filter: ListFilter; onFilterChange: (filter: ListFilter) => void;
  history: SidebarHistoryModel; actions: SidebarHistoryActions; credits?: CreditBalance;
  onNewThread: () => void; onClose: () => void;
  threadListRef: RefObject<HTMLDivElement | null>; restoreAfterListCommand: FocusReturnTarget;
};

export function ChatListColumn({ screen, compact, filter, onFilterChange, history, actions, credits,
  onNewThread, onClose, threadListRef, restoreAfterListCommand }: ChatListColumnProps) {
  const { threadCount, threadGroups, selectedThreadId } = history;
  const [remote, setRemote] = useState<RemoteList | null>(null);
  // Loaders are read through a ref so a parent re-render does not refetch; only a filter change does.
  const loadersRef = useRef(actions);
  loadersRef.current = actions;
  useEffect(() => {
    const { loadCompareRuns, loadMediaJobs } = loadersRef.current;
    if (filter !== "compare" && filter !== "media") { setRemote(null); return; }
    let cancelled = false;
    const blank: RemoteList = { filter, status: "loading", runs: [], jobs: [] };
    setRemote(blank);
    const settle = (next: Partial<RemoteList>) => { if (!cancelled) setRemote({ ...blank, ...next }); };
    const failed = () => settle({ status: "error" });
    if (filter === "compare") {
      if (!loadCompareRuns) failed();
      else loadCompareRuns().then((runs) => settle({ status: "ready", runs }), failed);
    } else if (!loadMediaJobs) failed();
    else loadMediaJobs().then((jobs) => settle({ status: "ready", jobs }), failed);
    return () => { cancelled = true; };
  }, [filter]);
  const groups = filter === "pinned"
    ? threadGroups.map((group) => ({ ...group, items: group.items.filter((item) => item.pinned) }))
      .filter((group) => group.items.length)
    : threadGroups;
  const rowReturn = (trigger: HTMLElement): FocusReturnTarget => () =>
    trigger.isConnected ? trigger : restoreAfterListCommand();
  const empty = (text: string) => <p className="list-empty">{text}</p>;
  return <>
    <div className="list-header">
      <h2 className="list-title">대화 <span className="sr-only">{threadCount}개</span></h2>
      <div className="list-header-actions">
        <button type="button" className="icon-button new-chat-button" onClick={onNewThread}
          aria-label="새 대화" title="새 대화 (⌘/Ctrl+N)"><Plus size={17} /></button>
        <button type="button" className="icon-button sidebar-toggle" onClick={onClose}
          aria-label="사이드바 닫기" title="사이드바 닫기 (⌘/Ctrl+B)"><PanelLeftClose size={17} /></button>
      </div>
    </div>
    <div className="list-filters" role="group" aria-label="목록 필터">{FILTERS.map(([id, label]) =>
      <button type="button" key={id} className="filter-chip" aria-pressed={filter === id}
        onClick={() => onFilterChange(id)}>{label}</button>)}</div>
    {filter === "all" || filter === "pinned"
      ? <div className="thread-list" ref={threadListRef} tabIndex={0} aria-label="대화 목록">
        {groups.length ? groups.map((group) =>
          <section className="thread-group" key={group.label} aria-label={group.label}>
            <div className="thread-group-label">{group.label}</div>
            {group.items.map((item) => <div
              className={selectedThreadId === item.id && screen === "chat" ? "thread-item selected" : "thread-item"}
              key={item.id}>
              <button type="button" className="thread-select" onClick={() => actions.onSelectThread(item.id)}
                title={item.title}><span className="thread-title">{item.title}</span>
                <span className="thread-meta">{metaLine(item.modelId, relativeTime(item.updatedAt))}</span></button>
              <ThreadActions item={item} actions={actions} restoreFallback={restoreAfterListCommand} compact={compact} />
            </div>)}
          </section>) : empty(filter === "pinned" ? "고정한 대화가 없습니다." : "아직 대화가 없습니다.")}
      </div>
      : <div className="thread-list" ref={threadListRef} tabIndex={0}
        aria-label={filter === "compare" ? "비교 기록" : "미디어 작업"} aria-busy={remote?.status === "loading"}>
        {!remote || remote.status === "loading" ? empty("불러오는 중…")
          : remote.status === "error" ? empty("목록을 불러오지 못했습니다.")
            : remote.filter === "compare" ? remote.runs.length ? remote.runs.map((run) =>
              <button type="button" key={run.id} className="list-row compare-run-row" title={run.prompt}
                onClick={(event) => actions.onOpenCompareRun?.(run, rowReturn(event.currentTarget))}>
                <span className="thread-title">{run.prompt || "질문 없는 비교"}</span>
                <span className="thread-meta">{metaLine(`${run.modelIds.length} models`, relativeTime(run.createdAt))}</span>
              </button>) : empty("저장된 비교가 없습니다.")
              : remote.jobs.length ? remote.jobs.map((job) =>
                <button type="button" key={job.id} className="list-row media-job-row" title={job.label}
                  onClick={() => actions.onOpenMediaJob?.(job)}>
                  <span className="thread-title">{job.label}</span>
                  <span className="thread-meta">{metaLine(job.modelId, relativeTime(job.updatedAt))}</span>
                </button>) : empty("추적 중인 미디어 작업이 없습니다.")}
      </div>}
    <CreditCard credits={credits} />
  </>;
}
