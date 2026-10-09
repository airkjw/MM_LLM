import { ArrowLeftRight, CircleHelp, LoaderCircle, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { canSynthesizeCompare, COMPARE_SYNTHESIS_MODEL_ID } from "../../shared/compare-synthesis";
import type { AppSettings, ChatbotBookmark, ChatbotUsageReport, CompareEvent, CompareRequest, CompareRun, CompareSynthesisEvent, GatewayModel, MediaResult, PickedAttachment, ProjectSummary, SessionState, ThreadSnapshot, ThreadSummary, UpdateState } from "../../shared/contracts";
import { CreditRefreshQueue } from "../../shared/credit-refresh";
import { buildMeetingReductionRound, buildMeetingSummaryPlan, MEETING_SUMMARY_INSTRUCTION } from "../../shared/meeting-transcript";
import { resolveLiveThreadModel } from "../../shared/model-catalog";
import { staleRefreshDelay } from "../../shared/refresh-policy";
import { LatestRequestGate } from "../../shared/request-generation";
import { isPristineThread } from "../../shared/thread-state";
import { AppDialogs } from "./AppDialogs";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { useConfirm } from "./components/ConfirmDialog";
import { Notice, useNotice } from "./components/Notice";
import { LIST_SCREENS, Sidebar, type FocusReturnTarget, type MediaKind, type SidebarScreen } from "./components/Sidebar";
import { ModelPreferences } from "./model-preferences";
import { appShortcutBlocked, isEditableTarget, platformCommandModifier, worksInsideEditable } from "./shortcut-policy";
import { useResponsiveSidebarState } from "./sidebar-responsive";
import { ThemePersistence } from "./theme-persistence";
import { useDialogFocus } from "./use-focus-layer";

import { ChatPanel, type ComposerHandle, type EvidenceAppend } from "./ChatPanel";
import { ChatbotScreen, type ChatbotStatus } from "./ChatbotScreen";
import { ResearchScreen } from "./ResearchScreen";
import { SettingsScreen, type SettingsCategory } from "./SettingsScreen";
import { CompareScreen } from "./CompareInline";
import { VoicePanel } from './VoicePanel';
import { Login } from "./Login";
import { MediaPanel, type MediaJobRequest } from "./MediaPanel";
import { errorText, templates } from "./ui-shared";
/** Rendered screens in stage 4; projects and voice still open their existing dialog/disclosure. */
type Screen = Extract<SidebarScreen, "chat" | "compare" | "media" | "research" | "chatbot" | "settings">;
const MEDIA_BUSY_NOTICE = "진행 중인 미디어 작업이 끝난 뒤 다시 선택해 주세요.";
type RenameDialogState = { thread: ThreadSummary; value: string; busy: boolean; error: string };
const MEDIA_KINDS: ReadonlyArray<readonly [MediaKind, string]> = [["image", "이미지"], ["audio", "오디오"], ["video", "비디오"]];
const MAC = navigator.platform.includes("Mac");
const SHORTCUT_LABEL = MAC ? "⌘K" : "Ctrl K";
/** Palette commands (contract D3.7). "⌘↵ 새 창" is out of scope: the app has one window. */
const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  { id: "new-thread", label: "새 대화", shortcut: MAC ? "⌘N" : "Ctrl+N" },
  { id: "compare", label: "모델 비교 시작", shortcut: MAC ? "⌘⇧C" : "Ctrl+Shift+C" },
  { id: "theme-system", label: "시스템", group: "화면 모드" },
  { id: "theme-light", label: "라이트", group: "화면 모드" },
  { id: "theme-dark", label: "다크", group: "화면 모드" },
  { id: "credits", label: "크레딧 새로고침" }
];
const MEDIA_KIND_PANEL_ID = "media-kind-panel";
const mediaKindTabId = (kind: MediaKind) => `media-kind-tab-${kind}`;
const VOICE_UNAVAILABLE = "음성은 대화 화면에서 사용할 수 있습니다. 모델 목록을 불러온 뒤 다시 시도해 주세요.";

async function checkStoredThreadModel(snapshot: ThreadSnapshot, models: GatewayModel[]): Promise<{
  snapshot: ThreadSnapshot; removedModelId?: string;
}> {
  const resolved = resolveLiveThreadModel(snapshot.modelId, models);
  if (!resolved.removed) return { snapshot };
  return { snapshot, removedModelId: snapshot.modelId };
}

