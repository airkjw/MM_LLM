import { useId, useRef, useState, type RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AudioLines, BookOpenText, Bot, ChevronUp, Columns3, Download, Folder, Image as ImageIcon, LogOut, Menu,
  MessageSquare, PanelLeftOpen, RefreshCw, Settings, ShieldCheck, UserRound
} from "lucide-react";
import type { CreditBalance } from "../../../shared/contracts";
import { creditBalancePresentation, creditPresentation } from "../../../shared/credit-usage";
import { useFocusLayer } from "../use-focus-layer";
import { formatCredit } from "./ChatListColumn";
import type {
  FocusReturnTarget, SidebarAccountActions, SidebarAccountModel, SidebarScreen
} from "./Sidebar";

type RailItem = { id: Exclude<SidebarScreen, "settings">; label: string; icon: LucideIcon };
export const RAIL_ITEMS: readonly RailItem[] = [
  { id: "chat", label: "대화", icon: MessageSquare },
  { id: "compare", label: "모델 비교", icon: Columns3 },
  { id: "research", label: "논문·법령 리서치", icon: BookOpenText },
  { id: "media", label: "미디어", icon: ImageIcon },
  { id: "voice", label: "음성", icon: AudioLines },
  { id: "projects", label: "프로젝트", icon: Folder },
  { id: "chatbot", label: "챗봇", icon: Bot }
];
/** Only these destinations are rendered screens in stage 2; the others still open their existing dialogs. */
const SCREEN_DESTINATIONS = new Set<SidebarScreen>(["chat", "media"]);

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

/** Temporary home of the account popover on the rail avatar until the settings screen replaces it. */
export function AccountMenu({ model, actions, restoreFallback, onBeforeOpen }: {
  model: SidebarAccountModel; actions: SidebarAccountActions; restoreFallback: FocusReturnTarget;
  onBeforeOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const { ref: popoverRef, requestClose } = useFocusLayer<HTMLDivElement>({
    active: open, mode: "nonmodal", onClose: () => setOpen(false), closeOnOutside: true,
    restoreTo: triggerRef, restoreFallback
  });
  const { credits, updateState } = model;
  const { remaining, empty, low, source } = creditBalancePresentation(credits);
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
  return <section className="rail-account" aria-label="계정 및 앱 관리">
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
        <small className="app-version">MM_LLM · v{updateState?.currentVersion ?? "확인 중"}</small>
        <button type="button" onClick={() => openDialog(actions.onOpenSettings)}><Settings size={16} /> 설정</button>
        <button type="button" onClick={() => openDialog(actions.onOpenKeyReplace)}><ShieldCheck size={16} /> API 키 교체</button>
        <button type="button" onClick={() => closeThen(actions.onRefreshModels)}><RefreshCw size={16} /> 모델 목록 새로고침</button>
        {updateState?.status !== "disabled" && <button type="button"
          className={updateState?.status === "ready" ? "update-ready" : ""} onClick={() => closeThen(actions.onUpdateAction)}
          disabled={updateState?.status === "checking" || updateState?.status === "downloading"}>
          {updateState?.status === "ready" ? <Download size={16} /> : <RefreshCw size={16} />}{updateText}
          {updateState?.status === "ready" && <span className="sr-only">새 업데이트를 설치할 수 있습니다.</span>}
        </button>}
        {updateState?.status === "error" && <span className="update-error"
          title={updateState.message}>업데이트 확인에 실패했습니다. 다시 시도해 주세요.</span>}
        <button type="button" className="logout-action" onClick={() => closeThen(actions.onLogout)}>
          <LogOut size={16} /> 로그아웃</button>
      </div>
    </div>}
    <button type="button" className={`account-trigger rail-avatar${empty ? " credit-empty" : low ? " credit-low" : ""}`}
      ref={triggerRef} aria-expanded={open} aria-haspopup="dialog" title="설정·계정"
      onClick={() => { if (open) requestClose("programmatic", false); else { onBeforeOpen?.(); setOpen(true); } }}
      aria-label={`설정·계정, ${remaining === undefined ? "크레딧 확인 전" : partialLabel
        ? `${partialLabel} 크레딧 ${formatCredit(remaining)}, 전체 잔액 미확인`
        : `남은 크레딧 ${formatCredit(remaining)}`}${statusText ? `, ${statusText}` : ""}${updateState?.status === "ready" ? ", 새 업데이트 준비됨" : ""}${updateState?.status === "error" ? ", 업데이트 오류" : ""}`}>
      <span className="rail-avatar-face" aria-hidden="true"><UserRound size={16} /></span>
      {updateState?.status === "ready" && <span className="rail-update-badge">업데이트</span>}
      {updateState?.status === "error" && <span className="rail-update-badge rail-update-error">오류</span>}
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

export type RailProps = {
  screen: SidebarScreen; compact: boolean; listOpen: boolean;
  openerRef: RefObject<HTMLButtonElement | null>; onOpenList: () => void;
  onNavigate: (destination: SidebarScreen, returnFocus: FocusReturnTarget) => void;
  account: SidebarAccountModel; accountActions: SidebarAccountActions;
  onBeforeAccountOpen: () => void; accountRestoreFallback: FocusReturnTarget;
};

export function Rail({ screen, compact, listOpen, openerRef, onOpenList, onNavigate, account, accountActions,
  onBeforeAccountOpen, accountRestoreFallback }: RailProps) {
  const currentItem = () => document.querySelector<HTMLElement>('nav.rail .rail-item[aria-current="page"]');
  const navigate = (destination: SidebarScreen, trigger: HTMLElement) =>
    onNavigate(destination, () => trigger.isConnected ? trigger : currentItem());
  const openerLabel = compact ? "사이드바 열기" : "사이드바 펼치기";
  return <nav className="rail" aria-label="주 탐색">
    <div className="rail-logo" aria-hidden="true">M</div>
    <button ref={openerRef} type="button" className={`sidebar-mobile-open icon-button${listOpen ? "" : " visible"}`}
      onClick={onOpenList} aria-label={openerLabel} title={openerLabel}>
      {compact ? <Menu size={18} /> : <PanelLeftOpen size={18} />}</button>
    {RAIL_ITEMS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className="rail-item" title={label}
      aria-current={SCREEN_DESTINATIONS.has(id) && screen === id ? "page" : undefined}
      onClick={(event) => navigate(id, event.currentTarget)}>
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" /><span className="sr-only">{label}</span></button>)}
    <span className="rail-spacer" />
    <button type="button" className="rail-item" title="앱 설정"
      onClick={(event) => navigate("settings", event.currentTarget)}>
      <Settings size={18} strokeWidth={1.75} aria-hidden="true" /><span className="sr-only">앱 설정</span></button>
    <AccountMenu model={account} actions={accountActions} restoreFallback={accountRestoreFallback}
      onBeforeOpen={onBeforeAccountOpen} />
  </nav>;
}
