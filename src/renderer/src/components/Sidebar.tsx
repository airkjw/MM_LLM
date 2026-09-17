import type { LucideIcon } from "lucide-react";
import {
  Bot, Columns3, Download, Edit3, FolderOpen, LogOut, Menu, MessageCircle, Pin, PinOff,
  Plus, RefreshCw, Search, Settings, ShieldCheck, Sparkles, Trash2
} from "lucide-react";
import type { CreditBalance, ThreadSummary, UpdateState } from "../../../shared/contracts";

export type SidebarScreen = "chat" | "image" | "audio" | "video";

export type SidebarNavItem = {
  id: SidebarScreen;
  label: string;
  icon: LucideIcon;
  count: number;
};

export type SidebarThreadGroup = {
  label: string;
  items: ThreadSummary[];
};

export type SidebarWorkspaceModel = {
  open: boolean;
  screen: SidebarScreen;
  navItems: readonly SidebarNavItem[];
  projectCount: number;
};

export type SidebarWorkspaceActions = {
  onToggle: () => void;
  onNewThread: () => void;
  onOpenProjects: () => void;
  onOpenCompare: () => void;
  onOpenChatbot: () => void;
  onScreenChange: (screen: SidebarScreen) => void;
};

export type SidebarHistoryModel = {
  threadCount: number;
  threadGroups: SidebarThreadGroup[];
  selectedThreadId?: string;
};

export type SidebarHistoryActions = {
  onOpenSearch: () => void;
  onSelectThread: (id: string) => void;
  onPinThread: (thread: ThreadSummary) => void;
  onRenameThread: (thread: ThreadSummary) => void;
  onExportThread: (thread: ThreadSummary) => void;
  onDeleteThread: (id: string) => void;
};

export type SidebarAccountModel = {
  credits?: CreditBalance;
  updateState: UpdateState | null;
};

export type SidebarAccountActions = {
  onRefreshCredits: () => void;
  onOpenKeyReplace: () => void;
  onRefreshModels: () => void;
  onOpenSettings: () => void;
  onUpdateAction: () => void;
  onLogout: () => void;
};

export type SidebarProps = {
  workspace: SidebarWorkspaceModel;
  workspaceActions: SidebarWorkspaceActions;
  history: SidebarHistoryModel;
  historyActions: SidebarHistoryActions;
  account: SidebarAccountModel;
  accountActions: SidebarAccountActions;
};

function formatCredit(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) : "-";
}

function CreditMeter({
  label, bucket
}: {
  label: string;
  bucket: CreditBalance["total"] | CreditBalance["monthly_allocated"] | CreditBalance["purchased"];
}) {
  const derivedQuota = typeof bucket?.quota === "number" ? bucket.quota
    : typeof bucket?.used === "number" && typeof bucket?.remaining === "number"
      ? bucket.used + bucket.remaining : undefined;
  const max = derivedQuota && derivedQuota > 0 ? derivedQuota : 1;
  const remaining = typeof bucket?.remaining === "number"
    ? Math.max(0, Math.min(max, bucket.remaining)) : 0;
  return <div className="credit-meter">
    <span><b>{label}</b><strong>{formatCredit(bucket?.remaining)}</strong></span>
    <progress aria-label={`${label} 남은 크레딧`} max={max} value={remaining} />
    <small>{typeof derivedQuota === "number"
      ? `사용 ${formatCredit(bucket?.used)} / 총 ${formatCredit(derivedQuota)}`
      : "API에서 잔액 정보를 확인합니다."}</small>
  </div>;
}

/** Owns the whole account surface so U3 can replace its presentation with a popover without reshaping Sidebar. */
export function AccountMenu({ model, actions }: {
  model: SidebarAccountModel;
  actions: SidebarAccountActions;
}) {
  const { credits, updateState } = model;
  const { onRefreshCredits, onOpenKeyReplace, onRefreshModels, onOpenSettings, onUpdateAction, onLogout } = actions;
  return <section className="sidebar-account-area" aria-label="계정 및 앱 관리">
    <div className="credit-card">
      <div className="credit-card-title"><span className="credit-indicator" />크레딧</div>
      <CreditMeter label="전체" bucket={credits?.total} />
      <CreditMeter label="월 제공" bucket={credits?.monthly_allocated} />
      <CreditMeter label="구매" bucket={credits?.purchased} />
      {credits?.monthly_allocated?.renewal_date && <div className="credit-renewal">
        월 제공 크레딧 갱신 {new Date(credits.monthly_allocated.renewal_date).toLocaleDateString("ko-KR")}
      </div>}
      <button type="button" onClick={onRefreshCredits}
        aria-label="크레딧 새로고침" title="크레딧 자동 갱신 · 지금 새로고침"><RefreshCw size={14} /></button>
    </div>
    <div className="sidebar-bottom">
      <button type="button" onClick={onOpenKeyReplace}>
        <ShieldCheck size={16} /> API 키 교체</button>
      <button type="button" onClick={onRefreshModels}><RefreshCw size={16} /> 모델 목록 새로고침</button>
      <button type="button" onClick={onOpenSettings}><Settings size={16} /> 설정</button>
      {updateState?.status !== "disabled" && <button type="button"
        className={updateState?.status === "ready" ? "update-ready" : ""}
        onClick={onUpdateAction}
        disabled={updateState?.status === "checking" || updateState?.status === "downloading"}>
        {updateState?.status === "ready" ? <Download size={16} /> : <RefreshCw size={16} />}
        {updateState?.status === "ready"
          ? `업데이트 설치 ${updateState.availableVersion ?? ""}`
          : updateState?.status === "downloading"
            ? `업데이트 다운로드 ${updateState.progress ?? 0}%`
            : updateState?.status === "checking" ? "업데이트 확인 중"
              : updateState?.status === "latest" ? `최신 버전 ${updateState.currentVersion}`
                : "업데이트 확인"}
      </button>}
      {updateState?.status === "error" && <span className="update-error" title={updateState.message}>
        업데이트 확인에 실패했습니다. 다시 시도해 주세요.</span>}
      <button type="button" onClick={onLogout}><LogOut size={16} /> 로그아웃</button>
    </div>
  </section>;
}

