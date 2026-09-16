import { contextBridge, ipcRenderer } from "electron";
import type {
  AudioRequest, ChatEvent, ChatRequest, CompareEvent, CompareRequest, DesktopApi, DroppedAttachment, ImageRequest,
  PickedAttachment, VideoRequest
} from "../shared/contracts";

const desktopApi: DesktopApi = {
  getSession: () => ipcRenderer.invoke("session:get"),
  login: (key) => ipcRenderer.invoke("session:login", key),
  logout: () => ipcRenderer.invoke("session:logout"),
  replaceApiKey: (key) => ipcRenderer.invoke("session:replace-key", key),
  refreshModels: () => ipcRenderer.invoke("models:refresh"),
  getCredits: (force = false) => ipcRenderer.invoke("credits:get", force),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (settings) => ipcRenderer.invoke("settings:update", settings),
  listThreads: () => ipcRenderer.invoke("threads:list"),
  createThread: (request) => ipcRenderer.invoke("threads:create", request),
  loadThread: (id) => ipcRenderer.invoke("threads:load", id),
  deleteThread: (id) => ipcRenderer.invoke("threads:delete", id),
  setWebSearchMode: (id, mode) => ipcRenderer.invoke("threads:web-search", id, mode),
  updateThreadSettings: (id, settings) => ipcRenderer.invoke("threads:settings", id, settings),
  countClaudeInputTokens: (id) => ipcRenderer.invoke("claude:count-tokens", id),
  setThreadProject: (id, projectId) => ipcRenderer.invoke("threads:project", id, projectId),
  renameThread: (id, title) => ipcRenderer.invoke("threads:rename", id, title),
  setThreadPinned: (id, pinned) => ipcRenderer.invoke("threads:pin", id, pinned),
  searchThreads: (query) => ipcRenderer.invoke("threads:search", query),
  exportThread: (id) => ipcRenderer.invoke("threads:export", id),
  pickAttachment: (kinds: Array<PickedAttachment["kind"]>) =>
    ipcRenderer.invoke("attachments:pick", kinds),
  addDroppedAttachments: (files: DroppedAttachment[], kinds: Array<PickedAttachment["kind"]>) =>
    ipcRenderer.invoke("attachments:add-dropped", files, kinds),
  discardAttachments: (ids) => ipcRenderer.invoke("attachments:discard", ids),
  listProjects: () => ipcRenderer.invoke("projects:list"),
  createProject: (input) => ipcRenderer.invoke("projects:create", input),
  updateProject: (id, input) => ipcRenderer.invoke("projects:update", id, input),
  deleteProject: (id) => ipcRenderer.invoke("projects:delete", id),
  addProjectDocument: (projectId, attachmentId, deidentifiedConfirmed) =>
    ipcRenderer.invoke("projects:add-document", projectId, attachmentId, deidentifiedConfirmed),
  removeProjectDocument: (projectId, documentId) => ipcRenderer.invoke("projects:remove-document", projectId, documentId),
  listCompareRuns: () => ipcRenderer.invoke("compare:list"),
  streamCompare(request: CompareRequest, onEvent: (event: CompareEvent) => void) {
    const { port1, port2 } = new MessageChannel(); let stopped = false;
    const cleanup = () => { if (stopped) return; stopped = true; port1.removeEventListener("message", receive); port1.close(); };
    const receive = (event: MessageEvent<CompareEvent>) => {
      onEvent(event.data); if (event.data.type === "done" || event.data.type === "error") cleanup();
    };
    port1.addEventListener("message", receive); port1.start();
    ipcRenderer.postMessage("compare:stream", request, [port2]);
    return () => { if (!stopped) port1.postMessage({ type: "cancel" }); };
  },
  continueCompare: (runId, modelId) => ipcRenderer.invoke("compare:continue", runId, modelId),
  listChatbotBookmarks: () => ipcRenderer.invoke("chatbots:list"),
  saveChatbotBookmark: (input) => ipcRenderer.invoke("chatbots:save", input),
  deleteChatbotBookmark: (id) => ipcRenderer.invoke("chatbots:delete", id),
  createChatbotThread: (bookmarkId) => ipcRenderer.invoke("chatbots:create-thread", bookmarkId),
  getChatbotUsage: (bookmarkId) => ipcRenderer.invoke("chatbots:usage", bookmarkId),
  acknowledgeAttachmentPrivacy: (threadId) => ipcRenderer.invoke("attachments:acknowledge", threadId),
  streamChat(request: ChatRequest, onEvent: (event: ChatEvent) => void) {
    const { port1, port2 } = new MessageChannel();
    let stopped = false;
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      port1.removeEventListener("message", receive);
      port1.close();
    };
    const receive = (event: MessageEvent<ChatEvent>) => {
      onEvent(event.data);
      if (event.data.type === "done" || event.data.type === "error") cleanup();
    };
    port1.addEventListener("message", receive);
    port1.start();
    ipcRenderer.postMessage("chat:stream", request, [port2]);
    const stop = () => { if (!stopped) port1.postMessage({ type: "cancel" }); };
    return stop;
  },
  generateImage: (request: ImageRequest) => ipcRenderer.invoke("media:image", request),
  generateVideo: (request: VideoRequest) => ipcRenderer.invoke("media:video", request),
  runAudio: (request: AudioRequest) => ipcRenderer.invoke("media:audio", request),
  listMediaJobs: () => ipcRenderer.invoke("media:jobs:list"),
  pollMediaJob: (id) => ipcRenderer.invoke("media:jobs:poll", id),
  stopTrackingMediaJob: (id) => ipcRenderer.invoke("media:jobs:stop", id),
  releaseMediaJobSource: (id) => ipcRenderer.invoke("media:jobs:release-source", id),
  acknowledgeMediaJob: (id) => ipcRenderer.invoke("media:jobs:ack", id),
  listBackgroundResponses: () => ipcRenderer.invoke("responses:list"),
  pollBackgroundResponse: (id) => ipcRenderer.invoke("responses:poll", id),
  cancelBackgroundResponse: (id) => ipcRenderer.invoke("responses:cancel", id),
  saveRemoteMedia: (url, defaultName) => ipcRenderer.invoke("media:save", url, defaultName),
  releaseMedia: (url) => ipcRenderer.invoke("media:release", url),
  openExternal: (url) => ipcRenderer.invoke("external:open", url),
  openKeyGuide: () => ipcRenderer.invoke("guide:open"),
  getUpdateState: () => ipcRenderer.invoke("updates:state"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdateChanged(onState) {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof onState>[0]) => onState(state);
    ipcRenderer.on("updates:changed", listener);
    return () => ipcRenderer.removeListener("updates:changed", listener);
  }
};

contextBridge.exposeInMainWorld("mmllm", desktopApi);
