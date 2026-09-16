import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { PublicMessage, ThreadSnapshot, ThreadSummary } from "../shared/contracts";

type InternalMessage = PublicMessage & { apiContent: string | Array<Record<string, unknown>> };
export type InternalThread = Omit<ThreadSnapshot, "messages" | "messageCount"> & {
  messages: InternalMessage[];
};

type StoredThreads = { version: 1; threads: InternalThread[] };
const root = () => join(app.getPath("userData"), "private");
const file = (name: string) => join(root(), name);
let threadFile = "threads-unavailable.enc";

export function setAccountNamespace(key: string | null): void {
  threadFile = key
    ? `threads-${createHash("sha256").update(key).digest("hex").slice(0, 24)}.enc`
    : "threads-unavailable.enc";
}

async function ensureVault(): Promise<void> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error("운영체제 보안 저장소를 사용할 수 없습니다.");
  }
  await mkdir(root(), { recursive: true, mode: 0o700 });
}

async function encryptToFile(name: string, plain: string): Promise<void> {
  await ensureVault();
  const encrypted = await safeStorage.encryptStringAsync(plain);
  const temp = file(`${name}.${randomUUID()}.tmp`);
  await writeFile(temp, encrypted, { mode: 0o600 });
  await rename(temp, file(name));
}

async function decryptFromFile(name: string): Promise<string | null> {
  await ensureVault();
  let encrypted: Buffer;
  try {
    encrypted = await readFile(file(name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const decrypted = await safeStorage.decryptStringAsync(encrypted);
  if (decrypted.shouldReEncrypt) {
    await encryptToFile(name, decrypted.result);
  }
  return decrypted.result;
}

export async function loadKey(): Promise<string | null> {
  return decryptFromFile("api-key.enc");
}

export async function saveKey(key: string): Promise<void> {
  await encryptToFile("api-key.enc", key);
}

export async function deleteKey(): Promise<void> {
  try {
    await unlink(file("api-key.enc"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

let mutationQueue: Promise<unknown> = Promise.resolve();
export function serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(mutation, mutation);
  mutationQueue = result.catch(() => undefined);
  return result;
}

export async function loadThreads(): Promise<StoredThreads> {
  if (threadFile === "threads-unavailable.enc") throw new Error("로그인이 필요합니다.");
  const plain = await decryptFromFile(threadFile);
  if (!plain) return { version: 1, threads: [] };
  const value = JSON.parse(plain) as StoredThreads;
  if (value.version !== 1 || !Array.isArray(value.threads)) throw new Error("대화 저장 파일 형식이 올바르지 않습니다.");
  return value;
}

export async function saveThreads(value: StoredThreads): Promise<void> {
  await encryptToFile(threadFile, JSON.stringify(value));
}

export function summary(thread: InternalThread): ThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    modelId: thread.modelId,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messages.length
  };
}

export function snapshot(thread: InternalThread): ThreadSnapshot {
  return {
    ...summary(thread),
    messages: thread.messages.map(({ apiContent: _hidden, ...message }) => message)
  };
}

export async function createThread(modelId: string): Promise<ThreadSnapshot> {
  return serializeMutation(async () => {
    const db = await loadThreads();
    const now = new Date().toISOString();
    const thread: InternalThread = {
      id: randomUUID(),
      title: "새 대화",
      modelId,
      createdAt: now,
      updatedAt: now,
      messages: []
    };
    db.threads.unshift(thread);
    await saveThreads(db);
    return snapshot(thread);
  });
}

export async function getThread(id: string): Promise<InternalThread> {
  const db = await loadThreads();
  const thread = db.threads.find((item) => item.id === id);
  if (!thread) throw new Error("대화를 찾을 수 없습니다.");
  return thread;
}

export async function updateThread(id: string, update: (thread: InternalThread) => void): Promise<ThreadSnapshot> {
  return serializeMutation(async () => {
    const db = await loadThreads();
    const thread = db.threads.find((item) => item.id === id);
    if (!thread) throw new Error("대화를 찾을 수 없습니다.");
    update(thread);
    thread.updatedAt = new Date().toISOString();
    await saveThreads(db);
    return snapshot(thread);
  });
}

export async function removeThread(id: string): Promise<void> {
  await serializeMutation(async () => {
    const db = await loadThreads();
    db.threads = db.threads.filter((item) => item.id !== id);
    await saveThreads(db);
  });
}
