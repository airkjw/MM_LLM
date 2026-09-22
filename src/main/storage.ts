import { app, safeStorage } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { validateBackup, type PortableBackup } from "../shared/backup-format";
import { redactChatbotPublicUrls } from "../shared/chatbot-files";
import type { AppSettings, BackgroundResponse, CreateThreadRequest, PendingMediaJob, PublicMessage, ThreadSearchResult, ThreadSnapshot, ThreadSummary, WebSearchMode } from "../shared/contracts";
import { MAX_BACKGROUND_RESPONSE_BYTES, planBackgroundReconciliation, upsertBackgroundResponseRecord } from "../shared/responses-lifecycle";
import { assertStoreGrowth, assertThreadCapacity } from "../shared/storage-limits";
import type { WebSearchCacheEntry } from "../shared/web-search";
import { writeAtomic } from "./atomic-file";
import { assertPendingJobResultSize } from "./media-jobs";
import { clearProjectVault, exportProjectBackup, restoreProjectBackup } from "./project-vault";
import { assertThreadStoreByteLength, DEFAULT_INSTRUCTION, MAX_THREAD_STORE_BYTES, mergeUniqueRecords, normalizeAppSettings, normalizeThreadPreferences, profileMoveCleanupFilenames, rankThreadRecords, resolveKeyRotationHash, settingsProfileFilename } from "./storage-logic";
import { chunkDocument } from "./thread-context";

export type AttachmentContext = { kind: "document" | "image"; name: string; chunks?: string[]; dataUrl?: string;
  rawPdfBase64?: string };
export type InternalMessage = PublicMessage & {
  apiContent: string | Array<Record<string, unknown>>;
  attachmentContext?: AttachmentContext[];
  manualToolResult?: { toolCallId: string; name: string; result: string };
  manualToolResults?: Array<{ toolCallId: string; name: string; result: string }>;
  /** Encrypted provider-only state. snapshot/export/search must never expose this field. */
  claudeContinuation?: Array<Record<string, unknown>>;
  /** Hidden idempotency marker for crash-safe Responses background reconciliation. */
  reconciledBackgroundResponseId?: string;
};
export type InternalThread = Omit<ThreadSnapshot, "messages" | "messageCount"> & {
  messages: InternalMessage[];
  webSearchHistory?: WebSearchCacheEntry[];
  webSearchContext?: string; // v0.1.1/v0.2 preview migration
  previousResponseId?: string;
};
type StoredThreads = { version: 2; threads: InternalThread[] };
type LegacyStoredThreads = { version: 1; threads: InternalThread[] };
type ProfileRecord = { id: string; keyHash: string; createdAt: string; lastUsedAt: string };
type ProfileRegistry = { version: 1; profiles: ProfileRecord[] };
type StoredJobs = { version: 1; jobs: PendingMediaJob[] };
type StoredSettings = { version: 1; settings: AppSettings };
type StoredBackgroundResponses = { version: 1; responses: BackgroundResponse[] };
type ProfileMoveJournal = { version: 1; sourceId: string; targetId: string; sourceKeyHash: string };
type LegacyMigrationJournal = { version: 1; profile: ProfileRecord };
type KeyRotationJournal = { version: 1; profileId: string; oldHash: string; newHash: string };
type ProjectDeletionJournal = { version: 1; profileId: string; projectId: string };

const root = () => join(app.getPath("userData"), "private");
const file = (name: string) => join(root(), name);
let currentProfileId: string | null = null;
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 24);
const threadFilename = (id: string) => `threads-profile-${id}.enc`;
const jobsFilename = (id: string) => `jobs-profile-${id}.enc`;
const settingsFilename = settingsProfileFilename;
const backgroundFilename = (id: string) => `background-responses-profile-${id}.enc`;
const MOVE_JOURNAL = "profile-move.enc";
const LEGACY_MIGRATION_JOURNAL = "legacy-migration.enc";
const KEY_ROTATION_JOURNAL = "key-rotation.enc";
const projectDeletionFilename = (id: string) => `project-delete-profile-${id}.enc`;
const MAX_ENCRYPTED_FILE_BYTES = 128 * 1024 * 1024;

