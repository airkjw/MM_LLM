import { CODE_BILLING_NOTICE, CODE_ARTIFACT_NOTICE, serverCodeProvider, mergeServerCode } from "../../shared/server-code";
import { ActionBarPrimitive, AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useAui, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { ArrowUp, Brain, Check, CircleHelp, Copy, Download, FileText, Globe2, Image as ImageIcon, LoaderCircle, Paperclip, RefreshCw, Settings, ShieldCheck, Sparkles, Square, X } from "lucide-react";
import { useCallback, useContext, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { claudeAllowsSampling, claudeDefaultThinkingMode, claudeForbidsForcedToolChoice, claudeThinkingCapabilities, isClaudeModel, isGeminiModel, isOpenAiModel } from "../../shared/advanced-chat";
import { hasFixedTemperature, reasoningSupport } from "../../shared/chat-options";
import type { ChatAdvancedSettings, ChatEvent, ChatRequest, CompareRequest, CompareRun, GatewayModel, PickedAttachment, PublicMessage, ReasoningMode, ThreadSnapshot, WebSearchMode, SearchCapability, WebSearchExecution } from "../../shared/contracts";
import { nativeSearchSettingsError, nativeSearchProvider, sharedEvidenceModelError } from "../../shared/search-capability";
import { citationLinkBlockReason, webSearchStatusLabel } from "../../shared/search-evidence";
import { unsupportedContinuationMessage } from "../../shared/chat-continuation";
import { CompareInline, type CompareSynthesisControls } from "./CompareInline";
import { useConfirm } from "./components/ConfirmDialog";
import { DiagnosticButton } from "./components/DiagnosticButton";
import { modelLabel } from "./model-names";
import { ModelPreferences } from "./model-preferences";
import { digitShortcut, hasBlockingModal } from "./shortcut-policy";
import { useDialogFocus, useFocusLayer } from "./use-focus-layer";

import { ModelPicker } from "./ModelPicker";
import { errorText, MarkdownText, readDroppedFiles, templates } from "./ui-shared";
function TemplateCard({ item, index, onChoose, disabled }: {
  item: typeof templates[number]; index: number; onChoose: () => Promise<void>; disabled: boolean;
}) {
  const Icon = item.icon;
  return <button type="button" className="template-card" aria-keyshortcuts={String(index + 1)}
    onClick={() => void onChoose()} disabled={disabled}>
    <span className="template-icon" aria-hidden="true"><Icon size={17} /></span>
    <span className="template-content"><strong>{item.title}</strong><small>{item.detail}</small></span>
    <kbd aria-hidden="true">{index + 1}</kbd>
  </button>;
}

const WEB_MODES: ReadonlyArray<{ value: WebSearchMode; label: string; short: string }> = [
  { value: "always", label: "웹검색 항상", short: "항상" }, { value: "auto", label: "웹검색 자동", short: "자동" },
  { value: "deep", label: "딥리서치 · 최대 6회 호출", short: "딥리서치" }, { value: "off", label: "웹검색 끄기", short: "끄기" }
];
const REASONING_MODES: ReadonlyArray<{ value: ReasoningMode; label: string }> = [
  { value: "auto", label: "자동" }, { value: "fast", label: "빠르게" }, { value: "balanced", label: "균형" }, { value: "deep", label: "깊게" }
];
const MAX_COMPARE_MODELS = 3;

/**
 * A composer toggle that opens a menu of the choices the current model supports and shows the current value
 * (contract D3.2: a menu instead of click-cycling, so keyboard users can see the options).
 */
function ComposerMenu<T extends string>({ name, icon, value, options, disabled, busy = false, onChoose }: {
  name: string; icon: ReactNode; value: T; options: ReadonlyArray<{ value: T; label: string; short?: string }>;
  /** `busy` (a save in flight) keeps the trigger focusable so focus returned to it is not dropped. */
  disabled: boolean; busy?: boolean; onChoose: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { ref, requestClose } = useFocusLayer<HTMLDivElement>({
    active: open, mode: "menu", onClose: () => setOpen(false), closeOnOutside: true, restoreTo: trigger
  });
  const current = options.find((option) => option.value === value) ?? options[0];
  useEffect(() => {
    if (!open) return;
    // Start on the current value; this frame runs after the focus layer's first-item focus.
    const frame = window.requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>('[role="menuitem"][aria-current="true"]')?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, ref]);
  return <div className="composer-menu">
    <button ref={trigger} type="button" className="composer-toggle" aria-haspopup="menu" aria-expanded={open}
      aria-label={`${name}: ${current.label}`} title={`${name}: ${current.label}`} disabled={disabled}
      aria-disabled={busy || undefined} onClick={() => open ? requestClose("programmatic", true) : !busy && setOpen(true)}>
      {icon}<span aria-hidden="true">{current.short ?? current.label}</span></button>
    {open && <div className="composer-menu-list" role="menu" aria-label={name} ref={ref} tabIndex={-1}>
      {options.map((option) => <button type="button" role="menuitem" key={option.value} data-value={option.value}
        tabIndex={option.value === value ? 0 : -1} aria-current={option.value === value ? "true" : undefined}
        onClick={() => { requestClose("programmatic", true); if (option.value !== value) onChoose(option.value); }}>
        <span>{option.label}</span>{option.value === value && <><Check size={14} aria-hidden="true" /><span className="sr-only">, 현재 선택</span></>}
      </button>)}
    </div>}
  </div>;
}

export type EvidenceAppend = { id: string; threadId: string; text: string };
export type ComposerHandle = { getText: () => string };
function ComposerDraft({ text, onDraftApplied, operations, onEvidenceApplied, composerRef, restoreRef }: {
  text?: string; onDraftApplied: () => void;
  operations: EvidenceAppend[]; onEvidenceApplied?: (ids: string[]) => void; composerRef?: Ref<ComposerHandle>;
  /** Lets a refused comparison put the question back after the composer cleared it on send. */
  restoreRef: { current: ((value: string) => void) | null };
}) {
  const aui = useAui();
  const replacement = useRef<string | undefined>(undefined);
  const applied = useRef(new Set<string>());
  useImperativeHandle(composerRef, () => ({ getText: () => aui.composer.getState().text }), [aui]);
  useEffect(() => {
    restoreRef.current = (value) => aui.composer.setText(value);
    return () => { restoreRef.current = null; };
  }, [aui, restoreRef]);
  useEffect(() => {
    if (!text) replacement.current = undefined;
    const replace = Boolean(text) && replacement.current !== text;
    // An accepted replacement owns the base. setText does not update getState's
    // rendered snapshot in this commit, so compose both intents before writing.
    let next = replace ? text! : aui.composer.getState().text;
    const ids: string[] = [];
    for (const operation of operations) {
      if (!applied.current.has(operation.id)) {
        const evidence = operation.text.slice(0, 30000) + (operation.text.length > 30000
          ? "\n[근거 일부 생략: 초안에 추가하는 자료는 30,000자까지입니다.]" : "");
        next += (next ? "\n\n" : "") + evidence;
        applied.current.add(operation.id);
        ids.push(operation.id);
      }
    }
    if (replace || ids.length) aui.composer.setText(next);
    if (replace) {
      replacement.current = text;
      onDraftApplied();
    }
    if (ids.length) onEvidenceApplied?.(ids);
  }, [aui, text, onDraftApplied, operations, onEvidenceApplied]);
  return null;
}

const NO_EVIDENCE: EvidenceAppend[] = [];

function UserMessage() {
  return <MessagePrimitive.Root className="message-row user">
    <div className="message-bubble user-bubble"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>;
}

function ManualToolCards({ messageId, calls, disabled, onSubmit }: {
  messageId: string; calls: NonNullable<PublicMessage["toolCalls"]>; disabled: boolean;
  onSubmit: (messageId: string, results: Array<{ toolCallId: string; result: string }>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const waiting = calls.filter((call) => call.status === "waiting");
  return <div className="manual-tool-list" aria-label="수동 도구 호출">
    {calls.map((call) => <section className="manual-tool-card" key={call.id}>
      <div><strong>{call.name}</strong><span>{call.status === "waiting" ? "사용자 결과 대기" : "결과 제출됨"}</span></div>
      <details><summary>모델이 요청한 JSON 인자</summary><pre>{call.arguments}</pre></details>
      {call.status === "waiting" && <>
        <label>직접 실행하거나 확인한 JSON 결과
          <textarea value={values[call.id] ?? "{}"} disabled={disabled} aria-label={`${call.name} 도구 결과 JSON`}
            onChange={(event) => setValues((current) => ({ ...current, [call.id]: event.target.value }))} />
        </label>
      </>}
    </section>)}
    {waiting.length > 0 && <button type="button" disabled={disabled} onClick={() => {
      try {
        const results = waiting.map((call) => { const result = values[call.id] ?? "{}"; JSON.parse(result);
          return { toolCallId: call.id, result }; });
        setError(""); onSubmit(messageId, results);
      } catch { setError("모든 대기 중인 도구에 유효한 JSON 결과를 입력해 주세요."); }
    }}>모든 도구 결과를 확인하고 다음 턴 전송</button>}
    {error && <div className="inline-error" role="alert">{error}</div>}
  </div>;
}

function AssistantMessage({ incomplete, onContinue, disabled, usage, credits, backgroundResponseId, onCancelBackground,
  messageId, toolCalls, files, reasoningSummary, onSubmitTool, modelId, createdAt, webSearch, continuationUnsupportedReason, serverCodeResults }: {
  modelId?: string; createdAt?: string; webSearch?: WebSearchExecution;
  incomplete: boolean; onContinue: () => void; disabled: boolean; usage?: PublicMessage["usage"]; credits?: number;
  backgroundResponseId?: string; onCancelBackground: (id: string) => void;
  messageId: string; toolCalls?: PublicMessage["toolCalls"];
  files?: PublicMessage["files"];
  serverCodeResults?: PublicMessage["serverCodeResults"];
  reasoningSummary?: string;
  continuationUnsupportedReason?: PublicMessage["continuationUnsupportedReason"];
  onSubmitTool: (messageId: string, results: Array<{ toolCallId: string; result: string }>) => void;
}) {
  const [sourceError, setSourceError] = useState("");
  const continuationNotice = unsupportedContinuationMessage(continuationUnsupportedReason);
  return <MessagePrimitive.Root className="message-row assistant">
    <span className="assistant-avatar"><Sparkles size={16} /></span>
    <div className="assistant-message-column">
      <small className="message-provenance">{modelId ? modelLabel(modelId) : "모델 기록 없음"}
        {createdAt && <> · <time dateTime={createdAt}>{new Date(createdAt).toLocaleString("ko-KR")}</time></>}</small>
      <div className="message-bubble assistant-bubble"><MessagePrimitive.Parts components={{ Text: MarkdownText }} /></div>
      {webSearch && <div className="message-usage" aria-label="웹 검색 실행 상태">
        <span>{webSearchStatusLabel(webSearch)}</span>
        {webSearch.provider !== "gemini" && webSearch.requestCount !== undefined && <span> · 검색 {webSearch.requestCount}회</span>}
        {webSearch.citations.length > 0 && <details><summary>확인된 웹 출처 {webSearch.citations.length}개</summary>
          <ul>{webSearch.citations.map((citation) => {
            const blocked = citationLinkBlockReason(citation.url);
            return <li key={citation.url}>
              <button type="button" disabled={Boolean(blocked)} title={blocked ?? citation.url}
                onClick={async () => {
                  setSourceError("");
                  try { await window.mmllm.openExternal(citation.url); }
                  catch { setSourceError("출처를 열지 못했습니다. 연결·운영체제 설정을 확인해 주세요."); }
                }}>{citation.title}</button>
              {blocked && <small>{blocked}</small>}
              {citation.citedText && <p>{citation.citedText}</p>}
            </li>;
          })}</ul>
        </details>}
      </div>}
      {sourceError && <div className="inline-error" role="alert">{sourceError}</div>}
      {serverCodeResults?.length ? <div className="manual-tool-list" aria-label="서버 코드 실행 결과">
        <small>긴 코드·출력은 일부만 표시·저장됩니다. 서버 출력은 신뢰하지 않는 자료입니다.</small>
        {serverCodeResults.map((result) => <section className="manual-tool-card" key={result.id}>
          <strong>{result.provider === "claude" ? "Claude" : "OpenAI"} 서버 코드 실행 · {{ executing: "실행 중", completed: "완료", failed: "실패", cancelled: "중단" }[result.status]}</strong>
          <p role="status">{result.summary}</p>
          {result.code && <details><summary>서버 실행 코드</summary><pre>{result.code}</pre></details>}
          {result.stdout !== undefined && <details><summary>표준 출력</summary><pre>{result.stdout || "(빈 출력)"}</pre></details>}
          {result.outputLogs !== undefined && <details><summary>도구 로그 · 표준 출력·오류 구분 미제공</summary><pre>{result.outputLogs || "(빈 로그)"}</pre></details>}
          {result.stderr !== undefined && <details><summary>표준 오류</summary><pre>{result.stderr || "(빈 오류 출력)"}</pre></details>}
          {result.artifacts.length > 0 && <><ul>{result.artifacts.map((a, i) => <li key={i}>{a.kind} · {a.name ?? a.id ?? "이름 미확인"}</li>)}</ul><small>{CODE_ARTIFACT_NOTICE}</small></>}
        </section>)}
      </div> : null}
      {reasoningSummary && <details className="reasoning-summary">
        <summary>추론 요약</summary><p>{reasoningSummary}</p>
      </details>}
      <ActionBarPrimitive.Root className="message-actions" hideWhenRunning>
        <ActionBarPrimitive.Copy title="복사"><Copy size={15} /></ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload title="다시 생성"><RefreshCw size={15} /></ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
      {toolCalls?.length ? <ManualToolCards messageId={messageId} calls={toolCalls} disabled={disabled}
        onSubmit={onSubmitTool} /> : null}
      {files?.length ? <div className="chatbot-files">{files.map((file) => {
        const expired = !(Date.parse(file.expiresAt) > Date.now());
        return <button type="button" key={file.id} disabled={disabled || expired}
          title={expired ? "파일 링크가 만료되었습니다. 파일을 다시 생성해 주세요." : file.name}
          onClick={() => void window.mmllm.saveRemoteMedia(file.mediaUrl, file.name)}>
          <Download size={13} />{file.name}{expired && " · 다운로드 기간 만료"}</button>;
      })}</div> : null}
      {backgroundResponseId ? <div className="incomplete-actions" role="status" aria-live="polite">
        <span>백그라운드 응답 처리 중</span>
        <button type="button" onClick={() => onCancelBackground(backgroundResponseId)} disabled={disabled}>취소</button>
      </div> : continuationNotice ? <div className="incomplete-actions" role="status"><span>{continuationNotice}</span></div>
        : incomplete && <div className="incomplete-actions"><span>중단된 답변</span>
        <button type="button" onClick={onContinue} disabled={disabled}>이어서 생성</button></div>}
      {usage && <div className="message-usage" title="토큰 사용량은 크레딧과 다른 값입니다.">
        입력 {usage.inputTokens.toLocaleString()} · 출력 {usage.outputTokens.toLocaleString()} · 합계 {usage.totalTokens.toLocaleString()} 토큰
        {usage.cacheCreationInputTokens !== undefined && <> · 캐시 생성 {usage.cacheCreationInputTokens.toLocaleString()}</>}
        {usage.cacheReadInputTokens !== undefined && <> · 캐시 읽기 {usage.cacheReadInputTokens.toLocaleString()}</>}
        {usage.cachedInputTokens !== undefined && <> · 캐시 입력 {usage.cachedInputTokens.toLocaleString()}</>}
        {usage.reasoningTokens !== undefined && <> · 추론 {usage.reasoningTokens.toLocaleString()}</>}
      </div>}
      {credits !== undefined && <div className="message-usage">실제 과금 {credits.toLocaleString()} 크레딧</div>}
    </div>
  </MessagePrimitive.Root>;
}

function ChatKeyboardShortcuts({ messages, running, stop }: {
  messages: PublicMessage[]; running: boolean; stop: () => void;
}) {
  const aui = useAui();
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (hasBlockingModal(document)) return;
      if (event.key === "Escape" && running) { event.preventDefault(); stop(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key === "ArrowUp" && !running) {
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea") && (target as HTMLInputElement).value) return;
        const latest = messages.findLast((message) => message.role === "user");
        if (latest) { event.preventDefault(); aui.composer.setText(latest.text); }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [aui, messages, running, stop]);
  return null;
}

/** The live comparison owned by App (streaming, gates and storage stay there); ChatPanel only renders and routes. */
export type ChatCompare = {
  run: CompareRun | null; busy: boolean; synthesis: CompareSynthesisControls;
  /** Starts `streamCompare`; false when it was refused or failed to start, so the draft and attachments stay. */
  onStart: (request: CompareRequest) => boolean;
  onStop: () => void;
  onContinue: (runId: string, modelId: string) => void;
  continueDisabled: boolean;
  onError: (message: string) => void;
};

export function ChatPanel({
  thread, modelId, models, onModelChange, onThreadUpdated, onRefreshThreads, onUsageChanged,
  onTemplateStart, initialDraft, onDraftApplied, evidenceAppends = NO_EVIDENCE, onEvidenceApplied,
  composerRef, voicePanel, headerSearch, compare, compareShortcut, onCompareShortcutHandled, active = true
}: {
  thread: ThreadSnapshot; modelId: string; models: GatewayModel[];
  onModelChange: (id: string) => void;
  onThreadUpdated: (snapshot: ThreadSnapshot) => void;
  onRefreshThreads: () => void;
  onUsageChanged: () => void;
  onTemplateStart: (item: typeof templates[number]) => Promise<void>;
  initialDraft?: string;
  onDraftApplied: () => void;
  evidenceAppends?: EvidenceAppend[];
  onEvidenceApplied?: (ids: string[]) => void;
  composerRef?: Ref<ComposerHandle>;
  voicePanel?: ReactNode;
  headerSearch?: ReactNode;
  /** Present when this conversation can start comparisons; `run` is set only for runs started here. */
  compare?: ChatCompare;
  /** Cmd/Ctrl+Shift+C request: add a second model token and open its picker. */
  compareShortcut?: number;
  onCompareShortcutHandled?: (id: number) => void;
  /** False while the App keeps this conversation mounted but hidden behind another screen: no window shortcuts. */
  active?: boolean;
}) {
  const confirm = useConfirm();
  const preferences = useContext(ModelPreferences);
  const [compareExtras, setCompareExtras] = useState<string[]>([]);
  const [compareConfirmed, setCompareConfirmed] = useState(false);
  const [tokenPickerRequest, setTokenPickerRequest] = useState<{ index: number; id: number } | null>(null);
  const restoreDraftRef = useRef<((value: string) => void) | null>(null);
  const [messages, setMessages] = useState<PublicMessage[]>(thread.messages);
  const [pending, setPending] = useState<PickedAttachment[]>([]);
  const attachmentConsent = thread.attachmentConsent;
  const [privacyDialog, setPrivacyDialog] = useState<"pick" | "drop" | "history" | null>(null);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [instructionDraft, setInstructionDraft] = useState(thread.instruction);
  const [advancedDraft, setAdvancedDraft] = useState<ChatAdvancedSettings>(thread.advanced);
  const [structuredSchemaDraft, setStructuredSchemaDraft] = useState(
    thread.advanced.structuredOutput ? JSON.stringify(thread.advanced.structuredOutput.schema, null, 2) : ""
  );
  const [toolsDraft, setToolsDraft] = useState(
    thread.advanced.tools ? JSON.stringify(thread.advanced.tools, null, 2) : ""
  );
  const [controlsPending, setControlsPending] = useState(false);
  const [checkedSearch, setCheckedSearch] = useState<{ id: string; capability: SearchCapability } | null>(null);
  useEffect(() => { setCheckedSearch(null); }, [modelId, models]);
  const [countedTokens, setCountedTokens] = useState<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const settleRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef(pending);
  const pendingKey = pending.map((item) => item.id).join();
  // Any attachment change resets the comparison consent (contract D3.5).
  useEffect(() => { setCompareConfirmed(false); }, [pendingKey]);
  const consentRef = useRef(attachmentConsent);
  const modelRef = useRef(modelId);
  const messagesRef = useRef(messages);
  const dragDepthRef = useRef(0);
  const droppedFilesRef = useRef<File[]>([]);
  const privacyBusyRef = useRef(privacyBusy);
  const aliveRef = useRef(true);
  const threadIdRef = useRef(thread.id);
  const closeChatSettings = useCallback(() => setChatSettingsOpen(false), []);
  const chatSettingsRef = useDialogFocus(chatSettingsOpen, closeChatSettings, !controlsPending);
  const closePrivacy = useCallback(() => {
    if (privacyBusyRef.current) return;
    droppedFilesRef.current = [];
    setPrivacyDialog(null);
  }, []);
  const privacyRef = useDialogFocus(Boolean(privacyDialog), closePrivacy, !privacyBusy);
  pendingRef.current = pending;
  consentRef.current = attachmentConsent;
  modelRef.current = modelId;
  messagesRef.current = messages;
  threadIdRef.current = thread.id;
  privacyBusyRef.current = privacyBusy;
  const chatModelIds = models.filter((model) => model.type === "llm").map((model) => model.id);
  const composerModels = [modelId, ...compareExtras.filter((id) => id !== modelId && chatModelIds.includes(id))]
    .filter(Boolean).slice(0, MAX_COMPARE_MODELS);
  const compareMode = Boolean(compare) && thread.target?.kind !== "chatbot" && composerModels.length >= 2;
  const compareRef = useRef(compare);
  compareRef.current = compare;
  const compareRequestRef = useRef({ compareMode, composerModels, compareConfirmed, webSearchMode: thread.webSearchMode });
  compareRequestRef.current = { compareMode, composerModels, compareConfirmed, webSearchMode: thread.webSearchMode };

  const hasAttachedHistory = messages.some((message) => Boolean(message.attachments?.length));
  const needsConsent = pending.length > 0 || hasAttachedHistory || Boolean(thread.projectId);

  useEffect(() => {
    const stale = pendingRef.current.map((item) => item.id);
    if (stale.length) void window.mmllm.discardAttachments(stale);
    setMessages(thread.messages); setPending([]); setError(""); setProgress("");
    setAdvancedDraft(thread.advanced);
    setStructuredSchemaDraft(thread.advanced.structuredOutput
      ? JSON.stringify(thread.advanced.structuredOutput.schema, null, 2) : "");
    setToolsDraft(thread.advanced.tools ? JSON.stringify(thread.advanced.tools, null, 2) : "");
  }, [thread.id]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopRef.current?.();
      const stale = pendingRef.current.map((item) => item.id);
      if (stale.length) void window.mmllm.discardAttachments(stale);
    };
  }, []);

  useEffect(() => {
    if (!isRunning) setMessages(thread.messages);
  }, [thread.messages, isRunning]);

  const run = useCallback(async (text: string, regenerate = false, regenerateAfterId?: string,
    continueIncompleteId?: string, toolResults?: ChatRequest["toolResults"]) => {
    if (thread.target?.kind !== "chatbot" && !models.some((model) => model.type === "llm" && model.id === modelRef.current)) {
      throw new Error("현재 사용할 수 있는 모델을 직접 선택해 주세요.");
    }
    const startingMessages = messagesRef.current;
    const attachments = regenerate ? [] : pendingRef.current;
    const after = regenerate
      ? regenerateAfterId
        ? startingMessages.findIndex((item) => item.id === regenerateAfterId && item.role === "user")
        : startingMessages.findLastIndex((item) => item.role === "user")
      : startingMessages.length - 1;
    const attachedInContext = startingMessages.slice(0, after + 1)
      .some((item) => Boolean(item.attachments?.length));
    if ((attachments.length > 0 || attachedInContext) && !consentRef.current) {
      throw new Error("첨부 자료 전송 확인을 먼저 완료해 주세요.");
    }
    const request: ChatRequest = {
      threadId: thread.id,
      modelId: modelRef.current,
      text,
      attachmentIds: attachments.map((item) => item.id),
      regenerate,
      regenerateAfterId,
      continueIncompleteId,
      toolResults
    };
    const now = new Date().toISOString();
    const assistantId = crypto.randomUUID();
    if (continueIncompleteId) {
      setMessages((previous) => [...previous,
        { id: assistantId, role: "assistant", modelId: modelRef.current, text: "", createdAt: now }]);
    } else if (regenerate) {
      const after = regenerateAfterId
        ? messagesRef.current.findIndex((item) => item.id === regenerateAfterId)
        : messagesRef.current.findLastIndex((item) => item.role === "user");
      setMessages((previous) => [
        ...previous.slice(0, after + 1),
        { id: assistantId, role: "assistant", modelId: modelRef.current, text: "", createdAt: now }
      ]);
    } else {
      setMessages((previous) => [
        ...previous,
        { id: crypto.randomUUID(), role: "user", text, createdAt: now,
          attachments: attachments.map((item) => item.name) },
        { id: assistantId, role: "assistant", modelId: modelRef.current, text: "", createdAt: now }
      ]);
    }
    setIsRunning(true);
    setError("");
    setProgress(attachments.some((item) => item.name.toLowerCase().endsWith(".pdf")) ? "첨부 PDF를 읽는 중입니다…" : "");
    setPending([]);
    await new Promise<void>((resolve) => {
      const runThreadId = thread.id;
      settleRef.current = resolve;
      stopRef.current = window.mmllm.streamChat(request, (event: ChatEvent) => {
        const current = aliveRef.current && threadIdRef.current === runThreadId;
        if (event.type === "delta") {
          if (!current) return;
          setProgress("");
          setMessages((previous) => previous.map((item) =>
            item.id === assistantId ? { ...item, text: item.text + event.text } : item
          ));
        } else if (event.type === "server_code") {
          if (!current) return;
          setMessages((previous) => previous.map((item) => item.id === assistantId
            ? { ...item, serverCodeResults: mergeServerCode(item.serverCodeResults, event.result) } : item));
        } else if (event.type === "tool_call") {
          if (!current) return;
          setMessages((previous) => previous.map((item) => item.id === assistantId
            ? { ...item, toolCalls: [...(item.toolCalls ?? []), event.call] } : item));
        } else if (event.type === "web_search") {
          if (!current) return;
          setMessages((previous) => previous.map((item) => item.id === assistantId ? { ...item, webSearch: event.search } : item));
        } else if (event.type === "reasoning_summary") {
          if (!current) return;
          setMessages((previous) => previous.map((item) => item.id === assistantId
            ? { ...item, reasoningSummary: (item.reasoningSummary ?? "") + event.text } : item));
        } else if (event.type === "progress") {
          if (!current) return;
          setProgress(event.message);
        } else if (event.type === "done") {
          if (!current) { resolve(); return; }
          setMessages(event.snapshot.messages);
          onThreadUpdated(event.snapshot);
          onRefreshThreads();
          onUsageChanged();
          setIsRunning(false);
          setProgress("");
          stopRef.current = null;
          settleRef.current = null;
          resolve();
        } else if (event.type === "error") {
          if (!current) { resolve(); return; }
          if (event.snapshot) {
            setMessages(event.snapshot.messages);
            onThreadUpdated(event.snapshot);
            onRefreshThreads();
          } else {
            const fallbackThreadId = thread.id;
            void window.mmllm.loadThread(fallbackThreadId).then((snapshot) => {
              if (!aliveRef.current || threadIdRef.current !== fallbackThreadId) return;
              setMessages(snapshot.messages);
              onThreadUpdated(snapshot);
            }).catch(() => {
              if (aliveRef.current && threadIdRef.current === fallbackThreadId) setMessages(startingMessages);
            });
          }
          setError(event.message);
          onUsageChanged();
          setIsRunning(false);
          setProgress("");
          stopRef.current = null;
          settleRef.current = null;
          resolve();
        }
      });
    });
  }, [thread.id, thread.target?.kind, models, onThreadUpdated, onRefreshThreads, onUsageChanged]);

  const onNew = useCallback(async (message: { content: readonly { type: string; text?: string }[] }) => {
    const text = message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim();
    if (!text) return;
    const request = compareRequestRef.current;
    if (request.compareMode && compareRef.current) {
      // Comparison is a separate stream (contract D3.4): the composer's tokens, web toggle and attachments
      // become one CompareRequest. Attachment ownership passes to main only when the stream starts.
      const attachments = pendingRef.current;
      const started = compareRef.current.onStart({ prompt: text, modelIds: request.composerModels,
        webSearchMode: request.webSearchMode, attachmentIds: attachments.map((item) => item.id),
        deidentifiedConfirmed: request.compareConfirmed });
      if (started) { setPending([]); setCompareConfirmed(false); }
      else restoreDraftRef.current?.(text);
      return;
    }
    try { await run(text); }
    catch (error) { setError(errorText(error)); }
  }, [run]);

  const onReload = useCallback(async (parentId: string | null) => {
    const selectedUser = parentId
      ? messagesRef.current.find((message) => message.id === parentId && message.role === "user")
      : null;
    const lastUser = messagesRef.current.findLast((message) => message.role === "user");
    const user = selectedUser ?? lastUser;
    if (!user) return;
    if (lastUser && user.id !== lastUser.id &&
      !(await confirm({ title: "답변 다시 생성", message: "이 답변부터 다시 생성하면 이후 대화가 사라집니다.", confirmLabel: "이후 대화 삭제 후 다시 생성", danger: true }))) return;
    try { await run(user.text, true, user.id); }
    catch (error) { setError(errorText(error)); }
  }, [run]);

  const onCancel = useCallback(async () => {
    stopRef.current?.();
  }, []);

  async function setSearchMode(mode: WebSearchMode) {
    setControlsPending(true);
    try {
      const updated = await window.mmllm.setWebSearchMode(thread.id, mode);
      onThreadUpdated(updated);
    } catch (error) { setError(errorText(error)); }
    finally { setControlsPending(false); }
  }

  const selectedModel = models.find((model) => model.id === modelId);
  const displayModels = checkedSearch ? models.map((model) => model.id === checkedSearch.id
    ? { ...model, searchCapability: checkedSearch.capability } : model) : models;
  const searchCapability = checkedSearch?.id === modelId ? checkedSearch.capability : selectedModel?.searchCapability;
  const sonarRestriction = selectedModel && nativeSearchProvider(selectedModel) === "sonar" &&
    (thread.webSearchMode === "off" || thread.webSearchMode === "deep")
    ? "Sonar는 검색 끄기·공통 근거 전용 답변을 지원하지 않습니다. 다른 모델을 선택하거나 검색 방식을 자동·항상으로 바꿔 주세요." : undefined;
  const searchSettingsError = searchCapability?.status === "supported" && searchCapability.provider && thread.webSearchMode !== "off" && thread.webSearchMode !== "deep"
    ? nativeSearchSettingsError(searchCapability.provider, thread.advanced) : undefined;
  const searchRouteLabel = thread.webSearchMode === "deep" ? "Sonar 공통 검색 후 선택 모델 답변 · 3~4개 검색어 교차 조사 · 총 최대 6회 API 호출"
    : searchCapability?.status === "supported" ? "모델 자체 검색 · 도구 추가 과금 가능"
    : searchCapability?.status === "unsupported" ? "자체 검색 미지원 · Sonar 검색 후 선택 모델 답변 · 추가 요청"
    : "자체 검색 미확인 · 전송 시 확인, 미확인/미지원은 Sonar 추가 요청";
  const chatbotTarget = thread.target?.kind === "chatbot" ? thread.target : undefined;
  const reasoning = selectedModel ? reasoningSupport(selectedModel) : "none";
  const modelById = (id: string) => models.find((model) => model.id === id);
  const compareModelError = compareMode
    ? composerModels.map(modelById).find((model) => model && sharedEvidenceModelError(model)) : undefined;
  const compareBusy = Boolean(compare?.busy || compare?.synthesis.busy);
  const compareSendBlocked = compareMode && (compareBusy || Boolean(compareModelError) ||
    pending.length > 0 && !compareConfirmed);
  const showCompare = Boolean(compare && (compare.run || compare.busy));
  const unavailableForCompare = (model: GatewayModel) => sharedEvidenceModelError(model);
  function addCompareModel(id: string): string {
    const current = compareRequestRef.current.composerModels;
    const model = modelById(id);
    if (current.includes(id)) return "이미 비교 목록에 있는 모델입니다.";
    if (current.length >= MAX_COMPARE_MODELS) return "비교는 최대 3개 모델까지 할 수 있습니다.";
    if (!model) return "현재 사용할 수 있는 모델을 직접 선택해 주세요.";
    const refusal = unavailableForCompare(model);
    if (refusal) return refusal;
    const next = [...current.slice(1), id];
    setCompareExtras(next);
    compareRequestRef.current = { ...compareRequestRef.current, composerModels: [current[0], ...next] };
    return `${modelLabel(id)} 비교에 추가 · ${current.length + 1}/${MAX_COMPARE_MODELS}`;
  }
  const replaceCompareModel = (index: number, id: string) => setCompareExtras((items) => {
    const next = composerModels.slice(1);
    if (next.includes(id) || id === modelId) return items;
    next[index - 1] = id;
    return next;
  });
  const choosePrimaryModel = (id: string) => {
    setCompareExtras((items) => items.filter((item) => item !== id));
    onModelChange(id);
  };
  // Cmd/Ctrl+Shift+C: add a second token (favorites → recent → list order, never Sonar) and open its picker.
  const shortcutRef = useRef({ composerModels, preferences, models });
  shortcutRef.current = { composerModels, preferences, models };
  useEffect(() => {
    if (!compareShortcut) return;
    onCompareShortcutHandled?.(compareShortcut);
    if (thread.target?.kind === "chatbot") return;
    const { composerModels: current, preferences: prefs, models: available } = shortcutRef.current;
    if (current.length < 2) {
      const llms = available.filter((model) => model.type === "llm" && !current.includes(model.id) && !sharedEvidenceModelError(model));
      const candidate = prefs.favorites.find((id) => llms.some((model) => model.id === id)) ??
        prefs.recent.find((id) => llms.some((model) => model.id === id)) ?? llms[0]?.id;
      if (!candidate) { setError("비교에 추가할 수 있는 다른 대화 모델이 없습니다."); return; }
      setCompareExtras([candidate]);
    }
    setTokenPickerRequest({ index: 1, id: compareShortcut });
  }, [compareShortcut]);
  // The token's picker opens in its own effect (children run first); then the request is spent, so a later
  // replacement or re-added token never reopens it.
  useEffect(() => { if (tokenPickerRequest) setTokenPickerRequest(null); }, [tokenPickerRequest]);
  // Start cards answer 1–4 only while the empty start screen is visible (contract D3.1).
  const templateKeysRef = useRef({ enabled: false, choose: (_item: typeof templates[number]) => {} });
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const digit = digitShortcut(event);
      const { enabled, choose } = templateKeysRef.current;
      if (!digit || !enabled || digit > templates.length) return;
      event.preventDefault();
      choose(templates[digit - 1]);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  async function saveThreadControls(nextReasoning: ReasoningMode, nextInstruction = instructionDraft,
    nextAdvanced = advancedDraft) {
    setControlsPending(true);
    try {
      const updated = await window.mmllm.updateThreadSettings(thread.id, {
        modelId, instruction: nextInstruction, reasoningMode: nextReasoning, advanced: nextAdvanced
      });
      onThreadUpdated(updated); onRefreshThreads();
      setInstructionDraft(updated.instruction); setAdvancedDraft(updated.advanced);
      return updated;
    } catch (error) { setError(errorText(error)); return null; }
    finally { setControlsPending(false); }
  }

  async function saveChatSettings() {
    let next = { ...advancedDraft };
    try {
      const tools = toolsDraft.trim() ? JSON.parse(toolsDraft) as ChatAdvancedSettings["tools"] : undefined;
      next = { ...next,
        structuredOutput: structuredSchemaDraft.trim() ? {
          name: "mmllm_output", schema: JSON.parse(structuredSchemaDraft) as Record<string, unknown>
        } : undefined,
        tools, toolChoice: tools?.length ? next.toolChoice : undefined };
    } catch { setError("구조화 출력과 수동 도구 정의는 유효한 JSON이어야 합니다."); return; }
    const updated = await saveThreadControls(thread.reasoningMode, instructionDraft, next);
    if (updated) setChatSettingsOpen(false);
  }

  const convertMessage = useCallback((message: PublicMessage): ThreadMessageLike => ({
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    content: [{ type: "text", text: message.text +
      (message.attachments?.length ? `\n\n📎 ${message.attachments.join(", ")}` : "") }]
  }), []);

  const runtime = useExternalStoreRuntime({
    messages, isRunning, onNew, onReload, onCancel, convertMessage,
    isSendDisabled: Boolean(privacyDialog) || (needsConsent && !attachmentConsent) || isRunning || compareSendBlocked ||
      controlsPending || !modelId || messages.some((message) => message.role === "assistant" &&
        message.toolCalls?.some((call) => call.status === "waiting"))
  });
  const latestIncompleteId = messages.findLast((item) => item.role === "assistant" && item.status === "incomplete" &&
    !item.backgroundResponseId)?.id;

  async function addAttachment() {
    if (!attachmentConsent) { setPrivacyDialog("pick"); return; }
    await pickFile();
  }

  async function pickFile() {
    try {
      if (pendingRef.current.length >= 4) throw new Error("파일은 한 번에 최대 4개까지 첨부할 수 있습니다.");
      const item = await window.mmllm.pickAttachment(["document", "image"]);
      if (item) setPending((items) => [...items, item].slice(0, 4));
    } catch (error) {
      setError(errorText(error));
    }
  }

  async function importDroppedFiles(files: File[]) {
    try {
      const capacity = 4 - pendingRef.current.length;
      if (capacity <= 0) throw new Error("파일은 한 번에 최대 4개까지 첨부할 수 있습니다.");
      if (files.length > capacity) throw new Error(`파일은 한 번에 최대 4개까지 첨부할 수 있습니다. 현재 ${capacity}개를 더 첨부할 수 있습니다.`);
      const items = await window.mmllm.addDroppedAttachments(
        await readDroppedFiles(files), ["document", "image"]
      );
      setPending((current) => [...current, ...items]);
      setError("");
    } catch (error) { setError(errorText(error)); }
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDropActive(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDropActive(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDropActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    if (thread.target?.kind === "chatbot") { setError("Studio Chatbot은 문서화된 텍스트 메시지만 지원합니다."); return; }
    if (isRunning || controlsPending || privacyDialog) { setError("답변 생성이나 설정 저장이 끝난 뒤 파일을 첨부해 주세요."); return; }
    if (!consentRef.current) {
      droppedFilesRef.current = files;
      setPrivacyDialog("drop");
      return;
    }
    void importDroppedFiles(files);
  }

  async function acknowledgePrivacy() {
    if (privacyBusy) return;
    const action = privacyDialog;
    setPrivacyBusy(true);
    try {
      const updated = await window.mmllm.acknowledgeAttachmentPrivacy(thread.id);
      onThreadUpdated(updated);
      onRefreshThreads();
      setPrivacyDialog(null);
      if (action === "pick") await pickFile();
      if (action === "drop") {
        const files = droppedFilesRef.current;
        droppedFilesRef.current = [];
        await importDroppedFiles(files);
      }
    } catch (error) { setError(errorText(error)); }
    finally { setPrivacyBusy(false); }
  }

  const fixedTemperature = hasFixedTemperature(modelId);
  const claudeNative = selectedModel ? isClaudeModel(selectedModel) : false;
  const claudeThinking = claudeThinkingCapabilities(selectedModel?.id ?? "");
  const claudeSampling = claudeAllowsSampling(selectedModel?.id ?? "");
  const claudeThinkingMode = advancedDraft.claudeThinking?.mode ??
    claudeDefaultThinkingMode(selectedModel?.id ?? "");
  const claudeThinkingActive = claudeThinkingMode !== "off";
  const claudeFullSampling = claudeSampling && !claudeThinkingActive;
  const claudeThinkingRestrictsToolChoice = claudeNative &&
    (claudeThinkingMode === "manual" || claudeForbidsForcedToolChoice(selectedModel?.id ?? ""));
  const geminiNative = selectedModel ? isGeminiModel(selectedModel) : false;
  const openAiModel = selectedModel ? isOpenAiModel(selectedModel) : false;
  let draftToolNames: string[] = [];
  try { const parsed = JSON.parse(toolsDraft) as unknown; if (Array.isArray(parsed)) draftToolNames = parsed
    .flatMap((item) => typeof item === "object" && item && typeof (item as { name?: unknown }).name === "string"
      ? [(item as { name: string }).name] : []); } catch { /* Save displays the validation error. */ }
  draftToolNames = [...new Set(draftToolNames)];
  const selectedToolChoiceValue = typeof advancedDraft.toolChoice === "object"
    ? `tool:${advancedDraft.toolChoice.name}` : advancedDraft.toolChoice ?? "auto";
  const chooseTemplate = async (item: typeof templates[number]) => {
    setControlsPending(true);
    try { await onTemplateStart(item); }
    catch (error) { setError(errorText(error)); }
    finally { setControlsPending(false); }
  };
  const startVisible = messages.length === 0 && !showCompare;
  templateKeysRef.current = { enabled: active && startVisible && !controlsPending, choose: (item) => void chooseTemplate(item) };
  const modelsLocked = isRunning || controlsPending || compareBusy;
  const pickerFallback = () => document.querySelector<HTMLElement>(".chat-panel .composer-input");
  const routeVisible = !chatbotTarget && thread.webSearchMode !== "off";
  // A comparison never uses the models' own search: main runs one billed shared Sonar search and gives the same
  // evidence to every model, so the visible route states that path instead of the primary model's chat route.
  const compareRouteLabel = thread.webSearchMode === "deep"
    ? `비교 웹 근거: 딥리서치 · 최대 5회 조사 + 모델별 합성 · Sonar 공통 검색 추가 요청`
    : thread.webSearchMode === "auto"
      ? `비교 웹 근거: 필요할 때 검색 · Sonar 공통 검색 1회 후 ${composerModels.length}개 모델에 동일하게 제공 · 추가 요청`
      : `비교 웹 근거: 항상 검색 · 공통 1회 · Sonar 공통 검색 후 ${composerModels.length}개 모델에 동일하게 제공 · 추가 요청`;
  const routeLabel = compareMode ? compareRouteLabel
    : thread.webSearchMode === "auto" ? `검색할 때: ${searchRouteLabel}` : searchRouteLabel;
  const footerPrefix = chatbotTarget ? "Studio Chatbot · 원격 감사 로그가 저장될 수 있음"
    : thread.purpose === "meeting-summary" ? "로컬 회의 요약 · 웹 검색 꺼짐" : "";
  return <AssistantRuntimeProvider runtime={runtime}>
    {active && <ChatKeyboardShortcuts messages={messages} running={isRunning} stop={() => stopRef.current?.()} />}
    <ComposerDraft text={initialDraft} onDraftApplied={onDraftApplied} operations={evidenceAppends}
      onEvidenceApplied={onEvidenceApplied} composerRef={composerRef} restoreRef={restoreDraftRef} />
    <div className="chat-panel" onDragEnter={handleDragEnter} onDragOver={(event) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {thread.purpose === "meeting-summary" && <div className="meeting-summary-banner" role="status">
        <ShieldCheck size={15} />로컬 회의 전사를 정리하는 전용 대화입니다. 웹 검색은 꺼져 있으며,
        준비된 구간별 초안을 검토한 뒤 직접 전송합니다.
      </div>}
      <div className="panel-header">
        <div className="panel-heading"><h2 title={thread.title}>{thread.title === "새 대화" ? "새로운 대화" : thread.title}</h2></div>
        {headerSearch}
        <div className="panel-actions">
          {chatbotTarget && <span className="chatbot-target"><Sparkles size={14} />{chatbotTarget.alias}</span>}</div>
      </div>
      {voicePanel}
      <ThreadPrimitive.Root className="chat-thread">
        <ThreadPrimitive.Viewport className="chat-viewport">
          {startVisible && <div className="chat-welcome">
            <span className="eyebrow">KYUNG HEE UNIVERSITY · MEDICAL MBA</span>
            <h1>의료의 미래를 읽고,<br /><em>경영의 답을 설계하다</em></h1>
            <p>질문을 적거나, 아래 주제로 대화를 시작하세요.</p>
            <div className="template-grid" role="group" aria-label="의료경영 시작 가이드">{templates.map((item, index) =>
              <TemplateCard key={item.title} item={item} index={index} disabled={controlsPending}
                onChoose={() => chooseTemplate(item)} />)}</div>
          </div>}
          <ThreadPrimitive.Messages>
            {({ message }) => {
              const stored = messages.find((item) => item.id === message.id);
              return message.role === "user" ? <UserMessage /> : <AssistantMessage
                incomplete={stored?.id === latestIncompleteId}
                continuationUnsupportedReason={stored?.continuationUnsupportedReason}
                disabled={isRunning || controlsPending}
                webSearch={stored?.webSearch}
                usage={stored?.usage}
                credits={stored?.credits}
                messageId={stored?.id ?? message.id} modelId={stored?.modelId} createdAt={stored?.createdAt}
                toolCalls={stored?.toolCalls}
                files={stored?.files}
                reasoningSummary={stored?.reasoningSummary} serverCodeResults={stored?.serverCodeResults}
                onSubmitTool={(messageId, results) => void run("수동 도구 결과를 제출합니다.", false, undefined, undefined, {
                  assistantMessageId: messageId, results
                }).catch((error) => setError(errorText(error)))}
                backgroundResponseId={stored?.backgroundResponseId}
                onCancelBackground={(id) => void window.mmllm.cancelBackgroundResponse(id).then(async () => {
                  const refreshed = await window.mmllm.loadThread(thread.id);
                  setMessages(refreshed.messages); onThreadUpdated(refreshed); onUsageChanged();
                }).catch((error) => setError(errorText(error)))}
                onContinue={() => void run("중단된 답변의 마지막 문장부터 자연스럽게 이어서 답변해 주세요.", false, undefined, stored?.id)
                  .catch((error) => setError(errorText(error)))} />;
            }}
          </ThreadPrimitive.Messages>
          {compare && showCompare && <CompareInline run={compare.run} busy={compare.busy} synthesis={compare.synthesis}
            continueDisabled={compare.continueDisabled} onContinue={compare.onContinue} onError={compare.onError}
            digitKeys={active} />}
          <ThreadPrimitive.ViewportFooter className="chat-footer">
            {needsConsent && <small className="document-scope-note">문서는 전송 한도 안에서는 전체 본문을 전달하고, 한도를 넘으면 관련 부분을 발췌합니다.
              전체 원문을 빠짐없이 검토한 결과가 아닐 수 있으므로, 필요한 페이지·표·항목을 질문에 명시해 주세요.</small>}
            {error && <div className="inline-error" role="alert" aria-live="assertive"><CircleHelp size={16} />{error}
              <button onClick={() => setError("")} type="button" aria-label="오류 닫기"><X size={14} /></button></div>}
            {error && <DiagnosticButton stage="chat" modelId={modelId} />}
            {progress && <div className="inline-progress" role="status" aria-live="polite"><LoaderCircle className="spin" size={15} />{progress}</div>}
            <ComposerPrimitive.Root className={dropActive ? "composer-card drop-active" : "composer-card"}>
              {dropActive && <div className="composer-drop-hint"><Paperclip size={18} />
                PDF·Word·Excel·PPT·한글·텍스트·이미지를 여기에 놓으세요</div>}
              {!chatbotTarget && <div className="composer-models" role="group" aria-label="대화 모델">
                <ModelPicker models={displayModels} selected={modelId} onSelect={choosePrimaryModel} disabled={modelsLocked}
                  compare={compare ? { ids: composerModels, onAdd: addCompareModel } : undefined} restoreFallback={pickerFallback} />
                {composerModels.slice(1).map((id, offset) => <span className="composer-compare-token" key={`slot-${offset}`}>
                  <ModelPicker models={displayModels} selected={id} variant="compare" disabled={modelsLocked}
                    onSelect={(next) => replaceCompareModel(offset + 1, next)} unavailable={unavailableForCompare}
                    compare={{ ids: composerModels, onAdd: addCompareModel }} restoreFallback={pickerFallback}
                    openRequest={tokenPickerRequest?.index === offset + 1 ? tokenPickerRequest.id : undefined} />
                  <button type="button" className="composer-token-remove" disabled={modelsLocked}
                    aria-label={`${modelLabel(id)} 비교에서 제거`} title={`${modelLabel(id)} 비교에서 제거`}
                    onClick={() => setCompareExtras((items) => items.filter((item) => item !== id))}><X size={12} aria-hidden="true" /></button>
                </span>)}
                {compare && <ModelPicker models={displayModels} selected="" variant="add" onSelect={(id) => void addCompareModel(id)}
                  disabled={modelsLocked || composerModels.length >= MAX_COMPARE_MODELS} unavailable={unavailableForCompare}
                  compare={{ ids: composerModels, onAdd: addCompareModel }} restoreFallback={pickerFallback} />}
              </div>}
              {pending.length > 0 && <div className="attachment-row">
                {pending.map((item) => <span className="attachment-chip" key={item.id}>
                  {item.kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
                  {item.name}<button type="button" aria-label={`${item.name} 첨부 제거`} disabled={compareBusy} onClick={() => {
                    void window.mmllm.discardAttachments([item.id]);
                    setPending((items) => items.filter((attached) => attached.id !== item.id));
                  }}><X size={13} /></button>
                </span>)}
              </div>}
              <ComposerPrimitive.Input placeholder="질문이나 아이디어를 적어주세요..."
                className="composer-input" rows={2} addAttachmentOnPaste={false} />
              <div className="composer-bottom">
                {!chatbotTarget && <button type="button" className="attach-button" onClick={addAttachment}
                  disabled={isRunning || controlsPending || compareBusy || Boolean(privacyDialog)} title="PDF·Word·Excel·PPT·한글·텍스트·이미지 첨부">
                  <Paperclip size={16} aria-hidden="true" /><span className="sr-only">파일 첨부</span>
                </button>}
                {!chatbotTarget && <ComposerMenu name="웹 검색 방식" icon={<Globe2 size={14} aria-hidden="true" />}
                  value={thread.webSearchMode} options={WEB_MODES}
                  disabled={isRunning || compareBusy || thread.purpose === "meeting-summary"} busy={controlsPending}
                  onChoose={(mode) => void setSearchMode(mode)} />}
                {!chatbotTarget && reasoning === "adjustable" && <ComposerMenu name="사고 강도"
                  icon={<Brain size={14} aria-hidden="true" />} value={thread.reasoningMode} options={REASONING_MODES}
                  disabled={isRunning} busy={controlsPending}
                  onChoose={(mode) => void saveThreadControls(mode, thread.instruction, thread.advanced)} />}
                {!chatbotTarget && reasoning === "native-required" && <span className="reasoning-unavailable"
                  title="Claude 네이티브 Messages API 전환 후 조절할 수 있습니다.">사고 강도: 자동</span>}
                {!chatbotTarget && reasoning === "model-managed" && <span className="reasoning-unavailable"
                  title="이 모델은 사고 기능을 모델 내부에서 자동으로 관리합니다.">사고 가능 · 모델 자동</span>}
                {!chatbotTarget && <button type="button" className="icon-button composer-settings" aria-label="대화 설정" title="대화 설정"
                  disabled={isRunning || controlsPending}
                  onClick={() => { setInstructionDraft(thread.instruction); setAdvancedDraft(thread.advanced); setChatSettingsOpen(true); }}>
                  <Settings size={15} /></button>}
                <span className="composer-hint" aria-hidden="true">↵ 전송 · ⇧↵ 줄바꿈</span>
                {compareMode && compare?.busy
                  ? <button type="button" className="send-button stop" title="비교 중단" aria-label="비교 중단"
                    onClick={compare.onStop}><Square size={14} /></button>
                  : isRunning
                    ? <ComposerPrimitive.Cancel className="send-button stop" title="생성 중단" aria-label="생성 중단"><Square size={14} /></ComposerPrimitive.Cancel>
                    : <ComposerPrimitive.Send className="send-button" title="전송" aria-label="메시지 전송"
                      disabled={compareMode ? compareSendBlocked : Boolean(sonarRestriction) || !selectedModel && !chatbotTarget}><ArrowUp size={16} /></ComposerPrimitive.Send>}
              </div>
            </ComposerPrimitive.Root>
            {compareMode && pending.length > 0 && <div className="composer-compare-consent">
              <label className="deid-check"><input type="checkbox" checked={compareConfirmed} disabled={compareBusy}
                aria-describedby={!compareConfirmed ? "compare-consent-hint" : undefined}
                onChange={(event) => setCompareConfirmed(event.target.checked)} />
                <span>환자 식별정보나 개인정보를 제거했습니다. 자료는 선택한 모델 수만큼 외부 전송·과금될 수 있습니다.</span></label>
              {!compareConfirmed && <p id="compare-consent-hint" className="notice-info" role="status">첨부 자료를 전송하려면 위 확인란을 체크해 주세요.</p>}
            </div>}
            {compareModelError && <div className="inline-error" role="status">Sonar는 검색 끄기가 확인되지 않아 비교 답변에 사용할 수 없습니다. Sonar 선택을 해제하고 다른 모델을 직접 선택해 주세요.</div>}
            {routeVisible && <div className="composer-route"><Globe2 size={13} aria-hidden="true" />
              <span role="status">{routeLabel}</span>
              {thread.webSearchMode !== "deep" && !compareMode && <button type="button" className="text-button" disabled={isRunning || controlsPending || !selectedModel}
                onClick={async () => {
                  const id = modelId; const owner = thread.id; setControlsPending(true); setError("");
                  try {
                    const capability = await window.mmllm.checkModelSearch(id);
                    if (aliveRef.current && modelRef.current === id && threadIdRef.current === owner) setCheckedSearch({ id, capability });
                  } catch (error) { if (aliveRef.current && threadIdRef.current === owner) setError(errorText(error)); }
                  finally { if (aliveRef.current) setControlsPending(false); }
                }}>검색 기능 확인</button>}
            </div>}
            {selectedModel && nativeSearchProvider(selectedModel) === "sonar" && thread.webSearchMode === "auto" &&
              <div className="chat-checkline" role="status">Sonar 자동 모드는 일반 질문에서도 모델 자체 검색이 실행될 수 있습니다.</div>}
            {sonarRestriction && !compareMode && <div className="inline-error" role="status">{sonarRestriction}</div>}
            {searchSettingsError && !compareMode && <div className="inline-error" role="status">{searchSettingsError}</div>}
            {!selectedModel && !chatbotTarget && <div className="inline-error" role="status">현재 사용할 수 있는 모델을 직접 선택해 주세요.</div>}
            <p className="composer-notice">{footerPrefix && <>{footerPrefix} · </>}
              {needsConsent && !attachmentConsent
                ? <><button type="button" className="privacy-confirm-link"
                    onClick={() => setPrivacyDialog("history")}>첨부 자료 전송 확인</button> · </>
                : needsConsent ? "이 대화의 첨부 자료는 API로 다시 전송될 수 있습니다 · " : "환자 식별정보는 전송 전에 직접 제거해 주세요 · "}
              대화 기록은 이 기기에 암호화 저장됩니다</p>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
      {privacyDialog && <div className="privacy-modal-backdrop" role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !privacyBusy) closePrivacy();
        }}>
        <div className="privacy-modal" role="dialog" aria-modal="true" ref={privacyRef} tabIndex={-1}
          aria-labelledby="privacy-modal-title" aria-describedby="privacy-modal-detail">
          <div className="privacy-modal-icon"><ShieldCheck size={23} /></div>
          <h3 id="privacy-modal-title">환자 식별정보나 개인정보를 제거하셨습니까?</h3>
          <p id="privacy-modal-detail">첨부 자료는 ChatKHU API로 전송됩니다.<br />
            사용은 가능하지만 책임은 본인에게 있습니다.</p>
          <div className="privacy-modal-actions">
            <button type="button" onClick={closePrivacy} disabled={privacyBusy}>취소</button>
            <button type="button" className="privacy-modal-primary"
              onClick={() => void acknowledgePrivacy()} disabled={privacyBusy}>제거했고 계속하기</button>
          </div>
          <small>이 대화에서는 한 번만 확인합니다</small>
        </div>
      </div>}
      {chatSettingsOpen && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !controlsPending) closeChatSettings();
      }}>
        <div className="dialog-card chat-settings-dialog" role="dialog" aria-modal="true" tabIndex={-1}
          aria-labelledby="chat-settings-title" ref={chatSettingsRef}>
          <div className="dialog-title"><Settings size={21} /><h3 id="chat-settings-title">대화 설정</h3></div>
          <label className="settings-field">이 대화의 추가 지침
            <textarea value={instructionDraft} onChange={(event) => setInstructionDraft(event.target.value)}
              maxLength={12000} placeholder="전역 기본 지침보다 구체적인 지침을 적어 주세요." />
          </label>
          <div className="advanced-grid">
            {(!claudeNative || claudeFullSampling) && <label>Temperature
              <input type="number" min="0" max={claudeNative ? 1 : 2} step="0.1"
                disabled={fixedTemperature}
                value={fixedTemperature ? 1 : advancedDraft.temperature ?? ""}
                onChange={(event) => setAdvancedDraft((value) => ({ ...value,
                  temperature: event.target.value === "" ? undefined : Number(event.target.value) }))} />
              <small>{fixedTemperature ? "이 모델은 공식 API에서 1만 허용합니다."
                : claudeNative ? "Claude 네이티브 0–1" : "0–2 · 비워두면 모델 기본값"}</small>
            </label>}
            <label>최대 출력 토큰
              <input type="number" min="128" max="65536" step="128"
                value={advancedDraft.maxOutputTokens ?? ""}
                onChange={(event) => setAdvancedDraft((value) => ({ ...value,
                  maxOutputTokens: event.target.value === "" ? undefined : Number(event.target.value) }))} />
              <small>128–65,536 · 비워두면 모델 기본값</small>
            </label>
            {(!claudeNative || claudeSampling) && <label>Top P
              <input type="number" min={claudeNative && claudeThinkingActive ? .95 : 0} max="1" step="0.05" value={advancedDraft.topP ?? ""}
                onChange={(event) => setAdvancedDraft((value) => ({ ...value,
                  topP: event.target.value === "" ? undefined : Number(event.target.value) }))} />
              <small>{claudeNative && claudeThinkingActive
                ? "사고 모드에서는 0.95–1" : "0–1 · Temperature와 함께 과도하게 조정하지 마세요"}</small>
            </label>}
            {claudeNative && claudeFullSampling && <label>Top K
              <input type="number" min="1" step="1" value={advancedDraft.topK ?? ""}
                onChange={(event) => setAdvancedDraft((value) => ({ ...value,
                  topK: event.target.value === "" ? undefined : Number(event.target.value) }))} />
              <small>Claude 네이티브 정수 옵션</small>
            </label>}
            {claudeNative && !claudeFullSampling && <div><small>{claudeSampling
              ? "사고 모드에서는 Temperature와 Top K를 사용하지 않으며 Top P는 0.95–1만 허용됩니다."
              : "Claude 4.7 이상은 현재 계약에서 비기본 sampling 값을 사용하지 않습니다."}</small>
              {(advancedDraft.temperature !== undefined || advancedDraft.topK !== undefined ||
                !claudeSampling && advancedDraft.topP !== undefined) && <button type="button"
                className="secondary-button" onClick={() => setAdvancedDraft((value) => ({ ...value,
                  temperature: undefined, topK: undefined,
                  ...(!claudeSampling ? { topP: undefined } : {}) }))}>기존 sampling 값 지우기</button>}</div>}
            {!claudeNative && <label>중단 문자열 · 최대 4개
              <input value={(advancedDraft.stop ?? []).join(" | ")}
                onChange={(event) => setAdvancedDraft((value) => ({ ...value,
                  stop: event.target.value ? event.target.value.split("|").map((item) => item.trim()).filter(Boolean) : undefined }))} />
              <small>| 로 구분합니다</small>
            </label>}
          </div>
          {geminiNative && <fieldset className="advanced-section"><legend>Gemini 사고 설정</legend>
            <label>사고 수준<select value={advancedDraft.thinkingLevel ?? ""}
              onChange={(event) => setAdvancedDraft((value) => ({ ...value,
                thinkingLevel: (event.target.value || undefined) as ChatAdvancedSettings["thinkingLevel"],
                ...(event.target.value ? { thinkingBudget: undefined } : {}) }))}>
              <option value="">모델 기본값</option><option value="minimal">minimal</option>
              <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
            </select></label>
            <label>사고 예산<input type="number" min="-1" step="1" disabled={Boolean(advancedDraft.thinkingLevel)}
              value={advancedDraft.thinkingBudget ?? ""} onChange={(event) => setAdvancedDraft((value) => ({ ...value,
                thinkingBudget: event.target.value === "" ? undefined : Number(event.target.value) }))} /></label>
            <small>수준과 예산은 서로 배타적입니다. 0 또는 -1은 모델 자동입니다.</small>
          </fieldset>}
          {claudeNative && <fieldset className="advanced-section"><legend>Claude 네이티브 사고</legend>
            <label>모드<select value={claudeThinkingMode}
              onChange={(event) => setAdvancedDraft((value) => { const mode = event.target.value as "off" | "adaptive" | "manual";
                return { ...value, claudeThinking: { ...value.claudeThinking, mode,
                  ...(mode === "manual" ? { budgetTokens: value.claudeThinking?.budgetTokens ?? 1024 } : {}) } }; })}>
              {claudeThinking.canDisable && <option value="off">끄기</option>}
              {claudeThinking.adaptive && <option value="adaptive">적응형 · 4.6 이상</option>}
              {claudeThinking.manual && <option value="manual">수동 예산</option>}
            </select></label>
            {claudeThinkingMode === "adaptive" && <label>노력 수준<select
              value={advancedDraft.claudeThinking?.effort ?? "high"}
              onChange={(event) => setAdvancedDraft((value) => ({ ...value, claudeThinking: {
                ...value.claudeThinking, mode: "adaptive",
                effort: event.target.value as "low" | "medium" | "high" | "xhigh" | "max"
              } }))}>{claudeThinking.efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select></label>}
            {advancedDraft.claudeThinking?.mode === "manual" && <label>사고 토큰 예산<input type="number"
              min="1024" max="200000" step="1024" value={advancedDraft.claudeThinking.budgetTokens ?? 1024}
              onChange={(event) => setAdvancedDraft((value) => ({ ...value, claudeThinking: {
                ...value.claudeThinking!, budgetTokens: Number(event.target.value)
              } }))} /></label>}
            <small>사고 내용과 signature는 화면·내보내기에 표시하지 않습니다. 도구 호출을 이어갈 때만 암호화 저장하고 해당 도구 턴이 끝나면 제거합니다.</small>
            <button type="button" className="secondary-button" disabled={controlsPending} onClick={() => {
              setControlsPending(true); setCountedTokens(null);
              void window.mmllm.countClaudeInputTokens(thread.id).then((value) => setCountedTokens(value.inputTokens))
                .catch((error) => setError(errorText(error))).finally(() => setControlsPending(false));
            }}>현재 입력 토큰 계산</button>
            {countedTokens !== null && <output aria-live="polite">현재 입력 {countedTokens.toLocaleString()} 토큰</output>}
          </fieldset>}
          {openAiModel && <fieldset className="advanced-section"><legend>OpenAI Responses</legend>
            <label><input type="checkbox" checked={Boolean(advancedDraft.responses?.background)}
              onChange={(event) => setAdvancedDraft((value) => ({ ...value,
                responses: { ...value.responses, background: event.target.checked } }))} />백그라운드 실행</label>
            <label><input type="checkbox" checked={Boolean(advancedDraft.responses?.chain)}
              onChange={(event) => setAdvancedDraft((value) => ({ ...value,
                responses: { ...value.responses, chain: event.target.checked } }))} />응답 체인 사용</label>
            <label>추론 요약<select value={advancedDraft.responses?.reasoningSummary ?? ""}
              onChange={(event) => setAdvancedDraft((value) => ({ ...value, responses: { ...value.responses,
                reasoningSummary: (event.target.value || undefined) as "auto" | "none" | undefined } }))}>
              <option value="">지정 안 함</option><option value="auto">auto</option><option value="none">none</option>
            </select></label>
            <small>체인을 켜면 이전 response id와 최신 입력만 전송하며 로컬 전체 대화 재전송은 사용하지 않습니다.</small>
          </fieldset>}
          {!claudeNative && <label className="settings-field">Strict JSON Schema 구조화 출력
            <textarea value={structuredSchemaDraft} onChange={(event) => setStructuredSchemaDraft(event.target.value)}
              placeholder={'{"type":"object","properties":{},"required":[],"additionalProperties":false}'} />
            <small>루트 object · 모든 object의 additionalProperties false · 최대 64KB</small>
          </label>}
          <fieldset className="advanced-section"><legend>서버 코드 실행</legend>
            <label><input type="checkbox" aria-label="서버 코드 실행 사용" checked={Boolean(advancedDraft.serverCode)}
              disabled={!selectedModel || !serverCodeProvider(selectedModel) && !advancedDraft.serverCode}
              onChange={(event) => setAdvancedDraft((value) => ({ ...value, serverCode: event.target.checked }))} />서버 코드 실행 사용 · 기본 꺼짐</label>
            <small>{CODE_BILLING_NOTICE}</small>
            <small>{selectedModel && serverCodeProvider(selectedModel) ? "공식 지원 모델 · 현재 계정 목록에 있음. 도구별 권한은 서버가 최종 확인합니다." : "선택한 모델의 코드 실행 지원 미확인 · 사용 불가"}</small>
            {claudeNative && <small>코드 실행과 수동 함수 도구를 함께 사용하려면 Claude 사고 모드를 꺼 주세요.</small>}
            <small>코드·첨부 자료도 제공사로 전송됩니다. 기존 첨부 전송 확인이 필요합니다.</small>
            <small>{CODE_ARTIFACT_NOTICE}</small>
          </fieldset>
          <label className="settings-field">수동 function 도구 정의 JSON
            <textarea value={toolsDraft} onChange={(event) => setToolsDraft(event.target.value)}
              placeholder={'[{"name":"lookup_metric","description":"...","parameters":{"type":"object","properties":{},"required":[],"additionalProperties":false}}]'} />
            <small>최대 4개. MM_LLM은 도구를 자동 실행하지 않으며, 호출 카드에서 사용자가 JSON 결과를 직접 제출합니다.</small>
          </label>
          {toolsDraft.trim() && <label className="settings-field">도구 선택 방식
            <select value={selectedToolChoiceValue}
              onChange={(event) => setAdvancedDraft((value) => ({ ...value, toolChoice: event.target.value.startsWith("tool:")
                ? { name: event.target.value.slice(5) } : event.target.value as "auto" | "none" | "required" }))}>
              <option value="auto">auto</option><option value="none">none</option>
              <option value="required" disabled={claudeThinkingRestrictsToolChoice}>required</option>
              {draftToolNames.map((name) => <option key={name} value={`tool:${name}`}
                disabled={claudeThinkingRestrictsToolChoice}>{name} 도구 지정</option>)}
            </select>
            {claudeThinkingRestrictsToolChoice && <small>{claudeThinkingMode === "manual"
              ? "Claude 수동 사고에서는 auto 또는 none만 사용할 수 있습니다."
              : "이 모델은 required 또는 지정 도구 선택을 지원하지 않습니다."}</small>}
          </label>}
          <div className="dialog-actions"><button type="button" className="secondary-button"
            onClick={closeChatSettings} disabled={controlsPending}>취소</button><button type="button" className="primary-button"
            onClick={() => void saveChatSettings()} disabled={controlsPending}>{controlsPending ? "저장 중…" : "저장"}</button></div>
        </div>
      </div>}
    </div>
  </AssistantRuntimeProvider>;
}
