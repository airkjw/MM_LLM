import { app, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, rm, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { decodeBackupBytes, type PortableProject } from "../shared/backup-format";
import type { ProjectDocument, ProjectSummary } from "../shared/contracts";
import { writeAtomic } from "./atomic-file";
import { extractDocx, extractPdf, extractXlsx } from "./document-text";
import { createVaultKey, decryptVaultBlob, encryptVaultBlob, type VaultKey } from "./project-vault-crypto";
import { chunkDocument } from "./thread-context";

export const MAX_PROJECT_DOCUMENT_BYTES = 18 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
export const MAX_PROJECT_DOCUMENTS = 20;
export const MAX_PROJECTS = 50;
export const MAX_PROJECT_METADATA_BYTES = 1024 * 1024;
export const MAX_PROJECT_INDEX_BYTES = 6 * 1024 * 1024;
export const MAX_PROJECT_RAW_PDF_BYTES = 14 * 1024 * 1024;

type StoredDocument = ProjectDocument & { blobId: string; indexBlobId: string };
type ProjectRecord = Omit<ProjectSummary, "threadCount" | "documents"> & { documents: StoredDocument[] };
type ProjectDb = { version: 1; projects: ProjectRecord[] };
type Keyring = { version: 1; current: { id: string; key: string }; previous?: { id: string; key: string } };

const privateRoot = () => join(app.getPath("userData"), "private");
const metadataPath = (profileId: string) => join(privateRoot(), `projects-profile-${profileId}.enc`);
const keyringPath = (profileId: string) => join(privateRoot(), `project-keyring-profile-${profileId}.enc`);
const blobRoot = (profileId: string) => join(privateRoot(), "project-blobs", profileId);
const blobPath = (profileId: string, blobId: string) => join(blobRoot(profileId), `${safeId(blobId, "문서 Blob")}.blob`);
async function readEncryptedBlob(profileId: string, blobId: string): Promise<Buffer> {
  const path = blobPath(profileId, blobId); const handle = await open(path, "r");
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size <= 0 || details.size > 25 * 1024 * 1024) {
      throw new Error("프로젝트 문서 암호화 파일이 저장 한도를 넘었습니다.");
    }
    return await handle.readFile();
  } finally { await handle.close(); }
}
const profileQueues = new Map<string, Promise<unknown>>();
function serializeProfile<T>(profileId: string, operation: () => Promise<T>): Promise<T> {
  const previous = profileQueues.get(profileId) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const queued = result.then(() => undefined, () => undefined).finally(() => {
    if (profileQueues.get(profileId) === queued) profileQueues.delete(profileId);
  });
  profileQueues.set(profileId, queued); return result;
}

function safeId(value: string, label: string): string {
  if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value;
}

async function ensure(profileId: string): Promise<void> {
  safeId(profileId, "프로필");
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error("운영체제 보안 저장소를 사용할 수 없습니다.");
  await mkdir(blobRoot(profileId), { recursive: true, mode: 0o700 });
}

async function atomic(path: string, bytes: Buffer): Promise<void> {
  await writeAtomic(path, bytes);
}

async function encryptText(path: string, value: unknown): Promise<void> {
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value));
  await atomic(path, encrypted);
}

async function decryptText<T>(path: string, maxBytes = 2 * 1024 * 1024): Promise<T | null> {
  let handle;
  try { handle = await open(path, "r"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  let bytes: Buffer;
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size <= 0 || details.size > maxBytes) {
      throw new Error("프로젝트 메타데이터가 로컬 저장 한도를 넘었습니다.");
    }
    bytes = await handle.readFile();
  } finally { await handle.close(); }
  const result = await safeStorage.decryptStringAsync(bytes);
  if (Buffer.byteLength(result.result, "utf8") > maxBytes) {
    throw new Error("프로젝트 메타데이터가 로컬 저장 한도를 넘었습니다.");
  }
  return JSON.parse(result.result) as T;
}

async function db(profileId: string): Promise<ProjectDb> {
  await ensure(profileId); const value = await decryptText<ProjectDb>(metadataPath(profileId), MAX_PROJECT_METADATA_BYTES * 2);
  if (!value) return { version: 1, projects: [] };
  if (value.version !== 1 || !Array.isArray(value.projects)) throw new Error("프로젝트 저장 파일 형식이 올바르지 않습니다.");
  return value;
}

