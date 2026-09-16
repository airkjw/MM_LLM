import {
  app, BrowserWindow, dialog, ipcMain, protocol, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent
} from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AudioRequest, ChatEvent, ChatRequest, ImageRequest, PickedAttachment, SessionState, VideoRequest
} from "../shared/contracts";
import {
  createThread, deleteKey, getThread, loadKey, loadThreads, removeThread, saveKey,
  setAccountNamespace, snapshot, summary, updateThread
} from "./storage";
import {
  assertModel, currentModels, GatewayError, generateImage, generateVideo, getCredits,
  isAllowedMedia, listModels, pollVideo, runAudio, setGatewayKey, streamChat
} from "./gateway";
import {
  addDroppedAttachments, contentForChat, discardAttachments, getAttachment, imageDataUrls, pickAttachment
} from "./attachments";
import { checkForUpdates, currentUpdateState, installUpdate, startUpdates } from "./updates";

protocol.registerSchemesAsPrivileged([
  { scheme: "mmllm", privileges: { secure: true, standard: true, supportFetchAPI: true } }
]);
if (process.env.MM_LLM_MOCK === "1" && !app.isPackaged) {
  const testRoot = join(app.getPath("temp"), "mmllm-ui-smoke");
  mkdirSync(testRoot, { recursive: true });
  app.setPath("userData", testRoot);
}

let mainWindow: BrowserWindow | null = null;
const activeRuns = new Map<string, AbortController>();
const documentRoot = () => resolve(__dirname, "../renderer");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trustedInvoke(event: IpcMainInvokeEvent): BrowserWindow {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) throw new Error("허용되지 않은 창입니다.");
  return mainWindow;
}

function trustedEvent(event: IpcMainEvent): boolean {
  return Boolean(mainWindow &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame);
}

function confirmed(value: unknown): void {
  if (value !== true) throw new Error("자료를 비식별화했는지 확인해 주세요.");
}

function hasAttachedContent(messages: Array<{ attachments?: string[] }>): boolean {
  return messages.some((message) => Boolean(message.attachments?.length));
}

