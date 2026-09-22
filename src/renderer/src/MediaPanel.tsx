import { CircleHelp, Copy, Download, Image as ImageIcon, LoaderCircle, MessageCircle, Mic2, Music2, Paperclip, Plus, Sparkles, Video, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioRequest, GatewayModel, MediaResult, PendingMediaJob, PickedAttachment } from "../../shared/contracts";
import { audioLaneForModel, imageCapability, imageEstimate, musicCapability, musicEstimate, sttEstimate, supportsMultiSpeakerTts, TTS_VOICES, videoCapability, videoEstimate } from "../../shared/media-capabilities";
import { formatTranscriptTimestamp, transcriptForChat } from "../../shared/meeting-transcript";
import { LatestRequestGate } from "../../shared/request-generation";
import { useConfirm } from "./components/ConfirmDialog";
import { DiagnosticButton } from "./components/DiagnosticButton";
import { Notice, useNotice } from "./components/Notice";
import { type SidebarScreen } from "./components/Sidebar";

import { ModelPicker } from "./ModelPicker";
import { DeidCheck, errorText, readDroppedFiles } from "./ui-shared";
type Screen = SidebarScreen;
const AUDIO_LANES = ["tts", "stt", "music"] as const;
export function MediaPanel({
  screen, models, workspaceEpochRef, onUsageChanged, onSummarizeTranscript
}: { screen: Exclude<Screen, "chat">; models: GatewayModel[]; onUsageChanged: () => void;
  workspaceEpochRef: { current: number };
  onSummarizeTranscript: (result: MediaResult) => Promise<void> }) {
  const confirm = useConfirm();
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
  const { notice, setError, setInfo, clear: clearNotice } = useNotice();
  const [result, setResult] = useState<MediaResult | null>(null);
  const [jobs, setJobs] = useState<PendingMediaJob[]>([]);
  const [visibleSegments, setVisibleSegments] = useState(250);
  const [summaryPending, setSummaryPending] = useState(false);
  const speakerColors = useMemo(() => new Map([...new Set(result?.segments?.map((segment) => segment.speaker) ?? [])]
    .map((speaker, index) => [speaker, index % 6])), [result?.segments]);
  const jobsRef = useRef(jobs);
  const pickedRef = useRef(picked);
  const resultRef = useRef(result);
  const pollingJobsRef = useRef(false);
  const usageChangedRef = useRef(onUsageChanged);
  usageChangedRef.current = onUsageChanged;
  const [pollNotice, setPollNotice] = useState("");
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
    let failures = 0;
    setPollNotice("");
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
          failures = 0; setPollNotice("");
          if (terminalSeen) usageChangedRef.current();
        }
      } catch (error) {
        if (!cancelled && epoch === workspaceEpochRef.current && ++failures >= 3) {
          setPollNotice("생성 작업 상태를 확인하지 못했습니다. 연결이 복구되면 자동으로 다시 확인합니다.");
        }
      } finally { pollingJobsRef.current = false; }
    };
    void pollAll();
    const timer = setInterval(() => void pollAll(), 5_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [screen, audioLane, workspaceEpochRef]);

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
    if (!(await confirm({ title: "추적 중단", message: `${lane} 추적만 중단합니다. 이미 사용된 크레딧은 복구되지 않으며 서버 작업은 계속될 수 있습니다.`, confirmLabel: "추적 중단", danger: true }))) return;
    try {
      await window.mmllm.stopTrackingMediaJob(result.jobId);
      setResult(null);
      setJobs((items) => items.filter((item) => item.id !== result.jobId));
      setInfo("추적을 중단했습니다. 서버 생성과 과금은 취소되지 않을 수 있습니다.");
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
    <div className="panel-header media-header"><div className="panel-heading"><span className="panel-section">미디어</span><h2>{titles[screen][0]}</h2></div>
      <ModelPicker models={available} selected={modelId} onSelect={setModelId} disabled={busy} />
    </div>
    <div className="media-scroll">
      <div className="media-intro"><p>{screen === "image" ? "프롬프트와 참고 이미지로 필요한 시각 자료를 만드세요." :
        screen === "video" ? "장면을 설명하고 길이와 비율을 설정하세요." : "텍스트를 음성으로 만들거나, 녹음을 전사하고 정리하세요."}</p>
        <span>설정 · 생성 · 저장</span></div>
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
          <h3 className="media-card-heading">작업 설정</h3>
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
          {pollNotice && <p className="notice-info" role="status">{pollNotice}</p>}
          <Notice notice={notice} onClose={clearNotice} />
          {notice?.tone === "error" && <DiagnosticButton stage="media" modelId={modelId} />}
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
          <h3 className="media-card-heading">결과</h3>
          {jobs.length > 1 && <div className="job-list"><strong>이 화면의 작업 {jobs.length}개</strong>
            {jobs.map((job) => <button type="button" key={job.id} onClick={() => showJob(job)}>
              {job.label} · {job.status === "completed" ? "완료" : job.status === "failed" ? "실패" : "진행 중"}
            </button>)}</div>}
          {!result && <div className="result-placeholder"><span>{icon}</span>
            <strong>결과가 여기에 나타납니다</strong>
            <small>자료와 설정을 확인하고 작업을 시작하세요.</small></div>}
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
                className={`speaker-${speakerColors.get(segment.speaker) ?? 0}`}
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