async function saveDb(profileId: string, value: ProjectDb): Promise<void> {
  if (value.projects.length > MAX_PROJECTS || Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_PROJECT_METADATA_BYTES) {
    throw new Error("프로젝트 메타데이터가 로컬 저장 한도를 넘었습니다.");
  }
  await encryptText(metadataPath(profileId), value);
}

function decodeKey(value: { id: string; key: string }): VaultKey {
  const key = Buffer.from(value.key, "base64");
  if (!/^[a-f0-9-]{36}$/.test(value.id) || key.length !== 32) throw new Error("프로젝트 보관함 키가 올바르지 않습니다.");
  return { id: value.id, key };
}

async function loadKeyring(profileId: string): Promise<{ ring: Keyring; keys: VaultKey[] }> {
  await ensure(profileId); let ring = await decryptText<Keyring>(keyringPath(profileId));
  if (!ring) {
    const key = createVaultKey(); ring = { version: 1, current: { id: key.id, key: key.key.toString("base64") } };
    await encryptText(keyringPath(profileId), ring);
  }
  if (ring.version !== 1) throw new Error("프로젝트 보관함 키 버전을 지원하지 않습니다.");
  return { ring, keys: [decodeKey(ring.current), ...(ring.previous ? [decodeKey(ring.previous)] : [])] };
}

async function recoverRotation(profileId: string): Promise<VaultKey> {
  const loaded = await loadKeyring(profileId); const current = loaded.keys[0];
  if (!loaded.ring.previous) return current;
  const files = (await readdir(blobRoot(profileId))).filter((name) => /^[a-f0-9-]{36}\.blob$/.test(name));
  for (const name of files) {
    const id = name.slice(0, -5); const path = blobPath(profileId, id); const encrypted = await readEncryptedBlob(profileId, id);
    const plain = decryptVaultBlob(encrypted, loaded.keys, `${profileId}:${id}`);
    await atomic(path, encryptVaultBlob(plain, current, `${profileId}:${id}`)); plain.fill(0);
  }
  const finalized: Keyring = { version: 1, current: loaded.ring.current };
  await encryptText(keyringPath(profileId), finalized);
  return current;
}

async function rotateProjectVaultKeyUnlocked(profileId: string): Promise<void> {
  const loaded = await loadKeyring(profileId); const next = createVaultKey();
  const rotating: Keyring = { version: 1,
    current: { id: next.id, key: next.key.toString("base64") }, previous: loaded.ring.current };
  await encryptText(keyringPath(profileId), rotating);
  await recoverRotation(profileId);
}

async function listProjectsUnlocked(profileId: string, threadCounts: Map<string, number> = new Map()): Promise<ProjectSummary[]> {
  await sweepProjectOrphansUnlocked(profileId);
  return (await db(profileId)).projects.map((project) => ({ id: project.id, name: project.name,
    instruction: project.instruction, documents: project.documents.map(({ blobId: _b, indexBlobId: _i, ...doc }) => doc),
    threadCount: threadCounts.get(project.id) ?? 0, createdAt: project.createdAt, updatedAt: project.updatedAt }));
}

async function createProjectUnlocked(profileId: string, name: string, instruction = ""): Promise<ProjectSummary> {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
  if (!cleaned) throw new Error("프로젝트 이름을 입력해 주세요.");
  const value = await db(profileId); const now = new Date().toISOString();
  if (value.projects.length >= MAX_PROJECTS) throw new Error(`프로젝트는 프로필당 최대 ${MAX_PROJECTS}개까지 만들 수 있습니다.`);
  const project: ProjectRecord = { id: randomUUID(), name: cleaned, instruction: instruction.trim().slice(0, 12_000),
    documents: [], createdAt: now, updatedAt: now };
  value.projects.unshift(project); await saveDb(profileId, value);
  return { ...project, documents: [], threadCount: 0 };
}

async function updateProjectUnlocked(profileId: string, projectId: string,
  update: { name: string; instruction: string }): Promise<ProjectSummary> {
  safeId(projectId, "프로젝트"); const value = await db(profileId);
  const project = value.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  const name = update.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
  if (!name) throw new Error("프로젝트 이름을 입력해 주세요.");
  project.name = name; project.instruction = update.instruction.trim().slice(0, 12_000);
  project.updatedAt = new Date().toISOString(); await saveDb(profileId, value);
  return { ...project, documents: project.documents.map(({ blobId: _b, indexBlobId: _i, ...doc }) => doc), threadCount: 0 };
}

