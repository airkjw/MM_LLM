import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Archive, CircleHelp, Download, Gauge, KeyRound, LogOut, MessageSquareText, RefreshCw, ShieldCheck, SlidersHorizontal,
  Stethoscope, Sun
} from "lucide-react";
import type { AppSettings, CreditBalance, UpdateState } from "../../shared/contracts";
import { creditPresentation } from "../../shared/credit-usage";
import { BackupPanel } from "./components/BackupPanel";
import { formatCredit } from "./components/ChatListColumn";
import { DiagnosticButton } from "./components/DiagnosticButton";
import type { FocusReturnTarget } from "./components/Sidebar";

export type SettingsCategory = "general" | "display" | "response" | "account" | "credits" | "backup" | "diagnostics";
type CategoryEntry = { id: SettingsCategory; label: string; icon: LucideIcon; description: string };
/** Contract D4.1: "응답 기본값" and "기본 지침" are one category (one setting); no empty category is shown. */
const CATEGORIES: readonly CategoryEntry[] = [
  { id: "general", label: "일반", icon: SlidersHorizontal, description: "앱 정보와 업데이트, 모델 목록을 관리합니다." },
  { id: "display", label: "화면", icon: Sun, description: "테마, 글자 크기, 움직임을 설정합니다. 변경은 바로 적용됩니다." },
  { id: "response", label: "응답 기본값", icon: MessageSquareText, description: "모든 대화에 먼저 적용되는 기본 지침입니다." },
  { id: "account", label: "계정 · API 키", icon: KeyRound, description: "이 기기에 연결된 ChatKHU API 키를 관리합니다." },
  { id: "credits", label: "크레딧", icon: Gauge, description: "Gateway가 알려준 크레딧 잔액입니다." },
  { id: "backup", label: "백업 · 복원", icon: Archive, description: "대화와 프로젝트를 암호화해 다른 컴퓨터로 옮깁니다." },
  { id: "diagnostics", label: "진단", icon: Stethoscope, description: "문제를 알릴 때 붙여 넣을 진단 정보를 복사합니다." }
];
const ACCOUNT_GROUP_START: SettingsCategory = "account";

/** Status label for every UpdateState status (the footer and the 앱 버전 row; contract D4.1). */
export function updateStatusLabel(state: UpdateState | null): string {
  switch (state?.status) {
    case "disabled": return "자동 업데이트 꺼짐";
    case "idle": return "업데이트 확인 전";
    case "latest": return "최신";
    case "ready": return "업데이트 준비됨";
    case "downloading": return `다운로드 ${state.progress ?? 0}%`;
    case "checking": return "확인 중";
    case "error": return "확인 실패";
    default: return "";
  }
}

function updateDescription(state: UpdateState | null): string {
  switch (state?.status) {
    case "disabled": return "이 실행 환경에서는 자동 업데이트를 사용하지 않습니다.";
    case "idle": return "아직 업데이트를 확인하지 않았습니다.";
    case "checking": return "새 버전을 확인하는 중입니다.";
    case "downloading": return `${state.availableVersion ? `${state.availableVersion} 버전을 ` : "새 버전을 "}내려받는 중입니다.`;
    case "ready": return `${state.availableVersion ? `${state.availableVersion} 버전을 ` : "새 버전을 "}설치할 수 있습니다.`;
    case "latest": return "현재 최신 버전입니다.";
    case "error": return "업데이트 확인에 실패했습니다. 다시 시도해 주세요.";
    default: return "업데이트 상태를 확인하는 중입니다.";
  }
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

type RadioOption<T extends string> = { value: T; label: string; content?: ReactNode };

/**
 * A radiogroup with one tab stop (the checked radio). Arrow keys, Home and End move focus and select, as native
 * radios do; while a save is in flight the group is aria-disabled and ignores input (settingsSaving guard).
 */
function RadioGroup<T extends string>({ label, value, options, onChange, disabled, className }: {
  label: string; value: T; options: readonly RadioOption<T>[]; onChange: (value: T) => void; disabled: boolean;
  className: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const checkedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const choose = (index: number) => {
    if (disabled) return;
    refs.current[index]?.focus();
    if (options[index].value !== value) onChange(options[index].value);
  };
  const keydown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = options.length - 1;
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % options.length
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index - 1 + options.length) % options.length
        : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (next < 0) return;
    event.preventDefault();
    choose(next);
  };
  return <div className={className} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
    {options.map((option, index) => <button key={option.value} type="button" role="radio"
      ref={(element) => { refs.current[index] = element; }} aria-checked={option.value === value}
      tabIndex={index === checkedIndex ? 0 : -1} onClick={() => choose(index)} onKeyDown={(event) => keydown(event, index)}>
      {option.content ?? option.label}</button>)}
  </div>;
}