export default function App() {
  const confirm = useConfirm();
  const [session, setSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>("chat");
  const [mediaKind, setMediaKind] = useState<MediaKind>("image");
  const [voiceRequest, setVoiceRequest] = useState(0);
  // MediaPanel reports generation/estimate work so the kind tabs and media rows cannot discard it.
  const [mediaBusy, setMediaBusy] = useState(false);
  const [openedMediaJob, setOpenedMediaJob] = useState<MediaJobRequest | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [thread, setThread] = useState<ThreadSnapshot | null>(null);
  const [modelId, setModelId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useResponsiveSidebarState();
  const { notice, setError, setInfo, clear: clearNotice } = useNotice();
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [backgroundNotice, setBackgroundNotice] = useState("");
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  // The settings screen shows the draft: the pending value while a save runs, then the saved (or restored) value.
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const settingsSavingRef = useRef(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("general");
  // Once visited, the media screen stays mounted (hidden) so a paid generation survives navigating away.
  const [mediaVisited, setMediaVisited] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);
  const [keyReplaceOpen, setKeyReplaceOpen] = useState(false);
  const [replacementKey, setReplacementKey] = useState("");
  const [keyReplacing, setKeyReplacing] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<{ threadId: string; text: string } | null>(null);
  const [evidenceAppends, setEvidenceAppends] = useState<EvidenceAppend[]>([]);
  const composerRef = useRef<ComposerHandle | null>(null);
  // Only retain the unsent chatbot draft displaced by evidence's new LLM target, in memory.
  const displacedChatbotDraftsRef = useRef(new Map<string, string>());
  const evidenceCreationRef = useRef<{ owner: object; texts: string[]; owned: () => boolean } | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDraft, setProjectDraft] = useState({ name: "", instruction: "" });
  const [projectBusy, setProjectBusy] = useState(false);
  // The live inline comparison (contract D3.4) and the conversation that started it; saved runs open read-only.
  const [compareRun, setCompareRun] = useState<CompareRun | null>(null);
  const [compareOriginId, setCompareOriginId] = useState<string | null>(null);
  const [viewedCompareRun, setViewedCompareRun] = useState<CompareRun | null>(null);
  const [compareShortcut, setCompareShortcut] = useState(0);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareSynthesisBusy, setCompareSynthesisBusy] = useState(false);
  const [bookmarks, setBookmarks] = useState<ChatbotBookmark[]>([]);
  const [bookmarkDraft, setBookmarkDraft] = useState({ alias: "", chatbotId: "" });
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [chatbotUsage, setChatbotUsage] = useState<{ bookmarkId: string; report: ChatbotUsageReport } | null>(null);
  // null follows the current chatbot conversation; "" is an explicit "new bookmark" choice.
  const [chatbotSelectedId, setChatbotSelectedId] = useState<string | null>(null);
  const [chatbotStatus, setChatbotStatus] = useState<Record<string, ChatbotStatus>>({});
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
  const continueInFlightRef = useRef(false);
  // Set when the palette switches or creates a conversation, or evidence returns to it: the composer takes focus
  // once that conversation is visible. A token, so a failed or superseded request clears only its own request.
  const pendingComposerFocusRef = useRef<object | null>(null);
  const lastFocusRef = useRef<Element | null>(null);
  const dialogReturnFocusRef = useRef<FocusReturnTarget | null>(null);
  const creditRefreshRef = useRef<{
    lastAt: number; timer: number | null; inFlight: Promise<void> | null;
  }>({ lastAt: 0, timer: null, inFlight: null });
  const creditQueueRef = useRef(new CreditRefreshQueue());
  visibleThreadIdRef.current = thread?.id ?? null;
  const evidenceOwner = useMemo(() => ({}), [screen, projectsOpen, selectedProjectId]);
  const evidenceOwnerRef = useRef<object | null>(evidenceOwner);
  evidenceOwnerRef.current = evidenceOwner;
  const evidenceEpoch = uiEpochRef.current;
  useEffect(() => () => { evidenceOwnerRef.current = null; }, []);
  const evidenceApplied = useCallback((ids: string[]) => {
    setEvidenceAppends((current) => current.filter((item) => !ids.includes(item.id)));
  }, []);

  const rememberDialogReturn = useCallback((returnFocus?: FocusReturnTarget) => {
    dialogReturnFocusRef.current = returnFocus ?? null;
  }, []);
  // Dialog focus return: the original trigger, else the visible list control, else the rail's current item.
  const dialogRestoreFallback = useCallback(() => dialogReturnFocusRef.current?.() ??
    document.querySelector<HTMLElement>(
      ".sidebar-mobile-open.visible:not([disabled]), .sidebar:not(.collapsed) .sidebar-toggle:not([disabled])"
    ) ?? document.querySelector<HTMLElement>('nav.rail .rail-item[aria-current="page"]'), []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeRename = useCallback(() => {
    setRenameDialog((current) => current?.busy ? current : null);
  }, []);
  const closeKeyReplace = useCallback(() => { setKeyReplaceOpen(false); setReplacementKey(""); }, []);
  const closeProjects = useCallback(() => { if (!projectBusy) setProjectsOpen(false); }, [projectBusy]);
  const renameRef = useDialogFocus<HTMLFormElement>(
    Boolean(renameDialog), closeRename, !renameDialog?.busy, dialogRestoreFallback);
  const keyReplaceRef = useDialogFocus(keyReplaceOpen, closeKeyReplace, !keyReplacing, dialogRestoreFallback);
  const projectsRef = useDialogFocus(projectsOpen, closeProjects, !projectBusy, dialogRestoreFallback);
  // The palette restores focus to whatever had it when it opened (its trigger, or the field where Cmd/Ctrl+K was pressed).
  const openPalette = useCallback(() => {
    setKeyReplaceOpen(false); setReplacementKey(""); setRenameDialog(null); setPaletteOpen(true);
  }, []);
  const openKeyReplace = useCallback((returnFocus?: FocusReturnTarget) => {
    rememberDialogReturn(returnFocus);
    setPaletteOpen(false); setReplacementKey(""); setRenameDialog(null); setKeyReplaceOpen(true);
  }, [rememberDialogReturn]);
  const loadBookmarks = useCallback(async () => {
    const epoch = uiEpochRef.current;
    try { const next = await window.mmllm.listChatbotBookmarks();
      if (epoch === uiEpochRef.current) setBookmarks(next); }
    catch (error) { if (epoch === uiEpochRef.current) setError(errorText(error)); }
  }, []);

  useEffect(() => {
    if (!renameDialog) return;
    const frame = window.requestAnimationFrame(() => renameInputRef.current?.select());
    return () => window.cancelAnimationFrame(frame);
  }, [renameDialog?.thread.id]);

  useEffect(() => {
    if (!pendingWorkspaceFocusRef.current || loading || !session?.authenticated) return;
    pendingWorkspaceFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      (document.querySelector<HTMLElement>(".sidebar-toggle:not([disabled])") ??
        document.querySelector<HTMLElement>(".sidebar-mobile-open.visible"))?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, session?.authenticated]);

  // After the palette switched or created a conversation (or evidence came back to it), the visible composer takes
  // focus: the opener was replaced or hidden.
  useEffect(() => {
    if (!pendingComposerFocusRef.current || !thread || screen !== "chat") return;
    pendingComposerFocusRef.current = null;
    const frame = window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(".chat-slot:not([hidden]) .chat-panel .composer-input")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [thread?.id, screen]);

  // Focus never stays inside a screen that became hidden (kept-alive conversation or media): it moves to the
  // current rail item, the Stage 2 fallback.
  useEffect(() => {
    const track = (event: FocusEvent) => { lastFocusRef.current = event.target instanceof Element ? event.target : null; };
    document.addEventListener("focusin", track);
    return () => document.removeEventListener("focusin", track);
  }, []);
  useEffect(() => {
    if (screen === "media") setMediaVisited(true);
    const last = lastFocusRef.current;
    const active = document.activeElement;
    const hiddenLayer = (element: Element | null) => element?.closest(".chat-slot[hidden], .media-keepalive[hidden]");
    if (!hiddenLayer(active) && !(hiddenLayer(last) && (!active || active === document.body))) return;
    const frame = window.requestAnimationFrame(() => {
      const current = document.activeElement;
      if (current && current !== document.body && !hiddenLayer(current)) return;
      document.querySelector<HTMLElement>('nav.rail .rail-item[aria-current="page"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [screen, thread?.target?.kind]);

  // The voice rail item opens the existing per-conversation voice disclosure until stage 4 gives it a screen.
  useEffect(() => {
    if (!voiceRequest) return;
    const frame = window.requestAnimationFrame(() => {
      const voice = document.querySelector<HTMLDetailsElement>(".chat-panel details.voice-panel");
      if (!voice) { setError(VOICE_UNAVAILABLE); return; }
      voice.open = true;
      voice.querySelector<HTMLElement>(":scope > summary")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [voiceRequest, setError]);

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
    const root = document.documentElement.dataset;
    root.fontSize = appSettings?.fontSize ?? "medium";
    // Display settings (contract D4.2): absent values are the defaults (default density, OS motion, hints shown).
    root.density = appSettings?.density ?? "default";
    root.reduceMotion = appSettings?.reduceMotion === true ? "true" : "false";
    root.shortcutHints = appSettings?.shortcutHints === false ? "false" : "true";
    if (!appSettings) return;
    const preference = appSettings.theme;
    // data-theme comes only from the startup bootstrap and main's resolved pushes below.
    if (document.documentElement.dataset.themePreference !== preference) {
      document.documentElement.dataset.themePreference = preference;
    }
    void themePersistenceRef.current?.sync(preference).catch((error) => {
      console.warn("화면 테마 설정을 저장하지 못했습니다.", error instanceof Error ? error.name : "unknown");
    });
  }, [appSettings]);

  useEffect(() => window.mmllm.onThemeResolved((theme) => {
    if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
  }), []);

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
    if (state.timer !== null) { window.clearTimeout(state.timer); state.timer = null; }
    const epoch = uiEpochRef.current;
    return creditQueueRef.current.run(manual, async (forced) => {
      if (epoch !== uiEpochRef.current) return;
      state.lastAt = Date.now();
      await window.mmllm.getCredits(forced).then((credits) => {
      if (epoch === uiEpochRef.current) {
        setSession((current) => current ? { ...current, credits } : current);
      }
    }).catch((error) => {
      if (forced && epoch === uiEpochRef.current) setError(errorText(error));
      });
    });
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

  const handleUsageChanged = useCallback(() => { void refreshCredits(); }, [refreshCredits]);

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
        const repaired = await checkStoredThreadModel(next, state.models);
        next = repaired.snapshot;
        if (repaired.removedModelId) removedModelNotice =
          `${repaired.removedModelId} 모델은 현재 사용할 수 없습니다. 전송 전에 사용할 모델을 직접 선택해 주세요.`;
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
    if (removedModelNotice) setInfo(removedModelNotice);
  }, [defaultModel]);

  const resetPrivateUi = useCallback(() => {
    uiEpochRef.current += 1;
    workspaceGateRef.current.invalidate(); selectGateRef.current.invalidate();
    for (const gate of actionGatesRef.current.values()) gate.invalidate();
    actionGatesRef.current.clear();
    summaryFlowRef.current = null; summaryStartRef.current = false;
    const credit = creditRefreshRef.current;
    creditQueueRef.current.reset(); setBackgroundNotice("");
    if (credit.timer !== null) window.clearTimeout(credit.timer);
    credit.timer = null; credit.lastAt = 0; credit.inFlight = null;
    setSession(null); setThreads([]); setProjects([]); setProjectsOpen(false); setSelectedProjectId(null);
    setProjectBusy(false);
    compareStopRef.current?.(); compareStopRef.current = null;
    compareSynthesisStopRef.current?.(); compareSynthesisStopRef.current = null;
    setProjectDraft({ name: "", instruction: "" }); setCompareBusy(false);
    setCompareSynthesisBusy(false); setCompareRun(null); setCompareOriginId(null); setViewedCompareRun(null); setCompareShortcut(0);
    setBookmarks([]); setThread(null); setModelId(""); setScreen("chat"); setMediaKind("image"); setOpenedMediaJob(null);
    setMediaVisited(false); setChatbotSelectedId(null); setChatbotStatus({}); setChatbotUsage(null);
    setAppSettings(null); setSettingsDraft(null); setSettingsSaving(false); settingsSavingRef.current = false;
    setSettingsError(""); setSettingsCategory("general"); pendingComposerFocusRef.current = null;
    setPaletteOpen(false); setRenameDialog(null);
    setKeyReplaceOpen(false); setReplacementKey(""); setKeyReplacing(false);
    setTemplateDraft(null); setEvidenceAppends([]); displacedChatbotDraftsRef.current.clear();
    evidenceCreationRef.current = null; setError("");
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
    let failures = 0;
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
        if (!stopped) { failures = 0; setBackgroundNotice(""); }
      } catch (error) {
        if (!stopped && ++failures >= 3) setBackgroundNotice("백그라운드 응답 상태를 확인하지 못했습니다. 연결이 복구되면 자동으로 다시 확인합니다.");
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

  /** Resolves true when the new conversation became the visible one. */
  async function newThread(): Promise<boolean> {
    if (!modelId) return false;
    const request = selectGateRef.current.begin();
    const epoch = uiEpochRef.current;
    try {
      const next = await window.mmllm.createThread({ modelId });
      if (!selectGateRef.current.isLatest(request) || epoch !== uiEpochRef.current) return false;
      setTemplateDraft(null); setThread(next); setScreen("chat"); await refreshThreads();
      return true;
    } catch (error) {
      if (selectGateRef.current.isLatest(request) && epoch === uiEpochRef.current) setError(errorText(error));
      return false;
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
      if (!(await confirm({ title: "개인정보 제거 확인", message: "환자 식별정보나 개인정보를 제거하셨습니까? 사용은 가능하지만 책임은 본인에게 있습니다.", confirmLabel: "제거했습니다" }))) {
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
    if (!(await confirm({ title: "프로젝트 삭제", message: "연결된 대화는 미분류로 이동하고 문서 보관함은 삭제됩니다.", confirmLabel: "프로젝트 삭제", danger: true }))) return;
    const epoch = uiEpochRef.current; setProjectBusy(true);
    try {
      await window.mmllm.deleteProject(projectId); if (epoch !== uiEpochRef.current) return; setSelectedProjectId(null);
      setProjectDraft({ name: "", instruction: "" }); await Promise.all([refreshProjects(), refreshThreads()]);
      if (thread?.projectId === projectId) applyThreadUpdate(await window.mmllm.loadThread(thread.id));
    } catch (error) { if (epoch === uiEpochRef.current) setError(errorText(error)); }
    finally { if (epoch === uiEpochRef.current) setProjectBusy(false); }
  }

  async function removeProjectDocument(projectId: string, documentId: string) {
    if (!(await confirm({ title: "문서 제거", message: "프로젝트에서 이 문서를 제거할까요?", confirmLabel: "문서 제거", danger: true }))) return;
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

  /** Starts an inline comparison from the composer; false leaves the draft and attachments with the composer. */
  function startCompare(request: CompareRequest, originId: string): boolean {
    if (compareBusy || compareSynthesisBusy) { setError("진행 중인 비교나 종합분석이 끝난 뒤 다시 시도해 주세요."); return false; }
    if (request.modelIds.length < 2 || request.modelIds.length > 3 || new Set(request.modelIds).size !== request.modelIds.length) {
      setError("서로 다른 모델을 2~3개 선택해 주세요."); return false;
    }
    if (request.attachmentIds.length && !request.deidentifiedConfirmed) { setError("첨부 자료의 비식별화를 확인해 주세요."); return false; }
    const gateKey = "workspace:compare";
    const gate = actionGatesRef.current.get(gateKey) ?? new LatestRequestGate();
    actionGatesRef.current.set(gateKey, gate);
    const request_ = gate.begin(); const epoch = uiEpochRef.current;
    setCompareBusy(true); setCompareRun(null); setCompareOriginId(originId); setError("");
    try {
      compareStopRef.current = window.mmllm.streamCompare(request, (event: CompareEvent) => {
        if (!gate.isLatest(request_) || epoch !== uiEpochRef.current) return;
        if (event.type === "snapshot" || event.type === "done") setCompareRun({ ...event.run,
          results: event.run.results.map((item) => ({ ...item })) });
        else if (event.type === "delta") setCompareRun((current) => current ? { ...current,
          results: current.results.map((item) => item.modelId === event.modelId ? { ...item, text: item.text + event.text } : item) } : current);
        else if (event.type === "status") setCompareRun((current) => current ? { ...current,
          results: current.results.map((item) => item.modelId === event.modelId ? { ...item, status: event.status } : item) } : current);
        if (event.type === "done" || event.type === "error") {
          setCompareBusy(false); compareStopRef.current = null;
          if (event.type === "error") { if (event.run) setCompareRun(event.run); setError(event.message); }
        }
      });
      return true;
    } catch (error) {
      if (gate.isLatest(request_) && epoch === uiEpochRef.current) {
        setCompareBusy(false); compareStopRef.current = null; setError(errorText(error));
      }
      return false;
    }
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
    // One continuation at a time: repeated clicks or digit presses must not create duplicate threads.
    if (compareBusy || compareSynthesisBusy || continueInFlightRef.current) return;
    continueInFlightRef.current = true;
    const key = `compare:continue:${runId}:${selectedModel}`;
    const gate = actionGatesRef.current.get(key) ?? new LatestRequestGate();
    actionGatesRef.current.set(key, gate);
    const request = gate.begin(); const epoch = uiEpochRef.current;
    try {
      const next = await window.mmllm.continueCompare(runId, selectedModel);
      if (!gate.isLatest(request) || epoch !== uiEpochRef.current) return;
      setThread(next); setModelId(next.modelId); setScreen("chat"); await refreshThreads();
    } catch (error) { if (gate.isLatest(request) && epoch === uiEpochRef.current) setError(errorText(error)); }
    finally { continueInFlightRef.current = false; }
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
      // The conversation opens beside the bookmark list on the chatbot screen (contract D4.4).
      setChatbotSelectedId(bookmarkId); setThread(next); setModelId(next.modelId); setScreen("chatbot"); await refreshThreads();
    } catch (error) { if (gate.isLatest(request) && epoch === uiEpochRef.current) setError(errorText(error)); }
    finally { if (gate.isLatest(request) && epoch === uiEpochRef.current) setBookmarkBusy(false); }
  }

  async function loadChatbotUsage(bookmarkId: string) {
    const epoch = uiEpochRef.current;
    setBookmarkBusy(true); setError("");
    try { const report = await window.mmllm.getChatbotUsage(bookmarkId);
      if (epoch === uiEpochRef.current) {
        setChatbotUsage({ bookmarkId, report }); setChatbotStatus((current) => ({ ...current, [bookmarkId]: "connected" }));
      } }
    catch (error) {
      if (epoch === uiEpochRef.current) {
        setChatbotStatus((current) => ({ ...current, [bookmarkId]: "check" })); setError(errorText(error));
      } }
    finally { if (epoch === uiEpochRef.current) setBookmarkBusy(false); }
  }

  async function deleteBookmark(bookmark: ChatbotBookmark) {
    const epoch = uiEpochRef.current;
    try {
      await window.mmllm.deleteChatbotBookmark(bookmark.id);
      const next = await window.mmllm.listChatbotBookmarks();
      if (epoch !== uiEpochRef.current) return;
      setBookmarks(next); setChatbotSelectedId("");
    } catch (error) { if (epoch === uiEpochRef.current) setError(errorText(error)); }
  }

  /** "일반 대화로 옮기기" (D4.4): the chatbot's unsent draft moves to a new general conversation, like evidence does. */
  async function moveChatbotDraftToChat() {
    const text = composerRef.current?.getText() ?? "";
    const request = selectGateRef.current.begin(); const epoch = uiEpochRef.current;
    try {
      const target = await window.mmllm.createThread({ modelId: defaultModel(session?.models ?? []) });
      if (!selectGateRef.current.isLatest(request) || epoch !== uiEpochRef.current) return;
      pendingComposerFocusRef.current = {};
      setTemplateDraft(text ? { threadId: target.id, text } : null);
      setThread(target); setModelId(target.modelId); setScreen("chat"); await refreshThreads();
    } catch (error) {
      if (selectGateRef.current.isLatest(request) && epoch === uiEpochRef.current) setError(errorText(error));
    }
  }

  /** Resolves true when the chosen conversation became the visible one. */
  async function selectThread(id: string): Promise<boolean> {
    const request = selectGateRef.current.begin();
    const epoch = uiEpochRef.current;
    try {
      const loaded = await window.mmllm.loadThread(id);
      const repaired = await checkStoredThreadModel(loaded, session?.models ?? []);
      const next = repaired.snapshot;
      if (!selectGateRef.current.isLatest(request) || epoch !== uiEpochRef.current) return false;
      const savedDraft = displacedChatbotDraftsRef.current.get(next.id);
      displacedChatbotDraftsRef.current.delete(next.id);
      setTemplateDraft(savedDraft ? { threadId: next.id, text: savedDraft } : null);
      setThread(next); setModelId(next.modelId); setScreen("chat");
      if (repaired.removedModelId) setInfo(
        `${repaired.removedModelId} 모델은 현재 사용할 수 없습니다. 전송 전에 사용할 모델을 직접 선택해 주세요.`
      );
      return true;
    } catch (error) {
      if (selectGateRef.current.isLatest(request) && epoch === uiEpochRef.current) setError(errorText(error));
      return false;
    }
  }

  async function deleteThread(id: string) {
    if (!(await confirm({ title: "대화 삭제", message: "삭제한 기록은 되돌릴 수 없습니다.", confirmLabel: "대화 삭제", danger: true }))) return;
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
        const repaired = await checkStoredThreadModel(loaded, session?.models ?? []);
        const next = repaired.snapshot;
        if (!selectGateRef.current.isLatest(request) || epoch !== uiEpochRef.current) return;
        setThread(next); setModelId(next.modelId); await refreshThreads();
        if (repaired.removedModelId) setInfo(
          `${repaired.removedModelId} 모델은 현재 사용할 수 없습니다. 전송 전에 사용할 모델을 직접 선택해 주세요.`
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
        const repaired = await checkStoredThreadModel(thread, models);
        if (epoch !== uiEpochRef.current) return;
        setThread(repaired.snapshot); setModelId(repaired.snapshot.modelId);
        if (repaired.removedModelId) {
          await refreshThreads();
          setInfo(`${repaired.removedModelId} 모델은 현재 사용할 수 없습니다. 전송 전에 사용할 모델을 직접 선택해 주세요.`);
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

  function appendEvidence(text: string, ownsSource: () => boolean = () => true) {
    const epoch = evidenceEpoch; const owner = evidenceOwner;
    const originId = thread?.id ?? null;
    const owned = () => epoch === uiEpochRef.current && evidenceOwnerRef.current === owner &&
      visibleThreadIdRef.current === originId && ownsSource();
    if (!owned() || screen !== "research" && !projectsOpen) return;
    const enqueue = (targetId: string, texts: string[]) => {
      setEvidenceAppends((current) => [...current, ...texts.map((value) => ({
        id: crypto.randomUUID(), threadId: targetId, text: value
      }))]);
      pendingComposerFocusRef.current = {};
      setProjectsOpen(false); setScreen("chat");
    };
    if (thread && thread.target?.kind !== "chatbot") { enqueue(thread.id, [text]); return; }
    if (evidenceCreationRef.current?.owner === owner && evidenceCreationRef.current.owned()) {
      evidenceCreationRef.current.texts.push(text); return;
    }
    const batch = { owner, texts: [text], owned }; evidenceCreationRef.current = batch;
    const request = selectGateRef.current.begin();
    void (async () => {
      try {
        const target = await window.mmllm.createThread({ modelId: defaultModel(session?.models ?? []) });
        if (!owned() || !selectGateRef.current.isLatest(request)) return;
        if (originId && thread?.target?.kind === "chatbot") {
          displacedChatbotDraftsRef.current.set(originId, composerRef.current?.getText() ?? "");
        }
        // A snapshot update only refreshes the selected ID; this operation selects a new target.
        setTemplateDraft(null); setThread(target); setModelId(target.modelId);
        enqueue(target.id, batch.texts);
        await refreshThreads();
      } catch (error) {
        if (owned() && selectGateRef.current.isLatest(request)) setError(errorText(error));
      } finally {
        if (evidenceCreationRef.current === batch) evidenceCreationRef.current = null;
      }
    })();
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
      if (plan.chunkCount > 1) setInfo(
        `긴 전사를 ${plan.chunkCount}개 구간으로 나눴습니다. 각 초안을 검토해 직접 전송하면 마지막 종합 초안이 이어집니다.`
      );
    } catch (error) { setError(errorText(error)); }
    finally { summaryStartRef.current = false; }
  }

  /**
   * Settings apply and save at once (contract D4.1/D4.2): one save at a time (settingsSaving guard); the screen
   * shows the pending value, and a failure restores the previous value with an inline error.
   */
  async function applySettings(patch: Partial<AppSettings>, surface: "inline" | "notice" = "inline"): Promise<boolean | null> {
    if (!appSettings || settingsSavingRef.current) return null;
    const previous = appSettings; const next = { ...appSettings, ...patch };
    const epoch = uiEpochRef.current;
    settingsSavingRef.current = true; setSettingsSaving(true); setSettingsError(""); setSettingsDraft(next);
    try {
      const saved = await window.mmllm.updateSettings(next);
      if (epoch === uiEpochRef.current) { setAppSettings(saved); setSettingsDraft(saved); }
      return true;
    } catch (error) {
      if (epoch === uiEpochRef.current) {
        setSettingsDraft(previous);
        if (surface === "inline") setSettingsError(errorText(error)); else setError(errorText(error));
      }
      return false;
    } finally {
      if (epoch === uiEpochRef.current) { settingsSavingRef.current = false; setSettingsSaving(false); }
    }
  }

  function openRenameConversation(item: ThreadSummary, returnFocus?: FocusReturnTarget) {
    rememberDialogReturn(returnFocus);
    setPaletteOpen(false); setKeyReplaceOpen(false); setReplacementKey("");
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

  /** Theme from the palette: the same save path as the settings screen; the theme effect then syncs main. */
  async function applyThemePreference(theme: AppSettings["theme"]) {
    if (!appSettings || appSettings.theme === theme) return;
    await applySettings({ theme }, screen === "settings" ? "inline" : "notice");
  }

  /** Carried-over R-3 N1: a palette request that fails or is superseded clears only its own focus request. */
  function focusComposerAfter(action: () => Promise<boolean>) {
    const token = {}; pendingComposerFocusRef.current = token;
    void action().then((done) => { if (!done && pendingComposerFocusRef.current === token) pendingComposerFocusRef.current = null; });
  }

  function runPaletteCommand(id: string) {
    if (id === "new-thread") focusComposerAfter(newThread);
    else if (id === "compare") startCompareShortcut();
    else if (id === "theme-system" || id === "theme-light" || id === "theme-dark") {
      void applyThemePreference(id.slice("theme-".length) as AppSettings["theme"]);
    } else if (id === "credits") void refreshCredits(true);
  }

  // Cmd/Ctrl+Shift+C: open the conversation composer and ask it for a second model token (contract D3.7/D3.8).
  const startCompareShortcut = () => { setScreen("chat"); setCompareShortcut((value) => value + 1); };
  // Cmd/Ctrl+B toggles the list column where it is shown; elsewhere it is a no-op (the rail always stays).
  const toggleList = () => { if (LIST_SCREENS.has(screen)) setSidebarOpen((open) => !open); };
  const shortcutActions = useRef({ newThread, openPalette, toggleList, startCompareShortcut });
  shortcutActions.current = { newThread, openPalette, toggleList, startCompareShortcut };
  useEffect(() => {
    if (!session?.authenticated) return;
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
      const key = event.key.toLowerCase();
      // Only Cmd/Ctrl+K, N and Shift+C stay global inside text fields; everything else is the field's.
      if (isEditableTarget(event.target) &&
        (!worksInsideEditable(key, event.shiftKey) || !platformCommandModifier(event, MAC))) return;
      if (appShortcutBlocked(document, key)) return;
      if (key === "c" && event.shiftKey) { event.preventDefault(); shortcutActions.current.startCompareShortcut(); }
      else if (key === "n" && !event.shiftKey) { event.preventDefault(); void shortcutActions.current.newThread(); }
      else if (key === "k") { event.preventDefault(); shortcutActions.current.openPalette(); }
      else if (key === "b" && !event.shiftKey) { event.preventDefault(); shortcutActions.current.toggleList(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [session?.authenticated]);

  const calendarDay = new Date().toDateString();
  const threadGroups = useMemo(() => {
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const startWeek = new Date(startToday); startWeek.setDate(startWeek.getDate() - 7);
  const unpinned = threads.filter((item) => !item.pinned);
  return [
    { label: "고정", items: threads.filter((item) => item.pinned) },
    { label: "오늘", items: unpinned.filter((item) => Date.parse(item.updatedAt) >= startToday.getTime()) },
    { label: "이번 주", items: unpinned.filter((item) => Date.parse(item.updatedAt) < startToday.getTime() && Date.parse(item.updatedAt) >= startWeek.getTime()) },
    { label: "이전", items: unpinned.filter((item) => Date.parse(item.updatedAt) < startWeek.getTime()) }
  ].filter((group) => group.items.length);
  }, [threads, calendarDay]);

  const loadCompareRuns = useCallback(() => window.mmllm.listCompareRuns(), []);
  const updatePreference = useCallback((id: string, action: "favorite" | "recent") => {
    const epoch = uiEpochRef.current;
    void window.mmllm.updateModelPreference(id, action).then((settings) => {
      if (epoch === uiEpochRef.current) {
        setAppSettings(settings);
        setSettingsDraft((draft) => draft ? { ...draft, favoriteModels: settings.favoriteModels, recentModels: settings.recentModels } : draft);
      }
    }).catch((error) => { if (epoch === uiEpochRef.current) setError(errorText(error)); });
  }, [setError]);
  const preferences = useMemo(() => ({ favorites: appSettings?.favoriteModels ?? [], recent: appSettings?.recentModels ?? [],
    update: updatePreference }), [appSettings?.favoriteModels, appSettings?.recentModels, updatePreference]);

  if (loading) return <div className="startup"><LoaderCircle className="spin" size={30} /><span>MM_LLM을 준비하고 있어요...</span></div>;
  if (!session?.authenticated) return <Login onLogin={async (state) => {
    setLoading(true); resetPrivateUi();
    try { await setupWorkspace(state); }
    catch (error) { setError(errorText(error)); }
    finally { setLoading(false); }
  }} />;

  const credits = session.credits;
  const navigate = (destination: SidebarScreen, returnFocus: FocusReturnTarget) => {
    if (destination === "voice") { setScreen("chat"); setVoiceRequest((value) => value + 1); return; }
    if (destination === "projects") { openProjectsPanel(returnFocus); return; }
    if (destination === "media") setOpenedMediaJob(null);
    if (destination === "chatbot") void loadBookmarks();
    if (destination === "settings") { setSettingsDraft(appSettings); setSettingsError(""); }
    setScreen(destination);
  };
  const openAccountSettings = () => {
    setSettingsDraft(appSettings); setSettingsError(""); setSettingsCategory("account"); setScreen("settings");
  };
  // Manual activation: arrows/Home/End only move focus; Enter, Space or a click selects. Switching kinds
  // resets MediaPanel, so it is refused while a generation or estimate is in flight.
  const selectMediaKind = (kind: MediaKind) => {
    if (kind === mediaKind || mediaBusy) return;
    setOpenedMediaJob(null); setMediaKind(kind);
  };
  const moveMediaKindFocus = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const tabs = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const current = tabs.indexOf(event.currentTarget);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.focus();
  };
  const headerSearch = <button type="button" className="header-search" aria-keyshortcuts="Meta+K Control+K"
    title={`명령 또는 대화 검색 (${SHORTCUT_LABEL})`} onClick={openPalette}>
    <Search size={15} aria-hidden="true" /><span className="header-search-label">명령 또는 대화 검색</span>
    <kbd aria-hidden="true">{SHORTCUT_LABEL}</kbd></button>;
  const mediaHeader = <div className="header-center">
    <div className="media-kind-tabs" role="tablist" aria-label="미디어 종류">{MEDIA_KINDS.map(([kind, label]) =>
      <button type="button" role="tab" key={kind} id={mediaKindTabId(kind)} aria-controls={MEDIA_KIND_PANEL_ID}
        aria-selected={mediaKind === kind} aria-disabled={mediaBusy && mediaKind !== kind ? true : undefined}
        tabIndex={mediaKind === kind ? 0 : -1}
        onClick={() => selectMediaKind(kind)} onKeyDown={moveMediaKindFocus}>{label}</button>)}</div>
    {headerSearch}</div>;
  const compareSynthesisReady = !compareBusy && canSynthesizeCompare(compareRun);
  const compareSynthesisModelAvailable = session.models.some((item) =>
    item.type === "llm" && item.id === COMPARE_SYNTHESIS_MODEL_ID);
  const headerCenter = <div className="header-center">{headerSearch}</div>;
  const compareControls = thread ? {
    run: compareOriginId === thread.id ? compareRun : null, busy: compareOriginId === thread.id && compareBusy,
    synthesis: { ready: compareSynthesisReady, busy: compareSynthesisBusy, modelAvailable: compareSynthesisModelAvailable,
      onStart: () => void startCompareSynthesis(), onStop: () => compareSynthesisStopRef.current?.() },
    onStart: (request: CompareRequest) => startCompare(request, thread.id),
    onStop: () => compareStopRef.current?.(),
    onContinue: (runId: string, selected: string) => void continueCompare(runId, selected),
    continueDisabled: compareBusy || compareSynthesisBusy,
    onError: setError
  } : undefined;
  const chatbotTarget = thread?.target?.kind === "chatbot" ? thread.target : undefined;
  const followedBookmark = chatbotTarget ? bookmarks.find((item) => item.chatbotId === chatbotTarget.chatbotId)?.id ?? null : null;
  const chatbotSelected = chatbotSelectedId ?? followedBookmark;
  const chatbotConversationShown = screen === "chatbot" && Boolean(chatbotTarget) &&
    bookmarks.some((item) => item.id === chatbotSelected && item.chatbotId === chatbotTarget?.chatbotId);
  // One conversation instance, kept mounted on every screen (hidden and inert elsewhere) so drafts, attachments
  // and in-flight answers survive visits to other screens; on the chatbot screen it sits beside the bookmark list.
  const chatVisible = screen === "chat" || chatbotConversationShown;
  const chatbotHeader = <div className="header-center chatbot-header-tools">
    <span className="chatbot-badge">ChatKHU Studio</span>
    {chatbotUsage && chatbotUsage.bookmarkId === chatbotSelected &&
      <span className="chatbot-usage-line">{chatbotUsage.report.summary.join(" · ")}</span>}
    <button type="button" className="secondary-button" onClick={() => void moveChatbotDraftToChat()}>
      <ArrowLeftRight size={14} aria-hidden="true" />일반 대화로 옮기기</button>
    {headerSearch}</div>;
  const mediaMounted = screen === "media" || mediaVisited;
  return <ModelPreferences.Provider value={preferences}><div className="app-shell">
    <Sidebar
      workspace={{ open: sidebarOpen, screen }}
      workspaceActions={{
        onToggle: () => setSidebarOpen((open) => !open), onNewThread: () => void newThread(), onNavigate: navigate,
        onOpenAccount: openAccountSettings
      }}
      history={{ threadCount: threads.length, threadGroups, selectedThreadId: thread?.id }}
      historyActions={{
        onSelectThread: (id) => void selectThread(id),
        onPinThread: (item) => void pinConversation(item), onRenameThread: openRenameConversation,
        onExportThread: (item) => void window.mmllm.exportThread(item.id).catch((error) => setError(errorText(error))),
        onDeleteThread: (id) => void deleteThread(id),
        loadCompareRuns: () => window.mmllm.listCompareRuns(),
        onOpenCompareRun: (run) => {
          // A saved run opens read-only on the compare screen; nothing new is stored or started.
          setViewedCompareRun(run); setScreen("compare");
        },
        loadMediaJobs: () => window.mmllm.listMediaJobs(),
        onOpenMediaJob: (job) => {
          // The clicked job opens in its own kind (STT in the STT lane); a busy media screen keeps its work and
          // says why (carried-over Stage 2 N1).
          if (mediaBusy) { setInfo(MEDIA_BUSY_NOTICE); return; }
          setMediaKind(job.kind === "stt" ? "audio" : job.kind); setScreen("media");
          setOpenedMediaJob({ id: job.id, kind: job.kind });
        }
      }}
      account={{ credits, updateState }} />
    <main className="main-area">
      <AppDialogs
        retrievalModels={session.models}
        onResearchEvidence={appendEvidence}
        renameDialog={renameDialog}
        closeRename={closeRename}
        renameRef={renameRef}
        saveRenamedConversation={saveRenamedConversation}
        renameInputRef={renameInputRef}
        setRenameDialog={setRenameDialog}
        projectsOpen={projectsOpen}
        projectBusy={projectBusy}
        closeProjects={closeProjects}
        projectsRef={projectsRef}
        selectedProjectId={selectedProjectId}
        setSelectedProjectId={setSelectedProjectId}
        setProjectDraft={setProjectDraft}
        projects={projects}
        projectDraft={projectDraft}
        saveProject={saveProject}
        removeProjectDocument={removeProjectDocument}
        addDocumentToProject={addDocumentToProject}
        thread={thread}
        assignCurrentThreadToProject={assignCurrentThreadToProject}
        createProjectThread={createProjectThread}
        removeProject={removeProject}
        keyReplaceOpen={keyReplaceOpen}
        keyReplacing={keyReplacing}
        closeKeyReplace={closeKeyReplace}
        keyReplaceRef={keyReplaceRef}
        replacementKey={replacementKey}
        setReplacementKey={setReplacementKey}
        replaceApiKey={replaceApiKey} />
      {!session.models.length && <div className="offline-banner"><CircleHelp size={16} />
        모델 목록을 가져오지 못했습니다. 연결을 확인하고 새로고침해 주세요.
        <button type="button" onClick={refreshModels}>새로고침</button></div>}
      {backgroundNotice && <div className="offline-banner" role="status">{backgroundNotice}</div>}
      <Notice notice={notice} onClose={clearNotice} floating />
      <CommandPalette open={paletteOpen} onClose={closePalette} searchThreads={(query) => window.mmllm.searchThreads(query)}
        onSelectThread={(id) => { if (id !== thread?.id) focusComposerAfter(() => selectThread(id)); else void selectThread(id); }}
        commands={PALETTE_COMMANDS} onRunCommand={runPaletteCommand} />
      {screen === "compare" && <CompareScreen headerCenter={headerCenter} loadRuns={loadCompareRuns}
        selectedRun={viewedCompareRun} onSelectRun={setViewedCompareRun}
        continueDisabled={compareBusy || compareSynthesisBusy}
        onContinue={(runId, selected) => void continueCompare(runId, selected)} onError={setError}
        onStartNew={startCompareShortcut} />}
      {screen === "research" && <ResearchScreen onEvidence={appendEvidence} headerCenter={headerCenter} />}
      {screen === "settings" && settingsDraft && <SettingsScreen category={settingsCategory} onCategoryChange={setSettingsCategory}
        settings={settingsDraft} saving={settingsSaving} error={settingsError} onChange={(patch) => applySettings(patch)}
        updateState={updateState} credits={credits} modelId={modelId}
        onUpdateAction={() => void (updateState?.status === "ready"
          ? window.mmllm.installUpdate()
          : window.mmllm.checkForUpdates()).catch((error) => setError(errorText(error)))}
        onRefreshModels={() => void refreshModels()} onRefreshCredits={() => void refreshCredits(true)}
        onOpenKeyReplace={openKeyReplace} onLogout={() => void logout()} />}
      <div className={screen === "chatbot" ? "conversation-host chatbot-screen screen-layout" : "conversation-host"}
        role={screen === "chatbot" ? "region" : undefined} aria-label={screen === "chatbot" ? "Studio 챗봇" : undefined}>
        {screen === "chatbot" && <ChatbotScreen bookmarks={bookmarks} selectedId={chatbotSelected}
          onSelect={(id) => setChatbotSelectedId(id)} status={chatbotStatus} busy={bookmarkBusy}
          draft={bookmarkDraft} onDraftChange={setBookmarkDraft} onSave={() => void saveBookmark()}
          onOpen={(id) => void openChatbot(id)} onUsage={(id) => void loadChatbotUsage(id)}
          onDelete={(bookmark) => void deleteBookmark(bookmark)} usage={chatbotUsage}
          conversationShown={chatbotConversationShown} />}
        <div className="chat-slot" hidden={!chatVisible} inert={!chatVisible || undefined}>
          {thread && llmModels.length > 0
            ? <ChatPanel key={thread.id} thread={thread} modelId={modelId} active={chatVisible}
              voicePanel={<VoicePanel key={`voice-${uiEpochRef.current}-${thread.id}`} models={session.models}
                threadId={thread.id} canApply={thread.target?.kind !== 'chatbot'}
                onApply={(text) => setEvidenceAppends(current => [...current, { id: crypto.randomUUID(), threadId: thread.id, text }])}
                onSaved={applyThreadUpdate} onUsageChanged={handleUsageChanged} />}
              models={llmModels} onModelChange={setModelId}
              onThreadUpdated={applyThreadUpdate} onRefreshThreads={() => void refreshThreads()}
              onUsageChanged={handleUsageChanged} onTemplateStart={startTemplate}
              initialDraft={templateDraft?.threadId === thread.id ? templateDraft.text : undefined}
              evidenceAppends={evidenceAppends.filter((item) => item.threadId === thread.id)}
              onEvidenceApplied={evidenceApplied} composerRef={composerRef}
              onDraftApplied={() => setTemplateDraft(null)}
              compare={compareControls} compareShortcut={compareShortcut || undefined}
              onCompareShortcutHandled={(id) => setCompareShortcut((value) => value === id ? 0 : value)}
              headerSearch={screen === "chatbot" ? chatbotHeader : headerCenter} />
            : screen === "chat" && <section className="chat-panel" aria-labelledby="no-models-title">
              {/* The header Cmd+K entry stays reachable while models or the conversation are still loading. */}
              <div className="panel-header"><div className="panel-heading"><h2>대화</h2></div>{headerCenter}<div className="panel-actions" /></div>
              <div className="no-models">
                <LoaderCircle size={27} /><h2 id="no-models-title">모델 목록을 기다리고 있어요</h2>
                <p>네트워크를 확인한 뒤 다시 시도해 주세요.</p>
                <button type="button" className="primary-button" onClick={refreshModels}>모델 목록 새로고침</button>
              </div>
            </section>}
        </div>
      </div>
      {mediaMounted && <div className="media-keepalive" hidden={screen !== "media"} inert={screen !== "media" || undefined}>
        <MediaPanel screen={mediaKind} models={session.models} workspaceEpochRef={uiEpochRef}
          headerSearch={mediaHeader} openJob={openedMediaJob} onBusyChange={setMediaBusy}
          tabPanel={{ id: MEDIA_KIND_PANEL_ID, labelledBy: mediaKindTabId(mediaKind) }}
          onUsageChanged={handleUsageChanged}
          onSummarizeTranscript={summarizeTranscript} /></div>}
    </main>
  </div></ModelPreferences.Provider>;
}