async function ensureVault(): Promise<void> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error("운영체제 보안 저장소를 사용할 수 없습니다.");
  await mkdir(root(), { recursive: true, mode: 0o700 });
}
async function encryptToFile(name: string, plain: string): Promise<void> {
  await ensureVault();
  const encrypted = await safeStorage.encryptStringAsync(plain);
  await writeAtomic(file(name), encrypted);
}
async function decryptFromFile(name: string, maxEncryptedBytes?: number): Promise<string | null> {
  await ensureVault();
  const limit = maxEncryptedBytes ?? MAX_ENCRYPTED_FILE_BYTES;
  let handle;
  try { handle = await open(file(name), "r"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  let encrypted: Buffer;
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size <= 0 || details.size > limit) {
      throw new Error("로컬 암호화 저장 파일이 안전 한도를 넘었습니다.");
    }
    encrypted = await handle.readFile();
  } finally { await handle.close(); }
  const decrypted = await safeStorage.decryptStringAsync(encrypted);
  if (decrypted.shouldReEncrypt) await encryptToFile(name, decrypted.result);
  return decrypted.result;
}

export const loadKey = () => decryptFromFile("api-key.enc");
export const saveKey = (key: string) => encryptToFile("api-key.enc", key);
export async function deleteKey(): Promise<void> {
  try { await unlink(file("api-key.enc")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

let mutationQueue: Promise<unknown> = Promise.resolve();
export function serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(mutation, mutation);
  mutationQueue = result.catch(() => undefined);
  return result;
}
async function loadProfiles(): Promise<ProfileRegistry> {
  const plain = await decryptFromFile("profiles.enc");
  if (!plain) return { version: 1, profiles: [] };
  const value = JSON.parse(plain) as ProfileRegistry;
  if (value.version !== 1 || !Array.isArray(value.profiles)) throw new Error("로컬 프로필 저장 파일 형식이 올바르지 않습니다.");
  return value;
}
const saveProfiles = (value: ProfileRegistry) => encryptToFile("profiles.enc", JSON.stringify(value));

async function unlinkIfPresent(name: string): Promise<void> {
  await unlink(file(name)).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

async function recoverProfileMove(registry: ProfileRegistry): Promise<ProfileRegistry> {
  const plain = await decryptFromFile(MOVE_JOURNAL);
  if (!plain) return registry;
  const journal = JSON.parse(plain) as ProfileMoveJournal;
  if (journal.version !== 1 || !/^[a-f0-9-]{36}$/.test(journal.sourceId) ||
    !/^[a-f0-9-]{36}$/.test(journal.targetId) || !/^[a-f0-9]{24}$/.test(journal.sourceKeyHash)) {
    throw new Error("프로필 이동 복구 정보가 올바르지 않습니다.");
  }
  const sourceRecord = registry.profiles.find((item) => item.id === journal.sourceId);
  // Importing another stored profile is no longer supported. If an old import crashed before
  // committing the registry, remove only exact records copied from that source and keep it isolated.
  // A legacy move could also have copied opaque account settings, which cannot be attributed field by
  // field; reset the target settings instead of exposing another account's preferences.
  const source = await loadThreadsFile(threadFilename(journal.sourceId));
  const target = await loadThreadsFile(threadFilename(journal.targetId));
  const copiedThreads = new Map(source.threads.map((item) => [item.id,
    JSON.stringify({ ...item, attachmentConsent: false })]));
  const keptThreads = target.threads.filter((item) => copiedThreads.get(item.id) !== JSON.stringify(item));
  if (keptThreads.length !== target.threads.length) {
    target.threads = keptThreads;
    await encryptToFile(threadFilename(journal.targetId), JSON.stringify(target));
  }
  const sourceJobs = await loadJobs(journal.sourceId); const targetJobs = await loadJobs(journal.targetId);
  const copiedJobs = new Map(sourceJobs.jobs.map((item) => [item.id, JSON.stringify(item)]));
  const keptJobs = targetJobs.jobs.filter((item) => copiedJobs.get(item.id) !== JSON.stringify(item));
  if (keptJobs.length !== targetJobs.jobs.length) {
    targetJobs.jobs = keptJobs;
    await saveJobs(targetJobs, journal.targetId);
  }
  await unlinkIfPresent(settingsFilename(journal.targetId));
  if (sourceRecord) {
    await unlinkIfPresent(MOVE_JOURNAL);
    return registry;
  }
  // A missing source record means the old move committed before interruption. Finish cleanup only.
  await Promise.all(profileMoveCleanupFilenames(journal.sourceId, journal.sourceKeyHash).map(unlinkIfPresent));
  await unlinkIfPresent(MOVE_JOURNAL);
  return registry;
}

async function migrateLegacyStore(
  registry: ProfileRegistry, profile: ProfileRecord, recovering = false
): Promise<ProfileRegistry> {
  if (!recovering) {
    const journal: LegacyMigrationJournal = { version: 1, profile };
    // The marker is committed before any copy or registry change. Every later step is idempotent.
    await encryptToFile(LEGACY_MIGRATION_JOURNAL, JSON.stringify(journal));
  }
  const sourceName = `threads-${profile.keyHash}.enc`;
  const targetName = threadFilename(profile.id);
  const [sourcePlain, targetPlain] = await Promise.all([
    decryptFromFile(sourceName), decryptFromFile(targetName)
  ]);
  if (!sourcePlain && !targetPlain) {
    throw new Error("기존 대화 이전 원본과 대상 파일을 모두 찾을 수 없습니다.");
  }
  const source = sourcePlain ? parseThreads(sourcePlain) : { version: 2 as const, threads: [] };
  const target = targetPlain ? parseThreads(targetPlain) : { version: 2 as const, threads: [] };
  target.threads = mergeUniqueRecords(target.threads, source.threads)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  await encryptToFile(targetName, JSON.stringify(target));
  const existing = registry.profiles.find((item) => item.id === profile.id);
  if (!existing) registry.profiles.push(profile);
  await saveProfiles(registry);
  // Source deletion happens strictly after both the target and registry are durable.
  await unlinkIfPresent(sourceName);
  await unlinkIfPresent(LEGACY_MIGRATION_JOURNAL);
  return registry;
}

async function recoverLegacyMigration(registry: ProfileRegistry): Promise<ProfileRegistry> {
  const plain = await decryptFromFile(LEGACY_MIGRATION_JOURNAL);
  if (!plain) return registry;
  const journal = JSON.parse(plain) as LegacyMigrationJournal;
  if (journal.version !== 1 || !/^[a-f0-9-]{36}$/.test(journal.profile?.id ?? "") ||
    !/^[a-f0-9]{24}$/.test(journal.profile?.keyHash ?? "")) {
    throw new Error("기존 대화 이전 복구 정보가 올바르지 않습니다.");
  }
  return migrateLegacyStore(registry, journal.profile, true);
}

async function recoverKeyRotation(registry: ProfileRegistry, activeHash: string): Promise<ProfileRegistry> {
  const plain = await decryptFromFile(KEY_ROTATION_JOURNAL);
  if (!plain) return registry;
  const journal = JSON.parse(plain) as KeyRotationJournal;
  if (journal.version !== 1 || !/^[a-f0-9-]{36}$/.test(journal.profileId) ||
    !/^[a-f0-9]{24}$/.test(journal.oldHash) || !/^[a-f0-9]{24}$/.test(journal.newHash)) {
    throw new Error("API 키 교체 복구 정보가 올바르지 않습니다.");
  }
  const committedHash = resolveKeyRotationHash(journal.oldHash, journal.newHash, activeHash);
  const profile = registry.profiles.find((item) => item.id === journal.profileId);
  if (!profile) throw new Error("API 키 교체 대상 프로필을 찾을 수 없습니다.");
  if (![journal.oldHash, journal.newHash].includes(profile.keyHash)) {
    throw new Error("API 키 교체 대상 프로필 상태가 올바르지 않습니다.");
  }
  profile.keyHash = committedHash;
  await saveProfiles(registry);
  await unlinkIfPresent(KEY_ROTATION_JOURNAL);
  return registry;
}

/** A validated key opens only its own profile. A different key starts with an isolated local profile. */
export async function activateProfileForKey(key: string): Promise<void> {
  await serializeMutation(async () => {
    const hash = hashKey(key);
    let registry = await loadProfiles();
    registry = await recoverProfileMove(registry);
    registry = await recoverLegacyMigration(registry);
    registry = await recoverKeyRotation(registry, hash);
    const now = new Date().toISOString();
    let profile = registry.profiles.find((item) => item.keyHash === hash);
    if (!profile) {
      profile = { id: randomUUID(), keyHash: hash, createdAt: now, lastUsedAt: now };
      registry.profiles.push(profile);
    } else profile.lastUsedAt = now;
    if (await decryptFromFile(`threads-${hash}.enc`)) {
      registry = await migrateLegacyStore(registry, profile);
    }
    await saveProfiles(registry);
    currentProfileId = profile.id;
  });
}
export function clearActiveProfile(): void { currentProfileId = null; }
export function setAccountNamespace(key: string | null): void { if (!key) clearActiveProfile(); }
function requireProfile(): string { if (!currentProfileId) throw new Error("로그인이 필요합니다."); return currentProfileId; }
export function getActiveProfileId(): string { return requireProfile(); }

export function exportPortableBackup(): Promise<PortableBackup> {
  return serializeMutation(async () => {
    const profileId = requireProfile();
    const threads = (await loadThreads()).threads;
    const projects = await exportProjectBackup(profileId);
    return validateBackup({ version: 1, createdAt: new Date().toISOString(), threads,
      settings: await loadSettings(), projects });
  });
}

export function restorePortableBackup(input: unknown): Promise<void> {
  const backup = validateBackup(input);
  const threads = parseThreads(JSON.stringify({ version: 2, threads: backup.threads }));
  assertStoreGrowth(threads.threads);
  // Consent must be given on this computer. Remote background jobs are not restarted by a restore.
  for (const thread of threads.threads) {
    thread.attachmentConsent = false; thread.previousResponseId = undefined;
    for (const message of thread.messages) {
      if (message.backgroundResponseId) { message.backgroundResponseId = undefined; message.status = "incomplete"; }
      if (message.files) message.files = message.files.map((file) => ({ ...file, mediaUrl: "", expiresAt: new Date(0).toISOString() }));
    }
  }
  return serializeMutation(async () => {
    const previousId = requireProfile(); const registry = await loadProfiles();
    const record = registry.profiles.find((profile) => profile.id === previousId);
    if (!record) throw new Error("현재 계정의 저장 정보를 찾을 수 없습니다.");
    const restoredId = randomUUID();
    let commitAttempted = false;
    try {
      await encryptToFile(threadFilename(restoredId), JSON.stringify(threads));
      await encryptToFile(settingsFilename(restoredId), JSON.stringify({ version: 1, settings: normalizeAppSettings(backup.settings) }));
      await restoreProjectBackup(restoredId, backup.projects);
      // Only the encrypted registry pointer changes once all staged data is durable.
      // Previous files remain untouched for recovery; no API key is imported or replaced.
      record.id = restoredId; record.lastUsedAt = new Date().toISOString();
      commitAttempted = true;
      await saveProfiles(registry);
      currentProfileId = restoredId;
    } catch (error) {
      if (commitAttempted) {
        const observed = await loadProfiles();
        if (observed.profiles.some((profile) => profile.id === restoredId)) { currentProfileId = restoredId; return; }
      }
      await Promise.all([unlinkIfPresent(threadFilename(restoredId)), unlinkIfPresent(settingsFilename(restoredId)), clearProjectVault(restoredId)]);
      throw error;
    }
  });
}
export async function rotateActiveProfileKey(nextKey: string): Promise<void> {
  await serializeMutation(async () => {
    const profileId = requireProfile();
    const previousKey = await loadKey();
    if (!previousKey) throw new Error("현재 API 키를 찾을 수 없습니다.");
    const oldHash = hashKey(previousKey); const newHash = hashKey(nextKey);
    if (oldHash === newHash) throw new Error("현재 사용 중인 API 키입니다.");
    const registry = await loadProfiles();
    const profile = registry.profiles.find((item) => item.id === profileId && item.keyHash === oldHash);
    if (!profile) throw new Error("현재 API 키 프로필을 확인할 수 없습니다.");
    if (registry.profiles.some((item) => item.id !== profileId && item.keyHash === newHash)) {
      throw new Error("이 기기에서 이미 다른 프로필에 사용된 API 키입니다.");
    }
    const journal: KeyRotationJournal = { version: 1, profileId, oldHash, newHash };
    await encryptToFile(KEY_ROTATION_JOURNAL, JSON.stringify(journal));
    try {
      await saveKey(nextKey);
      profile.keyHash = newHash;
      profile.lastUsedAt = new Date().toISOString();
      await saveProfiles(registry);
      await unlinkIfPresent(KEY_ROTATION_JOURNAL);
    } catch (error) {
      try {
        await saveKey(previousKey);
        profile.keyHash = oldHash;
        await saveProfiles(registry);
        await unlinkIfPresent(KEY_ROTATION_JOURNAL);
      } catch {
        // Keep the journal. Startup recovery reconciles the registry with whichever key is durable.
      }
      throw error;
    }
  });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function legacyContext(message: InternalMessage): AttachmentContext[] {
  const contexts: AttachmentContext[] = [];
  const parts = Array.isArray(message.apiContent) ? message.apiContent : [{ type: "text", text: message.apiContent }];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") {
      for (const match of part.text.matchAll(/\[첨부 문서: ([^\]]+)\]\n([\s\S]*?)\n\[\/첨부 문서\]/g)) {
        contexts.push({ kind: "document", name: match[1], chunks: chunkDocument(match[2]) });
      }
    }
    if (part.type === "image_url" && isRecord(part.image_url) && typeof part.image_url.url === "string" &&
      part.image_url.url.startsWith("data:image/")) {
      contexts.push({ kind: "image", name: message.attachments?.[0] ?? "첨부 이미지", dataUrl: part.image_url.url });
    }
  }
  return contexts;
}
function normalizeThread(raw: InternalThread): InternalThread {
  const webSearchMode: WebSearchMode = ["always", "auto", "deep", "off"].includes(raw.webSearchMode)
    ? raw.webSearchMode : "always";
  const purpose = raw.purpose === "meeting-summary" ? "meeting-summary" : undefined;
  return {
    ...raw, purpose, webSearchMode: purpose === "meeting-summary" ? "off" : webSearchMode,
    projectId: typeof raw.projectId === "string" && /^[a-f0-9-]{36}$/.test(raw.projectId) ? raw.projectId : undefined,
    previousResponseId: typeof raw.previousResponseId === "string" && raw.previousResponseId.length <= 500
      ? raw.previousResponseId : undefined,
    attachmentConsent: Boolean(raw.attachmentConsent),
    ...normalizeThreadPreferences(raw as unknown as Record<string, unknown>),
    webSearchHistory: Array.isArray(raw.webSearchHistory) ? raw.webSearchHistory.slice(0, 5)
      : raw.webSearchContext ? [{ query: "이전 검색", fingerprint: "", content: raw.webSearchContext,
        createdAt: raw.updatedAt }] : [],
    messages: Array.isArray(raw.messages) ? raw.messages.map((message) => {
      const attachmentContext = Array.isArray(message.attachmentContext) ? message.attachmentContext : legacyContext(message);
      const text = raw.target?.kind === "chatbot" ? redactChatbotPublicUrls(message.text) : message.text;
      const apiContent = raw.target?.kind === "chatbot" ? text
        : typeof message.apiContent === "string" || Array.isArray(message.apiContent) ? message.apiContent : text;
      const reasoningSummary = typeof message.reasoningSummary === "string" &&
        Buffer.byteLength(message.reasoningSummary, "utf8") <= 64 * 1024 ? message.reasoningSummary : undefined;
      const reconciledBackgroundResponseId = typeof message.reconciledBackgroundResponseId === "string" &&
        message.reconciledBackgroundResponseId.length <= 500 ? message.reconciledBackgroundResponseId : undefined;
      return { ...message, text, apiContent, reasoningSummary, reconciledBackgroundResponseId,
        ...(attachmentContext.length ? { attachmentContext } : {}) };
    }) : []
  };
}
async function loadThreadsFile(name: string): Promise<StoredThreads> {
  const plain = await decryptFromFile(name, MAX_THREAD_STORE_BYTES * 2);
  if (!plain) return { version: 2, threads: [] };
  return parseThreads(plain);
}
function parseThreads(plain: string): StoredThreads {
  assertThreadStoreByteLength(Buffer.byteLength(plain, "utf8"));
  const value = JSON.parse(plain) as StoredThreads | LegacyStoredThreads;
  if (![1, 2].includes(value.version) || !Array.isArray(value.threads)) throw new Error("대화 저장 파일 형식이 올바르지 않습니다.");
  if (value.threads.some((thread) => !thread || typeof thread !== "object" ||
    typeof thread.id !== "string" || thread.id.length > 100 || typeof thread.title !== "string" ||
    !Array.isArray(thread.messages) || thread.messages.some((message) =>
      !message || typeof message !== "object" || typeof message.id !== "string" || message.id.length > 100 ||
      !["user", "assistant"].includes(message.role) || typeof message.text !== "string" ||
      typeof message.createdAt !== "string" || !(typeof message.apiContent === "string" ||
        Array.isArray(message.apiContent) || message.apiContent === undefined)))) {
    throw new Error("대화 저장 파일에 손상된 레코드가 있습니다.");
  }
  return { version: 2, threads: value.threads.map(normalizeThread) };
}
export const loadThreads = () => loadThreadsFile(threadFilename(requireProfile()));
export const saveThreads = (value: StoredThreads, previous: StoredThreads["threads"] = []) => {
  assertStoreGrowth(value.threads, previous);
  const serialized = JSON.stringify({ ...value, version: 2 });
  try { assertThreadStoreByteLength(Buffer.byteLength(serialized, "utf8")); }
  catch { throw new Error("대화 기록이 96MB 로컬 저장 한도를 넘었습니다. 오래된 대화나 큰 첨부 대화를 정리해 주세요."); }
  return encryptToFile(threadFilename(requireProfile()), serialized);
};
export function summary(thread: InternalThread): ThreadSummary {
  return { id: thread.id, title: thread.title, modelId: thread.modelId, createdAt: thread.createdAt,
    updatedAt: thread.updatedAt, messageCount: thread.messages.length, webSearchMode: thread.webSearchMode ?? "always",
    pinned: Boolean(thread.pinned), purpose: thread.purpose, projectId: thread.projectId, target: thread.target };
}
export function snapshot(thread: InternalThread): ThreadSnapshot {
  return { ...summary(thread), attachmentConsent: Boolean(thread.attachmentConsent),
    instruction: thread.instruction ?? "", reasoningMode: thread.reasoningMode ?? "auto",
    advanced: thread.advanced ?? {},
    messages: thread.messages.map(({ apiContent: _a, attachmentContext: _c, manualToolResult: _m,
      manualToolResults: _ms, claudeContinuation: _cc, reconciledBackgroundResponseId: _br, ...message }) => message) };
}

export async function beginProjectDeletion(projectId: string, profileId = requireProfile()): Promise<void> {
  if (!/^[a-f0-9-]{36}$/.test(projectId) || !/^[a-f0-9-]{36}$/.test(profileId)) {
    throw new Error("프로젝트 삭제 복구 정보가 올바르지 않습니다.");
  }
  await encryptToFile(projectDeletionFilename(profileId), JSON.stringify({ version: 1, profileId, projectId }));
}
export async function pendingProjectDeletion(profileId = requireProfile()): Promise<string | null> {
  const plain = await decryptFromFile(projectDeletionFilename(profileId), 16 * 1024);
  if (!plain) return null;
  const value = JSON.parse(plain) as ProjectDeletionJournal;
  if (value.version !== 1 || value.profileId !== profileId || !/^[a-f0-9-]{36}$/.test(value.projectId)) {
    throw new Error("프로젝트 삭제 복구 정보가 올바르지 않습니다.");
  }
  return value.projectId;
}
export async function finishProjectDeletion(profileId = requireProfile()): Promise<void> {
  await unlinkIfPresent(projectDeletionFilename(profileId));
}
export async function createThread(request: CreateThreadRequest): Promise<ThreadSnapshot> {
  return serializeMutation(async () => {
    const db = await loadThreads(); const now = new Date().toISOString();
    assertThreadCapacity(db.threads.length);
    const thread: InternalThread = { id: randomUUID(), title: "새 대화", modelId: request.modelId,
      createdAt: now, updatedAt: now, attachmentConsent: false,
      webSearchMode: request.purpose === "meeting-summary" ? "off" : "always", purpose: request.purpose,
      projectId: request.projectId, target: request.target,
      pinned: false, instruction: request.instruction?.trim() ?? "", reasoningMode: "auto", advanced: {}, messages: [] };
    db.threads.unshift(thread); await saveThreads(db); return snapshot(thread);
  });
}
export async function getThread(id: string): Promise<InternalThread> {
  const thread = (await loadThreads()).threads.find((item) => item.id === id);
  if (!thread) throw new Error("대화를 찾을 수 없습니다."); return thread;
}
export async function updateThread(id: string, update: (thread: InternalThread) => void): Promise<ThreadSnapshot> {
  return serializeMutation(async () => {
    const db = await loadThreads(); const thread = db.threads.find((item) => item.id === id);
    if (!thread) throw new Error("대화를 찾을 수 없습니다.");
    const previous = db.threads.map((item) => ({ ...item, messages: [...item.messages] }));
    update(thread); thread.updatedAt = new Date().toISOString(); await saveThreads(db, previous); return snapshot(thread);
  });
}
export async function removeThread(id: string): Promise<void> {
  await serializeMutation(async () => { const db = await loadThreads(); const previous = db.threads;
    db.threads = db.threads.filter((item) => item.id !== id); await saveThreads(db, previous); });
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultInstruction: DEFAULT_INSTRUCTION,
  theme: "system",
  fontSize: "medium"
};

export async function loadSettings(): Promise<AppSettings> {
  const profileId = requireProfile();
  const plain = await decryptFromFile(settingsFilename(profileId));
  if (!plain) return { ...DEFAULT_APP_SETTINGS };
  const stored = JSON.parse(plain) as StoredSettings;
  if (stored.version !== 1 || !stored.settings) throw new Error("설정 저장 파일 형식이 올바르지 않습니다.");
  return normalizeAppSettings(stored.settings);
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return serializeMutation(async () => {
    // Model preferences have their own mutation path. Read them inside the same
    // queue so saving an older settings form cannot undo a recent favorite.
    const current = await loadSettings();
    const normalized = normalizeAppSettings({ ...settings,
      favoriteModels: current.favoriteModels, recentModels: current.recentModels });
    await encryptToFile(settingsFilename(requireProfile()), JSON.stringify({
      version: 1, settings: normalized
    } satisfies StoredSettings));
    return normalized;
  });
}

export async function updateModelPreference(modelId: string, action: "favorite" | "recent"): Promise<AppSettings> {
  return serializeMutation(async () => {
    const settings = await loadSettings();
    if (action === "recent") settings.recentModels = [modelId, ...(settings.recentModels ?? []).filter((id) => id !== modelId)].slice(0, 8);
    else {
      const favorites = settings.favoriteModels ?? [];
      if (!favorites.includes(modelId) && favorites.length >= 20) throw new Error("즐겨찾기는 최대 20개까지 저장할 수 있습니다.");
      settings.favoriteModels = favorites.includes(modelId) ? favorites.filter((id) => id !== modelId) : [...favorites, modelId];
    }
    await encryptToFile(settingsFilename(requireProfile()), JSON.stringify({ version: 1, settings }));
    return settings;
  });
}

export async function searchThreads(query: string): Promise<ThreadSearchResult[]> {
  return rankThreadRecords((await loadThreads()).threads, query)
    .map(({ thread, snippet }) => ({ ...summary(thread), snippet }));
}
async function loadJobs(profileId = requireProfile()): Promise<StoredJobs> {
  const plain = await decryptFromFile(jobsFilename(profileId)); if (!plain) return { version: 1, jobs: [] };
  const value = JSON.parse(plain) as StoredJobs;
  if (value.version !== 1 || !Array.isArray(value.jobs)) throw new Error("미디어 작업 저장 파일 형식이 올바르지 않습니다.");
  const now = Date.now();
  return { version: 1, jobs: value.jobs.map((job) => ({
    ...job,
    attempts: Number.isFinite(job.attempts) ? job.attempts : 0,
    nextPollAt: job.nextPollAt || job.updatedAt || job.createdAt,
    expiresAt: job.expiresAt || new Date(Date.parse(job.createdAt) + 24 * 60 * 60_000).toISOString()
  })).filter((job) => Number.isFinite(Date.parse(job.createdAt)) &&
    (["completed", "failed"].includes(job.status) || Date.parse(job.expiresAt) > now - 7 * 24 * 60 * 60_000)) };
}
const saveJobs = (value: StoredJobs, profileId = requireProfile()) => {
  value.jobs.forEach((job) => assertPendingJobResultSize(job.result));
  return encryptToFile(jobsFilename(profileId), JSON.stringify(value));
};
export async function listPendingJobs(profileId = requireProfile()): Promise<PendingMediaJob[]> {
  return (await loadJobs(profileId)).jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function addPendingJob(job: PendingMediaJob, profileId = requireProfile()): Promise<void> {
  await serializeMutation(async () => { const db = await loadJobs(profileId); db.jobs = [job, ...db.jobs.filter((item) => item.id !== job.id)].slice(0, 20); await saveJobs(db, profileId); });
}
export async function getPendingJob(id: string, profileId = requireProfile()): Promise<PendingMediaJob> {
  const job = (await loadJobs(profileId)).jobs.find((item) => item.id === id); if (!job) throw new Error("추적 중인 작업을 찾을 수 없습니다."); return job;
}
export async function updatePendingJob(id: string, update: (job: PendingMediaJob) => void,
  profileId = requireProfile()): Promise<PendingMediaJob | null> {
  return serializeMutation(async () => { const db = await loadJobs(profileId); const job = db.jobs.find((item) => item.id === id);
    if (!job) return null; update(job); job.updatedAt = new Date().toISOString(); await saveJobs(db, profileId); return job; });
}
export async function removePendingJob(id: string, profileId = requireProfile()): Promise<void> {
  await serializeMutation(async () => { const db = await loadJobs(profileId); db.jobs = db.jobs.filter((item) => item.id !== id); await saveJobs(db, profileId); });
}

async function loadBackgroundFile(profileId = requireProfile()): Promise<StoredBackgroundResponses> {
  const plain = await decryptFromFile(backgroundFilename(profileId), MAX_BACKGROUND_RESPONSE_BYTES * 2);
  if (!plain) return { version: 1, responses: [] };
  const value = JSON.parse(plain) as StoredBackgroundResponses;
  if (value.version !== 1 || !Array.isArray(value.responses)) {
    throw new Error("백그라운드 응답 저장 파일 형식이 올바르지 않습니다.");
  }
  return { version: 1, responses: value.responses.filter((item) => item && typeof item.id === "string") };
}

async function saveBackgroundFile(value: StoredBackgroundResponses, profileId = requireProfile()): Promise<void> {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_BACKGROUND_RESPONSE_BYTES) {
    throw new Error("백그라운드 응답 기록이 8MB 저장 한도를 넘었습니다.");
  }
  await encryptToFile(backgroundFilename(profileId), serialized);
}

export async function listBackgroundResponses(profileId = requireProfile()): Promise<BackgroundResponse[]> {
  return (await loadBackgroundFile(profileId)).responses;
}

/** Reconciles the complete store first, then prunes only unchanged versions that were applied. */
export async function reconcileAndPruneBackgroundResponses(
  reconcile: (item: BackgroundResponse) => Promise<unknown>, profileId = requireProfile(), now = Date.now()
): Promise<BackgroundResponse[]> {
  const initial = await loadBackgroundFile(profileId);
  const plan = planBackgroundReconciliation(initial.responses, now);
  for (const item of plan.reconcile) await reconcile(item);
  if (!plan.processedVersions.length) return initial.responses;
  const processed = new Map(plan.processedVersions.map((item) => [item.id, item.fingerprint]));
  return serializeMutation(async () => {
    const current = await loadBackgroundFile(profileId);
    current.responses = current.responses.filter((item) => processed.get(item.id) !== JSON.stringify(item));
    await saveBackgroundFile(current, profileId);
    return current.responses;
  });
}

export async function upsertBackgroundResponse(item: BackgroundResponse, profileId = requireProfile()): Promise<void> {
  await serializeMutation(async () => {
    const db = await loadBackgroundFile(profileId);
    db.responses = upsertBackgroundResponseRecord(db.responses, item);
    await saveBackgroundFile(db, profileId);
  });
}

export async function removeBackgroundResponse(id: string, profileId = requireProfile()): Promise<void> {
  await serializeMutation(async () => {
    const db = await loadBackgroundFile(profileId);
    db.responses = db.responses.filter((item) => item.id !== id);
    await saveBackgroundFile(db, profileId);
  });
}
