import type { RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AudioLines, BookOpenText, Bot, Columns3, Folder, Image as ImageIcon, Menu, MessageSquare, PanelLeftOpen, Settings,
  UserRound
} from "lucide-react";
import { creditBalancePresentation } from "../../../shared/credit-usage";
import { formatCredit } from "./ChatListColumn";
import type { FocusReturnTarget, SidebarAccountModel, SidebarScreen } from "./Sidebar";

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

/**
 * The rail avatar (README): credit and update state in its label and a text badge, one polite live region for
 * update changes. It opens the settings screen on the account category; the Stage 2 popover is gone (risk 6).
 */
function RailAvatar({ model, onOpen }: { model: SidebarAccountModel; onOpen: (trigger: HTMLElement) => void }) {
  const { credits, updateState } = model;
  const { remaining, empty, low, source } = creditBalancePresentation(credits);
  const partialLabel = source === "monthly" ? "월 제공" : source === "purchased" ? "구매" : undefined;
  const statusText = partialLabel ? `${partialLabel}만 확인됨` : empty ? "잔액 없음" : low ? "잔액 10% 이하" : undefined;
  return <section className="rail-account" aria-label="계정 및 앱 관리">
    <button type="button" className={`account-trigger rail-avatar${empty ? " credit-empty" : low ? " credit-low" : ""}`}
      title="설정·계정" onClick={(event) => onOpen(event.currentTarget)}
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
  /** False on screens whose own column takes the list column's slot: no opener is offered for a hidden list. */
  listAvailable: boolean;
  openerRef: RefObject<HTMLButtonElement | null>; onOpenList: () => void;
  onNavigate: (destination: SidebarScreen, returnFocus: FocusReturnTarget) => void;
  onOpenAccount: (returnFocus: FocusReturnTarget) => void;
  account: SidebarAccountModel;
};

export function Rail({ screen, compact, listOpen, listAvailable, openerRef, onOpenList, onNavigate, onOpenAccount,
  account }: RailProps) {
  const currentItem = () => document.querySelector<HTMLElement>('nav.rail .rail-item[aria-current="page"]');
  const returnTo = (trigger: HTMLElement): FocusReturnTarget => () => trigger.isConnected ? trigger : currentItem();
  const navigate = (destination: SidebarScreen, trigger: HTMLElement) => onNavigate(destination, returnTo(trigger));
  const openerLabel = compact ? "사이드바 열기" : "사이드바 펼치기";
  return <nav className="rail" aria-label="주 탐색">
    <div className="rail-logo" aria-hidden="true">M</div>
    <button ref={openerRef} type="button" className={`sidebar-mobile-open icon-button${listAvailable && !listOpen ? " visible" : ""}`}
      onClick={onOpenList} aria-label={openerLabel} title={openerLabel}>
      {compact ? <Menu size={18} /> : <PanelLeftOpen size={18} />}</button>
    {RAIL_ITEMS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className="rail-item" title={label}
      aria-current={screen === id ? "page" : undefined}
      onClick={(event) => navigate(id, event.currentTarget)}>
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" /><span className="sr-only">{label}</span></button>)}
    <span className="rail-spacer" />
    <button type="button" className="rail-item" title="앱 설정" aria-current={screen === "settings" ? "page" : undefined}
      onClick={(event) => navigate("settings", event.currentTarget)}>
      <Settings size={18} strokeWidth={1.75} aria-hidden="true" /><span className="sr-only">앱 설정</span></button>
    <RailAvatar model={account} onOpen={(trigger) => onOpenAccount(returnTo(trigger))} />
  </nav>;
}