export function Sidebar({
  workspace, workspaceActions, history, historyActions, account, accountActions
}: SidebarProps) {
  const { open, screen, navItems, projectCount } = workspace;
  const { onToggle, onNewThread, onOpenProjects, onOpenCompare, onOpenChatbot, onScreenChange } = workspaceActions;
  const { threadCount, threadGroups, selectedThreadId } = history;
  const { onOpenSearch, onSelectThread, onPinThread, onRenameThread, onExportThread, onDeleteThread } = historyActions;
  return <aside className={open ? "sidebar" : "sidebar collapsed"}>
    <div className="sidebar-top"><div className="brand"><span className="brand-mark"><Sparkles size={20} /></span>
      <strong>MM<span className="brand-underscore">_</span>LLM</strong></div>
      <button type="button" className="icon-button sidebar-toggle" onClick={onToggle}
        aria-label={open ? "사이드바 접기" : "사이드바 펼치기"}
        title={open ? "사이드바 접기" : "사이드바 펼치기"}><Menu size={18} /></button></div>
    {open && <>
      <div className="sidebar-caption">Medical MBA의 AI 공간</div>
      <button type="button" className="new-chat-button" onClick={onNewThread}><Plus size={17} /> 새 대화</button>
      <button type="button" className="project-button" onClick={onOpenProjects}>
        <FolderOpen size={16} /> 프로젝트 <small>{projectCount}</small>
      </button>
      <div className="workspace-tools-row">
        <button type="button" onClick={onOpenCompare}><Columns3 size={15} /> 모델 비교</button>
        <button type="button" onClick={onOpenChatbot}><Bot size={15} /> 챗봇</button>
      </div>
      <div className="sidebar-section-label">워크스페이스</div>
      <nav className="nav-list">{navItems.map(({ id, label, icon: Icon, count }) =>
        <button type="button" key={id} className={screen === id ? "nav-item active" : "nav-item"}
          onClick={() => onScreenChange(id)}><Icon size={18} /><span>{label}</span>
          <small title={`현재 API 키로 사용 가능한 ${label} 모델 ${count}개`}>{count}개</small></button>)}</nav>
      <div className="sidebar-section-label history-title">대화 <span>{threadCount}</span>
        <button type="button" className="history-search" onClick={onOpenSearch}
          aria-label="대화 검색" title="대화 검색 (⌘/Ctrl+K)"><Search size={14} /></button></div>
      <div className="thread-list">{threadGroups.map((group) => <section className="thread-group" key={group.label}>
        <div className="thread-group-label">{group.label}</div>
        {group.items.map((item) =>
          <div className={selectedThreadId === item.id && screen === "chat" ? "thread-item selected" : "thread-item"}
            key={item.id}>
            <button type="button" onClick={() => onSelectThread(item.id)} title={item.title}>
              {item.pinned ? <Pin size={14} /> : <MessageCircle size={15} />}<span>{item.title}</span></button>
            <div className="thread-tools">
              <button type="button" aria-label={item.pinned ? "고정 해제" : "고정"} title={item.pinned ? "고정 해제" : "고정"}
                onClick={() => onPinThread(item)}>{item.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
              <button type="button" aria-label="이름 변경" title="이름 변경"
                onClick={() => onRenameThread(item)}><Edit3 size={13} /></button>
              <button type="button" aria-label="Markdown 내보내기" title="Markdown 내보내기"
                onClick={() => onExportThread(item)}><Download size={13} /></button>
              <button type="button" aria-label="삭제" title="삭제" onClick={() => onDeleteThread(item.id)}>
                <Trash2 size={13} /></button>
            </div>
          </div>)}</section>)}</div>
      <div className="sidebar-spacer" />
      <AccountMenu model={account} actions={accountActions} />
    </>}
  </aside>;
}
