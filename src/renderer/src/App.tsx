import { CircleHelp, Image as ImageIcon, LoaderCircle, Mic2, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canSynthesizeCompare, COMPARE_SYNTHESIS_MODEL_ID } from "../../shared/compare-synthesis";
import type { AppSettings, ChatbotBookmark, ChatbotUsageReport, CompareEvent, CompareRun, CompareSynthesisEvent, GatewayModel, MediaResult, PickedAttachment, ProjectSummary, SessionState, ThreadSearchResult, ThreadSnapshot, ThreadSummary, UpdateState, WebSearchMode } from "../../shared/contracts";
import { CreditRefreshQueue } from "../../shared/credit-refresh";
import { buildMeetingReductionRound, buildMeetingSummaryPlan, MEETING_SUMMARY_INSTRUCTION } from "../../shared/meeting-transcript";
import { resolveLiveThreadModel } from "../../shared/model-catalog";
import { staleRefreshDelay } from "../../shared/refresh-policy";
import { LatestRequestGate } from "../../shared/request-generation";
import { isPristineThread } from "../../shared/thread-state";
import { AppDialogs } from "./AppDialogs";
import { useConfirm } from "./components/ConfirmDialog";
import { Notice, useNotice } from "./components/Notice";
import { Sidebar, type FocusReturnTarget, type SidebarScreen } from "./components/Sidebar";
import { ModelPreferences } from "./model-preferences";
import { appShortcutBlocked } from "./shortcut-policy";
import { useResponsiveSidebarState } from "./sidebar-responsive";
import { ThemePersistence } from "./theme-persistence";
import { useDialogFocus } from "./use-focus-layer";