async function extractedText(name: string, bytes: Buffer, signal?: AbortSignal): Promise<string> {
  const extension = extname(name).toLowerCase();
  signal?.throwIfAborted();
  try {
    if (extension === ".pdf") return await extractPdf(bytes, undefined, signal);
    if (extension === ".docx") return await extractDocx(bytes);
    if (extension === ".xlsx") return await extractXlsx(bytes);
  } catch (error) {
    if (extension !== ".pdf") throw error;
    return "[로컬 OCR로 읽히지 않은 PDF입니다. Claude 네이티브 PDF 분석에서 원문을 사용할 수 있습니다.]";
  }
  throw new Error("프로젝트에는 PDF·Word·Excel 문서만 추가할 수 있습니다.");
}

async function addProjectDocumentUnlocked(profileId: string, projectId: string,
  input: { name: string; mime: string; bytes: Buffer }, signal?: AbortSignal): Promise<ProjectSummary> {
  signal?.throwIfAborted();
  safeId(projectId, "프로젝트");
  if (input.bytes.length > MAX_PROJECT_DOCUMENT_BYTES) throw new Error("프로젝트 문서는 18MB 이하여야 합니다.");
  const value = await db(profileId); const project = value.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  if (project.documents.length >= MAX_PROJECT_DOCUMENTS) throw new Error("프로젝트에는 문서를 최대 20개까지 저장할 수 있습니다.");
  const used = project.documents.reduce((sum, item) => sum + item.size, 0);
  if (used + input.bytes.length > MAX_PROJECT_BYTES) throw new Error("프로젝트 문서 전체 용량은 64MB 이하여야 합니다.");
  const name = basename(input.name).slice(0, 255); const extension = extname(name).toLowerCase();
  const expectedMime = extension === ".pdf" ? "application/pdf"
    : extension === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : extension === ".xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "";
  if (!expectedMime || input.mime !== expectedMime || extension === ".pdf" &&
    !input.bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || [".docx", ".xlsx"].includes(extension) &&
    !input.bytes.subarray(0, 2).equals(Buffer.from("PK"))) {
    throw new Error("프로젝트 문서의 확장자·MIME·실제 파일 형식이 일치하지 않습니다.");
  }
  const text = await extractedText(name, input.bytes, signal); signal?.throwIfAborted();
  const chunks = chunkDocument(text); const indexBytes = Buffer.from(JSON.stringify(chunks), "utf8");
  if (indexBytes.length > MAX_PROJECT_INDEX_BYTES) throw new Error("프로젝트 문서의 추출 텍스트가 저장 한도를 넘었습니다.");
  const blobId = randomUUID(); const indexBlobId = randomUUID(); const key = await recoverRotation(profileId);
  await atomic(blobPath(profileId, blobId), encryptVaultBlob(input.bytes, key, `${profileId}:${blobId}`));
  try { await atomic(blobPath(profileId, indexBlobId),
    encryptVaultBlob(indexBytes, key, `${profileId}:${indexBlobId}`)); }
  catch (error) { await unlink(blobPath(profileId, blobId)).catch(() => undefined); throw error; }
  const now = new Date().toISOString(); const document: StoredDocument = { id: randomUUID(), blobId, indexBlobId, name,
    mime: input.mime, size: input.bytes.length, createdAt: now };
  try { project.documents.push(document); project.updatedAt = now; await saveDb(profileId, value); }
  catch (error) { await Promise.all([blobId, indexBlobId].map((id) => unlink(blobPath(profileId, id)).catch(() => undefined))); throw error; }
  return { ...project, documents: project.documents.map(({ blobId: _b, indexBlobId: _i, ...doc }) => doc), threadCount: 0 };
}

async function removeProjectDocumentUnlocked(profileId: string, projectId: string, documentId: string): Promise<void> {
  safeId(projectId, "프로젝트"); safeId(documentId, "문서"); const value = await db(profileId);
  const project = value.projects.find((item) => item.id === projectId); if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  const document = project.documents.find((item) => item.id === documentId); if (!document) throw new Error("프로젝트 문서를 찾을 수 없습니다.");
  project.documents = project.documents.filter((item) => item.id !== documentId); project.updatedAt = new Date().toISOString();
  await saveDb(profileId, value);
  for (const blobId of [document.blobId, document.indexBlobId]) {
    const refs = value.projects.flatMap((item) => item.documents)
      .filter((item) => item.blobId === blobId || item.indexBlobId === blobId).length;
    if (!refs) await unlink(blobPath(profileId, blobId)).catch(() => undefined);
  }
}

