import { ActionBarPrimitive, AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useAui, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { ArrowRight, ArrowUp, CircleHelp, Copy, Download, FileText, Globe2, Image as ImageIcon, LoaderCircle, Paperclip, RefreshCw, Settings, ShieldCheck, Sparkles, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { claudeAllowsSampling, claudeDefaultThinkingMode, claudeForbidsForcedToolChoice, claudeThinkingCapabilities, isClaudeModel, isGeminiModel, isOpenAiModel } from "../../shared/advanced-chat";
import { hasFixedTemperature, reasoningSupport } from "../../shared/chat-options";
import type { ChatAdvancedSettings, ChatEvent, ChatRequest, GatewayModel, PickedAttachment, PublicMessage, ReasoningMode, ThreadSnapshot, WebSearchMode } from "../../shared/contracts";
import { hasNativeWebSearch } from "../../shared/web-search";
import { useConfirm } from "./components/ConfirmDialog";
import { DiagnosticButton } from "./components/DiagnosticButton";
import { modelLabel } from "./model-names";
import { hasBlockingModal } from "./shortcut-policy";
import { useDialogFocus } from "./use-focus-layer";

import { ModelPicker } from "./ModelPicker";
import { errorText, MarkdownText, readDroppedFiles, templates } from "./ui-shared";
function TemplateCard({ item, onChoose, disabled }: {
  item: typeof templates[number]; onChoose: () => Promise<void>; disabled: boolean;
}) {
  const Icon = item.icon;
  return <button type="button" className="template-card"
    onClick={() => void onChoose()} disabled={disabled}>
    <span className="template-icon"><Icon size={19} /></span>
    <span className="template-content"><strong>{item.title}</strong><small>{item.detail}</small></span>
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
  messageId, toolCalls, files, reasoningSummary, onSubmitTool, modelId, createdAt }: {
  modelId?: string; createdAt?: string;
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
      <small className="message-provenance">{modelId ? modelLabel(modelId) : "모델 기록 없음"}
        {createdAt && <> · <time dateTime={createdAt}>{new Date(createdAt).toLocaleString("ko-KR")}</time></>}</small>
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

export function ChatPanel({
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
  const confirm = useConfirm();
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
        <div className="panel-heading"><span className="panel-section">대화</span><h2 title={thread.title}>{thread.title === "새 대화" ? "새로운 대화" : thread.title}</h2></div>
        <div className="panel-actions">{!chatbotTarget && <ModelPicker models={models} selected={modelId} onSelect={onModelChange}
            disabled={isRunning || controlsPending} />}
          {chatbotTarget && <span className="chatbot-target"><Sparkles size={14} />{chatbotTarget.alias}</span>}</div>
      </div>
      <ThreadPrimitive.Root className="chat-thread">
        <ThreadPrimitive.Viewport className="chat-viewport">
          {messages.length === 0 && <div className="chat-welcome">
            <span className="eyebrow">KYUNG HEE UNIVERSITY · MEDICAL MBA</span>
            <h1>의료의 미래를 읽고,<br /><em>경영의 답을 설계하다</em></h1>
            <p>질문을 적거나, 아래 주제로 대화를 시작하세요.</p>
            <div className="welcome-section-label">의료경영 시작 가이드</div>
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
                messageId={stored?.id ?? message.id} modelId={stored?.modelId} createdAt={stored?.createdAt}
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
            {needsConsent && <small className="document-scope-note">문서는 질문과 관련된 부분을 발췌해 전달할 수 있습니다.
              전체 원문을 빠짐없이 검토한 결과가 아닐 수 있으므로, 필요한 페이지·표·항목을 질문에 명시해 주세요.</small>}
            {error && <div className="inline-error" role="alert" aria-live="assertive"><CircleHelp size={16} />{error}
              <button onClick={() => setError("")} type="button" aria-label="오류 닫기"><X size={14} /></button></div>}
            {error && <DiagnosticButton stage="chat" modelId={modelId} />}
            {progress && <div className="inline-progress" role="status" aria-live="polite"><LoaderCircle className="spin" size={15} />{progress}</div>}
            <ComposerPrimitive.Root className={dropActive ? "composer-card drop-active" : "composer-card"}>
              {!chatbotTarget && <div className="composer-options" aria-label="응답 설정"><label className="web-mode"><Globe2 size={14} />
                <select aria-label="웹 검색 방식" value={thread.webSearchMode} disabled={isRunning || controlsPending || thread.purpose === "meeting-summary"}
                  onChange={(event) => void setSearchMode(event.target.value as WebSearchMode)}>
                  <option value="always">웹검색 항상</option><option value="auto">웹검색 자동</option>
                  <option value="deep">딥리서치 · 최대 6회 호출</option>
                  <option value="off">웹검색 끄기</option>
                </select></label>
                {reasoning === "adjustable" && <label className="reasoning-mode" title="모델의 추론 강도">
                  <Sparkles size={14} /><span className="control-caption">사고</span><select value={thread.reasoningMode} disabled={isRunning || controlsPending}
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
              </div>}
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