import { ChatPanel } from "./ChatPanel";
import { Login } from "./Login";
import { MediaPanel } from "./MediaPanel";
import { errorText, templates } from "./ui-shared";
type Screen = SidebarScreen;
type RenameDialogState = { thread: ThreadSummary; value: string; busy: boolean; error: string };
const AUDIO_LANES = ["tts", "stt", "music"] as const;

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
  const confirm = useConfirm();
  const [session, setSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>("chat");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [thread, setThread] = useState<ThreadSnapshot | null>(null);
  const [modelId, setModelId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useResponsiveSidebarState();
  const { notice, setError, setInfo, clear: clearNotice } = useNotice();
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [backgroundNotice, setBackgroundNotice] = useState("");
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
  const creditQueueRef = useRef(new CreditRefreshQueue());
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
      if (repaired.removedModelId) setInfo(
        `${repaired.removedModelId} 모델이 현재 목록에서 사라져 ${next.modelId}(으)로 변경했습니다.`
      );
    } catch (error) {
      if (selectGateRef.current.isLatest(request) && epoch === uiEpochRef.current) setError(errorText(error));
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
        const repaired = await repairRemovedThreadModel(loaded, session?.models ?? []);
        const next = repaired.snapshot;
        if (!selectGateRef.current.isLatest(request) || epoch !== uiEpochRef.current) return;
        setThread(next); setModelId(next.modelId); await refreshThreads();
        if (repaired.removedModelId) setInfo(
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
          setInfo(`${repaired.removedModelId} 모델이 현재 목록에서 사라져 ${repaired.snapshot.modelId}(으)로 변경했습니다.`);
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
      if (plan.chunkCount > 1) setInfo(
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

  const shortcutActions = useRef({ newThread, openSearch, setSidebarOpen });
  shortcutActions.current = { newThread, openSearch, setSidebarOpen };
  useEffect(() => {
    if (!session?.authenticated) return;
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (appShortcutBlocked(document, key)) return;
      if (key === "n") { event.preventDefault(); void shortcutActions.current.newThread(); }
      if (key === "k") { event.preventDefault(); shortcutActions.current.openSearch(); }
      if (key === "b") { event.preventDefault(); shortcutActions.current.setSidebarOpen((open) => !open); }
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

  const nav = [
    { id: "image", label: "이미지", icon: ImageIcon },
    { id: "audio", label: "오디오", icon: Mic2 },
    { id: "video", label: "비디오", icon: Video }
  ] as const;
  const credits = session.credits;
  const compareSynthesisReady = !compareBusy && canSynthesizeCompare(compareRun);
  const compareSynthesisModelAvailable = session.models.some((item) =>
    item.type === "llm" && item.id === COMPARE_SYNTHESIS_MODEL_ID);
  return <ModelPreferences.Provider value={preferences}><div className="app-shell">
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
      <AppDialogs
        renameDialog={renameDialog}
        closeRename={closeRename}
        renameRef={renameRef}
        saveRenamedConversation={saveRenamedConversation}
        renameInputRef={renameInputRef}
        setRenameDialog={setRenameDialog}
        toolsOpen={toolsOpen}
        compareBusy={compareBusy}
        compareSynthesisBusy={compareSynthesisBusy}
        bookmarkBusy={bookmarkBusy}
        closeTools={closeTools}
        toolsRef={toolsRef}
        toolsTab={toolsTab}
        setToolsTab={setToolsTab}
        openWorkspaceTools={openWorkspaceTools}
        comparePrompt={comparePrompt}
        setComparePrompt={setComparePrompt}
        llmModels={llmModels}
        compareModels={compareModels}
        setCompareModels={setCompareModels}
        compareMode={compareMode}
        setCompareMode={setCompareMode}
        addCompareAttachment={addCompareAttachment}
        compareAttachments={compareAttachments}
        setCompareAttachments={setCompareAttachments}
        compareConfirmed={compareConfirmed}
        setCompareConfirmed={setCompareConfirmed}
        compareStopRef={compareStopRef}
        startCompare={startCompare}
        compareRun={compareRun}
        continueCompare={continueCompare}
        compareSynthesisReady={compareSynthesisReady}
        compareSynthesisModelAvailable={compareSynthesisModelAvailable}
        compareSynthesisStopRef={compareSynthesisStopRef}
        startCompareSynthesis={startCompareSynthesis}
        bookmarkDraft={bookmarkDraft}
        setBookmarkDraft={setBookmarkDraft}
        saveBookmark={saveBookmark}
        bookmarks={bookmarks}
        openChatbot={openChatbot}
        loadChatbotUsage={loadChatbotUsage}
        setBookmarks={setBookmarks}
        setError={setError}
        chatbotUsage={chatbotUsage}
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
        replaceApiKey={replaceApiKey}
        searchOpen={searchOpen}
        closeSearch={closeSearch}
        searchRef={searchRef}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        setSearchOpen={setSearchOpen}
        selectThread={selectThread}
        settingsOpen={settingsOpen}
        settingsDraft={settingsDraft}
        settingsSaving={settingsSaving}
        closeSettings={closeSettings}
        settingsRef={settingsRef}
        modelId={modelId}
        setSettingsDraft={setSettingsDraft}
        saveGlobalSettings={saveGlobalSettings} />
      {!session.models.length && <div className="offline-banner"><CircleHelp size={16} />
        모델 목록을 가져오지 못했습니다. 연결을 확인하고 새로고침해 주세요.
        <button type="button" onClick={refreshModels}>새로고침</button></div>}
      {backgroundNotice && <div className="offline-banner" role="status">{backgroundNotice}</div>}
      <Notice notice={notice} onClose={clearNotice} floating />
      {screen === "chat" && thread && llmModels.length > 0
        ? <ChatPanel key={thread.id} thread={thread} modelId={modelId}
          models={llmModels} onModelChange={setModelId}
          onThreadUpdated={applyThreadUpdate} onRefreshThreads={() => void refreshThreads()}
          onUsageChanged={handleUsageChanged} onTemplateStart={startTemplate}
          initialDraft={templateDraft?.threadId === thread.id ? templateDraft.text : undefined}
          onDraftApplied={() => setTemplateDraft(null)} />
        : screen !== "chat" && <MediaPanel screen={screen} models={session.models} workspaceEpochRef={uiEpochRef}
          onUsageChanged={handleUsageChanged}
          onSummarizeTranscript={summarizeTranscript} />}
      {screen === "chat" && (!thread || !llmModels.length) && <div className="no-models">
        <LoaderCircle size={27} /><h2>모델 목록을 기다리고 있어요</h2>
        <p>네트워크를 확인한 뒤 다시 시도해 주세요.</p>
        <button type="button" className="primary-button" onClick={refreshModels}>모델 목록 새로고침</button>
      </div>}
    </main>
  </div></ModelPreferences.Provider>;
}
