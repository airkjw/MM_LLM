import { app, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ChatbotBookmark, CompareRun } from "../shared/contracts";
import { fitWorkspaceState, WORKSPACE_COMPARE_ENTITY_MAX_BYTES, WORKSPACE_MAX_BYTES } from "../shared/workspace-storage-policy";
import { writeAtomic } from "./atomic-file";

type WorkspaceState = { version: 1; bookmarks: ChatbotBookmark[]; compares: CompareRun[] };
const MAX_FILE_BYTES = WORKSPACE_MAX_BYTES;
const root = () => join(app.getPath("userData"), "private");
const pathFor = (profileId: string) => join(root(), `workspace-runs-profile-${profileId}.enc`);

function validProfile(value: string): void {
  if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error("프로필 형식이 올바르지 않습니다.");
}

async function load(profileId: string): Promise<WorkspaceState> {
  validProfile(profileId); await mkdir(root(), { recursive: true, mode: 0o700 });
  let handle;
  try { handle = await open(pathFor(profileId), "r"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, bookmarks: [], compares: [] };
    throw error;
  }
  let encrypted: Buffer;
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size <= 0 || details.size > MAX_FILE_BYTES * 2) {
      throw new Error("워크스페이스 실행 기록이 저장 한도를 넘었습니다.");
    }
    encrypted = await handle.readFile();
  } finally { await handle.close(); }
  const plain = await safeStorage.decryptStringAsync(encrypted);
  if (Buffer.byteLength(plain.result, "utf8") > MAX_FILE_BYTES) {
    throw new Error("워크스페이스 실행 기록이 저장 한도를 넘었습니다.");
  }
  const value = JSON.parse(plain.result) as WorkspaceState;
  if (value.version !== 1 || !Array.isArray(value.bookmarks) || !Array.isArray(value.compares)) {
    throw new Error("워크스페이스 실행 기록 형식이 올바르지 않습니다.");
  }
  return value;
}

async function save(profileId: string, value: WorkspaceState): Promise<void> {
  const plain = JSON.stringify(fitWorkspaceState(value));
  if (Buffer.byteLength(plain, "utf8") > MAX_FILE_BYTES) throw new Error("워크스페이스 실행 기록이 저장 한도를 넘었습니다.");
  const encrypted = await safeStorage.encryptStringAsync(plain);
  const target = pathFor(profileId); const temp = `${target}.${randomUUID()}.tmp`;
  await writeAtomic(target, encrypted);
}

const queues = new Map<string, Promise<unknown>>();
function mutate<T>(profileId: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(profileId) ?? Promise.resolve(); const result = previous.then(operation, operation);
  const queued = result.then(() => undefined, () => undefined).finally(() => {
    if (queues.get(profileId) === queued) queues.delete(profileId);
  });
  queues.set(profileId, queued); return result;
}

export async function listChatbotBookmarks(profileId: string): Promise<ChatbotBookmark[]> {
  return (await load(profileId)).bookmarks;
}

export async function saveChatbotBookmark(profileId: string, input: { alias: string; chatbotId: string }): Promise<ChatbotBookmark> {
  return mutate(profileId, async () => {
    const value = await load(profileId); const existing = value.bookmarks.find((item) => item.chatbotId === input.chatbotId);
    const now = new Date().toISOString();
    if (existing) existing.alias = input.alias;
    const saved = existing ?? { id: randomUUID(), alias: input.alias, chatbotId: input.chatbotId, createdAt: now };
    if (!existing) value.bookmarks.unshift(saved);
    value.bookmarks = value.bookmarks.slice(0, 50); await save(profileId, value); return saved;
  });
}

export async function deleteChatbotBookmark(profileId: string, id: string): Promise<void> {
  await mutate(profileId, async () => { const value = await load(profileId); value.bookmarks = value.bookmarks.filter((item) => item.id !== id); await save(profileId, value); });
}

export async function listCompareRuns(profileId: string): Promise<CompareRun[]> {
  return (await load(profileId)).compares;
}

export async function upsertCompareRun(profileId: string, run: CompareRun): Promise<CompareRun> {
  if (Buffer.byteLength(JSON.stringify(run), "utf8") > WORKSPACE_COMPARE_ENTITY_MAX_BYTES) throw new Error("모델 비교 결과가 저장 한도를 넘었습니다.");
  return mutate(profileId, async () => {
    const value = await load(profileId); const index = value.compares.findIndex((item) => item.id === run.id);
    if (index >= 0) value.compares[index] = run; else value.compares.unshift(run);
    value.compares = value.compares.slice(0, 20); await save(profileId, value); return run;
  });
}

export async function deleteWorkspaceRuns(profileId: string): Promise<void> {
  await unlink(pathFor(profileId)).catch((error) => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
}