function SettingSwitch({ label, description, checked, onChange, disabled }: {
  label: string; description: string; checked: boolean; onChange: (checked: boolean) => void; disabled: boolean;
}) {
  const descriptionId = useId();
  return <div className="settings-row">
    <div className="settings-row-text"><strong>{label}</strong><small id={descriptionId}>{description}</small></div>
    <button type="button" role="switch" className="settings-switch" aria-label={label} aria-describedby={descriptionId}
      aria-checked={checked} aria-disabled={disabled || undefined}
      onClick={() => { if (!disabled) onChange(!checked); }}><span aria-hidden="true" /></button>
  </div>;
}

function ThemePreview({ theme }: { theme: AppSettings["theme"] }) {
  // "night" names the dark sample: these previews are not theme overrides (the audit reserves "dark" selectors).
  return <span className={`theme-preview theme-preview-${theme === "dark" ? "night" : theme}`} aria-hidden="true">
    {theme === "system" ? <><span className="theme-preview-half light"><i /><b /></span><span className="theme-preview-half night"><i /><b /></span></>
      : <><i /><b /></>}
  </span>;
}

export type SettingsScreenProps = {
  category: SettingsCategory; onCategoryChange: (category: SettingsCategory) => void;
  /** The displayed values: the pending value while a save runs, the saved value otherwise. */
  settings: AppSettings; saving: boolean; error: string;
  /**
   * Saves at once (no save button). Resolves true when saved, false when the save failed and the previous value is
   * back, null when it was refused because another save is still running.
   */
  onChange: (patch: Partial<AppSettings>) => Promise<boolean | null>;
  updateState: UpdateState | null; onUpdateAction: () => void; onRefreshModels: () => void;
  credits?: CreditBalance; onRefreshCredits: () => void;
  onOpenKeyReplace: (returnFocus: FocusReturnTarget) => void; onLogout: () => void;
  modelId: string;
};

