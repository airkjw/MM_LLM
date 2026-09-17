import { isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ActionBarPrimitive, AssistantRuntimeProvider, ComposerPrimitive,
  MessagePrimitive, ThreadPrimitive, useAui, useExternalStoreRuntime,
  type ThreadMessageLike
} from "@assistant-ui/react";
import {
  ArrowRight, ArrowUp, BookOpen, Bot, Check, ChevronDown, CircleHelp, Columns3, Copy,
  Download, Edit3, FileText, Globe2, HeartPulse, Image as ImageIcon, LoaderCircle,
  FolderOpen, MessageCircle, Mic2, Music2, Paperclip, Plus,
  RefreshCw, Search, Settings, ShieldCheck, Sparkles, Square, Trash2, Video, X
} from "lucide-react";
import type {
  AppSettings, AudioRequest, ChatAdvancedSettings, ChatEvent, ChatRequest,
  ChatbotBookmark, ChatbotUsageReport, CompareEvent, CompareRun, CompareSynthesisEvent, DroppedAttachment, GatewayModel, MediaResult, PendingMediaJob,
  PickedAttachment, ProjectSummary, PublicMessage, ReasoningMode, SessionState, ThreadSearchResult,
  ThreadSnapshot, ThreadSummary, UpdateState, WebSearchMode
} from "../../shared/contracts";
import { modelLabel, providerLabel } from "./model-names";
import { hasNativeWebSearch } from "../../shared/web-search";
import { markdownImagePresentation } from "../../shared/markdown-security";
import { hasFixedTemperature, reasoningSupport } from "../../shared/chat-options";
import { LatestRequestGate } from "../../shared/request-generation";
import { isPristineThread } from "../../shared/thread-state";
import { staleRefreshDelay } from "../../shared/refresh-policy";
import {
  imageCapability, imageEstimate, isRecentlyAdded, musicCapability, musicEstimate,
  audioLaneForModel, sttEstimate, supportsMultiSpeakerTts, TTS_VOICES, videoCapability, videoEstimate
} from "../../shared/media-capabilities";
import {
  buildMeetingReductionRound, buildMeetingSummaryPlan, MEETING_SUMMARY_INSTRUCTION,
  transcriptForChat, formatTranscriptTimestamp
} from "../../shared/meeting-transcript";
import { resolveLiveThreadModel } from "../../shared/model-catalog";
import { assertDroppedFileBatch } from "../../shared/drop-limits";
import {
  claudeAllowsSampling, claudeDefaultThinkingMode, claudeForbidsForcedToolChoice, claudeThinkingCapabilities,
  isClaudeModel, isGeminiModel, isOpenAiModel
} from "../../shared/advanced-chat";
import { Sidebar, type FocusReturnTarget, type SidebarScreen } from "./components/Sidebar";
import { useDialogFocus } from "./use-focus-layer";
import { useResponsiveSidebarState } from "./sidebar-responsive";
import { ThemePersistence } from "./theme-persistence";
import { appShortcutBlocked, hasBlockingModal } from "./shortcut-policy";
import { canSynthesizeCompare, COMPARE_SYNTHESIS_MODEL_ID } from "../../shared/compare-synthesis";

type Screen = SidebarScreen;
type RenameDialogState = { thread: ThreadSummary; value: string; busy: boolean; error: string };
const AUDIO_LANES = ["tts", "stt", "music"] as const;

const templates = [
  { icon: HeartPulse, title: "병원 경영", detail: "운영 지표와 개선 과제", prompt: "분석할 병원의 현황이나 운영 지표를 적어 주세요.", instruction: "병원 운영 자료를 재무·환자경험·프로세스·인력 관점에서 분석하세요. 개선 과제는 영향도와 실행 가능성을 기준으로 우선순위를 제시하고, 필요한 지표가 없으면 먼저 질문하세요." },
  { icon: BookOpen, title: "의료 정책", detail: "제도 변화와 영향", prompt: "검토할 의료 정책이나 제도 변화를 적어 주세요.", instruction: "의료 정책을 환자·의료기관·보건의료인·정부 등 이해관계자별로 분석하세요. 최신 1차 근거를 우선하고 시행 시점, 적용 범위, 불확실성을 구분하세요." },
  { icon: FileText, title: "논문 읽기", detail: "핵심 주장과 한계", prompt: "논문을 첨부하고 특히 확인할 질문을 적어 주세요.", instruction: "논문의 연구 질문, 설계, 표본, 변수, 분석 방법, 주요 결과, 의료경영 시사점과 한계를 구분해 요약하세요. 원문에 없는 결론은 추정이라고 표시하고, 가능한 경우 표와 근거 위치를 제시하세요." },
  { icon: Sparkles, title: "연구 설계", detail: "질문에서 방법까지", prompt: "발전시키고 싶은 의료경영 연구 주제를 적어 주세요.", instruction: "연구 주제를 석사 논문 수준의 연구 질문, 이론적 근거, 가설, 조작적 변수, 자료 수집, 분석 계획으로 발전시키세요. 윤리·편향·실행 가능성과 연구의 한계를 함께 검토하세요." }
];

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

async function readDroppedFiles(files: File[]): Promise<DroppedAttachment[]> {
  assertDroppedFileBatch(files);
  const output: DroppedAttachment[] = [];
  // Read sequentially so a valid 64MB batch cannot transiently double memory through Promise fan-out.
  for (const file of files) output.push({ name: file.name, bytes: await file.arrayBuffer() });
  return output;
}

function ModelPicker({
  models, selected, onSelect, disabled = false
}: {
  models: GatewayModel[]; selected: string; onSelect: (id: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popoverId = useMemo(() => `model-picker-${crypto.randomUUID()}`, []);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); setOpen(false); setQuery(""); trigger.current?.focus();
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [open]);
  const filtered = models.filter((model) =>
    `${modelLabel(model.id)} ${model.id} ${providerLabel(model.owned_by)}`
      .toLowerCase().includes(query.toLowerCase())
  );
  const groups = filtered.reduce<Record<string, GatewayModel[]>>((acc, model) => {
    const provider = providerLabel(model.owned_by);
    (acc[provider] ??= []).push(model);
    return acc;
  }, {});
  return (
    <div className="model-picker" ref={container}>
      <button ref={trigger}
        className="model-trigger" type="button" aria-expanded={open} aria-haspopup="listbox"
        aria-controls={popoverId}
        onKeyDown={(event) => {
          if (!disabled && ["ArrowDown", "Enter", " "].includes(event.key) && !open) {
            event.preventDefault(); setOpen(true);
          }
        }}
        onClick={() => { if (!disabled) setOpen(!open); }} disabled={disabled}
      >
        <span className="model-dot" />
        <span className="model-trigger-text">{selected ? modelLabel(selected) : "모델 선택"}</span>
        {selected && hasNativeWebSearch(selected) && <Globe2 className="model-trigger-web" size={14} />}
        <ChevronDown size={16} />
      </button>
      {open && <div className="model-popover" id={popoverId} role="dialog" aria-label="모델 선택">
        <div className="model-search"><Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="모델 검색"
            placeholder="모델 이름 또는 ID 검색" autoFocus />
        </div>
        <div className="model-count">현재 API 키로 사용 가능한 모델 {models.length}개</div>
        <div className="model-options" role="listbox" aria-label="사용 가능한 모델">
          {Object.entries(groups).map(([provider, items]) => (
            <div key={provider} role="group" aria-label={provider}>
              <div className="model-group" aria-hidden="true">{provider}</div>
              {items.map((model) => <button
                type="button" className={model.id === selected ? "model-option selected" : "model-option"}
                role="option" aria-selected={model.id === selected}
                key={model.id} onClick={() => { onSelect(model.id); setOpen(false); setQuery(""); }}
              >
                <span><strong>{modelLabel(model.id)}</strong><small>{model.id}</small></span>
                <span className="model-badges">
                  {hasNativeWebSearch(model.id) && <span className="native-search-badge">
                    <Globe2 size={12} />직접 웹검색
                  </span>}
                  {reasoningSupport(model) === "adjustable" && <span className="reasoning-badge">
                    <Sparkles size={12} />강도 조절
                  </span>}
                  {reasoningSupport(model) === "native-required" && <span className="reasoning-badge automatic">
                    <Sparkles size={12} />사고 지원 · 자동
                  </span>}
                  {reasoningSupport(model) === "model-managed" && <span className="reasoning-badge automatic">
                    <Sparkles size={12} />사고 가능 · 모델 자동
                  </span>}
                  {isRecentlyAdded(model.created) && <span className="new-model-badge">신규</span>}
                </span>
                {model.id === selected && <Check size={17} />}
              </button>)}
            </div>
          ))}
          {!filtered.length && <div className="empty-models">검색 결과가 없습니다.</div>}
          <div className="model-permission-note">표시되는 모델은 현재 API 키의 조직·그룹 권한에 따라 달라집니다.</div>
        </div>
      </div>}
    </div>
  );
}