async function deleteProjectUnlocked(profileId: string, projectId: string): Promise<void> {
  safeId(projectId, "프로젝트"); const value = await db(profileId);
  if (!value.projects.some((item) => item.id === projectId)) { await sweepProjectOrphansUnlocked(profileId); return; }
  value.projects = value.projects.filter((item) => item.id !== projectId); await saveDb(profileId, value);
  await sweepProjectOrphansUnlocked(profileId);
}

async function sweepProjectOrphansUnlocked(profileId: string): Promise<void> {
  await ensure(profileId); const value = await db(profileId);
  const referenced = new Set(value.projects.flatMap((project) => project.documents
    .flatMap((doc) => [`${doc.blobId}.blob`, `${doc.indexBlobId}.blob`])));
  for (const name of await readdir(blobRoot(profileId))) {
    if (/^[a-f0-9-]{36}\.blob$/.test(name) && !referenced.has(name)) await unlink(join(blobRoot(profileId), name));
    if (name.endsWith(".tmp")) await unlink(join(blobRoot(profileId), name)).catch(() => undefined);
  }
}

function terms(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[가-힣]{2,}|[a-z0-9]{3,}/g) ?? [])].slice(0, 20);
}

async function projectContextUnlocked(profileId: string, projectId: string, query: string,
  includeRawPdfs: boolean): Promise<{ instruction: string; text: string; pdfs: Array<{ name: string; data: string }> }> {
  safeId(projectId, "프로젝트"); const value = await db(profileId);
  const project = value.projects.find((item) => item.id === projectId); if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  const keys = (await loadKeyring(profileId)).keys;
  const chunksByDocument = await Promise.all(project.documents.map(async (document) => {
    const plain = decryptVaultBlob(await readEncryptedBlob(profileId, document.indexBlobId), keys,
      `${profileId}:${document.indexBlobId}`);
    if (plain.length > MAX_PROJECT_INDEX_BYTES) throw new Error("프로젝트 문서 색인이 저장 한도를 넘었습니다.");
    const parsed = JSON.parse(plain.toString("utf8")) as unknown; plain.fill(0);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error("프로젝트 문서 색인이 올바르지 않습니다.");
    return { document, chunks: parsed as string[] };
  }));
  const queryTerms = terms(query); const ranked = chunksByDocument.flatMap(({ document, chunks }) => chunks.map((chunk, index) => ({
    name: document.name, chunk, score: (index === 0 ? 1 : 0) + queryTerms.reduce((sum, term) =>
      sum + Math.min(12, (chunk.toLowerCase().split(term).length - 1) * 4), 0)
  }))).sort((a, b) => b.score - a.score);
  const chosen: string[] = []; const represented = new Set<string>(); let used = 0;
  for (const item of ranked) {
    if (item.score <= 1 && represented.has(item.name)) continue;
    const block = `[프로젝트 문서: ${item.name}]\n${item.chunk}\n[/프로젝트 문서]`;
    if (used + block.length > 40_000) continue;
    chosen.push(block); represented.add(item.name); used += block.length;
    if (chosen.length >= Math.max(project.documents.length, 10)) break;
  }
  const pdfs: Array<{ name: string; data: string }> = [];
  if (includeRawPdfs) {
    let rawTotal = 0;
    for (const document of project.documents.filter((item) => item.mime === "application/pdf")) {
      const plain = decryptVaultBlob(await readEncryptedBlob(profileId, document.blobId), keys, `${profileId}:${document.blobId}`);
      if (!plain.subarray(0, 5).equals(Buffer.from("%PDF-"))) { plain.fill(0); throw new Error("프로젝트 PDF 실제 형식이 올바르지 않습니다."); }
      if (rawTotal + plain.length <= MAX_PROJECT_RAW_PDF_BYTES) {
        pdfs.push({ name: document.name, data: plain.toString("base64") }); rawTotal += plain.length;
      }
      plain.fill(0);
      if (rawTotal >= MAX_PROJECT_RAW_PDF_BYTES) break;
    }
  }
  return { instruction: project.instruction, text: chosen.join("\n\n"), pdfs };
}

