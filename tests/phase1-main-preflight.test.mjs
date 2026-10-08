import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { claudePauseEvents, source } from "./fixtures/native-search.mjs";

// Exercise the real IPC handlers, attachments, context, Gateway and encrypted stores.
// Only Electron startup/updater and local document extraction are fixtures.
const root = await mkdtemp(join(tmpdir(), "mmllm-phase1-corrections-"));
const handlers = new Map();
const window = { webContents: { mainFrame: { url: "mmllm://app/index.html" } } };
globalThis.__phase1MainElectron = {
  app: { isPackaged: true, getVersion: () => "0.5.1", getPath: () => root, on: () => {},
    whenReady: () => new Promise(() => {}) },
  ipcMain: { on: (name, handler) => handlers.set(name, handler), handle: () => {} },
  protocol: { registerSchemesAsPrivileged: () => {} },
  safeStorage: { isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from(`synthetic-vault\0${value}`),
    decryptStringAsync: async (bytes) => ({ result: bytes.toString().slice(16), shouldReEncrypt: false }) },
  BrowserWindow: class {}, dialog: {}, nativeTheme: {}, screen: {}, shell: {}
};
let documentText = "";
globalThis.__phase1DocumentText = () => documentText;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron") return { url: "phase1-corrections:electron", shortCircuit: true };
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".")) {
      const url = new URL(specifier, context.parentURL);
      if (url.pathname.endsWith("/main/updates")) return { url: "phase1-corrections:updates", shortCircuit: true };
      if (url.pathname.endsWith("/main/document-text")) return { url: "phase1-corrections:document-text", shortCircuit: true };
      if (url.protocol === "file:" && !existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(url) + ".ts")) return next(url.href + ".ts", context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "phase1-corrections:electron") return { format: "module", shortCircuit: true,
      source: "export const { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, screen, shell, safeStorage } = globalThis.__phase1MainElectron;" };
    if (url === "phase1-corrections:updates") return { format: "module", shortCircuit: true,
      source: "export const checkForUpdates = () => {}, currentUpdateState = () => ({}), installUpdate = () => {}, startUpdates = () => {};" };
    if (url === "phase1-corrections:document-text") return { format: "module", shortCircuit: true,
      source: "export const configureOcrDataRoot = () => {}, extractPdf = async () => globalThis.__phase1DocumentText(), extractDocx = extractPdf, extractXlsx = extractPdf;" };
    const loaded = next(url, context);
    if (url.endsWith("/src/main/index.ts")) return { ...loaded,
      source: loaded.source.toString() + "\nexport function registerCorrectionFixture(window) { mainWindow = window; registerHandlers(); }\n" };
    return loaded;
  }
});
const main = await import("../src/main/index.ts");
const storage = await import("../src/main/storage.ts");
const gateway = await import("../src/main/gateway.ts");
const attachments = await import("../src/main/attachments.ts");
main.registerCorrectionFixture(window);
await storage.activateProfileForKey("synthetic-phase1-correction-account");
const originalFetch = globalThis.fetch;
test.after(async () => {
  globalThis.fetch = originalFetch; attachments.clearAttachments(); hooks.deregister();
  delete globalThis.__phase1MainElectron; delete globalThis.__phase1DocumentText;
  await rm(root, { recursive: true, force: true });
});
let sessionId = 0;
const models = ["gpt-6-astra", "claude-sonnet-5", "gemini-3.8-flash", "sonar-pro"].map((id) => ({ id, type: "llm" }));
function session() { gateway.commitGatewaySession(`synthetic-correction-${++sessionId}`, models.map((model) => ({ ...model }))); }
async function invoke(channel, request) {
  const port = new EventEmitter(); const events = [];
  port.start = () => {};
  port.postMessage = (event) => events.push(structuredClone(event));
  let timeout;
  const done = new Promise((resolve, reject) => {
    port.close = () => { port.emit("close"); resolve(); };
    timeout = setTimeout(() => reject(new Error("synthetic IPC test timed out")), 5000);
  });
  try {
    handlers.get(channel)({ ports: [port], sender: window.webContents, senderFrame: window.webContents.mainFrame }, request);
    await done; return events;
  } finally { clearTimeout(timeout); }
}
function addFiles(name, count, size, prefix) {
  const picked = attachments.addDroppedAttachments(Array.from({ length: count }, (_, index) => {
    const bytes = Buffer.alloc(size); Buffer.from(prefix).copy(bytes);
    return { name: `${index}-${name}`, bytes };
  }), ["image", "document"]);
  return picked.map((item) => item.id);
}
function sse(events) { return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")); }

test("actual comparison rejects aggregate images and PDF count/size before every billed POST", async () => {
  const cases = [
    ["synthetic.png", 2, 7 * 1024 * 1024, "\x89PNG\r\n\x1a\n", /첨부 이미지 전체 크기/],
    ["synthetic.pdf", 3, 20, "%PDF-1.7\n", /PDF.*최대 2개/],
    ["synthetic.pdf", 2, 9 * 1024 * 1024, "%PDF-1.7\n", /이미지·PDF.*안전 한도/]
  ];
  for (const mode of ["always", "auto", "deep"]) for (const [name, count, size, prefix, expected] of cases) {
    session(); documentText = ""; let paid = 0;
    globalThis.fetch = async () => { paid++; throw new Error("unexpected billed POST"); };
    const attachmentIds = addFiles(name, count, size, prefix);
    const events = await invoke("compare:stream", { prompt: "최신 합성 통계 자료를 찾아줘", modelIds: models.slice(0, 3).map((m) => m.id),
      webSearchMode: mode, attachmentIds, deidentifiedConfirmed: true });
    assert.match(events.at(-1).message, expected, `${mode}: ${name}`);
    assert.equal(paid, 0);
    assert.equal(events.some((event) => event.type === "snapshot" || event.type === "done"), false);
    attachmentIds.forEach((id) => assert.throws(() => attachments.getAttachment(id), /다시 선택/));
  }
});

test("actual comparison validates the last selected model's raw PDF support before the common search", async () => {
  for (const id of ["gpt-6-astra", "gemini-3.8-flash"]) {
    session(); documentText = ""; let paid = 0;
    globalThis.fetch = async () => { paid++; throw new Error("unexpected billed POST"); };
    const events = await invoke("compare:stream", { prompt: "합성 원문 PDF 비교", modelIds: ["claude-sonnet-5", id], webSearchMode: "always",
      attachmentIds: addFiles("synthetic.pdf", 1, 20, "%PDF-1.7\n"), deidentifiedConfirmed: true });
    assert.equal(events.at(-1).type, "error"); assert.match(events.at(-1).message, /원문 PDF는 Claude 네이티브 분석만 지원/);
    assert.equal(paid, 0); assert.equal(events.some((event) => event.type === "snapshot"), false);
  }
});

test("actual comparison preserves a short extracted PDF's full text and performs one common search", async () => {
  session(); documentText = `합성 첫 절\n${"합성 본문. ".repeat(2000)}\n합성 마지막 절`; const paid = [];
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, "POST"); const body = JSON.parse(init.body); paid.push(body);
    if (body.model === "sonar-pro") return Response.json({ choices: [{ message: { content: "공통 합성 근거" } }], citations: [source.url] });
    assert.match(JSON.stringify(body), /합성 첫 절/); assert.match(JSON.stringify(body), /합성 마지막 절/);
    assert.match(JSON.stringify(body), /공통 합성 근거/); assert.equal(body.tools, undefined);
    return body.model.startsWith("claude") ? sse([{ type: "message_stop" }])
      : sse([{ choices: [{ delta: { content: "합성 답변" }, finish_reason: "stop" }] }]);
  };
  const events = await invoke("compare:stream", { prompt: "합성 문서 비교", modelIds: models.slice(0, 3).map((m) => m.id), webSearchMode: "always",
    attachmentIds: addFiles("synthetic.pdf", 1, 20, "%PDF-1.7\n"), deidentifiedConfirmed: true });
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.at(-1).run.results.every((result) => result.status === "completed"), true);
  assert.equal(paid.length, 4); assert.equal(paid.filter((body) => body.model === "sonar-pro").length, 1);
});