function DeidCheck({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="deid-check">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="custom-check">{checked && <Check size={12} />}</span>
    <span>환자 식별정보를 제거한 자료만 전송합니다</span>
    <ShieldCheck size={15} />
  </label>;
}

function TemplateCard({ item, onChoose, disabled }: {
  item: typeof templates[number]; onChoose: () => Promise<void>; disabled: boolean;
}) {
  const Icon = item.icon;
  return <button type="button" className="template-card"
    onClick={() => void onChoose()} disabled={disabled}>
    <span className="template-icon"><Icon size={19} /></span>
    <strong>{item.title}</strong><small>{item.detail}</small>
    <ArrowRight size={16} className="template-arrow" />
  </button>;
}

function ComposerPrefill({ text, onApplied }: { text?: string; onApplied: () => void }) {
  const aui = useAui();
  useEffect(() => {
    if (!text) return;
    aui.composer.setText(text);
    onApplied();
  }, [aui, text, onApplied]);
  return null;
}

function UserMessage() {
  return <MessagePrimitive.Root className="message-row user">
    <div className="message-bubble user-bubble"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>;
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

function MarkdownText({ text }: { text: string }) {
  return <div className="markdown-text"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => {
      const safe = typeof href === "string" && href.startsWith("https://") &&
        !/^https:\/\/factchat-cloud\.mindlogic\.ai\/v1\/public\/f\//i.test(href);
      return safe ? <a href={href} onClick={(event) => {
        event.preventDefault(); void window.mmllm.openExternal(href);
      }}>{children}</a> : <span>{children}</span>;
    },
    pre: ({ children }) => <div className="code-block"><button type="button" title="코드 복사"
      onClick={() => void navigator.clipboard.writeText(nodeText(children))}><Copy size={14} /> 복사</button>
      <pre>{children}</pre></div>,
    table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>
    ,img: ({ src, alt }) => {
      const image = markdownImagePresentation(src, alt);
      return image.externalUrl
        ? <a href={image.externalUrl} onClick={(event) => { event.preventDefault();
          void window.mmllm.openExternal(image.externalUrl!); }}>[{image.label} 링크]</a>
        : <span>[{image.label}]</span>;
    }
  }}>{text}</ReactMarkdown></div>;
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
  messageId, toolCalls, files, reasoningSummary, onSubmitTool }: {
  incomplete: boolean; onContinue: () => void; disabled: boolean; usage?: PublicMessage["usage"]; credits?: number;
  backgroundResponseId?: string; onCancelBackground: (id: string) => void;
  messageId: string; toolCalls?: PublicMessage["toolCalls"];
  files?: PublicMessage["files"];
  reasoningSummary?: string;
  onSubmitTool: (messageId: string, results: Array<{ toolCallId: string; result: string }>) => void;
}) {
  return <MessagePrimitive.Root className="message-row assistant">
    <span className="assistant-avatar"><Sparkles size={16} /></span>
    <div className="assistant-message-column">
      <div className="message-bubble assistant-bubble"><MessagePrimitive.Parts components={{ Text: MarkdownText }} /></div>
      {reasoningSummary && <details className="reasoning-summary">
        <summary>추론 요약</summary><p>{reasoningSummary}</p>
      </details>}
      <ActionBarPrimitive.Root className="message-actions" hideWhenRunning>
        <ActionBarPrimitive.Copy title="복사"><Copy size={15} /></ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload title="다시 생성"><RefreshCw size={15} /></ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
      {toolCalls?.length ? <ManualToolCards messageId={messageId} calls={toolCalls} disabled={disabled}
        onSubmit={onSubmitTool} /> : null}
      {files?.length ? <div className="chatbot-files">{files.filter((file) => Date.parse(file.expiresAt) > Date.now())
        .map((file) => <button type="button" key={file.id} disabled={disabled}
          onClick={() => void window.mmllm.saveRemoteMedia(file.mediaUrl, file.name)}><Download size={13} />{file.name}</button>)}</div> : null}
      {backgroundResponseId ? <div className="incomplete-actions" role="status" aria-live="polite">
        <span>백그라운드 응답 처리 중</span>
        <button type="button" onClick={() => onCancelBackground(backgroundResponseId)} disabled={disabled}>취소</button>
      </div> : incomplete && <div className="incomplete-actions"><span>중단된 답변</span>
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

function ChatPanel({
  thread, modelId, models, onModelChange, onThreadUpdated, onRefreshThreads, onUsageChanged,
  onTemplateStart, initialDraft, onDraftApplied
}: {
  thread: ThreadSnapshot; modelId: string; models: GatewayModel[];
  onModelChange: (id: string) => void;
  onThreadUpdated: (snapshot: ThreadSnapshot) => void;
  onRefreshThreads: () => void;
  onUsageChanged: () => void;
  onTemplateStart: (item: typeof templates[number]) => Promise<void>;
  initialDraft?: string;
  onDraftApplied: () => void;
}) {
  const [messages, setMessages] = useState<PublicMessage[]>(thread.messages);
  const [pending, setPending] = useState<PickedAttachment[]>([]);
  const [attachmentConsent, setAttachmentConsent] = useState(thread.attachmentConsent);
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
  const [countedTokens, setCountedTokens] = useState<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const settleRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef(pending);
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

  useEffect(() => () => {
    aliveRef.current = false;
    stopRef.current?.();
    const stale = pendingRef.current.map((item) => item.id);
    if (stale.length) void window.mmllm.discardAttachments(stale);
  }, []);

  const run = useCallback(async (text: string, regenerate = false, regenerateAfterId?: string,
    continueIncompleteId?: string, toolResults?: ChatRequest["toolResults"]) => {
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
        { id: assistantId, role: "assistant", text: "", createdAt: now }]);
    } else if (regenerate) {
      const after = regenerateAfterId
        ? messagesRef.current.findIndex((item) => item.id === regenerateAfterId)
        : messagesRef.current.findLastIndex((item) => item.role === "user");
      setMessages((previous) => [
        ...previous.slice(0, after + 1),
        { id: assistantId, role: "assistant", text: "", createdAt: now }
      ]);
    } else {
      setMessages((previous) => [
        ...previous,
        { id: crypto.randomUUID(), role: "user", text, createdAt: now,
          attachments: attachments.map((item) => item.name) },
        { id: assistantId, role: "assistant", text: "", createdAt: now }
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
  }, [thread.id, onThreadUpdated, onRefreshThreads, onUsageChanged]);

  const onNew = useCallback(async (message: { content: readonly { type: string; text?: string }[] }) => {
    const text = message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim();
    if (!text) return;
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
      !window.confirm("이 답변부터 다시 생성하면 이후 대화가 사라집니다. 계속할까요?")) return;
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
  const chatbotTarget = thread.target?.kind === "chatbot" ? thread.target : undefined;
  const reasoning = selectedModel ? reasoningSupport(selectedModel) : "none";

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
    isSendDisabled: Boolean(privacyDialog) || (needsConsent && !attachmentConsent) || isRunning ||
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
      setAttachmentConsent(true);
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
  return <AssistantRuntimeProvider runtime={runtime}>
    <ChatKeyboardShortcuts messages={messages} running={isRunning} stop={() => stopRef.current?.()} />
    <ComposerPrefill text={initialDraft} onApplied={onDraftApplied} />
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
        <div><h2>{thread.title === "새 대화" ? "새로운 대화" : thread.title}</h2></div>
        <div className="panel-actions">{!chatbotTarget && <><label className="web-mode"><Globe2 size={14} />
          <select value={thread.webSearchMode} disabled={isRunning || controlsPending || thread.purpose === "meeting-summary"}
            onChange={(event) => void setSearchMode(event.target.value as WebSearchMode)}>
            <option value="always">웹검색 항상</option><option value="auto">웹검색 자동</option>
            <option value="deep">딥리서치 · 최대 6회 호출</option>
            <option value="off">웹검색 끄기</option>
          </select></label>
          {reasoning === "adjustable" && <label className="reasoning-mode" title="모델의 추론 강도">
            <Sparkles size={14} /><select value={thread.reasoningMode} disabled={isRunning || controlsPending}
              onChange={(event) => void saveThreadControls(event.target.value as ReasoningMode,
                thread.instruction, thread.advanced)} aria-label="사고 강도">
              <option value="auto">자동</option><option value="fast">빠르게</option>
              <option value="balanced">균형</option><option value="deep">깊게</option>
            </select></label>}
          {reasoning === "native-required" && <span className="reasoning-unavailable"
            title="Claude 네이티브 Messages API 전환 후 조절할 수 있습니다.">사고 강도: 자동</span>}
          {reasoning === "model-managed" && <span className="reasoning-unavailable"
            title="이 모델은 사고 기능을 모델 내부에서 자동으로 관리합니다.">사고 가능 · 모델 자동</span>}
          <button type="button" className="icon-button" aria-label="대화 설정" title="대화 설정"
            disabled={isRunning || controlsPending}
            onClick={() => { setInstructionDraft(thread.instruction); setAdvancedDraft(thread.advanced); setChatSettingsOpen(true); }}>
            <Settings size={17} /></button>
          <ModelPicker models={models} selected={modelId} onSelect={onModelChange}
            disabled={isRunning || controlsPending} /></>}
          {chatbotTarget && <span className="chatbot-target"><Sparkles size={14} />{chatbotTarget.alias}</span>}</div>
      </div>
      <ThreadPrimitive.Root className="chat-thread">
        <ThreadPrimitive.Viewport className="chat-viewport">
          {messages.length === 0 && <div className="chat-welcome">
            <div className="welcome-mark"><Sparkles size={29} /></div>
            <span className="eyebrow">KYUNG HEE UNIVERSITY · MEDICAL MBA</span>
            <h1>의료의 미래를 읽고,<br /><em>경영의 답을 설계하다</em></h1>
            <p>경희대학교 의료경영학과 대학원을 위한 AI 워크스페이스</p>
            <div className="template-grid">{templates.map((item) =>
              <TemplateCard key={item.title} item={item} disabled={controlsPending}
                onChoose={async () => { setControlsPending(true); try { await onTemplateStart(item); }
                  catch (error) { setError(errorText(error)); } finally { setControlsPending(false); } }} />)}</div>
          </div>}
          <ThreadPrimitive.Messages>
            {({ message }) => {
              const stored = messages.find((item) => item.id === message.id);
              return message.role === "user" ? <UserMessage /> : <AssistantMessage
                incomplete={stored?.id === latestIncompleteId}
                disabled={isRunning || controlsPending}
                usage={stored?.usage}
                credits={stored?.credits}
                messageId={stored?.id ?? message.id}
                toolCalls={stored?.toolCalls}
                files={stored?.files}
                reasoningSummary={stored?.reasoningSummary}
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
          <ThreadPrimitive.ViewportFooter className="chat-footer">
            {error && <div className="inline-error" role="alert" aria-live="assertive"><CircleHelp size={16} />{error}
              <button onClick={() => setError("")} type="button" aria-label="오류 닫기"><X size={14} /></button></div>}
            {progress && <div className="inline-progress" role="status" aria-live="polite"><LoaderCircle className="spin" size={15} />{progress}</div>}
            <ComposerPrimitive.Root className={dropActive ? "composer-card drop-active" : "composer-card"}>
              {dropActive && <div className="composer-drop-hint"><Paperclip size={18} />
                PDF·Word·Excel·이미지를 여기에 놓으세요</div>}
              {pending.length > 0 && <div className="attachment-row">
                {pending.map((item) => <span className="attachment-chip" key={item.id}>
                  {item.kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
                  {item.name}<button type="button" aria-label={`${item.name} 첨부 제거`} onClick={() => {
                    void window.mmllm.discardAttachments([item.id]);
                    setPending((items) => items.filter((attached) => attached.id !== item.id));
                  }}><X size={13} /></button>
                </span>)}
              </div>}
              <ComposerPrimitive.Input placeholder="질문이나 아이디어를 적어주세요..."
                className="composer-input" rows={2} addAttachmentOnPaste={false} />
              <div className="composer-bottom">
                {!chatbotTarget && <button type="button" className="attach-button" onClick={addAttachment}
                  disabled={isRunning || controlsPending || Boolean(privacyDialog)} title="PDF·Word·Excel·이미지 첨부">
                  <Paperclip size={17} /><span>파일 첨부</span>
                </button>}
                <span className="composer-hint">Enter 전송 · Shift+Enter 줄바꿈</span>
                {isRunning
                  ? <ComposerPrimitive.Cancel className="send-button stop" title="생성 중단" aria-label="생성 중단"><Square size={16} /></ComposerPrimitive.Cancel>
                  : <ComposerPrimitive.Send className="send-button" title="전송" aria-label="메시지 전송"><ArrowUp size={19} /></ComposerPrimitive.Send>}
              </div>
            </ComposerPrimitive.Root>
            <div className="chat-checkline"><span className="web-search-status"><Globe2 size={13} />
              {chatbotTarget ? "Studio Chatbot · 원격 감사 로그가 저장될 수 있음" :
                thread.purpose === "meeting-summary" ? "로컬 회의 요약 · 웹 검색 꺼짐" :
                thread.webSearchMode === "off" ? "웹 검색을 사용하지 않음" : thread.webSearchMode === "auto"
                ? "최신 정보가 필요한 질문만 웹 검색" : thread.webSearchMode === "deep"
                  ? "Sonar로 3~4개 검색을 교차 검증 · 총 최대 6회 API 호출" : hasNativeWebSearch(modelId)
                  ? "선택 모델이 직접 웹 검색" : "Sonar 검색 후 선택 모델이 답변"}</span>
              {needsConsent && !attachmentConsent
                ? <button type="button" className="privacy-confirm-link"
                    onClick={() => setPrivacyDialog("history")}>첨부 자료 전송 확인</button>
                : <span>{needsConsent
                  ? "이 대화의 첨부 자료는 API로 다시 전송될 수 있습니다"
                  : "환자 식별정보는 입력 전에 제거해 주세요"}</span>}
              <span>대화 기록은 기기 안에 저장됩니다</span></div>
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

function MediaPanel({
  screen, models, workspaceEpochRef, onUsageChanged, onSummarizeTranscript
}: { screen: Exclude<Screen, "chat">; models: GatewayModel[]; onUsageChanged: () => void;
  workspaceEpochRef: { current: number };
  onSummarizeTranscript: (result: MediaResult) => Promise<void> }) {
  const [audioLane, setAudioLane] = useState<"tts" | "stt" | "music">("tts");
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [voice, setVoice] = useState("Aoede");
  const [imageCount, setImageCount] = useState(1);
  const [quality, setQuality] = useState("");
  const [background, setBackground] = useState("");
  const [mediaSize, setMediaSize] = useState("");
  const [durationSeconds, setDurationSeconds] = useState<number | undefined>();
  const [videoMode, setVideoMode] = useState<"standard" | "pro" | "">("");
  const [loopVideo, setLoopVideo] = useState(false);
  const [videoAudio, setVideoAudio] = useState(false);
  const [multiSpeaker, setMultiSpeaker] = useState(false);
  const [speakerOne, setSpeakerOne] = useState("진행자");
  const [speakerTwo, setSpeakerTwo] = useState("참석자");
  const [speakerOneVoice, setSpeakerOneVoice] = useState("Aoede");
  const [speakerTwoVoice, setSpeakerTwoVoice] = useState("Charon");
  const [lyrics, setLyrics] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [languageHints, setLanguageHints] = useState("ko,en");
  const [diarization, setDiarization] = useState(true);
  const [audioDuration, setAudioDuration] = useState<number | undefined>();
  const [picked, setPicked] = useState<PickedAttachment[]>([]);
  const [deidentified, setDeidentified] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MediaResult | null>(null);
  const [jobs, setJobs] = useState<PendingMediaJob[]>([]);
  const [visibleSegments, setVisibleSegments] = useState(250);
  const [summaryPending, setSummaryPending] = useState(false);
  const jobsRef = useRef(jobs);
  const pickedRef = useRef(picked);
  const resultRef = useRef(result);
  const pollingJobsRef = useRef(false);
  const submitGateRef = useRef(new LatestRequestGate());
  const selectionGateRef = useRef(new LatestRequestGate());
  const summaryGateRef = useRef(false);
  const transcriptAudioRef = useRef<HTMLAudioElement>(null);
  jobsRef.current = jobs;
  pickedRef.current = picked;
  resultRef.current = result;

  const available = useMemo(() => models.filter((model) => {
    if (screen !== "audio") return model.type === screen;
    if (model.type !== "audio") return false;
    return audioLaneForModel(model) === audioLane;
  }), [models, screen, audioLane]);
  const selectedModel = available.find((model) => model.id === modelId);
  const imageCaps = screen === "image" ? imageCapability(modelId) : undefined;
  const videoCaps = screen === "video" ? videoCapability(modelId) : undefined;
  const musicCaps = screen === "audio" && audioLane === "music" ? musicCapability(modelId) : undefined;
  const inputImageMax = screen === "image" ? imageCaps?.inputImageMax ?? 0 : screen === "video"
    ? videoCaps?.inputImageMax ?? 1 : 0;

  useEffect(() => {
    if (!available.some((model) => model.id === modelId)) setModelId(available[0]?.id ?? "");
  }, [available, modelId]);
  useEffect(() => {
    const image = imageCapability(modelId); const video = videoCapability(modelId);
    const ratios = screen === "image" ? image?.aspectRatios : screen === "video" ? video?.aspectRatios : undefined;
    setRatio(ratios?.[0] ?? ""); setImageCount(1); setQuality(image?.quality?.[0] ?? "");
    setBackground(image?.backgrounds?.[0] ?? "");
    setMediaSize(image?.sizes?.[0] ?? video?.resolutions?.[0] ?? "");
    setDurationSeconds(video?.durations?.[0] ?? video?.durationRange?.[0] ??
      musicCapability(modelId)?.defaultDuration);
    setVideoMode(video?.modes?.[0] ?? ""); setLoopVideo(false); setVideoAudio(false);
    setLyrics(""); setInstrumental(false); setMultiSpeaker(false);
  }, [modelId, screen]);
  useEffect(() => {
    if (screen !== "image" && screen !== "video") return;
    setPicked((items) => {
      const kept = items.slice(0, inputImageMax); const removed = items.slice(inputImageMax);
      if (removed.length) void window.mmllm.discardAttachments(removed.map((item) => item.id));
      return kept;
    });
  }, [screen, inputImageMax]);
  useEffect(() => {
    submitGateRef.current.invalidate(); selectionGateRef.current.invalidate();
    setResult((current) => {
      if (current) void releaseLocalResult(current, false);
      return null;
    });
    setPrompt(""); setError(""); setBusy(false); setVisibleSegments(250);
    setPicked((items) => {
      if (items.length) void window.mmllm.discardAttachments(items.map((item) => item.id));
      for (const item of items) if (item.mediaUrl) void window.mmllm.releaseMedia(item.mediaUrl).catch(() => undefined);
      return [];
    });
    setAudioDuration(undefined);
  }, [screen, audioLane]);
  useEffect(() => () => {
    submitGateRef.current.invalidate(); selectionGateRef.current.invalidate();
    const attachments = pickedRef.current;
    if (attachments.length) void window.mmllm.discardAttachments(attachments.map((item) => item.id));
    const current = resultRef.current;
    if (current) void releaseLocalResult(current, false);
  }, []);
  useEffect(() => {
    let active = true;
    const kind = screen === "image" ? "image" : screen === "video" ? "video"
      : audioLane === "stt" ? "stt" : null;
    if (!kind) return () => { active = false; };
    void window.mmllm.listMediaJobs().then((allJobs) => {
      const matching = allJobs.filter((item) => item.kind === kind);
      const job = matching[0];
      if (active) setJobs(matching);
      if (active && job) showJob(job);
    }).catch((error) => { if (active) setError(errorText(error)); });
    return () => { active = false; };
  }, [screen, audioLane]);

  function showJob(job: PendingMediaJob) {
    setResult(job.result ? { ...job.result, jobId: job.id, kind: job.kind,
      sourceAudioUrl: job.result.sourceAudioUrl ?? job.sourceAudioUrl,
      actualCredits: job.result.actualCredits ?? job.actualCredits,
      durationSeconds: job.result.durationSeconds ?? job.durationSeconds,
      billedDurationSeconds: job.result.billedDurationSeconds ?? job.billedDurationSeconds,
      videoModelId: job.result.videoModelId ?? job.videoModelId,
      createdAt: job.createdAt, elapsedMs: Date.parse(job.updatedAt) - Date.parse(job.createdAt) }
      : { jobId: job.id, kind: job.kind, operationId: job.operationId,
        sourceAudioUrl: job.sourceAudioUrl, actualCredits: job.actualCredits,
        durationSeconds: job.durationSeconds, billedDurationSeconds: job.billedDurationSeconds,
        videoModelId: job.videoModelId,
        status: job.status, createdAt: job.createdAt, elapsedMs: Date.now() - Date.parse(job.createdAt) });
    setVisibleSegments(250);
  }

  async function releaseLocalResult(value: MediaResult, explicit: boolean) {
    const terminal = ["completed", "failed"].includes(value.status ?? "");
    if (value.jobId && !terminal) {
      if (value.sourceAudioUrl) await window.mmllm.releaseMediaJobSource(value.jobId).catch(() => undefined);
      return;
    }
    const urls = [...(value.urls ?? []), value.audioUrl, value.videoUrl, value.sourceAudioUrl]
      .filter((url): url is string => Boolean(url?.startsWith("mmllm://media/")));
    await Promise.all([...new Set(urls)].map((url) => window.mmllm.releaseMedia(url).catch(() => undefined)));
    if (value.jobId && (explicit || terminal)) {
      await window.mmllm.acknowledgeMediaJob(value.jobId).catch(() => undefined);
    }
  }

  async function pick() {
    const selection = selectionGateRef.current.begin();
    try {
      const limit = screen === "audio" && audioLane === "stt" ? 1 : inputImageMax;
      if (limit < 1) throw new Error("선택한 모델은 참고 이미지 입력을 지원하지 않습니다.");
      if (picked.length >= limit) throw new Error(`이 화면에서는 파일을 최대 ${limit}개까지 첨부할 수 있습니다.`);
      const kinds = screen === "audio" && audioLane === "stt" ? ["audio"] as const : ["image"] as const;
      const item = await window.mmllm.pickAttachment([...kinds]);
      if (!selectionGateRef.current.isLatest(selection)) {
        if (item) await window.mmllm.discardAttachments([item.id]).catch(() => undefined);
        return;
      }
      if (item) setPicked((items) => [...items, item]);
    } catch (error) { setError(errorText(error)); }
  }

  async function importDroppedFiles(files: File[]) {
    const selection = selectionGateRef.current.begin();
    try {
      const stt = screen === "audio" && audioLane === "stt";
      const limit = stt ? 1 : inputImageMax;
      if (limit < 1) throw new Error("선택한 모델은 참고 이미지 입력을 지원하지 않습니다.");
      const capacity = stt ? 1 : limit - picked.length;
      if (files.length > capacity) throw new Error(`이 화면에서는 파일을 최대 ${limit}개까지 첨부할 수 있습니다.`);
      const kinds = stt ? ["audio"] as const : ["image"] as const;
      const items = await window.mmllm.addDroppedAttachments(await readDroppedFiles(files), [...kinds]);
      if (!selectionGateRef.current.isLatest(selection)) {
        await window.mmllm.discardAttachments(items.map((item) => item.id)).catch(() => undefined);
        return;
      }
      setPicked((current) => stt ? items.slice(0, 1) : [...current, ...items].slice(0, limit));
      setError("");
    } catch (error) { setError(errorText(error)); }
  }

  function handleMediaDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setDropActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) void importDroppedFiles(files);
  }

  const mediaDropProps = {
    onDragEnter: (event: React.DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault(); setDropActive(true);
    },
    onDragOver: (event: React.DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: React.DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
    },
    onDrop: handleMediaDrop
  };

  async function submit() {
    if (busy) return;
    if (!deidentified) { setError("환자 식별정보를 제거했는지 확인해 주세요."); return; }
    if (!modelId) { setError("사용 가능한 모델이 없습니다."); return; }
    const generation = submitGateRef.current.begin();
    const workspaceEpoch = workspaceEpochRef.current;
    const submitted = [...picked];
    setBusy(true); setError(""); setResult(null);
    try {
      let next: MediaResult;
      if (screen === "image") {
        next = await window.mmllm.generateImage({
          modelId, prompt, aspectRatio: ratio || undefined, numberOfImages: imageCount,
          quality: quality || undefined, imageSize: mediaSize || undefined,
          background: background || undefined, imageAttachmentIds: submitted.map((item) => item.id),
          deidentifiedConfirmed: true
        });
      } else if (screen === "video") {
        next = await window.mmllm.generateVideo({
          modelId, prompt, aspectRatio: ratio || undefined, durationSeconds,
          resolution: mediaSize || undefined, mode: videoMode || undefined,
          loop: videoCaps?.loop ? loopVideo : undefined,
          audio: videoCaps?.audio || videoCaps?.generateAudio ? videoAudio : undefined,
          imageAttachmentIds: submitted.map((item) => item.id),
          deidentifiedConfirmed: true
        });
      } else {
        const request: AudioRequest = audioLane === "tts"
          ? { lane: "tts", modelId, input: prompt, voice,
              ...(multiSpeaker ? { speakers: { [speakerOne]: speakerOneVoice, [speakerTwo]: speakerTwoVoice } } : {}),
              deidentifiedConfirmed: true }
          : audioLane === "music"
            ? { lane: "music", modelId, prompt, lyrics: lyrics.trim() || undefined,
                durationSeconds, instrumental: instrumental || undefined, deidentifiedConfirmed: true }
            : { lane: "stt", modelId, attachmentId: submitted[0]?.id ?? "",
                languageHints: languageHints.split(",").map((item) => item.trim()).filter(Boolean),
                enableSpeakerDiarization: diarization, deidentifiedConfirmed: true };
        next = await window.mmllm.runAudio(request);
      }
      if (!submitGateRef.current.isLatest(generation) || workspaceEpoch !== workspaceEpochRef.current) {
        await releaseLocalResult(next, false);
        return;
      }
      setResult(next); setDeidentified(false);
      if (next.jobId) {
        const allJobs = await window.mmllm.listMediaJobs();
        if (workspaceEpoch !== workspaceEpochRef.current) return;
        const kind = next.kind;
        const matching = allJobs.filter((item) => item.kind === kind);
        setJobs(matching);
      }
      onUsageChanged();
    } catch (error) {
      if (submitGateRef.current.isLatest(generation) && workspaceEpoch === workspaceEpochRef.current) {
        setError(errorText(error)); onUsageChanged();
      }
    }
    finally {
      if (submitted.length) await window.mmllm.discardAttachments(submitted.map((item) => item.id)).catch(() => undefined);
      setPicked((items) => items.filter((item) => !submitted.some((sent) => sent.id === item.id)));
      if (submitGateRef.current.isLatest(generation) && workspaceEpoch === workspaceEpochRef.current) setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const epoch = workspaceEpochRef.current;
    const pollAll = async () => {
      if (pollingJobsRef.current) return;
      const pendingJobs = jobsRef.current.filter((item) => !["completed", "failed"].includes(item.status));
      if (!pendingJobs.length) return;
      pollingJobsRef.current = true;
      try {
        let cursor = 0;
        let terminalSeen = false;
        const workers = Array.from({ length: Math.min(2, pendingJobs.length) }, async () => {
          while (cursor < pendingJobs.length && !cancelled) {
            const job = pendingJobs[cursor++];
            const next = await window.mmllm.pollMediaJob(job.id);
            if (cancelled || epoch !== workspaceEpochRef.current) return;
            if (["completed", "failed"].includes(next.status ?? "")) terminalSeen = true;
            setResult((current) => current?.jobId === job.id ? next : current);
          }
        });
        await Promise.all(workers);
        if (!cancelled && epoch === workspaceEpochRef.current) {
          const all = await window.mmllm.listMediaJobs();
          const kind = screen === "image" ? "image" : screen === "video" ? "video"
            : audioLane === "stt" ? "stt" : null;
          if (kind) setJobs(all.filter((item) => item.kind === kind));
          if (terminalSeen) onUsageChanged();
        }
      } catch (error) {
        if (!cancelled && epoch === workspaceEpochRef.current) setError(errorText(error));
      } finally { pollingJobsRef.current = false; }
    };
    void pollAll();
    const timer = setInterval(() => void pollAll(), 5_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [screen, audioLane, onUsageChanged, workspaceEpochRef]);

  async function dismissResult() {
    if (!result) return;
    try {
      await releaseLocalResult(result, true);
      if (result.jobId) setJobs((items) => items.filter((item) => item.id !== result.jobId));
      setResult(null);
    } catch (error) { setError(errorText(error)); }
  }

  async function stopTracking() {
    if (!result?.jobId) return;
    const lane = result.kind === "video" ? "영상 생성" : result.kind === "stt" ? "받아쓰기" : "이미지 생성";
    if (!window.confirm(`${lane} 추적만 중단합니다. 이미 사용된 크레딧은 복구되지 않으며 서버 작업은 계속될 수 있습니다. 계속할까요?`)) return;
    try {
      await window.mmllm.stopTrackingMediaJob(result.jobId);
      setResult(null);
      setJobs((items) => items.filter((item) => item.id !== result.jobId));
      setError("추적을 중단했습니다. 서버 생성과 과금은 취소되지 않을 수 있습니다.");
    } catch (error) { setError(errorText(error)); }
  }

  const titles = {
    image: ["이미지 스튜디오", "아이디어를 한 장의 이미지로"],
    audio: ["오디오 스튜디오", "말하고, 듣고, 기록해요"],
    video: ["비디오 스튜디오", "생각을 움직이는 장면으로"]
  } as const;
  const icon = screen === "image" ? <ImageIcon size={23} /> :
    screen === "audio" ? <Mic2 size={23} /> : <Video size={23} />;
  const canRun = screen === "audio" && audioLane === "stt" ? picked.length > 0 : prompt.trim().length > 0;
  const costNote = screen === "image" ? imageEstimate(modelId, imageCount) :
    screen === "video" ? videoEstimate(modelId) : audioLane === "stt" ? sttEstimate(audioDuration) :
      audioLane === "music" ? musicEstimate(modelId, durationSeconds) :
        "TTS 비용은 실제 입력·출력 토큰으로 확정됩니다.";

  function seekTranscript(milliseconds: number) {
    const audio = transcriptAudioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, milliseconds / 1000);
    void audio.play().catch(() => undefined);
  }

  return <div className="media-panel">
    <div className="panel-header media-header"><div><h2>{titles[screen][0]}</h2></div>
      <ModelPicker models={available} selected={modelId} onSelect={setModelId} disabled={busy} />
    </div>
    <div className="media-scroll">
      <div className="media-intro"><span className="media-icon">{icon}</span>
        <h1>{titles[screen][1]}</h1>
        <p>모델을 고르고 자료를 준비하면 MM_LLM이 알맞은 API로 연결합니다.</p>
      </div>
      {screen === "audio" && <div className="lane-tabs" role="tablist" aria-label="오디오 기능">
        {([
          ["tts", "텍스트 → 음성", Mic2], ["stt", "받아쓰기", MessageCircle],
          ["music", "음악·효과음", Music2]
        ] as const).map(([lane, title, Icon]) => <button type="button" key={lane}
          data-audio-lane={lane}
          className={audioLane === lane ? "lane-tab active" : "lane-tab"}
          role="tab" aria-selected={audioLane === lane} aria-controls="audio-lane-panel" disabled={busy}
          tabIndex={audioLane === lane ? 0 : -1}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const current = AUDIO_LANES.indexOf(lane);
            const next = event.key === "Home" ? 0 : event.key === "End" ? AUDIO_LANES.length - 1
              : (current + (event.key === "ArrowRight" ? 1 : -1) + AUDIO_LANES.length) % AUDIO_LANES.length;
            const nextLane = AUDIO_LANES[next];
            setAudioLane(nextLane);
            requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-audio-lane="${nextLane}"]`)?.focus());
          }}
          onClick={() => setAudioLane(lane)}><Icon size={16} />{title}</button>)}
      </div>}
      <div className="media-workspace" id={screen === "audio" ? "audio-lane-panel" : undefined}
        role={screen === "audio" ? "tabpanel" : undefined}>
        <div className="media-form">
          <label className="field-label">{screen === "audio" && audioLane === "stt" ? "오디오 파일" :
            screen === "audio" && audioLane === "tts" ? "읽을 텍스트" : "프롬프트"}</label>
          {screen === "audio" && audioLane === "stt"
            ? <button className={dropActive ? "file-drop drop-active" : "file-drop"} type="button" onClick={pick}
                disabled={busy}
                {...mediaDropProps}>
              <Paperclip size={22} /><strong>{picked[0]?.name || "녹음 파일 선택"}</strong>
              <small>파일을 놓거나 선택 · MP3, M4A, WAV, FLAC, OGG, AIFF · 18MB 이하</small>
            </button>
            : <textarea className="media-textarea" value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={screen === "image" ? "예: 의료경영 논문 발표용 따뜻한 병원 일러스트"
                : screen === "video" ? "예: 병원 운영의 하루를 보여주는 짧은 영상"
                  : audioLane === "music" ? "예: 차분한 학술 발표 배경음악" : "음성으로 들을 문장을 입력해 주세요"} />}
          {screen === "audio" && audioLane === "stt" && picked[0] &&
            <div className="source-audio-row"><span>{picked[0].name}</span>
              <button type="button" aria-label="선택한 오디오 제거" disabled={busy} onClick={() => {
                const selected = picked[0]; if (!selected) return;
                void window.mmllm.discardAttachments([selected.id]);
                setPicked([]); setAudioDuration(undefined);
              }}><X size={15} />제거</button></div>}
          {(screen === "image" || screen === "video") && <>
            <div className="media-controls">
              {(screen === "image" ? imageCaps?.aspectRatios : videoCaps?.aspectRatios)?.length ? <label>화면 비율
                <select value={ratio} onChange={(event) => setRatio(event.target.value)}>
                  {(screen === "image" ? imageCaps?.aspectRatios : videoCaps?.aspectRatios)?.map((item) =>
                    <option value={item} key={item}>{item}</option>)}
                </select></label> : null}
              {screen === "image" && (imageCaps?.countMax ?? 1) > 1 && <label>생성 개수
                <select value={imageCount} onChange={(event) => setImageCount(Number(event.target.value))}>
                  {Array.from({ length: imageCaps!.countMax }, (_, index) => index + 1).map((item) =>
                    <option key={item} value={item}>{item}장</option>)}</select></label>}
              {screen === "image" && imageCaps?.quality?.length && <label>품질
                <select value={quality} onChange={(event) => setQuality(event.target.value)}>
                  {imageCaps.quality.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
              {screen === "image" && imageCaps?.backgrounds?.length && <label>배경
                <select value={background} onChange={(event) => setBackground(event.target.value)}>
                  {imageCaps.backgrounds.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
              {screen === "image" && imageCaps?.sizes?.length && <label>이미지 크기
                <select value={mediaSize} onChange={(event) => setMediaSize(event.target.value)}>
                  {imageCaps.sizes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
              {screen === "video" && videoCaps?.durations?.length && <label>영상 길이
                <select value={durationSeconds ?? ""} onChange={(event) => setDurationSeconds(Number(event.target.value))}>
                  {videoCaps.durations.map((item) => <option key={item} value={item}>{item}초</option>)}</select></label>}
              {screen === "video" && videoCaps?.durationRange && <label>영상 길이
                <input type="number" min={videoCaps.durationRange[0]} max={videoCaps.durationRange[1]}
                  value={durationSeconds ?? videoCaps.durationRange[0]}
                  onChange={(event) => setDurationSeconds(Number(event.target.value))} />
                <small>{videoCaps.durationRange[0]}–{videoCaps.durationRange[1]}초</small></label>}
              {screen === "video" && videoCaps?.resolutions?.length && <label>해상도
                <select value={mediaSize} onChange={(event) => setMediaSize(event.target.value)}>
                  {videoCaps.resolutions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
              {screen === "video" && videoCaps?.modes?.length && <label>생성 모드
                <select value={videoMode} onChange={(event) => setVideoMode(event.target.value as "standard" | "pro")}>
                  {videoCaps.modes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
              {screen === "video" && (videoCaps?.generateAudio || videoCaps?.audio) && <label className="toggle-label">
                <input type="checkbox" checked={videoAudio}
                  onChange={(event) => setVideoAudio(event.target.checked)} />
                {videoCaps?.generateAudio ? "오디오 생성" : "오디오 포함"}</label>}
              {screen === "video" && videoCaps?.loop && <label className="toggle-label">
                <input type="checkbox" checked={loopVideo}
                  onChange={(event) => setLoopVideo(event.target.checked)} />반복 영상</label>}
            </div>
            {inputImageMax > 0 && <button className={dropActive ? "reference-button drop-active" : "reference-button"}
              type="button" onClick={pick} disabled={busy} {...mediaDropProps}>
              <Plus size={16} />{picked.length ? `참고 이미지 ${picked.length}/${inputImageMax}개` : "참고 이미지를 놓거나 선택"}
            </button>}
            {picked.length > 0 && <div className="attachment-row">
              {picked.map((item) => <span className="attachment-chip" key={item.id}>
                <ImageIcon size={14} />{item.name}
                <button type="button" aria-label={`${item.name} 첨부 제거`} onClick={() => {
                  void window.mmllm.discardAttachments([item.id]);
                  setPicked((items) => items.filter((attached) => attached.id !== item.id));
                }}><X size={13} /></button>
              </span>)}
            </div>}
          </>}
          {screen === "audio" && audioLane === "tts" && <div className="media-controls">
            <label>목소리<select value={voice} onChange={(event) => setVoice(event.target.value)}>
              {TTS_VOICES.map((item) =>
                <option key={item} value={item}>{item}</option>)}
            </select></label>
            {selectedModel && supportsMultiSpeakerTts(selectedModel) && <label className="toggle-label">
              <input type="checkbox" checked={multiSpeaker} onChange={(event) => setMultiSpeaker(event.target.checked)} />
              다중 화자</label>}
          </div>}
          {screen === "audio" && audioLane === "tts" && multiSpeaker && <div className="speaker-grid">
            <label>화자 1 이름<input value={speakerOne} maxLength={40}
              onChange={(event) => setSpeakerOne(event.target.value)} /></label>
            <label>화자 1 음성<select value={speakerOneVoice} onChange={(event) => setSpeakerOneVoice(event.target.value)}>
              {TTS_VOICES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>화자 2 이름<input value={speakerTwo} maxLength={40}
              onChange={(event) => setSpeakerTwo(event.target.value)} /></label>
            <label>화자 2 음성<select value={speakerTwoVoice} onChange={(event) => setSpeakerTwoVoice(event.target.value)}>
              {TTS_VOICES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <small>읽을 텍스트에는 위 화자 이름을 사용해 대화 형식으로 적어 주세요.</small>
          </div>}
          {screen === "audio" && audioLane === "stt" && <div className="meeting-options">
            <label>언어 힌트<input value={languageHints} placeholder="ko,en" maxLength={40}
              onChange={(event) => setLanguageHints(event.target.value)} />
              <small>쉼표로 구분 · 최대 5개</small></label>
            <label className="toggle-label"><input type="checkbox" checked={diarization}
              onChange={(event) => setDiarization(event.target.checked)} />화자 분리</label>
          </div>}
          {screen === "audio" && audioLane === "music" && musicCaps && <div className="music-options">
            {musicCaps.lyrics && <label>가사 (선택)<textarea value={lyrics} maxLength={4000}
              disabled={instrumental} onChange={(event) => setLyrics(event.target.value)}
              placeholder="직접 부를 가사를 입력하세요" /></label>}
            {musicCaps.duration && <label>길이(초)<input type="number" min={musicCaps.duration[0]}
              max={musicCaps.duration[1]} value={durationSeconds ?? musicCaps.defaultDuration ?? musicCaps.duration[0]}
              onChange={(event) => setDurationSeconds(Number(event.target.value))} /></label>}
            {musicCaps.instrumental && <label className="toggle-label"><input type="checkbox" checked={instrumental}
              onChange={(event) => { setInstrumental(event.target.checked); if (event.target.checked) setLyrics(""); }} />
              연주곡</label>}
          </div>}
          <div className="media-confirm"><DeidCheck checked={deidentified} onChange={setDeidentified} /></div>
          <div className="media-cost-note">{costNote}</div>
          <button className="primary-button media-submit" type="button"
            disabled={busy || !canRun || !deidentified || !modelId} onClick={submit}>
            {busy ? <><LoaderCircle size={17} className="spin" />작업 중...</> :
              <><Sparkles size={17} />{screen === "audio" && audioLane === "stt" ? "받아쓰기 시작" : "생성하기"}</>}
          </button>
          {error && <div className="inline-error" role="alert" aria-live="assertive"><CircleHelp size={16} />{error}</div>}
          {result?.creditDisplay && <div className="media-credit-result" aria-live="polite">{result.creditDisplay}</div>}
          {result?.usage && <div className="media-metadata" aria-label="사용 토큰">
            입력 {result.usage.inputTokens.toLocaleString()} · 출력 {result.usage.outputTokens.toLocaleString()} ·
            합계 {result.usage.totalTokens.toLocaleString()} 토큰
          </div>}
          {result?.videoModelId && <div className="media-metadata">처리 모델 ID: {result.videoModelId}</div>}
          {result?.musicStructure && <div className="media-metadata">음악 구조: {result.musicStructure}</div>}
        </div>
        <div className="media-result" aria-live="polite" aria-busy={busy ||
          Boolean(result?.jobId && !["completed", "failed"].includes(result.status ?? ""))}>
          {jobs.length > 1 && <div className="job-list"><strong>이 화면의 작업 {jobs.length}개</strong>
            {jobs.map((job) => <button type="button" key={job.id} onClick={() => showJob(job)}>
              {job.label} · {job.status === "completed" ? "완료" : job.status === "failed" ? "실패" : "진행 중"}
            </button>)}</div>}
          {!result && <div className="result-placeholder"><span>{icon}</span>
            <strong>결과가 여기에 나타납니다</strong>
            <small>준비가 되면 왼쪽에서 시작해 주세요.</small></div>}
          {result?.jobId && result.status !== "completed" && result.status !== "failed" && <div className="result-placeholder">
            <LoaderCircle size={28} className="spin" /><strong>생성 중입니다</strong>
            <small>앱을 다시 열어도 작업을 계속 확인합니다.<br />경과 {Math.max(0,
              Math.floor((result.elapsedMs ?? 0) / 1000))}초</small>
            {result.jobId && <button type="button" className="tracking-stop" onClick={() => void stopTracking()}>
              추적 중단</button>}</div>}
          {result?.status === "failed" && <div className="result-placeholder">
            <CircleHelp size={28} /><strong>생성에 실패했습니다</strong>
            <small>{result.error || "모델과 입력을 확인한 뒤 다시 시도해 주세요."}</small></div>}
          {!!result?.urls?.length && <div className="result-images">
            {result.urls.map((url, index) => <div className="result-image" key={index}>
              <img src={url} alt={`생성 이미지 ${index + 1}`} />
              <button type="button" onClick={() => window.mmllm.saveRemoteMedia(url, `mmllm-image-${index + 1}.png`)}>
                <Download size={16} /> 저장</button>
            </div>)}
          </div>}
          {result?.audioUrl && <div className="result-audio"><Music2 size={30} />
            <strong>오디오가 준비됐어요</strong>
            <audio controls src={result.audioUrl} />
            <button type="button" onClick={() => window.mmllm.saveRemoteMedia(
              result.audioUrl!, audioLane === "tts" ? "mmllm-voice.wav" : "mmllm-music.mp3")}>
              <Download size={16} /> 파일 저장</button></div>}
          {result?.text && result.kind === "stt" && <div className="transcript-result">
            <div className="transcript-heading"><div><strong>회의 전사</strong>
              <small>{result.durationSeconds ? `${Math.round(result.durationSeconds / 60)}분 · ` : ""}
                {result.segments?.length ?? 0}개 구간
                {result.billedDurationSeconds !== undefined
                  ? ` · 과금 기준 ${result.billedDurationSeconds.toFixed(1)}초` : ""}</small></div>
              <button type="button" onClick={() => navigator.clipboard.writeText(transcriptForChat(result))}>
                <Copy size={16} /> 복사</button></div>
            {result.sourceAudioUrl && <audio ref={transcriptAudioRef} controls src={result.sourceAudioUrl} />}
            {(result.text.length > 50_000 || (result.segments?.length ?? 0) > 2_000) &&
              <div className="transcript-warning">긴 전사입니다. MM_LLM이 로컬에서 안전한 크기의 구간별 초안을 준비합니다.
                각 초안을 확인하고 직접 전송하면 마지막 종합 초안까지 이어집니다.</div>}
            {result.segments?.length ? <div className="transcript-timeline" aria-label="회의 전사 타임라인">
              {result.segments.slice(0, visibleSegments).map((segment, index) => <button type="button" key={`${segment.startMs}-${index}`}
                className={`speaker-${Math.abs([...segment.speaker].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 6}`}
                onClick={() => seekTranscript(segment.startMs)}>
                <span className="segment-time">{formatTranscriptTimestamp(segment.startMs)}</span>
                <span className="segment-speaker">{segment.speaker}</span>
                <span className="segment-text">{segment.text}</span>
              </button>)}
              {visibleSegments < result.segments.length && <button type="button" className="timeline-more"
                onClick={() => setVisibleSegments((count) => Math.min(result.segments!.length, count + 250))}>
                다음 {Math.min(250, result.segments.length - visibleSegments)}개 구간 보기
              </button>}</div> : <p className="transcript-plain">{result.text}</p>}
            <button type="button" className="primary-button transcript-summary"
              disabled={summaryPending} onClick={() => {
                if (summaryGateRef.current) return;
                summaryGateRef.current = true; setSummaryPending(true);
                void onSummarizeTranscript(result).finally(() => {
                  summaryGateRef.current = false; setSummaryPending(false);
                });
              }}><Sparkles size={16} />{summaryPending ? "요약 준비 중…" : "요약하기"}</button>
          </div>}
          {result?.text && result.kind !== "stt" && <div className="result-text"><strong>받아쓰기 결과</strong>
            <p>{result.text}</p><button type="button" onClick={() =>
              navigator.clipboard.writeText(result.text!)}><Copy size={16} /> 복사</button></div>}
          {result?.videoUrl && result.status === "completed" && <div className="result-video">
            <video controls src={result.videoUrl} />
            <button type="button" onClick={() =>
              window.mmllm.saveRemoteMedia(result.videoUrl!, "mmllm-video.mp4")}>
              <Download size={16} /> 영상 저장</button></div>}
          {(result?.jobId || result?.sourceAudioUrl) && ["completed", "failed"].includes(result.status ?? "") &&
            <button type="button" className="tracking-stop" onClick={() => void dismissResult()}>결과 닫기</button>}
        </div>
      </div>
    </div>
  </div>;
}

function Login({ onLogin }: { onLogin: (state: SessionState) => Promise<void> }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const state = await window.mmllm.login(key.trim());
      setKey("");
      await onLogin(state);
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <div className="login-page">
    <div className="login-card">
      <div className="login-brand"><span className="brand-mark"><Sparkles size={24} /></span>
        <span>MM<span className="brand-underscore">_</span>LLM</span></div>
      <span className="eyebrow">KYUNG HEE UNIVERSITY · MEDICAL MBA</span>
      <h1>의료의 미래를 읽고,<br /><em>경영의 답을 설계하다</em></h1>
      <p>경희대학교 의료경영학과 대학원을 위한 AI 워크스페이스</p>
      <form onSubmit={submit}>
        <label htmlFor="api-key">학생 본인의 API 키</label>
        <input id="api-key" type="password" value={key}
          onChange={(event) => setKey(event.target.value)}
          autoComplete="off" placeholder="ChatKHU API 키를 입력하세요" required />
        <button className="primary-button" type="submit" disabled={busy || !key.trim()}>
          {busy ? <><LoaderCircle className="spin" size={17} /> 확인 중...</> :
            <>시작하기 <ArrowRight size={18} /></>}
        </button>
      </form>
      {error && <div className="inline-error" role="alert" aria-live="assertive"><CircleHelp size={16} />{error}</div>}
      <div className="login-note"><ShieldCheck size={16} />
        키는 이 기기의 운영체제 보안 저장소로 보호됩니다.</div>
      <button className="docs-link" type="button" onClick={() => void window.mmllm.openKeyGuide()}>
        API 키 발급 안내 <ArrowRight size={13} /></button>
    </div>
    <div className="login-aside"><span>LIVE CHATKHU MODELS · ONE MEDICAL MBA SPACE</span>
      <div className="aside-circles"><span>GPT</span><span>Claude</span><span>Gemini</span><span>+ 더 많은 모델</span></div>
    </div>
  </div>;
}

async function repairRemovedThreadModel(snapshot: ThreadSnapshot, models: GatewayModel[]): Promise<{
  snapshot: ThreadSnapshot; removedModelId?: string;
}> {
  const resolved = resolveLiveThreadModel(snapshot.modelId, models);
  if (!resolved.removed || !resolved.modelId) return { snapshot };
  const updated = await window.mmllm.updateThreadSettings(snapshot.id, {
    modelId: resolved.modelId, instruction: snapshot.instruction,
    reasoningMode: snapshot.reasoningMode, advanced: snapshot.advanced
  });
  return { snapshot: updated, removedModelId: snapshot.modelId };
}

export default function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>("chat");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [thread, setThread] = useState<ThreadSnapshot | null>(null);
  const [modelId, setModelId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useResponsiveSidebarState();
  const [error, setError] = useState("");
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ThreadSearchResult[]>([]);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);
  const [keyReplaceOpen, setKeyReplaceOpen] = useState(false);
  const [replacementKey, setReplacementKey] = useState("");
  const [keyReplacing, setKeyReplacing] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<{ threadId: string; text: string } | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDraft, setProjectDraft] = useState({ name: "", instruction: "" });
  const [projectBusy, setProjectBusy] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsTab, setToolsTab] = useState<"compare" | "chatbot">("compare");
  const [comparePrompt, setComparePrompt] = useState("");
  const [compareModels, setCompareModels] = useState<string[]>([]);
  const [compareMode, setCompareMode] = useState<WebSearchMode>("always");
  const [compareAttachments, setCompareAttachments] = useState<PickedAttachment[]>([]);
  const [compareConfirmed, setCompareConfirmed] = useState(false);
  const [compareRun, setCompareRun] = useState<CompareRun | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareSynthesisBusy, setCompareSynthesisBusy] = useState(false);
  const [bookmarks, setBookmarks] = useState<ChatbotBookmark[]>([]);
  const [bookmarkDraft, setBookmarkDraft] = useState({ alias: "", chatbotId: "" });
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [chatbotUsage, setChatbotUsage] = useState<{ bookmarkId: string; report: ChatbotUsageReport } | null>(null);
  const compareStopRef = useRef<null | (() => void)>(null);
  const compareSynthesisStopRef = useRef<null | (() => void)>(null);
  const workspaceGateRef = useRef(new LatestRequestGate());
  const selectGateRef = useRef(new LatestRequestGate());
  const actionGatesRef = useRef(new Map<string, LatestRequestGate>());
  const summaryFlowRef = useRef<{ threadId: string; prompts: string[]; nextIndex: number;
    outputs: string[]; phase: "map" | "reduce" | "final"; lastAssistantId?: string } | null>(null);
  const summaryStartRef = useRef(false);
  const uiEpochRef = useRef(0);
  const visibleThreadIdRef = useRef<string | null>(null);
  const themePersistenceRef = useRef<ThemePersistence | null>(null);
  if (!themePersistenceRef.current) {
    themePersistenceRef.current = new ThemePersistence((theme) => window.mmllm.setThemePreference(theme));
  }
  const renameInputRef = useRef<HTMLInputElement>(null);
  const pendingWorkspaceFocusRef = useRef(false);
  const dialogReturnFocusRef = useRef<FocusReturnTarget | null>(null);
  const creditRefreshRef = useRef<{
    lastAt: number; timer: number | null; inFlight: Promise<void> | null;
  }>({ lastAt: 0, timer: null, inFlight: null });
  visibleThreadIdRef.current = thread?.id ?? null;

  const rememberDialogReturn = useCallback((returnFocus?: FocusReturnTarget) => {
    dialogReturnFocusRef.current = returnFocus ?? null;
  }, []);
  const dialogRestoreFallback = useCallback(() => dialogReturnFocusRef.current?.() ??
    document.querySelector<HTMLElement>(
      ".sidebar-mobile-open.visible:not([disabled]), .sidebar:not(.collapsed) .sidebar-toggle:not([disabled])"
    ), []);

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const closeRename = useCallback(() => {
    setRenameDialog((current) => current?.busy ? current : null);
  }, []);
  const closeKeyReplace = useCallback(() => { setKeyReplaceOpen(false); setReplacementKey(""); }, []);
  const closeProjects = useCallback(() => { if (!projectBusy) setProjectsOpen(false); }, [projectBusy]);
  const settingsRef = useDialogFocus(settingsOpen, closeSettings, !settingsSaving, dialogRestoreFallback);
  const searchRef = useDialogFocus(searchOpen, closeSearch, true, dialogRestoreFallback);
  const renameRef = useDialogFocus<HTMLFormElement>(
    Boolean(renameDialog), closeRename, !renameDialog?.busy, dialogRestoreFallback);
  const keyReplaceRef = useDialogFocus(keyReplaceOpen, closeKeyReplace, !keyReplacing, dialogRestoreFallback);
  const projectsRef = useDialogFocus(projectsOpen, closeProjects, !projectBusy, dialogRestoreFallback);
  const closeTools = useCallback(() => {
    if (compareBusy || compareSynthesisBusy || bookmarkBusy) return;
    if (compareAttachments.length) void window.mmllm.discardAttachments(compareAttachments.map((item) => item.id));
    setCompareAttachments([]); setCompareConfirmed(false); setToolsOpen(false);
  }, [compareBusy, compareSynthesisBusy, bookmarkBusy, compareAttachments]);
  const toolsRef = useDialogFocus(
    toolsOpen, closeTools, !compareBusy && !compareSynthesisBusy && !bookmarkBusy, dialogRestoreFallback);
  const openSearch = useCallback((returnFocus?: FocusReturnTarget) => {
    rememberDialogReturn(returnFocus);
    setSettingsOpen(false); setKeyReplaceOpen(false); setReplacementKey(""); setRenameDialog(null); setSearchOpen(true);
  }, [rememberDialogReturn]);
  const openSettings = useCallback((returnFocus?: FocusReturnTarget) => {
    rememberDialogReturn(returnFocus);
    setSearchOpen(false); setKeyReplaceOpen(false); setReplacementKey(""); setRenameDialog(null); setSettingsOpen(true);
  }, [rememberDialogReturn]);
  const openKeyReplace = useCallback((returnFocus?: FocusReturnTarget) => {
    rememberDialogReturn(returnFocus);
    setSearchOpen(false); setSettingsOpen(false); setReplacementKey(""); setRenameDialog(null); setKeyReplaceOpen(true);
  }, [rememberDialogReturn]);
  const openWorkspaceTools = useCallback(async (tab: "compare" | "chatbot", returnFocus?: FocusReturnTarget) => {
    if (returnFocus || !toolsOpen) rememberDialogReturn(returnFocus);
    setToolsTab(tab); setToolsOpen(true);
    if (tab === "chatbot") {
      const epoch = uiEpochRef.current;
      try { const next = await window.mmllm.listChatbotBookmarks();
        if (epoch === uiEpochRef.current) setBookmarks(next); }
      catch (error) { if (epoch === uiEpochRef.current) setError(errorText(error)); }
    }
  }, [rememberDialogReturn, toolsOpen]);

  useEffect(() => {
    if (!renameDialog) return;
    const frame = window.requestAnimationFrame(() => renameInputRef.current?.select());
    return () => window.cancelAnimationFrame(frame);
  }, [renameDialog?.thread.id]);

  useEffect(() => {
    if (!pendingWorkspaceFocusRef.current || loading || !session?.authenticated) return;
    pendingWorkspaceFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".sidebar-toggle:not([disabled])")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, session?.authenticated]);

  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.fontSize = appSettings?.fontSize ?? "medium";
    if (!appSettings) return;
    const preference = appSettings.theme;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const appliedTheme = preference === "system" ? media.matches ? "dark" : "light" : preference;
      document.documentElement.dataset.theme = appliedTheme;
      document.documentElement.dataset.themePreference = preference;
      void themePersistenceRef.current?.sync(preference).catch((error) => {
        console.warn("화면 테마 설정을 저장하지 못했습니다.", error instanceof Error ? error.name : "unknown");
      });
    };
    apply(); media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appSettings]);

  const llmModels = useMemo(() => session?.models.filter((model) => model.type === "llm") ?? [], [session]);
  const defaultModel = useCallback((items: GatewayModel[]) =>
    items.find((item) => item.id === "gpt-5.6-luna")?.id ??
    items.find((item) => item.type === "llm")?.id ?? "", []);

  const refreshThreads = useCallback(async () => {
    const epoch = uiEpochRef.current;
    try {
      const items = await window.mmllm.listThreads();
      if (epoch === uiEpochRef.current) setThreads(items);
    } catch (error) {
      if (epoch === uiEpochRef.current) setError(errorText(error));
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    const epoch = uiEpochRef.current;
    const next = await window.mmllm.listProjects();
    if (epoch === uiEpochRef.current) setProjects(next);
    return epoch === uiEpochRef.current ? next : [];
  }, []);

  const openProjectsPanel = useCallback((returnFocus?: FocusReturnTarget) => {
    rememberDialogReturn(returnFocus);
    const first = projects.find((item) => item.id === selectedProjectId) ?? projects[0];
    setSelectedProjectId(first?.id ?? null);
    setProjectDraft(first ? { name: first.name, instruction: first.instruction } : { name: "", instruction: "" });
    setProjectsOpen(true);
  }, [projects, selectedProjectId, rememberDialogReturn]);

  const performCreditRefresh = useCallback((manual: boolean) => {
    const state = creditRefreshRef.current;
    if (state.inFlight) return state.inFlight;
    if (state.timer !== null) { window.clearTimeout(state.timer); state.timer = null; }
    const epoch = uiEpochRef.current;
    state.lastAt = Date.now();
    let request: Promise<void>;
    request = window.mmllm.getCredits(manual).then((credits) => {
      if (epoch === uiEpochRef.current) {
        setSession((current) => current ? { ...current, credits } : current);
      }
    }).catch((error) => {
      if (manual && epoch === uiEpochRef.current) setError(errorText(error));
    }).finally(() => {
      if (state.inFlight === request) state.inFlight = null;
    });
    state.inFlight = request;
    return request;
  }, []);

  const refreshCredits = useCallback((manual = false) => {
    const state = creditRefreshRef.current;
    const delay = staleRefreshDelay(state.lastAt, Date.now(), manual);
    if (delay === 0) return performCreditRefresh(manual);
    if (state.timer === null) {
      state.timer = window.setTimeout(() => {
        state.timer = null;
        void performCreditRefresh(false);
      }, delay);
    }
    return Promise.resolve();
  }, [performCreditRefresh]);

  const setupWorkspace = useCallback(async (state: SessionState) => {
    const request = workspaceGateRef.current.begin();
    const epoch = uiEpochRef.current;
    if (!state.authenticated) {
      if (workspaceGateRef.current.isLatest(request) && epoch === uiEpochRef.current) setSession(state);
      return;
    }
    const [savedSettings, items, savedProjects] = await Promise.all([
      window.mmllm.getSettings(), window.mmllm.listThreads(), window.mmllm.listProjects()
    ]);
    let next: ThreadSnapshot | null = null;
    let nextThreads = items;
    let removedModelNotice = "";
    if (state.models.some((item) => item.type === "llm")) {
      next = items.length
        ? await window.mmllm.loadThread(items[0].id)
        : await window.mmllm.createThread({ modelId: defaultModel(state.models) });
      if (next) {
        const repaired = await repairRemovedThreadModel(next, state.models);
        next = repaired.snapshot;
        if (repaired.removedModelId) removedModelNotice =
          `${repaired.removedModelId} 모델이 현재 목록에서 사라져 ${next.modelId}(으)로 변경했습니다.`;
      }
      if (!items.length) nextThreads = [{
        id: next.id, title: next.title, modelId: next.modelId,
        createdAt: next.createdAt, updatedAt: next.updatedAt,
        messageCount: next.messageCount, webSearchMode: next.webSearchMode, pinned: next.pinned
      }];
    } else if (items[0]) {
      next = await window.mmllm.loadThread(items[0].id);
    }
    if (!workspaceGateRef.current.isLatest(request) || epoch !== uiEpochRef.current) return;
    selectGateRef.current.invalidate();
    setAppSettings(savedSettings); setSettingsDraft(savedSettings); setThreads(nextThreads); setProjects(savedProjects);
    setThread(next); setModelId(next?.modelId ?? "");
    creditRefreshRef.current.lastAt = state.credits ? Date.now() : 0;
    setSession(state);
    if (removedModelNotice) setError(removedModelNotice);
  }, [defaultModel]);

  const resetPrivateUi = useCallback(() => {
    uiEpochRef.current += 1;
    workspaceGateRef.current.invalidate(); selectGateRef.current.invalidate();
    for (const gate of actionGatesRef.current.values()) gate.invalidate();
    actionGatesRef.current.clear();
    summaryFlowRef.current = null; summaryStartRef.current = false;
    const credit = creditRefreshRef.current;
    if (credit.timer !== null) window.clearTimeout(credit.timer);
    credit.timer = null; credit.lastAt = 0; credit.inFlight = null;
    setSession(null); setThreads([]); setProjects([]); setProjectsOpen(false); setSelectedProjectId(null);
    setProjectBusy(false);
    compareStopRef.current?.(); compareStopRef.current = null;
    compareSynthesisStopRef.current?.(); compareSynthesisStopRef.current = null;
    setProjectDraft({ name: "", instruction: "" }); setToolsOpen(false); setCompareBusy(false);
    setCompareSynthesisBusy(false); setCompareRun(null);
    setCompareAttachments([]); setBookmarks([]); setThread(null); setModelId(""); setScreen("chat");
    setAppSettings(null); setSettingsDraft(null); setSettingsOpen(false); setSettingsSaving(false);
    setSearchOpen(false); setSearchQuery(""); setSearchResults([]); setRenameDialog(null);
    setKeyReplaceOpen(false); setReplacementKey(""); setKeyReplacing(false);
    setTemplateDraft(null); setError("");
  }, []);

  const applyThreadUpdate = useCallback((snapshot: ThreadSnapshot) => {
    if (visibleThreadIdRef.current === snapshot.id) setThread(snapshot);
    const flow = summaryFlowRef.current;
    const last = snapshot.messages.at(-1);
    if (!flow || flow.threadId !== snapshot.id || last?.role !== "assistant" ||
      last.status === "incomplete" || last.id === flow.lastAssistantId) return;
    flow.lastAssistantId = last.id;
    if (flow.phase === "final") { summaryFlowRef.current = null; return; }
    flow.outputs.push(last.text);
    if (flow.nextIndex < flow.prompts.length) {
      setTemplateDraft({ threadId: snapshot.id, text: flow.prompts[flow.nextIndex++] });
      return;
    }
    const round = buildMeetingReductionRound(flow.outputs);
    if (!round.prompts.length) { summaryFlowRef.current = null; return; }
    flow.prompts = round.prompts; flow.nextIndex = 1; flow.outputs = [];
    flow.phase = round.final ? "final" : "reduce";
    setTemplateDraft({ threadId: snapshot.id, text: round.prompts[0] });
  }, []);

  useEffect(() => {
    let mounted = true;
    window.mmllm.getSession().then(async (state) => {
      if (mounted) await setupWorkspace(state);
    }).catch((error) => { if (mounted) setError(errorText(error)); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [setupWorkspace]);

  useEffect(() => {
    if (!session?.authenticated) return;
    let stopped = false; let timer: number | undefined;
    const tick = async () => {
      try {
        const pending = (await window.mmllm.listBackgroundResponses()).filter((item) =>
          !["completed", "incomplete", "failed", "cancelled"].includes(item.status) &&
          Date.parse(item.nextPollAt) <= Date.now());
        for (const item of pending.slice(0, 3)) {
          if (stopped) return;
          const updated = await window.mmllm.pollBackgroundResponse(item.id);
          if (["completed", "incomplete", "failed", "cancelled"].includes(updated.status) &&
            visibleThreadIdRef.current === updated.threadId) {
            applyThreadUpdate(await window.mmllm.loadThread(updated.threadId));
          }
          if (["completed", "incomplete", "failed", "cancelled"].includes(updated.status)) void refreshCredits(false);
        }
      } catch (error) {
        if (!stopped) setError(errorText(error));
      } finally {
        if (!stopped) timer = window.setTimeout(tick, 5_000);
      }
    };
    void tick();
    return () => { stopped = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [session?.authenticated, applyThreadUpdate, refreshCredits]);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = window.mmllm.onUpdateChanged((state) => {
      if (mounted) setUpdateState(state);
    });
    void window.mmllm.getUpdateState().then((state) => {
      if (mounted) setUpdateState(state);
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  async function newThread() {
    if (!modelId) return;
    const request = selectGateRef.current.begin();
    const epoch = uiEpochRef.current;
    try {
      const next = await window.mmllm.createThread({ modelId });
      if (!selectGateRef.current.isLatest(request) || epoch !== uiEpochRef.current) return;
      setTemplateDraft(null); setThread(next); setScreen("chat"); await refreshThreads();
    } catch (error) {
      if (selectGateRef.current.isLatest(request) && epoch === uiEpochRef.current) setError(errorText(error));
    }
  }

  async function saveProject() {
    if (!projectDraft.name.trim()) { setError("프로젝트 이름을 입력해 주세요."); return; }
    const epoch = uiEpochRef.current;
    setProjectBusy(true);
    try {
      const saved = selectedProjectId
        ? await window.mmllm.updateProject(selectedProjectId, projectDraft)
        : await window.mmllm.createProject(projectDraft);
      if (epoch !== uiEpochRef.current) return;
      const next = await refreshProjects(); if (epoch !== uiEpochRef.current) return; setSelectedProjectId(saved.id);
      const current = next.find((item) => item.id === saved.id) ?? saved;
      setProjectDraft({ name: current.name, instruction: current.instruction });
    } catch (error) { if (epoch === uiEpochRef.current) setError(errorText(error)); }
    finally { if (epoch === uiEpochRef.current) setProjectBusy(false); }
  }

  async function assignCurrentThreadToProject(projectId?: string) {
    if (!thread) return;
    const epoch = uiEpochRef.current;
    setProjectBusy(true);
    try {
      const updated = await window.mmllm.setThreadProject(thread.id, projectId);
      if (epoch !== uiEpochRef.current) return;
      applyThreadUpdate(updated); await Promise.all([refreshThreads(), refreshProjects()]);
    } catch (error) { if (epoch === uiEpochRef.current) setError(errorText(error)); }
    finally { if (epoch === uiEpochRef.current) setProjectBusy(false); }
  }

  async function createProjectThread(projectId: string) {
    if (!modelId) return;
    const epoch = uiEpochRef.current;
    setProjectBusy(true);
    try {
      const created = await window.mmllm.createThread({ modelId, projectId });
      if (epoch !== uiEpochRef.current) return;
      setProjectsOpen(false); setThread(created); setScreen("chat");
      await Promise.all([refreshThreads(), refreshProjects()]);
    } catch (error) { if (epoch === uiEpochRef.current) setError(errorText(error)); }
    finally { if (epoch === uiEpochRef.current) setProjectBusy(false); }
  }

  async function addDocumentToProject(projectId: string) {
    const epoch = uiEpochRef.current;
    setProjectBusy(true); let attachment: PickedAttachment | null = null;
    try {
      attachment = await window.mmllm.pickAttachment(["document"]);
      if (epoch !== uiEpochRef.current) { if (attachment) await window.mmllm.discardAttachments([attachment.id]); return; }
      if (!attachment) return;
      if (!window.confirm("환자 식별정보나 개인정보를 제거하셨습니까? 사용은 가능하지만 책임은 본인에게 있습니다.")) {
        await window.mmllm.discardAttachments([attachment.id]); return;
      }
      await window.mmllm.addProjectDocument(projectId, attachment.id, true);
      if (epoch !== uiEpochRef.current) return;
      await refreshProjects();
      if (thread?.projectId === projectId) applyThreadUpdate(await window.mmllm.loadThread(thread.id));
    } catch (error) { if (attachment) void window.mmllm.discardAttachments([attachment.id]);
      if (epoch === uiEpochRef.current) setError(errorText(error)); }
    finally { if (epoch === uiEpochRef.current) setProjectBusy(false); }
  }

  async function removeProject(projectId: string) {
    if (!window.confirm("프로젝트를 삭제할까요? 연결된 대화는 미분류로 이동하고 문서 보관함은 삭제됩니다.")) return;
    const epoch = uiEpochRef.current; setProjectBusy(true);
    try {
      await window.mmllm.deleteProject(projectId); if (epoch !== uiEpochRef.current) return; setSelectedProjectId(null);
      setProjectDraft({ name: "", instruction: "" }); await Promise.all([refreshProjects(), refreshThreads()]);
      if (thread?.projectId === projectId) applyThreadUpdate(await window.mmllm.loadThread(thread.id));
    } catch (error) { if (epoch === uiEpochRef.current) setError(errorText(error)); }
    finally { if (epoch === uiEpochRef.current) setProjectBusy(false); }
  }

  async function removeProjectDocument(projectId: string, documentId: string) {
    if (!window.confirm("프로젝트에서 이 문서를 제거할까요?")) return;
    const epoch = uiEpochRef.current; setProjectBusy(true);
    try {
      await window.mmllm.removeProjectDocument(projectId, documentId);
      if (epoch !== uiEpochRef.current) return;
      const next = await refreshProjects();
      const current = next.find((item) => item.id === projectId);
      if (current) setProjectDraft({ name: current.name, instruction: current.instruction });
      if (thread?.projectId === projectId) applyThreadUpdate(await window.mmllm.loadThread(thread.id));
    } catch (error) { if (epoch === uiEpochRef.current) setError(errorText(error)); }
    finally { if (epoch === uiEpochRef.current) setProjectBusy(false); }
  }

  async function addCompareAttachment() {
    if (compareAttachments.length >= 4) { setError("비교 첨부는 최대 4개입니다."); return; }
    try {
      const item = await window.mmllm.pickAttachment(["document", "image"]);
      if (item) { setCompareAttachments((items) => [...items, item]); setCompareConfirmed(false); }
    } catch (error) { setError(errorText(error)); }
  }

  async function startCompare() {
    if (compareBusy || compareSynthesisBusy) return;
    if (compareModels.length < 2 || compareModels.length > 3) { setError("서로 다른 모델을 2~3개 선택해 주세요."); return; }
    if (compareAttachments.length && !compareConfirmed) { setError("첨부 자료의 비식별화를 확인해 주세요."); return; }
    const gateKey = "workspace:compare";
    const gate = actionGatesRef.current.get(gateKey) ?? new LatestRequestGate();
    actionGatesRef.current.set(gateKey, gate);
    const request = gate.begin(); const epoch = uiEpochRef.current;
    setCompareBusy(true); setCompareRun(null); setError("");
    compareStopRef.current = window.mmllm.streamCompare({ prompt: comparePrompt, modelIds: compareModels,
      webSearchMode: compareMode, attachmentIds: compareAttachments.map((item) => item.id),
      deidentifiedConfirmed: compareConfirmed }, (event: CompareEvent) => {
      if (!gate.isLatest(request) || epoch !== uiEpochRef.current) return;
      if (event.type === "snapshot" || event.type === "done") setCompareRun({ ...event.run,
        results: event.run.results.map((item) => ({ ...item })) });
      else if (event.type === "delta") setCompareRun((current) => current ? { ...current,
        results: current.results.map((item) => item.modelId === event.modelId ? { ...item, text: item.text + event.text } : item) } : current);
      else if (event.type === "status") setCompareRun((current) => current ? { ...current,
        results: current.results.map((item) => item.modelId === event.modelId ? { ...item, status: event.status } : item) } : current);
      if (event.type === "done" || event.type === "error") {
        setCompareBusy(false); compareStopRef.current = null; setCompareAttachments([]);
        if (event.type === "error") { if (event.run) setCompareRun(event.run); setError(event.message); }
      }
    });
  }

  async function startCompareSynthesis() {
    if (!compareRun || compareBusy || compareSynthesisBusy) return;
    if (!canSynthesizeCompare(compareRun)) {
      setError("종합분석에는 완료되었거나 일부 생성된 답변이 2개 이상 필요합니다."); return;
    }
    const key = `compare:synthesis:${compareRun.id}`;
    const gate = actionGatesRef.current.get(key) ?? new LatestRequestGate();
    actionGatesRef.current.set(key, gate);
    const request = gate.begin(); const epoch = uiEpochRef.current;
    setCompareSynthesisBusy(true); setError("");
    compareSynthesisStopRef.current = window.mmllm.streamCompareSynthesis(compareRun.id,
      (event: CompareSynthesisEvent) => {
        if (!gate.isLatest(request) || epoch !== uiEpochRef.current) return;
        if (event.type === "snapshot" || event.type === "done") {
          setCompareRun({ ...event.run, results: event.run.results.map((item) => ({ ...item })),
            synthesis: event.run.synthesis ? { ...event.run.synthesis } : undefined });
        } else if (event.type === "delta") {
          setCompareRun((current) => current?.synthesis ? { ...current,
            synthesis: { ...current.synthesis, text: current.synthesis.text + event.text } } : current);
        }
        if (event.type === "done" || event.type === "error") {
          setCompareSynthesisBusy(false); compareSynthesisStopRef.current = null; void refreshCredits(false);
          if (event.type === "error") {
            if (event.run) setCompareRun({ ...event.run, results: event.run.results.map((item) => ({ ...item })),
              synthesis: event.run.synthesis ? { ...event.run.synthesis } : undefined });
            if (!/중단|창이 닫/.test(event.message)) setError(event.message);
          }
        }
      });
  }

  async function continueCompare(runId: string, selectedModel: string) {
    if (compareBusy || compareSynthesisBusy) return;
    const key = `compare:continue:${runId}:${selectedModel}`;
    const gate = actionGatesRef.current.get(key) ?? new LatestRequestGate();
    actionGatesRef.current.set(key, gate);
    const request = gate.begin(); const epoch = uiEpochRef.current;
    try {
      const next = await window.mmllm.continueCompare(runId, selectedModel);
      if (!gate.isLatest(request) || epoch !== uiEpochRef.current) return;
      setToolsOpen(false); setThread(next); setModelId(next.modelId); setScreen("chat"); await refreshThreads();
    } catch (error) { if (gate.isLatest(request) && epoch === uiEpochRef.current) setError(errorText(error)); }
  }

  async function saveBookmark() {
    const epoch = uiEpochRef.current;
    setBookmarkBusy(true);
    try {
      await window.mmllm.saveChatbotBookmark(bookmarkDraft);
      const next = await window.mmllm.listChatbotBookmarks();
      if (epoch === uiEpochRef.current) { setBookmarkDraft({ alias: "", chatbotId: "" }); setBookmarks(next); }
    } catch (error) { if (epoch === uiEpochRef.current) setError(errorText(error)); }
    finally { if (epoch === uiEpochRef.current) setBookmarkBusy(false); }
  }

  async function openChatbot(bookmarkId: string) {
    const key = `chatbot:open:${bookmarkId}`;
    const gate = actionGatesRef.current.get(key) ?? new LatestRequestGate();
    actionGatesRef.current.set(key, gate);
    const request = gate.begin(); const epoch = uiEpochRef.current;
    setBookmarkBusy(true);
    try {
      const next = await window.mmllm.createChatbotThread(bookmarkId);
      if (!gate.isLatest(request) || epoch !== uiEpochRef.current) return;
      setToolsOpen(false); setThread(next); setModelId(next.modelId); setScreen("chat"); await refreshThreads();
    } catch (error) { if (gate.isLatest(request) && epoch === uiEpochRef.current) setError(errorText(error)); }
    finally { if (gate.isLatest(request) && epoch === uiEpochRef.current) setBookmarkBusy(false); }
  }

  async function loadChatbotUsage(bookmarkId: string) {
    const epoch = uiEpochRef.current;
    setBookmarkBusy(true); setError("");
    try { const report = await window.mmllm.getChatbotUsage(bookmarkId);
      if (epoch === uiEpochRef.current) setChatbotUsage({ bookmarkId, report }); }
    catch (error) { if (epoch === uiEpochRef.current) setError(errorText(error)); }
    finally { if (epoch === uiEpochRef.current) setBookmarkBusy(false); }
  }

  async function selectThread(id: string) {
    const request = selectGateRef.current.begin();
    const epoch = uiEpochRef.current;
    try {
      const loaded = await window.mmllm.loadThread(id);
      const repaired = await repairRemovedThreadModel(loaded, session?.models ?? []);
      const next = repaired.snapshot;
      if (!selectGateRef.current.isLatest(request) || epoch !== uiEpochRef.current) return;
      setTemplateDraft(null); setThread(next); setModelId(next.modelId); setScreen("chat");
      if (repaired.removedModelId) setError(
        `${repaired.removedModelId} 모델이 현재 목록에서 사라져 ${next.modelId}(으)로 변경했습니다.`
      );
    } catch (error) {
      if (selectGateRef.current.isLatest(request) && epoch === uiEpochRef.current) setError(errorText(error));
    }
  }

  async function deleteThread(id: string) {
    if (!window.confirm("이 대화를 삭제할까요? 삭제한 기록은 되돌릴 수 없습니다.")) return;
    if (summaryFlowRef.current?.threadId === id) summaryFlowRef.current = null;
    const request = selectGateRef.current.begin();
    const epoch = uiEpochRef.current;
    try {
      await window.mmllm.deleteThread(id);
      const remaining = (await window.mmllm.listThreads());
      if (!selectGateRef.current.isLatest(request) || epoch !== uiEpochRef.current) return;
      setThreads(remaining);
      if (thread?.id === id) {
        const loaded = remaining.length
          ? await window.mmllm.loadThread(remaining[0].id)
          : await window.mmllm.createThread({ modelId: modelId || defaultModel(session?.models ?? []) });
        const repaired = await repairRemovedThreadModel(loaded, session?.models ?? []);
        const next = repaired.snapshot;
        if (!selectGateRef.current.isLatest(request) || epoch !== uiEpochRef.current) return;
        setThread(next); setModelId(next.modelId); await refreshThreads();
        if (repaired.removedModelId) setError(
          `${repaired.removedModelId} 모델이 현재 목록에서 사라져 ${next.modelId}(으)로 변경했습니다.`
        );
      }
    } catch (error) {
      if (selectGateRef.current.isLatest(request) && epoch === uiEpochRef.current) setError(errorText(error));
    }
  }

  async function logout() {
    setLoading(true);
    try {
      await window.mmllm.logout();
      resetPrivateUi();
      setSession({ authenticated: false, models: [] });
    } catch (error) { setError(errorText(error)); }
    finally { setLoading(false); }
  }

  async function refreshModels() {
    const epoch = uiEpochRef.current;
    try {
      const models = await window.mmllm.refreshModels();
      if (epoch !== uiEpochRef.current) return;
      setSession((state) => state ? { ...state, models } : state);
      if (thread) {
        const repaired = await repairRemovedThreadModel(thread, models);
        if (epoch !== uiEpochRef.current) return;
        setThread(repaired.snapshot); setModelId(repaired.snapshot.modelId);
        if (repaired.removedModelId) {
          await refreshThreads();
          setError(`${repaired.removedModelId} 모델이 현재 목록에서 사라져 ${repaired.snapshot.modelId}(으)로 변경했습니다.`);
        }
      } else if (!models.some((item) => item.type === "llm" && item.id === modelId)) {
        setModelId(defaultModel(models));
      }
    } catch (error) { if (epoch === uiEpochRef.current) setError(errorText(error)); }
  }

  async function replaceApiKey() {
    if (!replacementKey.trim() || keyReplacing) return;
    setKeyReplacing(true); setLoading(true); setError("");
    try {
      const state = await window.mmllm.replaceApiKey(replacementKey.trim());
      resetPrivateUi();
      await setupWorkspace(state);
      pendingWorkspaceFocusRef.current = true;
    } catch (error) { setError(errorText(error)); }
    finally { setKeyReplacing(false); setLoading(false); }
  }

  async function startTemplate(item: typeof templates[number]) {
    if (!modelId) throw new Error("사용할 모델을 먼저 선택해 주세요.");
    const request = selectGateRef.current.begin();
    const epoch = uiEpochRef.current;
    const current = thread;
    const reuseCurrent = Boolean(current && isPristineThread(current));
    const next = current && reuseCurrent
      ? await window.mmllm.updateThreadSettings(current.id, {
        modelId, instruction: item.instruction,
        reasoningMode: current.reasoningMode, advanced: current.advanced
      })
      : await window.mmllm.createThread({ modelId, instruction: item.instruction });
    if (!selectGateRef.current.isLatest(request) || epoch !== uiEpochRef.current) {
      if (!reuseCurrent && epoch === uiEpochRef.current) {
        await window.mmllm.deleteThread(next.id).catch(() => undefined);
      }
      return;
    }
    setTemplateDraft({ threadId: next.id, text: item.prompt });
    setThread(next); setModelId(next.modelId); setScreen("chat");
    await refreshThreads();
  }

  async function summarizeTranscript(result: MediaResult) {
    if (summaryStartRef.current) return;
    summaryStartRef.current = true;
    const plan = buildMeetingSummaryPlan(result);
    if (!plan.prompts.length) { setError("요약할 회의 전사가 없습니다."); summaryStartRef.current = false; return; }
    if (!modelId) {
      setError("회의록 요약에 사용할 채팅 모델이 없습니다.");
      summaryStartRef.current = false;
      return;
    }
    try {
      const next = await window.mmllm.createThread({ modelId, instruction: MEETING_SUMMARY_INSTRUCTION,
        purpose: "meeting-summary" });
      summaryFlowRef.current = plan.chunkCount > 1
        ? { threadId: next.id, prompts: plan.prompts, nextIndex: 1, outputs: [], phase: "map" } : null;
      setTemplateDraft({ threadId: next.id, text: plan.prompts[0] });
      setThread(next); setScreen("chat"); await refreshThreads();
      if (plan.chunkCount > 1) setError(
        `긴 전사를 ${plan.chunkCount}개 구간으로 나눴습니다. 각 초안을 검토해 직접 전송하면 마지막 종합 초안이 이어집니다.`
      );
    } catch (error) { setError(errorText(error)); }
    finally { summaryStartRef.current = false; }
  }

  async function saveGlobalSettings() {
    if (!settingsDraft || settingsSaving) return;
    setSettingsSaving(true);
    try {
      const saved = await window.mmllm.updateSettings(settingsDraft);
      setAppSettings(saved); setSettingsDraft(saved); setSettingsOpen(false);
    } catch (error) { setError(errorText(error)); }
    finally { setSettingsSaving(false); }
  }

  function openRenameConversation(item: ThreadSummary, returnFocus?: FocusReturnTarget) {
    rememberDialogReturn(returnFocus);
    setSearchOpen(false); setSettingsOpen(false); setKeyReplaceOpen(false); setReplacementKey("");
    setRenameDialog({ thread: item, value: item.title, busy: false, error: "" });
  }

  async function saveRenamedConversation() {
    if (!renameDialog || renameDialog.busy) return;
    const item = renameDialog.thread;
    const title = renameDialog.value.trim();
    if (!title || title === item.title) return;
    setRenameDialog((current) => current && current.thread.id === item.id
      ? { ...current, busy: true, error: "" } : current);
    const key = `${item.id}:rename`;
    const gate = actionGatesRef.current.get(key) ?? new LatestRequestGate();
    actionGatesRef.current.set(key, gate);
    const request = gate.begin(); const epoch = uiEpochRef.current;
    try {
      const updated = await window.mmllm.renameThread(item.id, title);
      if (!gate.isLatest(request) || epoch !== uiEpochRef.current) return;
      if (visibleThreadIdRef.current === item.id) setThread(updated);
      await refreshThreads();
      if (gate.isLatest(request) && epoch === uiEpochRef.current) setRenameDialog(null);
    } catch (error) {
      if (!gate.isLatest(request) || epoch !== uiEpochRef.current) return;
      setRenameDialog((current) => current && current.thread.id === item.id
        ? { ...current, busy: false, error: errorText(error) } : current);
    }
  }

  async function pinConversation(item: ThreadSummary) {
    const key = `${item.id}:pin`;
    const gate = actionGatesRef.current.get(key) ?? new LatestRequestGate();
    actionGatesRef.current.set(key, gate);
    const request = gate.begin(); const epoch = uiEpochRef.current;
    try {
      const updated = await window.mmllm.setThreadPinned(item.id, !item.pinned);
      if (!gate.isLatest(request) || epoch !== uiEpochRef.current) return;
      if (visibleThreadIdRef.current === item.id) setThread(updated);
      await refreshThreads();
    } catch (error) { if (gate.isLatest(request) && epoch === uiEpochRef.current) setError(errorText(error)); }
  }

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) { setSearchResults([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.mmllm.searchThreads(searchQuery).then((items) => {
        if (!cancelled) setSearchResults(items);
      }).catch((error) => { if (!cancelled) setError(errorText(error)); });
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [searchOpen, searchQuery]);

  useEffect(() => {
    if (!session?.authenticated) return;
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (appShortcutBlocked(document, key)) return;
      if (key === "n") { event.preventDefault(); void newThread(); }
      if (key === "k") { event.preventDefault(); openSearch(); }
      if (key === "b") { event.preventDefault(); setSidebarOpen((open) => !open); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  if (loading) return <div className="startup"><LoaderCircle className="spin" size={30} /><span>MM_LLM을 준비하고 있어요...</span></div>;
  if (!session?.authenticated) return <Login onLogin={async (state) => {
    setLoading(true); resetPrivateUi();
    try { await setupWorkspace(state); }
    catch (error) { setError(errorText(error)); }
    finally { setLoading(false); }
  }} />;

  const nav = [
    { id: "image", label: "이미지", icon: ImageIcon },
    { id: "audio", label: "오디오", icon: Mic2 },
    { id: "video", label: "비디오", icon: Video }
  ] as const;
  const credits = session.credits;
  const compareSynthesisReady = !compareBusy && canSynthesizeCompare(compareRun);
  const compareSynthesisModelAvailable = session.models.some((item) =>
    item.type === "llm" && item.id === COMPARE_SYNTHESIS_MODEL_ID);
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const startWeek = new Date(startToday); startWeek.setDate(startWeek.getDate() - 7);
  const unpinned = threads.filter((item) => !item.pinned);
  const threadGroups = [
    { label: "고정", items: threads.filter((item) => item.pinned) },
    { label: "오늘", items: unpinned.filter((item) => Date.parse(item.updatedAt) >= startToday.getTime()) },
    { label: "이번 주", items: unpinned.filter((item) => Date.parse(item.updatedAt) < startToday.getTime() && Date.parse(item.updatedAt) >= startWeek.getTime()) },
    { label: "이전", items: unpinned.filter((item) => Date.parse(item.updatedAt) < startWeek.getTime()) }
  ].filter((group) => group.items.length);
  return <div className="app-shell">
    <Sidebar
      workspace={{ open: sidebarOpen, screen, navItems: nav, projectCount: projects.length }}
      workspaceActions={{
        onToggle: () => setSidebarOpen((open) => !open), onNewThread: () => void newThread(),
        onOpenProjects: openProjectsPanel, onOpenCompare: (returnFocus) => void openWorkspaceTools("compare", returnFocus),
        onOpenChatbot: (returnFocus) => void openWorkspaceTools("chatbot", returnFocus), onScreenChange: setScreen
      }}
      history={{ threadCount: threads.length, threadGroups, selectedThreadId: thread?.id }}
      historyActions={{
        onOpenSearch: openSearch, onSelectThread: (id) => void selectThread(id),
        onPinThread: (item) => void pinConversation(item), onRenameThread: openRenameConversation,
        onExportThread: (item) => void window.mmllm.exportThread(item.id).catch((error) => setError(errorText(error))),
        onDeleteThread: (id) => void deleteThread(id)
      }}
      account={{ credits, updateState }}
      accountActions={{
        onRefreshCredits: () => void refreshCredits(true), onOpenKeyReplace: openKeyReplace,
        onRefreshModels: () => void refreshModels(),
        onOpenSettings: (returnFocus) => { setSettingsDraft(appSettings); openSettings(returnFocus); },
        onUpdateAction: () => void (updateState?.status === "ready"
          ? window.mmllm.installUpdate()
          : window.mmllm.checkForUpdates()).catch((error) => setError(errorText(error))),
        onLogout: () => void logout()
      }} />
    <main className="main-area">
      {renameDialog && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !renameDialog.busy) closeRename();
      }}><form className="dialog-card rename-dialog" role="dialog" aria-modal="true"
        aria-labelledby="rename-thread-title" aria-describedby={renameDialog.error ? "rename-thread-error" : undefined}
        ref={renameRef} tabIndex={-1} onSubmit={(event) => { event.preventDefault(); void saveRenamedConversation(); }}>
        <div className="dialog-title"><Edit3 size={21} /><h3 id="rename-thread-title">대화 이름 변경</h3></div>
        <label className="settings-field">새 대화 이름
          <input ref={renameInputRef} value={renameDialog.value} maxLength={80} disabled={renameDialog.busy}
            onChange={(event) => setRenameDialog((current) => current
              ? { ...current, value: event.target.value, error: "" } : current)} />
        </label>
        {renameDialog.error && <div className="inline-error" id="rename-thread-error" role="alert">
          <CircleHelp size={16} />{renameDialog.error}</div>}
        <div className="dialog-actions"><button type="button" className="secondary-button"
          onClick={closeRename} disabled={renameDialog.busy}>취소</button>
          <button type="submit" className="primary-button" disabled={renameDialog.busy ||
            !renameDialog.value.trim() || renameDialog.value.trim() === renameDialog.thread.title}>
            {renameDialog.busy ? "저장 중…" : "저장"}</button></div>
      </form></div>}
      {toolsOpen && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !compareBusy && !compareSynthesisBusy && !bookmarkBusy) closeTools();
      }}><div className="dialog-card workspace-tools-dialog" role="dialog" aria-modal="true"
        aria-labelledby="workspace-tools-title" ref={toolsRef} tabIndex={-1}>
        <div className="dialog-title"><Sparkles size={21} /><h3 id="workspace-tools-title">워크스페이스 도구</h3></div>
        <div className="workspace-tool-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={toolsTab === "compare"}
            className={toolsTab === "compare" ? "selected" : ""} disabled={compareBusy || compareSynthesisBusy}
            onClick={() => setToolsTab("compare")}>
            <Columns3 size={15} /> 모델 비교</button>
          <button type="button" role="tab" aria-selected={toolsTab === "chatbot"}
            className={toolsTab === "chatbot" ? "selected" : ""} disabled={compareBusy || compareSynthesisBusy}
            onClick={() => void openWorkspaceTools("chatbot")}>
            <Bot size={15} /> Studio Chatbot</button>
        </div>
        {toolsTab === "compare" ? <section className="compare-panel" role="tabpanel">
          <p>같은 질문과 준비된 자료를 2~3개 모델에 각각 전송합니다. 웹 근거는 한 번만 조사해 모든 모델에 동일하게 제공합니다.</p>
          <label className="settings-field">질문
            <textarea value={comparePrompt} maxLength={100000} disabled={compareBusy || compareSynthesisBusy}
              onChange={(event) => setComparePrompt(event.target.value)} placeholder="비교할 질문을 입력하세요" />
          </label>
          <fieldset className="compare-models"><legend>모델 2~3개</legend>{llmModels.map((model) => <label key={model.id}>
            <input type="checkbox" checked={compareModels.includes(model.id)} disabled={compareBusy || compareSynthesisBusy ||
              !compareModels.includes(model.id) && compareModels.length >= 3} onChange={(event) => setCompareModels((items) =>
                event.target.checked ? [...items, model.id] : items.filter((id) => id !== model.id))} />
            <span>{modelLabel(model.id)}</span></label>)}</fieldset>
          <div className="compare-controls"><label>웹 근거<select value={compareMode} disabled={compareBusy || compareSynthesisBusy}
            onChange={(event) => setCompareMode(event.target.value as WebSearchMode)}>
            <option value="always">항상 검색 · 공통 1회</option><option value="auto">필요할 때 검색</option>
            <option value="deep">딥리서치 · 최대 5회 조사 + 모델별 합성</option><option value="off">검색 안 함</option>
          </select></label><button type="button" className="secondary-button" disabled={compareBusy || compareSynthesisBusy}
            onClick={() => void addCompareAttachment()}><Paperclip size={14} /> 첨부</button></div>
          {compareAttachments.length > 0 && <><div className="attachment-row">{compareAttachments.map((item) =>
            <span className="attachment-chip" key={item.id}>{item.name}<button type="button" disabled={compareBusy || compareSynthesisBusy}
              onClick={() => { void window.mmllm.discardAttachments([item.id]);
                setCompareAttachments((items) => items.filter((value) => value.id !== item.id)); }}><X size={12} /></button></span>)}</div>
            <label className="deid-check"><input type="checkbox" checked={compareConfirmed} disabled={compareBusy || compareSynthesisBusy}
              onChange={(event) => setCompareConfirmed(event.target.checked)} />
              환자 식별정보나 개인정보를 제거했습니다. 자료는 선택한 모델 수만큼 외부 전송·과금될 수 있습니다.</label></>}
          <div className="compare-run-actions">{compareBusy
            ? <button type="button" className="secondary-button" onClick={() => compareStopRef.current?.()}><Square size={14} /> 중단</button>
            : <button type="button" className="primary-button" disabled={compareSynthesisBusy || !comparePrompt.trim() || compareModels.length < 2}
              onClick={() => void startCompare()}><Columns3 size={15} /> 비교 실행</button>}</div>
          {compareRun && <><div className="compare-results" aria-live="polite">{compareRun.results.map((result) => <article key={result.modelId}>
            <header><strong>{modelLabel(result.modelId)}</strong><span>{result.status}</span></header>
            <div className="compare-result-body">{result.error
              ? <span className="compare-result-plain">{result.error}</span>
              : result.text ? <MarkdownText text={result.text} />
                : <span className="compare-result-plain">응답을 기다리는 중…</span>}</div>
            {result.text && result.status !== "running" && <button type="button" className="secondary-button"
              disabled={compareBusy || compareSynthesisBusy}
              onClick={() => void continueCompare(compareRun.id, result.modelId)}>이 모델과 대화 이어가기</button>}
          </article>)}</div>
          {compareSynthesisReady && <div className="compare-synthesis-actions">
            <button type="button" className={compareSynthesisBusy ? "secondary-button" : "primary-button"}
              disabled={!compareSynthesisModelAvailable}
              onClick={() => compareSynthesisBusy ? compareSynthesisStopRef.current?.() : void startCompareSynthesis()}>
              {compareSynthesisBusy ? <><Square size={14} /> 종합분석 중단</> : <><Sparkles size={15} />
                {compareRun.synthesis?.text ? "다시 분석" : "종합분석"}</>}
            </button>
            <small>{compareSynthesisModelAvailable
              ? "GPT-5.6 Sol이 답변 A·B·C의 차이와 근거를 검토합니다. 실행 시 추가 크레딧이 사용됩니다."
              : "현재 API 키에서 GPT-5.6 Sol을 사용할 수 없어 종합분석을 실행할 수 없습니다."}</small>
          </div>}
          {compareRun.synthesis && <section className="compare-synthesis" aria-live="polite">
            <header><span><Sparkles size={16} /><strong>{modelLabel(compareRun.synthesis.modelId)} 종합 분석</strong></span>
              <span>{compareRun.synthesis.status}</span></header>
            <div className="compare-synthesis-legend">{compareRun.results.map((result, index) =>
              <span key={result.modelId}>답변 {String.fromCharCode(65 + index)} · {modelLabel(result.modelId)}</span>)}</div>
            <div className="compare-synthesis-body">{compareRun.synthesis.text
              ? <MarkdownText text={compareRun.synthesis.text} />
              : <span className="compare-result-plain">{compareRun.synthesis.error ?? "종합분석 응답을 기다리는 중…"}</span>}</div>
            {compareRun.synthesis.error && compareRun.synthesis.text &&
              <div className="compare-synthesis-warning" role="status">{compareRun.synthesis.error}</div>}
          </section>}
          </>}
        </section> : <section className="chatbot-panel" role="tabpanel">
          <div className="audit-notice" role="note"><ShieldCheck size={16} />Studio Chatbot은 원격 서비스에 대화 감사 로그를 저장할 수 있습니다.
            모델·전역/프로젝트 지침·첨부는 전송하지 않고 문서화된 텍스트 메시지만 보냅니다.</div>
          <div className="bookmark-form"><label>별칭<input value={bookmarkDraft.alias} maxLength={80} disabled={bookmarkBusy}
            onChange={(event) => setBookmarkDraft((value) => ({ ...value, alias: event.target.value }))} /></label>
            <label>Chatbot ID<input value={bookmarkDraft.chatbotId} maxLength={200} disabled={bookmarkBusy}
              onChange={(event) => setBookmarkDraft((value) => ({ ...value, chatbotId: event.target.value }))} /></label>
            <button type="button" className="primary-button" disabled={bookmarkBusy || !bookmarkDraft.alias.trim() || !bookmarkDraft.chatbotId.trim()}
              onClick={() => void saveBookmark()}>북마크 저장</button></div>
          <div className="bookmark-list">{bookmarks.length === 0 && <p>저장된 챗봇이 없습니다. ChatKHU Studio에서 받은 ID를 직접 등록하세요.</p>}
            {bookmarks.map((bookmark) => <div key={bookmark.id}><Bot size={16} /><span><strong>{bookmark.alias}</strong>
              <small>{bookmark.chatbotId}</small></span><button type="button" className="secondary-button" disabled={bookmarkBusy}
                onClick={() => void openChatbot(bookmark.id)}>대화 시작</button><button type="button" className="secondary-button"
                disabled={bookmarkBusy} onClick={() => void loadChatbotUsage(bookmark.id)}>사용량</button><button type="button" className="icon-button"
                aria-label={`${bookmark.alias} 삭제`} disabled={bookmarkBusy} onClick={() => void window.mmllm.deleteChatbotBookmark(bookmark.id)
                  .then(async () => setBookmarks(await window.mmllm.listChatbotBookmarks())).catch((error) => setError(errorText(error)))}>
                <Trash2 size={14} /></button></div>)}</div>
          {chatbotUsage && <section className="chatbot-usage" aria-live="polite"><strong>챗봇 사용량</strong>
            <small>{new Date(chatbotUsage.report.retrievedAt).toLocaleString("ko-KR")}</small>
            {chatbotUsage.report.summary.map((line) => <div key={line}>{line}</div>)}
            <details><summary>안전하게 정규화된 상세 응답</summary>
              <pre>{JSON.stringify(chatbotUsage.report.data, null, 2)}</pre></details></section>}
        </section>}
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeTools}
          disabled={compareBusy || compareSynthesisBusy || bookmarkBusy}>닫기</button></div>
      </div></div>}
      {projectsOpen && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !projectBusy) closeProjects();
      }}><div className="dialog-card projects-dialog" role="dialog" aria-modal="true"
        aria-labelledby="projects-title" ref={projectsRef} tabIndex={-1}>
        <div className="dialog-title"><FolderOpen size={21} /><h3 id="projects-title">프로젝트</h3></div>
        <p className="project-notice">의료경영 연구별 지침과 문서를 암호화해 이 기기에 보관합니다. 문서는 선택한 프로젝트 대화에만 사용됩니다.</p>
        <div className="project-layout">
          <nav className="project-list" aria-label="프로젝트 목록">
            <button type="button" className={selectedProjectId === null ? "selected" : ""} onClick={() => {
              setSelectedProjectId(null); setProjectDraft({ name: "", instruction: "" });
            }}><Plus size={14} /><span>새 프로젝트</span></button>
            {projects.map((item) => <button type="button" key={item.id}
              className={selectedProjectId === item.id ? "selected" : ""} onClick={() => {
                setSelectedProjectId(item.id); setProjectDraft({ name: item.name, instruction: item.instruction });
              }}><FolderOpen size={14} /><span>{item.name}</span><small>{item.threadCount}</small></button>)}
          </nav>
          <section className="project-editor">
            <label className="settings-field">이름
              <input value={projectDraft.name} maxLength={80} disabled={projectBusy}
                onChange={(event) => setProjectDraft((value) => ({ ...value, name: event.target.value }))} />
            </label>
            <label className="settings-field">프로젝트 지침
              <textarea value={projectDraft.instruction} maxLength={12000} disabled={projectBusy}
                placeholder="이 프로젝트의 역할, 분석 기준, 출력 형식을 적어 주세요."
                onChange={(event) => setProjectDraft((value) => ({ ...value, instruction: event.target.value }))} />
              <small>전역 지침 다음에 적용되고, 대화별 지침이 가장 구체적으로 적용됩니다.</small>
            </label>
            <button type="button" className="primary-button project-save" disabled={projectBusy || !projectDraft.name.trim()}
              onClick={() => void saveProject()}>{projectBusy ? "처리 중…" : selectedProjectId ? "변경 저장" : "프로젝트 만들기"}</button>
            {selectedProjectId && (() => {
              const selected = projects.find((item) => item.id === selectedProjectId);
              if (!selected) return null;
              return <>
                <div className="project-section-heading"><strong>문서 보관함</strong><span>{selected.documents.length}/20</span></div>
                <div className="project-documents">{selected.documents.length === 0
                  ? <small>저장된 문서가 없습니다.</small>
                  : selected.documents.map((document) => <div key={document.id}><FileText size={14} />
                    <span title={document.name}>{document.name}</span><small>{Math.ceil(document.size / 1024)}KB</small>
                    <button type="button" aria-label={`${document.name} 제거`} disabled={projectBusy}
                      onClick={() => void removeProjectDocument(selected.id, document.id)}><X size={13} /></button></div>)}</div>
                <button type="button" className="secondary-button project-add-doc" disabled={projectBusy}
                  onClick={() => void addDocumentToProject(selected.id)}><Paperclip size={15} /> 문서 추가</button>
                <div className="project-actions">
                  <button type="button" className="secondary-button" disabled={projectBusy || thread?.projectId === selected.id || thread?.target?.kind === "chatbot"}
                    onClick={() => void assignCurrentThreadToProject(selected.id)}>현재 대화 연결</button>
                  {thread?.projectId === selected.id && <button type="button" className="secondary-button" disabled={projectBusy}
                    onClick={() => void assignCurrentThreadToProject(undefined)}>현재 대화 연결 해제</button>}
                  <button type="button" className="secondary-button" disabled={projectBusy}
                    onClick={() => void createProjectThread(selected.id)}>이 프로젝트에서 새 대화</button>
                  <button type="button" className="danger-button" disabled={projectBusy}
                    onClick={() => void removeProject(selected.id)}><Trash2 size={14} /> 삭제</button>
                </div>
              </>;
            })()}
          </section>
        </div>
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeProjects}
          disabled={projectBusy}>닫기</button></div>
      </div></div>}
      {keyReplaceOpen && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !keyReplacing) closeKeyReplace();
      }}><div className="dialog-card key-replace-dialog" role="dialog"
        aria-modal="true" aria-labelledby="key-replace-title" ref={keyReplaceRef} tabIndex={-1}>
        <div className="dialog-title"><ShieldCheck size={21} /><h3 id="key-replace-title">API 키 교체</h3></div>
        <p>새 키를 먼저 검증한 뒤 현재 대화와 설정을 그대로 연결합니다. 검증에 실패하면 기존 키를 계속 사용합니다.</p>
        <label className="settings-field">새 ChatKHU API 키
          <input type="password" autoComplete="off" value={replacementKey}
            disabled={keyReplacing}
            onChange={(event) => setReplacementKey(event.target.value)} placeholder="새 API 키 입력" />
        </label>
        <div className="dialog-actions"><button type="button" className="secondary-button"
          onClick={closeKeyReplace} disabled={keyReplacing}>취소</button>
          <button type="button" className="primary-button" disabled={keyReplacing || !replacementKey.trim()}
            onClick={() => void replaceApiKey()}>{keyReplacing ? "검증 중…" : "검증하고 교체"}</button></div>
      </div></div>}
      {searchOpen && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeSearch();
      }}><div className="dialog-card search-dialog" role="dialog"
        aria-modal="true" aria-labelledby="search-title" ref={searchRef} tabIndex={-1}>
        <div className="dialog-title"><Search size={21} /><h3 id="search-title">대화 검색</h3></div>
        <input className="dialog-search-input" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="제목이나 대화 내용 검색" aria-label="대화 검색어" />
        <div className="search-results">{searchQuery.trim() && !searchResults.length &&
          <div className="empty-models">검색 결과가 없습니다.</div>}
          {searchResults.map((item) => <button type="button" key={item.id} onClick={() => {
            setSearchOpen(false); void selectThread(item.id);
          }}><strong>{item.title}</strong><small>{item.snippet}</small></button>)}</div>
        <button type="button" className="secondary-button" onClick={closeSearch}>닫기</button>
      </div></div>}
      {settingsOpen && settingsDraft && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !settingsSaving) closeSettings();
      }}><div className="dialog-card settings-dialog"
        role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={settingsRef} tabIndex={-1}>
        <div className="dialog-title"><Settings size={21} /><h3 id="settings-title">앱 설정</h3></div>
        <div className="settings-inline"><label>테마<select value={settingsDraft.theme} disabled={settingsSaving}
          onChange={(event) => setSettingsDraft((value) => value ? { ...value, theme: event.target.value as AppSettings["theme"] } : value)}>
          <option value="system">시스템</option><option value="light">라이트</option><option value="dark">다크</option>
        </select></label><label>글자 크기<select value={settingsDraft.fontSize} disabled={settingsSaving}
          onChange={(event) => setSettingsDraft((value) => value ? { ...value, fontSize: event.target.value as AppSettings["fontSize"] } : value)}>
          <option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option>
        </select></label></div>
        <label className="settings-field">전역 기본 지침
          <textarea value={settingsDraft.defaultInstruction} maxLength={12000} disabled={settingsSaving}
            onChange={(event) => setSettingsDraft((value) => value ? { ...value, defaultInstruction: event.target.value } : value)} />
          <small>모든 대화에 적용됩니다. 대화별 지침은 더 구체적인 경우 우선합니다.</small>
        </label>
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeSettings}
          disabled={settingsSaving}>취소</button>
          <button type="button" className="primary-button" onClick={() => void saveGlobalSettings()}
            disabled={settingsSaving}>{settingsSaving ? "저장 중…" : "저장"}</button></div>
      </div></div>}
      {!session.models.length && <div className="offline-banner"><CircleHelp size={16} />
        모델 목록을 가져오지 못했습니다. 연결을 확인하고 새로고침해 주세요.
        <button type="button" onClick={refreshModels}>새로고침</button></div>}
      {error && <div className="app-error" role="alert" aria-live="assertive">{error}<button type="button" aria-label="오류 닫기"
        onClick={() => setError("")}><X size={14} /></button></div>}
      {screen === "chat" && thread && llmModels.length > 0
        ? <ChatPanel key={thread.id} thread={thread} modelId={modelId}
          models={llmModels} onModelChange={setModelId}
          onThreadUpdated={applyThreadUpdate} onRefreshThreads={() => void refreshThreads()}
          onUsageChanged={() => void refreshCredits()} onTemplateStart={startTemplate}
          initialDraft={templateDraft?.threadId === thread.id ? templateDraft.text : undefined}
          onDraftApplied={() => setTemplateDraft(null)} />
        : screen !== "chat" && <MediaPanel screen={screen} models={session.models} workspaceEpochRef={uiEpochRef}
          onUsageChanged={() => void refreshCredits()}
          onSummarizeTranscript={summarizeTranscript} />}
      {screen === "chat" && (!thread || !llmModels.length) && <div className="no-models">
        <LoaderCircle size={27} /><h2>모델 목록을 기다리고 있어요</h2>
        <p>네트워크를 확인한 뒤 다시 시도해 주세요.</p>
        <button type="button" className="primary-button" onClick={refreshModels}>모델 목록 새로고침</button>
      </div>}
    </main>
  </div>;
}
