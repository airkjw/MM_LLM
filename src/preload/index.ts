import { contextBridge, ipcRenderer } from "electron";
import type {
  AudioRequest, ChatEvent, ChatRequest, DesktopApi, DroppedAttachment, ImageRequest,
  PickedAttachment, VideoRequest
} from "../shared/contracts";

const desktopApi: DesktopApi = {
  getSession: () => ipcRenderer.invoke("session:get"),
  login: (key) => ipcRenderer.invoke("session:login", key),
  logout: () => ipcRenderer.invoke("session:logout"),
  refreshModels: () => ipcRenderer.invoke("models:refresh"),
  getCredits: () => ipcRenderer.invoke("credits:get"),
  listThreads: () => ipcRenderer.invoke("threads:list"),
  createThread: (modelId) => ipcRenderer.invoke("threads:create", modelId),
  loadThread: (id) => ipcRenderer.invoke("threads:load", id),
  deleteThread: (id) => ipcRenderer.invoke("threads:delete", id),
  pickAttachment: (kinds: Array<PickedAttachment["kind"]>) =>
    ipcRenderer.invoke("attachments:pick", kinds),
  addDroppedAttachments: (files: DroppedAttachment[], kinds: Array<PickedAttachment["kind"]>) =>
    ipcRenderer.invoke("attachments:add-dropped", files, kinds),
  acknowledgeAttachmentPrivacy: (threadId) => ipcRenderer.invoke("attachments:acknowledge", threadId),
  streamChat(request: ChatRequest, onEvent: (event: ChatEvent) => void) {
    const { port1, port2 } = new MessageChannel();
    let stopped = false;
    const receive = (event: MessageEvent<ChatEvent>) => {
      onEvent(event.data);
      if (event.data.type === "done" || event.data.type === "error") stop();
    };
    port1.addEventListener("message", receive);
    port1.start();
    ipcRenderer.postMessage("chat:stream", request, [port2]);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      port1.removeEventListener("message", receive);
      port1.close();
    };
    return stop;
  },
  generateImage: (request: ImageRequest) => ipcRenderer.invoke("media:image", request),
  generateVideo: (request: VideoRequest) => ipcRenderer.invoke("media:video", request),
  pollVideo: (operationId, modelId) => ipcRenderer.invoke("media:video:poll", operationId, modelId),
  runAudio: (request: AudioRequest) => ipcRenderer.invoke("media:audio", request),
  saveRemoteMedia: (url, defaultName) => ipcRenderer.invoke("media:save", url, defaultName),
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