test("actual main persists Claude pause_turn and rejects forged generic continuation with zero paid calls", async () => {
  session(); let paid = 0;
  globalThis.fetch = async (_url, init) => {
    if (init.method !== "POST") return Response.json({ id: "claude-sonnet-5", pricing: { web_search_per_1k: 0 } });
    paid++; return sse(claudePauseEvents);
  };
  const thread = await storage.createThread({ modelId: "claude-sonnet-5" });
  const events = await invoke("chat:stream", { threadId: thread.id, modelId: thread.modelId, text: "합성 검색 질문", attachmentIds: [] });
  assert.equal(events.at(-1).type, "done"); assert.equal(paid, 1);
  const paused = (await storage.getThread(thread.id)).messages.at(-1);
  assert.equal(paused.status, "incomplete"); assert.equal(paused.continuationUnsupportedReason, "claude_pause_turn");
  assert.equal(paused.text, "합성 통계 답변"); assert.equal(paused.webSearch.status, "executed");
  assert.equal(paused.webSearch.citations[0].url, source.url);
  assert.doesNotMatch(JSON.stringify(events), /encrypted_|synthetic-opaque/);
  const before = structuredClone((await storage.getThread(thread.id)).messages); paid = 0;
  const blocked = await invoke("chat:stream", { threadId: thread.id, modelId: thread.modelId, text: "이어서 생성", attachmentIds: [], continueIncompleteId: paused.id });
  assert.equal(blocked.at(-1).type, "error"); assert.match(blocked.at(-1).message, /이어 생성은 지원하지 않습니다.*별도 요청으로 추가 과금/);
  assert.equal(paid, 0); assert.deepEqual((await storage.getThread(thread.id)).messages, before);
  // An explicit fresh user question is allowed and makes exactly one new request.
  const fresh = await invoke("chat:stream", { threadId: thread.id, modelId: thread.modelId, text: "새 합성 질문", attachmentIds: [] });
  assert.equal(fresh.at(-1).type, "done"); assert.equal(paid, 1);
  assert.equal((await storage.getThread(thread.id)).messages.at(-2).text, "새 합성 질문");
});