async function clearProjectVaultUnlocked(profileId: string): Promise<void> {
  await Promise.all([
    unlink(metadataPath(profileId)).catch(() => undefined), unlink(keyringPath(profileId)).catch(() => undefined),
    rm(blobRoot(profileId), { recursive: true, force: true })
  ]);
}

export const rotateProjectVaultKey = (profileId: string) => serializeProfile(profileId,
  () => rotateProjectVaultKeyUnlocked(profileId));
export const listProjects = (profileId: string, threadCounts: Map<string, number> = new Map()) => serializeProfile(profileId,
  () => listProjectsUnlocked(profileId, threadCounts));
export const createProject = (profileId: string, name: string, instruction = "") => serializeProfile(profileId,
  () => createProjectUnlocked(profileId, name, instruction));
export const updateProject = (profileId: string, projectId: string, update: { name: string; instruction: string }) =>
  serializeProfile(profileId, () => updateProjectUnlocked(profileId, projectId, update));
export const addProjectDocument = (profileId: string, projectId: string,
  input: { name: string; mime: string; bytes: Buffer }, signal?: AbortSignal) => serializeProfile(profileId,
  () => addProjectDocumentUnlocked(profileId, projectId, input, signal));
export const removeProjectDocument = (profileId: string, projectId: string, documentId: string) =>
  serializeProfile(profileId, () => removeProjectDocumentUnlocked(profileId, projectId, documentId));
export const deleteProject = (profileId: string, projectId: string) => serializeProfile(profileId,
  () => deleteProjectUnlocked(profileId, projectId));
export const sweepProjectOrphans = (profileId: string) => serializeProfile(profileId,
  () => sweepProjectOrphansUnlocked(profileId));
export const projectContext = (profileId: string, projectId: string, query: string, includeRawPdfs: boolean) =>
  serializeProfile(profileId, () => projectContextUnlocked(profileId, projectId, query, includeRawPdfs));
export const clearProjectVault = (profileId: string) => serializeProfile(profileId,
  () => clearProjectVaultUnlocked(profileId));

export function exportProjectBackup(profileId: string): Promise<PortableProject[]> {
  return serializeProfile(profileId, async () => {
    const value = await db(profileId); const keys = (await loadKeyring(profileId)).keys;
    const projects: PortableProject[] = [];
    for (const project of value.projects) {
      const documents: PortableProject["documents"] = [];
      for (const { blobId, indexBlobId, ...doc } of project.documents) {
        const content = decryptVaultBlob(await readEncryptedBlob(profileId, blobId), keys, `${profileId}:${blobId}`);
        const index = decryptVaultBlob(await readEncryptedBlob(profileId, indexBlobId), keys, `${profileId}:${indexBlobId}`);
        try { documents.push({ ...doc, content: content.toString("base64"), index: index.toString("base64") }); }
        finally { content.fill(0); index.fill(0); }
      }
      projects.push({ ...project, documents });
    }
    return projects;
  });
}

/** Called only for a fresh staged profile after portable backup validation. */
export function restoreProjectBackup(profileId: string, projects: PortableProject[]): Promise<void> {
  return serializeProfile(profileId, async () => {
    await ensure(profileId); const key = await recoverRotation(profileId);
    const restored: ProjectRecord[] = [];
    for (const project of projects) {
      const documents: StoredDocument[] = [];
      for (const { content, index, ...doc } of project.documents) {
        const blobId = randomUUID(); const indexBlobId = randomUUID();
        const bytes = decodeBackupBytes(content, MAX_PROJECT_DOCUMENT_BYTES);
        const indexBytes = decodeBackupBytes(index, MAX_PROJECT_INDEX_BYTES);
        try {
          await atomic(blobPath(profileId, blobId), encryptVaultBlob(bytes, key, `${profileId}:${blobId}`));
          await atomic(blobPath(profileId, indexBlobId), encryptVaultBlob(indexBytes, key, `${profileId}:${indexBlobId}`));
        } finally { bytes.fill(0); indexBytes.fill(0); }
        documents.push({ ...doc, blobId, indexBlobId });
      }
      restored.push({ ...project, documents });
    }
    await saveDb(profileId, { version: 1, projects: restored });
  });
}