/** Settings screen (contract D4.1): a 240 category column and one category body; every change applies and saves at once. */
export function SettingsScreen({ category, onCategoryChange, settings, saving, error, onChange, updateState, onUpdateAction,
  onRefreshModels, credits, onRefreshCredits, onOpenKeyReplace, onLogout, modelId }: SettingsScreenProps) {
  const entry = CATEGORIES.find((item) => item.id === category) ?? CATEGORIES[0];
  const titleId = useId();
  const [instruction, setInstruction] = useState(settings.defaultInstruction);
  const savedInstruction = settings.defaultInstruction;
  const savedInstructionRef = useRef(savedInstruction);
  savedInstructionRef.current = savedInstruction;
  useEffect(() => { setInstruction(savedInstruction); }, [savedInstruction]);
  const status = updateStatusLabel(updateState);
  const version = updateState?.currentVersion;
  const updateButton = updateState?.status === "ready" ? `업데이트 설치 ${updateState.availableVersion ?? ""}`.trim()
    : updateState?.status === "downloading" ? `업데이트 다운로드 ${updateState.progress ?? 0}%`
      : updateState?.status === "checking" ? "업데이트 확인 중" : "업데이트 확인";
  // A blur save refused because another save was running is kept and retried when that save ends (never dropped).
  const [instructionPending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const markPending = (value: boolean) => { pendingRef.current = value; setPending(value); };
  const saveInstruction = async () => {
    if (instruction === savedInstruction) { markPending(false); return; }
    if (saving) { markPending(true); return; }
    // Only a failed save restores the saved text; a refused overlapping save keeps what the student typed.
    const saved = await onChange({ defaultInstruction: instruction });
    if (saved === false) setInstruction(savedInstructionRef.current);
    markPending(saved === null);
  };
  const retryInstruction = useRef(saveInstruction);
  retryInstruction.current = saveInstruction;
  useEffect(() => {
    if (saving || !pendingRef.current) return;
    markPending(false);
    void retryInstruction.current();
  }, [saving]);
  let body: ReactNode;
  if (entry.id === "general") {
    body = <div className="settings-list">
      <div className="settings-row"><div className="settings-row-text"><strong>앱 버전</strong>
        <small>MM_LLM {version ? `v${version}` : "버전 확인 중"}{status ? ` · ${status}` : ""}</small></div></div>
      <div className="settings-row">
        <div className="settings-row-text"><strong>업데이트</strong><small>{updateDescription(updateState)}</small></div>
        <button type="button" className={updateState?.status === "ready" ? "primary-button" : "secondary-button"} onClick={onUpdateAction}
          disabled={!updateState || updateState.status === "disabled" || updateState.status === "checking" || updateState.status === "downloading"}>
          {updateState?.status === "ready" ? <Download size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
          {updateButton}</button>
      </div>
      <div className="settings-row"><div className="settings-row-text"><strong>모델 목록</strong>
        <small>Gateway에서 사용할 수 있는 모델을 다시 불러옵니다.</small></div>
        <button type="button" className="secondary-button" onClick={onRefreshModels}><RefreshCw size={15} aria-hidden="true" />모델 목록 새로고침</button>
      </div>
    </div>;
  } else if (entry.id === "display") {
    body = <>
      <h3 className="settings-section-title">화면 모드</h3>
      <RadioGroup label="화면 모드" className="theme-cards" value={settings.theme} disabled={saving} onChange={(theme) => void onChange({ theme })}
        options={([["system", "시스템"], ["light", "라이트"], ["dark", "다크"]] as const).map(([value, label]) => ({ value, label,
          content: <><ThemePreview theme={value} /><span className="theme-card-caption"><span className="theme-radio" aria-hidden="true" />
            <span className="theme-card-label">{label}</span>{value === "system" && <small>권장</small>}</span></> }))} />
      <p className="settings-hint">시스템: macOS ‘자동’이나 Windows 야간 예약에 맞춰 낮에는 라이트, 밤에는 다크로 바뀝니다.</p>
      <div className="settings-list">
        <div className="settings-row"><div className="settings-row-text"><strong>글자 크기</strong><small>답변 본문과 메뉴에 함께 적용</small></div>
          <RadioGroup label="글자 크기" className="settings-segment" value={settings.fontSize} disabled={saving}
            onChange={(fontSize) => void onChange({ fontSize })}
            options={[{ value: "small", label: "작게" }, { value: "medium", label: "기본" }, { value: "large", label: "크게" }]} /></div>
        <div className="settings-row"><div className="settings-row-text"><strong>밀도</strong><small>목록 행 높이와 여백</small></div>
          <RadioGroup label="밀도" className="settings-segment" value={settings.density ?? "default"} disabled={saving}
            onChange={(density) => void onChange({ density })}
            options={[{ value: "default", label: "기본" }, { value: "compact", label: "촘촘" }]} /></div>
        <SettingSwitch label="동작 줄이기" description="테마 전환 페이드와 스트리밍 애니메이션 끄기 · 끄면 OS 설정을 따릅니다"
          checked={settings.reduceMotion === true} disabled={saving} onChange={(reduceMotion) => void onChange({ reduceMotion })} />
        <SettingSwitch label="단축키 힌트 표시" description="버튼 옆 ⌘K · ⌘↵ 표기"
          checked={settings.shortcutHints !== false} disabled={saving} onChange={(shortcutHints) => void onChange({ shortcutHints })} />
      </div>
    </>;
  } else if (entry.id === "response") {
    body = <label className="settings-field">전역 기본 지침
      <textarea value={instruction} maxLength={12000} aria-disabled={saving || undefined}
        onChange={(event) => setInstruction(event.target.value)} onBlur={() => void saveInstruction()} />
      <small>모든 대화에 적용됩니다. 대화별 지침은 더 구체적인 경우 우선합니다. 입력란을 벗어나면 저장됩니다.</small>
      {instructionPending && <small className="settings-field-pending" role="status">저장 대기 중 — 진행 중인 저장이 끝나면 자동으로 저장합니다.</small>}
    </label>;
  } else if (entry.id === "account") {
    body = <div className="settings-list">
      <div className="settings-row"><div className="settings-row-text"><strong>API 키 교체</strong>
        <small>새 키를 먼저 검증한 뒤 현재 대화와 설정을 그대로 연결합니다.</small></div>
        <button type="button" className="secondary-button" onClick={(event) => {
          const trigger = event.currentTarget;
          onOpenKeyReplace(() => trigger.isConnected ? trigger : null);
        }}><ShieldCheck size={15} aria-hidden="true" />API 키 교체</button></div>
      <div className="settings-row"><div className="settings-row-text"><strong>로그아웃</strong>
        <small>이 기기에서 연결을 끊고 로그인 화면으로 돌아갑니다.</small></div>
        <button type="button" className="secondary-button logout-action" onClick={onLogout}><LogOut size={15} aria-hidden="true" />로그아웃</button></div>
    </div>;
  } else if (entry.id === "credits") {
    body = <div className="settings-credits">
      <CreditMeter label="전체" bucket={credits?.total} />
      <CreditMeter label="월 제공" bucket={credits?.monthly_allocated} />
      <CreditMeter label="구매" bucket={credits?.purchased} />
      {credits?.monthly_allocated?.renewal_date && <div className="credit-renewal">월 제공 크레딧 갱신 {new Date(
        credits.monthly_allocated.renewal_date).toLocaleDateString("ko-KR")}</div>}
      <button type="button" className="secondary-button" onClick={onRefreshCredits}><RefreshCw size={15} aria-hidden="true" />크레딧 새로고침</button>
    </div>;
  } else if (entry.id === "backup") {
    body = <BackupPanel />;
  } else {
    body = <div className="settings-list"><div className="settings-row"><div className="settings-row-text"><strong>진단 정보</strong>
      <small>API 키와 대화 내용은 포함하지 않습니다.</small></div>
      <DiagnosticButton stage="general" modelId={modelId} /></div></div>;
  }
  return <section className="settings-screen screen-layout" aria-label="설정">
    <div className="screen-column settings-column">
      <div className="list-header"><h2 className="list-title">설정</h2></div>
      <nav className="settings-categories" aria-label="설정 분류">
        {CATEGORIES.map(({ id, label, icon: Icon }) => <div key={id} className="settings-category-item">
          {id === ACCOUNT_GROUP_START && <hr aria-hidden="true" />}
          <button type="button" aria-current={id === entry.id ? "true" : undefined} onClick={() => onCategoryChange(id)}>
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" />{label}</button></div>)}
      </nav>
      <div className="settings-footer"><span>MM_LLM {version ? `v${version}` : "버전 확인 중"}</span>
        {status && <span className={`settings-footer-status status-${updateState?.status}`}> · {status}</span>}</div>
    </div>
    <div className="settings-body">
      <div className="settings-content" aria-labelledby={titleId} role="region">
        <h2 id={titleId}>{entry.label}</h2>
        <p className="settings-description">{entry.description}</p>
        {error && <div className="inline-error" role="alert"><CircleHelp size={16} aria-hidden="true" />{error}</div>}
        {body}
      </div>
    </div>
  </section>;
}
