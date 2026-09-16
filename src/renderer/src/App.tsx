import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionBarPrimitive, AssistantRuntimeProvider, ComposerPrimitive,
  MessagePrimitive, ThreadPrimitive, useAui, useExternalStoreRuntime,
  type ThreadMessageLike
} from "@assistant-ui/react";
import {
  ArrowRight, ArrowUp, BookOpen, Check, ChevronDown, CircleHelp, Copy,
  Download, FileText, HeartPulse, Image as ImageIcon, LoaderCircle,
  LogOut, Menu, MessageCircle, Mic2, Music2, Paperclip, Plus,
  RefreshCw, Search, ShieldCheck, Sparkles, Square, Trash2, Video, X
} from "lucide-react";
import type {
  AudioRequest, ChatEvent, ChatRequest, CreditBalance, GatewayModel,
  MediaResult, PickedAttachment, PublicMessage, SessionState,
  ThreadSnapshot, ThreadSummary, UpdateState
} from "../../shared/contracts";
import { modelLabel, providerLabel } from "./model-names";

type Screen = "chat" | "image" | "audio" | "video";

const templates = [
  { icon: HeartPulse, title: "병원 경영", detail: "운영 지표와 개선 과제", prompt: "병원의 운영 지표를 바탕으로 경영 현황을 분석하고 개선 과제를 우선순위로 정리해 주세요. 필요한 지표가 있다면 먼저 질문해 주세요." },
  { icon: BookOpen, title: "의료 정책", detail: "제도 변화와 영향", prompt: "최근 의료 정책 변화가 병원 운영과 환자 경험에 미치는 영향을 이해관계자별로 분석해 주세요. 근거가 필요한 부분은 명확히 표시해 주세요." },
  { icon: FileText, title: "논문 읽기", detail: "핵심 주장과 한계", prompt: "첨부한 논문의 연구 질문, 방법, 주요 결과, 의료경영 실무에 대한 시사점과 한계를 표로 요약해 주세요." },
  { icon: Sparkles, title: "연구 설계", detail: "질문에서 방법까지", prompt: "의료경영학 연구 주제를 구체적인 연구 질문, 가설, 변수, 자료 수집 방법, 분석 계획으로 발전시켜 주세요. 먼저 내 관심 분야를 질문해 주세요." }
];

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function ModelPicker({
  models, selected, onSelect, disabled = false
}: {
  models: GatewayModel[]; selected: string; onSelect: (id: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
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
      <button
        className="model-trigger" type="button" aria-expanded={open}
        onClick={() => { if (!disabled) setOpen(!open); }} disabled={disabled}
      >
        <span className="model-dot" />
        <span className="model-trigger-text">{selected ? modelLabel(selected) : "모델 선택"}</span>
        <ChevronDown size={16} />
      </button>
      {open && <div className="model-popover">
        <div className="model-search"><Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="모델 이름 또는 ID 검색" autoFocus />
        </div>
        <div className="model-count">현재 API 키로 사용 가능한 모델 {models.length}개</div>
        <div className="model-options">
          {Object.entries(groups).map(([provider, items]) => (
            <div key={provider}>
              <div className="model-group">{provider}</div>
              {items.map((model) => <button
                type="button" className={model.id === selected ? "model-option selected" : "model-option"}
                key={model.id} onClick={() => { onSelect(model.id); setOpen(false); setQuery(""); }}
              >
                <span><strong>{modelLabel(model.id)}</strong><small>{model.id}</small></span>
                {model.id === selected && <Check size={17} />}
              </button>)}
            </div>
          ))}
          {!filtered.length && <div className="empty-models">검색 결과가 없습니다.</div>}
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

function TemplateCard({ item }: { item: typeof templates[number] }) {
  const aui = useAui();
  const Icon = item.icon;
  return <button type="button" className="template-card"
    onClick={() => aui.composer.setText(item.prompt)}>
    <span className="template-icon"><Icon size={19} /></span>
    <strong>{item.title}</strong><small>{item.detail}</small>
    <ArrowRight size={16} className="template-arrow" />
  </button>;
}

function UserMessage() {
  return <MessagePrimitive.Root className="message-row user">
    <div className="message-bubble user-bubble"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>;
}

function AssistantMessage() {
  return <MessagePrimitive.Root className="message-row assistant">
    <span className="assistant-avatar"><Sparkles size={16} /></span>
    <div className="assistant-message-column">
      <div className="message-bubble assistant-bubble"><MessagePrimitive.Parts /></div>
      <ActionBarPrimitive.Root className="message-actions" hideWhenRunning>
        <ActionBarPrimitive.Copy title="복사"><Copy size={15} /></ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload title="다시 생성"><RefreshCw size={15} /></ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </div>
  </MessagePrimitive.Root>;
}

function ChatPanel({
  thread, modelId, models, onModelChange, onThreadUpdated, onRefreshThreads
}: {
  thread: ThreadSnapshot; modelId: string; models: GatewayModel[];
  onModelChange: (id: string) => void;
  onThreadUpdated: (snapshot: ThreadSnapshot) => void;
  onRefreshThreads: () => void;
}) {
  const [messages, setMessages] = useState<PublicMessage[]>(thread.messages);
  const [pending, setPending] = useState<PickedAttachment[]>([]);
  const [deidentified, setDeidentified] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const stopRef = useRef<(() => void) | null>(null);
  const settleRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef(pending);
  const confirmedRef = useRef(deidentified);
  const modelRef = useRef(modelId);
  const messagesRef = useRef(messages);
  pendingRef.current = pending;
  confirmedRef.current = deidentified;
  modelRef.current = modelId;
  messagesRef.current = messages;

  const hasAttachedHistory = messages.some((message) => Boolean(message.attachments?.length));
  const needsConfirmation = pending.length > 0 || hasAttachedHistory;

  useEffect(() => { setMessages(thread.messages); setPending([]); setError(""); }, [thread.id]);

  const run = useCallback(async (text: string, regenerate = false, regenerateAfterId?: string) => {
    const startingMessages = messagesRef.current;
    const attachments = regenerate ? [] : pendingRef.current;
    const after = regenerate
      ? regenerateAfterId
        ? startingMessages.findIndex((item) => item.id === regenerateAfterId && item.role === "user")
        : startingMessages.findLastIndex((item) => item.role === "user")
      : startingMessages.length - 1;
    const attachedInContext = startingMessages.slice(0, after + 1)
      .some((item) => Boolean(item.attachments?.length));
    if ((attachments.length > 0 || attachedInContext) && !confirmedRef.current) {
      throw new Error("첨부 자료의 환자 식별정보를 제거했는지 확인해 주세요.");
    }
    const request: ChatRequest = {
      threadId: thread.id,
      modelId: modelRef.current,
      text,
      attachmentIds: attachments.map((item) => item.id),
      deidentifiedConfirmed: confirmedRef.current,
      regenerate,
      regenerateAfterId
    };
    const now = new Date().toISOString();
    const assistantId = crypto.randomUUID();
    if (regenerate) {
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
    setPending([]);
    setDeidentified(false);
    await new Promise<void>((resolve) => {
      settleRef.current = resolve;
      stopRef.current = window.mmllm.streamChat(request, (event: ChatEvent) => {
        if (event.type === "delta") {
          setMessages((previous) => previous.map((item) =>
            item.id === assistantId ? { ...item, text: item.text + event.text } : item
          ));
        } else if (event.type === "done") {
          setMessages(event.snapshot.messages);
          onThreadUpdated(event.snapshot);
          onRefreshThreads();
          setIsRunning(false);
          stopRef.current = null;
          settleRef.current = null;
          resolve();
        } else if (event.type === "error") {
          if (event.snapshot) {
            setMessages(event.snapshot.messages);
            onThreadUpdated(event.snapshot);
            onRefreshThreads();
          } else {
            void window.mmllm.loadThread(thread.id).then((snapshot) => {
              setMessages(snapshot.messages);
              onThreadUpdated(snapshot);
            }).catch(() => setMessages(startingMessages));
          }
          setError(event.message);
          setIsRunning(false);
          stopRef.current = null;
          settleRef.current = null;
          resolve();
        }
      });
    });
  }, [thread.id, onThreadUpdated, onRefreshThreads]);

  const onNew = useCallback(async (message: { content: readonly { type: string; text?: string }[] }) => {
    const text = message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim();
    if (!text) return;
    await run(text);
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
    stopRef.current = null;
    settleRef.current?.();
    settleRef.current = null;
    setIsRunning(false);
    await new Promise((resolve) => setTimeout(resolve, 120));
    try {
      const updated = await window.mmllm.loadThread(thread.id);
      setMessages(updated.messages);
      onThreadUpdated(updated);
    } catch (error) { setError(errorText(error)); }
  }, [thread.id, onThreadUpdated]);

  const convertMessage = useCallback((message: PublicMessage): ThreadMessageLike => ({
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    content: [{ type: "text", text: message.text +
      (message.attachments?.length ? `\n\n📎 ${message.attachments.join(", ")}` : "") }]
  }), []);

  const runtime = useExternalStoreRuntime({
    messages, isRunning, onNew, onReload, onCancel, convertMessage,
    isSendDisabled: (needsConfirmation && !deidentified) || isRunning || !modelId
  });

  async function addAttachment() {
    try {
      const item = await window.mmllm.pickAttachment(["document", "image"]);
      if (item) setPending((items) => [...items, item].slice(0, 4));
    } catch (error) {
      setError(errorText(error));
    }
  }

  return <AssistantRuntimeProvider runtime={runtime}>
    <div className="chat-panel">
      <div className="panel-header">
        <div><span className="eyebrow">MEDICAL MBA WORKSPACE</span>
          <h2>{thread.title === "새 대화" ? "새로운 대화" : thread.title}</h2></div>
        <ModelPicker models={models} selected={modelId} onSelect={onModelChange} disabled={isRunning} />
      </div>
      <ThreadPrimitive.Root className="chat-thread">
        <ThreadPrimitive.Viewport className="chat-viewport">
          {messages.length === 0 && <div className="chat-welcome">
            <div className="welcome-mark"><Sparkles size={29} /></div>
            <span className="eyebrow">YOUR SOFT SPACE TO THINK</span>
            <h1>의료경영의 질문을<br /><em>더 깊게</em> 풀어봐요.</h1>
            <p>하나의 창에서 모든 모델과 함께 읽고, 생각하고, 만들어 보세요.</p>
            <div className="template-grid">{templates.map((item) =>
              <TemplateCard key={item.title} item={item} />)}</div>
          </div>}
          <ThreadPrimitive.Messages>
            {({ message }) => message.role === "user" ? <UserMessage /> : <AssistantMessage />}
          </ThreadPrimitive.Messages>
          <ThreadPrimitive.ViewportFooter className="chat-footer">
            {error && <div className="inline-error"><CircleHelp size={16} />{error}
              <button onClick={() => setError("")} type="button"><X size={14} /></button></div>}
            <ComposerPrimitive.Root className="composer-card">
              {pending.length > 0 && <div className="attachment-row">
                {pending.map((item) => <span className="attachment-chip" key={item.id}>
                  {item.kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
                  {item.name}<button type="button" onClick={() => setPending((items) =>
                    items.filter((attached) => attached.id !== item.id))}><X size={13} /></button>
                </span>)}
              </div>}
              <ComposerPrimitive.Input placeholder="질문이나 아이디어를 적어주세요..."
                className="composer-input" rows={2} addAttachmentOnPaste={false} />
              <div className="composer-bottom">
                <button type="button" className="attach-button" onClick={addAttachment}
                  disabled={isRunning} title="PDF·Word·Excel·이미지 첨부">
                  <Paperclip size={17} /><span>파일 첨부</span>
                </button>
                <span className="composer-hint">Enter 전송 · Shift+Enter 줄바꿈</span>
                {isRunning
                  ? <ComposerPrimitive.Cancel className="send-button stop" title="생성 중단"><Square size={16} /></ComposerPrimitive.Cancel>
                  : <ComposerPrimitive.Send className="send-button" title="전송"><ArrowUp size={19} /></ComposerPrimitive.Send>}
              </div>
            </ComposerPrimitive.Root>
            <div className="chat-checkline">{needsConfirmation
              ? <DeidCheck checked={deidentified} onChange={setDeidentified} />
              : <span>환자 식별정보는 입력 전에 제거해 주세요</span>}
              <span>대화 기록은 기기 안에 저장됩니다</span></div>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </div>
  </AssistantRuntimeProvider>;
}

function MediaPanel({
  screen, models
}: { screen: Exclude<Screen, "chat">; models: GatewayModel[] }) {
  const [audioLane, setAudioLane] = useState<"tts" | "stt" | "music">("tts");
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [voice, setVoice] = useState("Aoede");
  const [picked, setPicked] = useState<PickedAttachment[]>([]);
  const [deidentified, setDeidentified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MediaResult | null>(null);

  const available = useMemo(() => models.filter((model) => {
    if (screen !== "audio") return model.type === screen;
    if (model.type !== "audio") return false;
    if (audioLane === "stt") return model.audio_client === "soniox";
    if (audioLane === "music") return ["google_lyria3", "elevenlabs"].includes(model.audio_client ?? "");
    return !["google_lyria3", "elevenlabs", "soniox"].includes(model.audio_client ?? "");
  }), [models, screen, audioLane]);

  useEffect(() => {
    if (!available.some((model) => model.id === modelId)) setModelId(available[0]?.id ?? "");
  }, [available, modelId]);
  useEffect(() => { setResult(null); setPrompt(""); setPicked([]); setError(""); }, [screen, audioLane]);

  async function pick() {
    try {
      const kinds = screen === "audio" && audioLane === "stt" ? ["audio"] as const : ["image"] as const;
      const item = await window.mmllm.pickAttachment([...kinds]);
      if (item) setPicked((items) => [...items, item].slice(0,
        screen === "video" || (screen === "audio" && audioLane === "stt") ? 1 : 4));
    } catch (error) { setError(errorText(error)); }
  }

  async function submit() {
    if (!deidentified) { setError("환자 식별정보를 제거했는지 확인해 주세요."); return; }
    if (!modelId) { setError("사용 가능한 모델이 없습니다."); return; }
    setBusy(true); setError(""); setResult(null);
    try {
      let next: MediaResult;
      if (screen === "image") {
        next = await window.mmllm.generateImage({
          modelId, prompt, aspectRatio: ratio, imageAttachmentIds: picked.map((item) => item.id),
          deidentifiedConfirmed: true
        });
      } else if (screen === "video") {
        next = await window.mmllm.generateVideo({
          modelId, prompt, aspectRatio: ratio, imageAttachmentIds: picked.map((item) => item.id),
          deidentifiedConfirmed: true
        });
      } else {
        const request: AudioRequest = audioLane === "tts"
          ? { lane: "tts", modelId, input: prompt, voice, deidentifiedConfirmed: true }
          : audioLane === "music"
            ? { lane: "music", modelId, prompt, deidentifiedConfirmed: true }
            : { lane: "stt", modelId, attachmentId: picked[0]?.id ?? "", deidentifiedConfirmed: true };
        next = await window.mmllm.runAudio(request);
      }
      setResult(next); setDeidentified(false);
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (screen !== "video" || !result?.operationId ||
      result.status === "completed" || result.status === "failed") return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const next = await window.mmllm.pollVideo(result.operationId!, modelId);
        if (!cancelled) setResult(next);
      } catch (error) {
        if (!cancelled) setError(errorText(error));
      }
    }, 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [screen, result?.operationId, result?.status, modelId]);

  const titles = {
    image: ["이미지 스튜디오", "아이디어를 한 장의 이미지로"],
    audio: ["오디오 스튜디오", "말하고, 듣고, 기록해요"],
    video: ["비디오 스튜디오", "생각을 움직이는 장면으로"]
  } as const;
  const icon = screen === "image" ? <ImageIcon size={23} /> :
    screen === "audio" ? <Mic2 size={23} /> : <Video size={23} />;
  const canRun = screen === "audio" && audioLane === "stt" ? picked.length > 0 : prompt.trim().length > 0;

  return <div className="media-panel">
    <div className="panel-header media-header"><div><span className="eyebrow">CREATE WITH CHATKHU</span>
      <h2>{titles[screen][0]}</h2></div>
      <ModelPicker models={available} selected={modelId} onSelect={setModelId} disabled={busy} />
    </div>
    <div className="media-scroll">
      <div className="media-intro"><span className="media-icon">{icon}</span>
        <h1>{titles[screen][1]}</h1>
        <p>모델을 고르고 자료를 준비하면 MM_LLM이 알맞은 API로 연결합니다.</p>
      </div>
      {screen === "audio" && <div className="lane-tabs">
        {([
          ["tts", "텍스트 → 음성", Mic2], ["stt", "받아쓰기", MessageCircle],
          ["music", "음악·효과음", Music2]
        ] as const).map(([lane, title, Icon]) => <button type="button" key={lane}
          className={audioLane === lane ? "lane-tab active" : "lane-tab"}
          onClick={() => setAudioLane(lane)}><Icon size={16} />{title}</button>)}
      </div>}
      <div className="media-workspace">
        <div className="media-form">
          <label className="field-label">{screen === "audio" && audioLane === "stt" ? "오디오 파일" :
            screen === "audio" && audioLane === "tts" ? "읽을 텍스트" : "프롬프트"}</label>
          {screen === "audio" && audioLane === "stt"
            ? <button className="file-drop" type="button" onClick={pick}>
              <Paperclip size={22} /><strong>{picked[0]?.name || "녹음 파일 선택"}</strong>
              <small>MP3, M4A, WAV, FLAC, OGG, AIFF · 18MB 이하</small>
            </button>
            : <textarea className="media-textarea" value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={screen === "image" ? "예: 의료경영 논문 발표용 따뜻한 병원 일러스트"
                : screen === "video" ? "예: 병원 운영의 하루를 보여주는 짧은 영상"
                  : audioLane === "music" ? "예: 차분한 학술 발표 배경음악" : "음성으로 들을 문장을 입력해 주세요"} />}
          {(screen === "image" || screen === "video") && <>
            <div className="media-controls"><label>화면 비율
              <select value={ratio} onChange={(event) => setRatio(event.target.value)}>
                <option value="16:9">16:9 가로</option><option value="1:1">1:1 정사각형</option>
                <option value="9:16">9:16 세로</option><option value="4:3">4:3</option>
              </select></label></div>
            <button className="reference-button" type="button" onClick={pick}>
              <Plus size={16} />{picked.length ? `참고 이미지 ${picked.length}개` : "참고 이미지 추가"}
            </button>
            {picked.length > 0 && <div className="attachment-row">
              {picked.map((item) => <span className="attachment-chip" key={item.id}>
                <ImageIcon size={14} />{item.name}
                <button type="button" onClick={() => setPicked((items) =>
                  items.filter((attached) => attached.id !== item.id))}><X size={13} /></button>
              </span>)}
            </div>}
          </>}
          {screen === "audio" && audioLane === "tts" && <div className="media-controls">
            <label>목소리<select value={voice} onChange={(event) => setVoice(event.target.value)}>
              {["Aoede", "Kore", "Puck", "Charon", "Fenrir", "Achernar", "Callirrhoe"].map((item) =>
                <option key={item} value={item}>{item}</option>)}
            </select></label>
          </div>}
          <div className="media-confirm"><DeidCheck checked={deidentified} onChange={setDeidentified} /></div>
          <button className="primary-button media-submit" type="button"
            disabled={busy || !canRun || !deidentified || !modelId} onClick={submit}>
            {busy ? <><LoaderCircle size={17} className="spin" />작업 중...</> :
              <><Sparkles size={17} />{screen === "audio" && audioLane === "stt" ? "받아쓰기 시작" : "생성하기"}</>}
          </button>
          {error && <div className="inline-error"><CircleHelp size={16} />{error}</div>}
        </div>
        <div className="media-result">
          {!result && <div className="result-placeholder"><span>{icon}</span>
            <strong>결과가 여기에 나타납니다</strong>
            <small>준비가 되면 왼쪽에서 시작해 주세요.</small></div>}
          {result?.status === "processing" && <div className="result-placeholder">
            <LoaderCircle size={28} className="spin" /><strong>생성 중입니다</strong>
            <small>완료될 때까지 이 화면을 열어 두세요.</small></div>}
          {result?.status === "failed" && <div className="result-placeholder">
            <CircleHelp size={28} /><strong>생성에 실패했습니다</strong>
            <small>모델과 입력을 확인한 뒤 다시 시도해 주세요.</small></div>}
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
          {result?.text && <div className="result-text"><strong>받아쓰기 결과</strong>
            <p>{result.text}</p><button type="button" onClick={() =>
              navigator.clipboard.writeText(result.text!)}><Copy size={16} /> 복사</button></div>}
          {result?.videoUrl && result.status === "completed" && <div className="result-video">
            <video controls src={result.videoUrl} />
            <button type="button" onClick={() =>
              window.mmllm.saveRemoteMedia(result.videoUrl!, "mmllm-video.mp4")}>
              <Download size={16} /> 영상 저장</button></div>}
        </div>
      </div>
    </div>
  </div>;
}

function Login({ onLogin }: { onLogin: (state: SessionState) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const state = await window.mmllm.login(key.trim());
      setKey("");
      onLogin(state);
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <div className="login-page">
    <div className="login-orb orb-one" /><div className="login-orb orb-two" />
    <div className="login-card">
      <div className="login-brand"><span className="brand-mark"><Sparkles size={24} /></span>
        <span>MM<span className="brand-underscore">_</span>LLM</span></div>
      <span className="eyebrow">KYUNG HEE UNIVERSITY · MEDICAL MBA</span>
      <h1>생각이 자라는<br /><em>부드러운 공간.</em></h1>
      <p>나의 ChatKHU API 키 하나로 시작하는<br />의료경영학과의 AI 워크스페이스</p>
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
      {error && <div className="inline-error"><CircleHelp size={16} />{error}</div>}
      <div className="login-note"><ShieldCheck size={16} />
        키는 이 기기의 운영체제 보안 저장소로 보호됩니다.</div>
      <button className="docs-link" type="button" onClick={() => void window.mmllm.openKeyGuide()}>
        API 키 발급 안내 <ArrowRight size={13} /></button>
    </div>
    <div className="login-aside"><span>36+ MODELS · ONE GENTLE SPACE</span>
      <div className="aside-circles"><span>GPT</span><span>Claude</span><span>Gemini</span><span>+ 더 많은 모델</span></div>
    </div>
  </div>;
}

export default function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>("chat");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [thread, setThread] = useState<ThreadSnapshot | null>(null);
  const [modelId, setModelId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [error, setError] = useState("");
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);

  const llmModels = useMemo(() => session?.models.filter((model) => model.type === "llm") ?? [], [session]);
  const defaultModel = useCallback((items: GatewayModel[]) =>
    items.find((item) => item.id === "gpt-5.6-luna")?.id ??
    items.find((item) => item.type === "llm")?.id ?? "", []);

  const refreshThreads = useCallback(async () => {
    try { setThreads(await window.mmllm.listThreads()); }
    catch (error) { setError(errorText(error)); }
  }, []);

  const setupWorkspace = useCallback(async (state: SessionState) => {
    setSession(state);
    if (!state.authenticated || !state.models.some((item) => item.type === "llm")) return;
    const items = await window.mmllm.listThreads();
    setThreads(items);
    const next = items.length
      ? await window.mmllm.loadThread(items[0].id)
      : await window.mmllm.createThread(defaultModel(state.models));
    setThread(next);
    setModelId(next.modelId);
    if (!items.length) setThreads([{
      id: next.id, title: next.title, modelId: next.modelId,
      createdAt: next.createdAt, updatedAt: next.updatedAt,
      messageCount: next.messageCount
    }]);
  }, [defaultModel]);

  useEffect(() => {
    let mounted = true;
    window.mmllm.getSession().then(async (state) => {
      if (mounted) await setupWorkspace(state);
    }).catch((error) => { if (mounted) setError(errorText(error)); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [setupWorkspace]);

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
    try {
      const next = await window.mmllm.createThread(modelId);
      setThread(next); setScreen("chat"); await refreshThreads();
    } catch (error) { setError(errorText(error)); }
  }

  async function selectThread(id: string) {
    try {
      const next = await window.mmllm.loadThread(id);
      setThread(next); setModelId(next.modelId); setScreen("chat");
    } catch (error) { setError(errorText(error)); }
  }

  async function deleteThread(id: string) {
    if (!window.confirm("이 대화를 삭제할까요? 삭제한 기록은 되돌릴 수 없습니다.")) return;
    try {
      await window.mmllm.deleteThread(id);
      const remaining = (await window.mmllm.listThreads());
      setThreads(remaining);
      if (thread?.id === id) {
        const next = remaining.length
          ? await window.mmllm.loadThread(remaining[0].id)
          : await window.mmllm.createThread(modelId || defaultModel(session?.models ?? []));
        setThread(next); setModelId(next.modelId); await refreshThreads();
      }
    } catch (error) { setError(errorText(error)); }
  }

  async function logout() {
    try {
      await window.mmllm.logout();
      setSession({ authenticated: false, models: [] });
      setThread(null); setThreads([]);
    } catch (error) { setError(errorText(error)); }
  }

  async function refreshModels() {
    try {
      const models = await window.mmllm.refreshModels();
      setSession((state) => state ? { ...state, models } : state);
      if (!models.some((item) => item.id === modelId)) setModelId(defaultModel(models));
    } catch (error) { setError(errorText(error)); }
  }

  async function refreshCredits() {
    try {
      const credits = await window.mmllm.getCredits();
      setSession((state) => state ? { ...state, credits } : state);
    } catch (error) { setError(errorText(error)); }
  }

  if (loading) return <div className="startup"><LoaderCircle className="spin" size={30} /><span>MM_LLM을 준비하고 있어요...</span></div>;
  if (!session?.authenticated) return <Login onLogin={(state) =>
    void setupWorkspace(state).catch((error) => setError(errorText(error)))} />;

  const nav = [
    { id: "chat", label: "대화", icon: MessageCircle, count: llmModels.length },
    { id: "image", label: "이미지", icon: ImageIcon,
      count: session.models.filter((item) => item.type === "image").length },
    { id: "audio", label: "오디오", icon: Mic2,
      count: session.models.filter((item) => item.type === "audio").length },
    { id: "video", label: "비디오", icon: Video,
      count: session.models.filter((item) => item.type === "video").length }
  ] as const;
  const credits = session.credits?.total?.remaining;
  return <div className="app-shell">
    <aside className={sidebarOpen ? "sidebar" : "sidebar collapsed"}>
      <div className="sidebar-top"><div className="brand"><span className="brand-mark"><Sparkles size={20} /></span>
        <strong>MM<span className="brand-underscore">_</span>LLM</strong></div>
        <button type="button" className="icon-button sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}
          title="사이드바 접기"><Menu size={18} /></button></div>
      {sidebarOpen && <>
        <div className="sidebar-caption">Medical MBA의 AI 공간</div>
        <button type="button" className="new-chat-button" onClick={newThread}><Plus size={17} /> 새 대화</button>
        <div className="sidebar-section-label">워크스페이스</div>
        <nav className="nav-list">{nav.map(({ id, label, icon: Icon, count }) =>
          <button type="button" key={id} className={screen === id ? "nav-item active" : "nav-item"}
            onClick={() => setScreen(id)}><Icon size={18} /><span>{label}</span>
            <small>{count}</small></button>)}</nav>
        <div className="sidebar-section-label history-title">최근 대화 <span>{threads.length}</span></div>
        <div className="thread-list">{threads.map((item) =>
          <div className={thread?.id === item.id && screen === "chat" ? "thread-item selected" : "thread-item"}
            key={item.id}>
            <button type="button" onClick={() => selectThread(item.id)} title={item.title}>
              <MessageCircle size={15} /><span>{item.title}</span></button>
            <button type="button" className="thread-delete" title="삭제" onClick={() => deleteThread(item.id)}>
              <Trash2 size={14} /></button>
          </div>)}</div>
        <div className="sidebar-spacer" />
        <div className="credit-card">
          <span><span className="credit-indicator" />남은 크레딧</span>
          <strong>{typeof credits === "number" ? credits.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) : "조회 필요"}</strong>
          <button type="button" onClick={refreshCredits} title="크레딧 새로고침"><RefreshCw size={14} /></button>
        </div>
        <div className="sidebar-bottom">
          <button type="button" onClick={refreshModels}><RefreshCw size={16} /> 모델 목록 새로고침</button>
          {updateState?.status !== "disabled" && <button type="button"
            className={updateState?.status === "ready" ? "update-ready" : ""}
            onClick={() => void (updateState?.status === "ready"
              ? window.mmllm.installUpdate()
              : window.mmllm.checkForUpdates()).catch((error) => setError(errorText(error)))}
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
          <button type="button" onClick={logout}><LogOut size={16} /> 로그아웃</button>
        </div>
      </>}
    </aside>
    <main className="main-area">
      {!session.models.length && <div className="offline-banner"><CircleHelp size={16} />
        모델 목록을 가져오지 못했습니다. 연결을 확인하고 새로고침해 주세요.
        <button type="button" onClick={refreshModels}>새로고침</button></div>}
      {error && <div className="app-error">{error}<button type="button" onClick={() => setError("")}><X size={14} /></button></div>}
      {screen === "chat" && thread && llmModels.length > 0
        ? <ChatPanel key={thread.id} thread={thread} modelId={modelId}
          models={llmModels} onModelChange={setModelId}
          onThreadUpdated={setThread} onRefreshThreads={() => void refreshThreads()} />
        : screen !== "chat" && <MediaPanel screen={screen} models={session.models} />}
      {screen === "chat" && (!thread || !llmModels.length) && <div className="no-models">
        <LoaderCircle size={27} /><h2>모델 목록을 기다리고 있어요</h2>
        <p>네트워크를 확인한 뒤 다시 시도해 주세요.</p>
        <button type="button" className="primary-button" onClick={refreshModels}>모델 목록 새로고침</button>
      </div>}
    </main>
  </div>;
}