function shortString(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label} 입력이 올바르지 않습니다.`);
  }
  return value.trim();
}

function ids(value: unknown, max = 4): string[] {
  if (!Array.isArray(value) || value.length > max ||
    !value.every((item) => typeof item === "string" && item.length < 100)) {
    throw new Error("첨부 파일 목록이 올바르지 않습니다.");
  }
  return value;
}

async function sessionState(): Promise<SessionState> {
  const saved = await loadKey();
  if (!saved) return { authenticated: false, models: [] };
  setGatewayKey(saved);
  setAccountNamespace(saved);
  try {
    const models = await listModels();
    const credits = await getCredits().catch(() => undefined);
    return { authenticated: true, models, credits };
  } catch (error) {
    if (error instanceof GatewayError && error.status === 401) {
      setGatewayKey(null);
      setAccountNamespace(null);
      return { authenticated: false, models: [] };
    }
    return { authenticated: true, models: currentModels() };
  }
}

function registerHandlers(): void {
  ipcMain.handle("updates:state", (event) => {
    trustedInvoke(event);
    return currentUpdateState();
  });
  ipcMain.handle("updates:check", async (event) => {
    trustedInvoke(event);
    return checkForUpdates();
  });
  ipcMain.handle("updates:install", (event) => {
    trustedInvoke(event);
    installUpdate();
  });
  ipcMain.handle("session:get", async (event) => {
    trustedInvoke(event);
    return sessionState();
  });
  ipcMain.handle("session:login", async (event, rawKey: unknown) => {
    trustedInvoke(event);
    if (activeRuns.size) throw new Error("진행 중인 답변을 중단한 뒤 계정을 변경해 주세요.");
    const key = shortString(rawKey, 500, "API 키");
    if (key.includes("\n") || key.includes("\r")) throw new Error("API 키 형식이 올바르지 않습니다.");
    const previous = await loadKey();
    setGatewayKey(key);
    setAccountNamespace(key);
    try {
      const models = await listModels();
      await saveKey(key);
      const credits = await getCredits().catch(() => undefined);
      return { authenticated: true, models, credits } satisfies SessionState;
    } catch (error) {
      setGatewayKey(previous);
      setAccountNamespace(previous);
      throw error;
    }
  });
  ipcMain.handle("session:logout", async (event) => {
    trustedInvoke(event);
    if (activeRuns.size) throw new Error("진행 중인 답변을 중단한 뒤 로그아웃해 주세요.");
    await deleteKey();
    setGatewayKey(null);
    setAccountNamespace(null);
  });
  ipcMain.handle("models:refresh", async (event) => {
    trustedInvoke(event);
    return listModels();
  });
  ipcMain.handle("credits:get", async (event) => {
    trustedInvoke(event);
    return getCredits();
  });
  ipcMain.handle("threads:list", async (event) => {
    trustedInvoke(event);
    const db = await loadThreads();
    return db.threads.map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
  ipcMain.handle("threads:create", async (event, modelId: unknown) => {
    trustedInvoke(event);
    const id = shortString(modelId, 200, "모델");
    assertModel(id, "llm");
    return createThread(id);
  });
  ipcMain.handle("threads:load", async (event, id: unknown) => {
    trustedInvoke(event);
    return snapshot(await getThread(shortString(id, 100, "대화")));
  });
  ipcMain.handle("threads:delete", async (event, id: unknown) => {
    trustedInvoke(event);
    await removeThread(shortString(id, 100, "대화"));
  });
  ipcMain.handle("attachments:acknowledge", async (event, rawThreadId: unknown) => {
    trustedInvoke(event);
    const threadId = shortString(rawThreadId, 100, "대화");
    const thread = await getThread(threadId);
    if (thread.attachmentConsent) return snapshot(thread);
    return updateThread(threadId, (item) => { item.attachmentConsent = true; });
  });
  ipcMain.handle("attachments:pick", async (event, value: unknown): Promise<PickedAttachment | null> => {
    const window = trustedInvoke(event);
    if (!Array.isArray(value) || !value.length ||
      !value.every((kind) => ["document", "image", "audio"].includes(kind))) {
      throw new Error("첨부 종류가 올바르지 않습니다.");
    }
    return pickAttachment(window, value);
  });
  ipcMain.handle("attachments:add-dropped", async (event, rawFiles: unknown, rawKinds: unknown): Promise<PickedAttachment[]> => {
    trustedInvoke(event);
    if (!Array.isArray(rawKinds) || !rawKinds.length ||
      !rawKinds.every((kind) => ["document", "image", "audio"].includes(kind))) {
      throw new Error("첨부 종류가 올바르지 않습니다.");
    }
    if (!Array.isArray(rawFiles) || !rawFiles.length || rawFiles.length > 4) {
      throw new Error("한 번에 파일을 1개에서 4개까지 첨부할 수 있습니다.");
    }
    const files = rawFiles.map((file) => {
      if (!isRecord(file) || typeof file.name !== "string" || file.name.length > 255) {
        throw new Error("첨부 파일 정보가 올바르지 않습니다.");
      }
      const bytes = file.bytes;
      if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) {
        throw new Error("첨부 파일을 읽을 수 없습니다.");
      }
      return {
        name: file.name,
        bytes: bytes instanceof ArrayBuffer
          ? new Uint8Array(bytes)
          : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      };
    });
    return addDroppedAttachments(files, rawKinds);
  });
  ipcMain.handle("media:image", async (event, value: unknown) => {
    trustedInvoke(event);
    if (!isRecord(value)) throw new Error("이미지 요청이 올바르지 않습니다.");
    confirmed(value.deidentifiedConfirmed);
    const request = value as ImageRequest;
    request.modelId = shortString(value.modelId, 200, "모델");
    request.prompt = shortString(value.prompt, 4000, "프롬프트");
    request.imageAttachmentIds = ids(value.imageAttachmentIds, 14);
    const urls = imageDataUrls(request.imageAttachmentIds);
    return generateImage(request, urls);
  });
  ipcMain.handle("media:video", async (event, value: unknown) => {
    trustedInvoke(event);
    if (!isRecord(value)) throw new Error("비디오 요청이 올바르지 않습니다.");
    confirmed(value.deidentifiedConfirmed);
    const request = value as VideoRequest;
    request.modelId = shortString(value.modelId, 200, "모델");
    request.prompt = shortString(value.prompt, 4000, "프롬프트");
    request.imageAttachmentIds = ids(value.imageAttachmentIds, 1);
    const urls = imageDataUrls(request.imageAttachmentIds);
    return generateVideo(request, urls);
  });
  ipcMain.handle("media:video:poll", async (event, operationId: unknown, modelId: unknown) => {
    trustedInvoke(event);
    return pollVideo(shortString(operationId, 500, "작업"), shortString(modelId, 200, "모델"));
  });
  ipcMain.handle("media:audio", async (event, value: unknown) => {
    trustedInvoke(event);
    if (!isRecord(value)) throw new Error("오디오 요청이 올바르지 않습니다.");
    confirmed(value.deidentifiedConfirmed);
    const request = value as AudioRequest;
    request.modelId = shortString(value.modelId, 200, "모델");
    if (request.lane === "tts") {
      request.input = shortString(value.input, 4000, "텍스트");
      return runAudio(request);
    }
    if (request.lane === "music") {
      request.prompt = shortString(value.prompt, 4000, "프롬프트");
      return runAudio(request);
    }
    if (request.lane !== "stt") throw new Error("오디오 기능이 올바르지 않습니다.");
    const attachment = getAttachment(shortString(value.attachmentId, 100, "오디오 파일"));
    if (attachment.kind !== "audio") throw new Error("오디오 파일을 선택해 주세요.");
    return runAudio(request, { name: attachment.name, mime: attachment.mime, bytes: attachment.bytes });
  });
  ipcMain.handle("media:save", async (event, url: unknown, filename: unknown) => {
    const window = trustedInvoke(event);
    if (typeof url !== "string" || !isAllowedMedia(url)) throw new Error("저장할 수 없는 결과입니다.");
    const name = shortString(filename, 100, "파일 이름").replace(/[\\/:*?"<>|]/g, "-");
    const save = await dialog.showSaveDialog(window, { defaultPath: name });
    if (save.canceled || !save.filePath) return false;
    let bytes: Buffer;
    if (url.startsWith("data:")) {
      const encoded = url.split(",", 2)[1];
      if (!encoded) throw new Error("결과 데이터가 올바르지 않습니다.");
      bytes = Buffer.from(encoded, "base64");
    } else {
      const target = new URL(url);
      if (target.protocol !== "https:") throw new Error("HTTPS 결과만 저장할 수 있습니다.");
      const response = await fetch(url);
      if (!response.ok) throw new Error("결과 다운로드가 실패했습니다.");
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (bytes.length > 200 * 1024 * 1024) throw new Error("결과 파일이 너무 큽니다.");
    await writeFile(save.filePath, bytes, { flag: "wx" }).catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await writeFile(save.filePath!, bytes);
    });
    return true;
  });
  ipcMain.handle("guide:open", async (event) => {
    trustedInvoke(event);
    await shell.openExternal("https://docs.mindlogic.ai/docs/khu/api-gateway/getting-started/authentication");
  });

  ipcMain.on("chat:stream", (event, rawRequest: unknown) => {
    const [port] = event.ports;
    if (!port) return;
    port.start();
    if (!trustedEvent(event) || !isRecord(rawRequest)) {
      port.postMessage({ type: "error", message: "허용되지 않은 요청입니다." } satisfies ChatEvent);
      port.close();
      return;
    }
    const abort = new AbortController();
    const runId = randomUUID();
    activeRuns.set(runId, abort);
    port.once("close", () => abort.abort());
    const send = (message: ChatEvent) => {
      if (!abort.signal.aborted) port.postMessage(message);
    };
    void (async () => {
      let savedUser = false;
      let regenerateIndex = -1;
      let text = "";
      let threadId = "";
      try {
        threadId = shortString(rawRequest.threadId, 100, "대화");
        const modelId = shortString(rawRequest.modelId, 200, "모델");
        assertModel(modelId, "llm");
        const prompt = shortString(rawRequest.text, 100_000, "메시지");
        const attachmentIds = ids(rawRequest.attachmentIds);
        if (rawRequest.regenerate === true) {
          if (attachmentIds.length) throw new Error("다시 생성할 때 새 파일은 첨부할 수 없습니다.");
          const existing = await getThread(threadId);
          const afterId = typeof rawRequest.regenerateAfterId === "string"
            ? rawRequest.regenerateAfterId : "";
          regenerateIndex = afterId
            ? existing.messages.findIndex((item) => item.id === afterId && item.role === "user")
            : existing.messages.findLastIndex((item) => item.role === "user");
          if (regenerateIndex < 0) throw new Error("다시 생성할 메시지가 없습니다.");
          if (hasAttachedContent(existing.messages.slice(0, regenerateIndex + 1)) &&
            !existing.attachmentConsent) {
            throw new Error("첨부 자료 전송 확인을 먼저 완료해 주세요.");
          }
        } else {
          const existing = await getThread(threadId);
          if ((attachmentIds.length || hasAttachedContent(existing.messages)) &&
            !existing.attachmentConsent) {
            throw new Error("첨부 자료 전송 확인을 먼저 완료해 주세요.");
          }
          const prepared = await contentForChat(prompt, attachmentIds);
          const at = new Date().toISOString();
          await updateThread(threadId, (thread) => {
            thread.modelId = modelId;
            if (thread.messages.length === 0) thread.title = prompt.slice(0, 38).replace(/\s+/g, " ");
            thread.messages.push({
              id: randomUUID(), role: "user", text: prompt, createdAt: at,
              attachments: prepared.names, apiContent: prepared.content
            });
          });
          discardAttachments(attachmentIds);
        }
        savedUser = true;
        const thread = await getThread(threadId);
        const contextMessages = regenerateIndex >= 0
          ? thread.messages.slice(0, regenerateIndex + 1) : thread.messages;
        const messages = contextMessages.map((item) => ({ role: item.role, content: item.apiContent }));
        for await (const delta of streamChat(modelId, messages, abort.signal)) {
          text += delta;
          send({ type: "delta", text: delta });
        }
        const updated = await updateThread(threadId, (item) => {
          if (regenerateIndex >= 0) item.messages.splice(regenerateIndex + 1);
          item.modelId = modelId;
          item.messages.push({
            id: randomUUID(), role: "assistant", text, apiContent: text,
            createdAt: new Date().toISOString(), status: "complete"
          });
        });
        send({ type: "done", snapshot: updated });
      } catch (error) {
        if (savedUser && threadId && text && regenerateIndex < 0) {
          await updateThread(threadId, (item) => {
            item.messages.push({
              id: randomUUID(), role: "assistant", text, apiContent: text,
              createdAt: new Date().toISOString(), status: "incomplete"
            });
          }).catch(() => undefined);
        }
        if (!abort.signal.aborted) {
          const message = error instanceof Error ? error.message : "요청에 실패했습니다.";
          const current = savedUser && threadId
            ? await getThread(threadId).then(snapshot).catch(() => undefined) : undefined;
          send({ type: "error", message, snapshot: current });
        }
      } finally {
        activeRuns.delete(runId);
        port.close();
      }
    })();
  });
}

async function registerAppProtocol(): Promise<void> {
  protocol.handle("mmllm", async (request) => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const target = resolve(documentRoot(), relative);
    if (!target.startsWith(documentRoot() + sep) && target !== resolve(documentRoot(), "index.html")) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      const bytes = await readFile(target);
      const contentType = target.endsWith(".html") ? "text/html; charset=utf-8" :
        target.endsWith(".js") ? "text/javascript; charset=utf-8" :
          target.endsWith(".css") ? "text/css; charset=utf-8" : "application/octet-stream";
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

async function createWindow(): Promise<void> {
  const stateFile = join(app.getPath("userData"), "window-state.json");
  type WindowState = { x: number; y: number; width: number; height: number; maximized?: boolean };
  let saved: WindowState | null = null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(stateFile, "utf8"));
    if (isRecord(parsed) && ["x", "y", "width", "height"].every((key) =>
      typeof parsed[key] === "number" && Number.isFinite(parsed[key]))) {
      saved = parsed as WindowState;
    }
  } catch { /* First run or invalid state: use the portrait default. */ }
  const display = saved ? screen.getDisplayMatching(saved) : screen.getPrimaryDisplay();
  const work = display.workArea;
  const portraitHeight = Math.min(1180, Math.max(620, work.height - 40));
  const width = Math.min(work.width, Math.max(680,
    saved ? Math.min(saved.width, work.width) : Math.round(portraitHeight * 1910 / 2300)));
  const height = Math.min(work.height, Math.max(620,
    saved ? Math.min(saved.height, work.height) : portraitHeight));
  const x = saved ? Math.max(work.x, Math.min(saved.x, work.x + work.width - width))
    : work.x + Math.round((work.width - width) / 2);
  const y = saved ? Math.max(work.y, Math.min(saved.y, work.y + work.height - height))
    : work.y + Math.round((work.height - height) / 2);
  mainWindow = new BrowserWindow({
    x, y, width, height, minWidth: 680, minHeight: 620,
    title: "MM_LLM",
    backgroundColor: "#f7f4f0",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  if (saved?.maximized) mainWindow.maximize();
  mainWindow.on("close", () => {
    if (!mainWindow) return;
    const bounds = mainWindow.getNormalBounds();
    const current: WindowState = { ...bounds, maximized: mainWindow.isMaximized() };
    try {
      mkdirSync(app.getPath("userData"), { recursive: true });
      const temp = stateFile + ".tmp";
      writeFileSync(temp, JSON.stringify(current), { mode: 0o600 });
      renameSync(temp, stateFile);
    } catch { /* Window state is optional; closing must still work. */ }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadURL("mmllm://app/index.html");
  }
}

app.whenReady().then(async () => {
  await registerAppProtocol();
  registerHandlers();
  await createWindow();
  startUpdates();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error) => {
  dialog.showErrorBox("MM_LLM 시작 오류", error instanceof Error ? error.message : "앱을 시작할 수 없습니다.");
  app.quit();
});

app.on("window-all-closed", () => {
  for (const run of activeRuns.values()) run.abort();
  if (process.platform !== "darwin") app.quit();
});