test("actual main still permits generic max_tokens and Responses incomplete continuation", async () => {
  for (const id of ["claude-sonnet-5", "gpt-6-astra"]) {
    session(); let paid = 0;
    const thread = await storage.createThread({ modelId: id });
    await storage.updateThread(thread.id, (value) => {
      value.webSearchMode = "off";
      if (id.startsWith("gpt")) { value.advanced = { responses: { chain: true } }; value.previousResponseId = "resp_synthetic_previous"; }
      value.messages = [{ id: "u", role: "user", text: "합성 질문", apiContent: "합성 질문", createdAt: thread.createdAt },
        { id: "a", role: "assistant", text: "합성 부분", apiContent: "합성 부분", createdAt: thread.createdAt, status: "incomplete" }];
    });
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.method, "POST"); paid++; const body = JSON.parse(init.body);
      if (id.startsWith("gpt")) { assert.equal(body.previous_response_id, "resp_synthetic_previous"); assert.equal(body.input.length, 1); }
      return id.startsWith("claude") ? sse([{ type: "message_stop" }])
        : sse([{ type: "response.completed", response: { id: "resp_synthetic_next", output: [] } }]);
    };
    const events = await invoke("chat:stream", { threadId: thread.id, modelId: id, text: "합성 이어 생성", attachmentIds: [], continueIncompleteId: "a" });
    assert.equal(events.at(-1).type, "done"); assert.equal(paid, 1);
    assert.equal((await storage.getThread(thread.id)).messages[1].status, "resolved");
  }
});
