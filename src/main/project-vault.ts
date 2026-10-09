import { app, safeStorage } from "electron";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, open, readdir, rm, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { decodeBackupBytes, type PortableProject } from "../shared/backup-format";
import type { ProjectDocument, ProjectSummary } from "../shared/contracts";
import { writeAtomic } from "./atomic-file";
import { extractDocx, extractPdf, extractXlsx } from "./document-text";
import { createVaultKey, decryptVaultBlob, encryptVaultBlob, type VaultKey } from "./project-vault-crypto";
import { chunkDocument } from "./thread-context";
import { chunkKey, LOCAL_RETRIEVAL, MAX_SEMANTIC_INDEX_BYTES, validateRetrievalSettings, validateSemanticIndex,
  type RetrievalChunk, type RetrievalSettings, type SemanticIndex } from "../shared/document-retrieval";

export const MAX_PROJECT_DOCUMENT_BYTES = 18 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
export const MAX_PROJECT_DOCUMENTS = 20;
export const MAX_PROJECTS = 50;
export const MAX_PROJECT_METADATA_BYTES = 1024 * 1024;
export const MAX_PROJECT_INDEX_BYTES = 6 * 1024 * 1024;
export const MAX_PROJECT_RAW_PDF_BYTES = 14 * 1024 * 1024;
export { MAX_SEMANTIC_INDEX_BYTES };
const SEMANTIC_LIMIT_LABEL = `${MAX_SEMANTIC_INDEX_BYTES / 1024 / 1024}MB`;

type StoredDocument = ProjectDocument & { blobId: string; indexBlobId: string; sourceHash?: string };
type ProjectRecord = Omit<ProjectSummary, "threadCount" | "documents"> & { documents: StoredDocument[]; semanticBlobId?: string };
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

function publicProject(project: ProjectRecord, threadCount = 0): ProjectSummary {
  return { id: project.id, name: project.name, instruction: project.instruction,
    documents: project.documents.map(({ blobId: _b, indexBlobId: _i, sourceHash: _h, ...doc }) => doc),
    retrieval: project.retrieval, threadCount, createdAt: project.createdAt, updatedAt: project.updatedAt };
}
async function listProjectsUnlocked(profileId: string, threadCounts: Map<string, number> = new Map()): Promise<ProjectSummary[]> {
  await sweepProjectOrphansUnlocked(profileId);
  return (await db(profileId)).projects.map((project) => publicProject(project, threadCounts.get(project.id) ?? 0));
}

async function createProjectUnlocked(profileId: string, name: string, instruction = ""): Promise<ProjectSummary> {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
  if (!cleaned) throw new Error("프로젝트 이름을 입력해 주세요.");
  const value = await db(profileId); const now = new Date().toISOString();
  if (value.projects.length >= MAX_PROJECTS) throw new Error(`프로젝트는 프로필당 최대 ${MAX_PROJECTS}개까지 만들 수 있습니다.`);
  const project: ProjectRecord = { id: randomUUID(), name: cleaned, instruction: instruction.trim().slice(0, 12_000),
    documents: [], createdAt: now, updatedAt: now };
  value.projects.unshift(project); await saveDb(profileId, value);
  return publicProject(project);
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
  return publicProject(project);
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
    mime: input.mime, size: input.bytes.length, createdAt: now, sourceHash: createHash("sha256").update(input.bytes).digest("hex") };
  try { project.documents.push(document); project.updatedAt = now; await saveDb(profileId, value); }
  catch (error) { await Promise.all([blobId, indexBlobId].map((id) => unlink(blobPath(profileId, id)).catch(() => undefined))); throw error; }
  return publicProject(project);
}

async function removeProjectDocumentUnlocked(profileId: string, projectId: string, documentId: string): Promise<void> {
  safeId(projectId, "프로젝트"); safeId(documentId, "문서"); const value = await db(profileId);
  const project = value.projects.find((item) => item.id === projectId); if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  const document = project.documents.find((item) => item.id === documentId); if (!document) throw new Error("프로젝트 문서를 찾을 수 없습니다.");
  project.documents = project.documents.filter((item) => item.id !== documentId); project.updatedAt = new Date().toISOString();
  const semanticBlobId = project.semanticBlobId;
  const pruned = semanticBlobId ? await pruneSemanticIndexUnlocked(profileId, semanticBlobId, documentId) : "kept";
  if (pruned !== "kept") {
    delete project.semanticBlobId;
    // An unreadable or unwritable index loses every vector: keep the chosen mode and ask for an explicit rebuild.
    if (pruned === "failed" && project.retrieval?.mode === "semantic") project.retrieval.rebuildRequired = true;
  }
  await saveDb(profileId, value);
  if (pruned !== "kept") await unlink(blobPath(profileId, semanticBlobId!)).catch(() => undefined);
  for (const blobId of [document.blobId, document.indexBlobId]) {
    const refs = value.projects.flatMap((item) => item.documents)
      .filter((item) => item.blobId === blobId || item.indexBlobId === blobId).length;
    if (!refs) await unlink(blobPath(profileId, blobId)).catch(() => undefined);
  }
}

/** Rewrites the semantic index without one document's vectors under the same blob id (new blob before metadata). */
async function pruneSemanticIndexUnlocked(profileId: string, blobId: string, documentId: string): Promise<"kept" | "empty" | "failed"> {
  try {
    const key = await recoverRotation(profileId); const aad = `${profileId}:${blobId}`;
    const plain = decryptVaultBlob(await readEncryptedBlob(profileId, blobId), [key], aad);
    let index: SemanticIndex;
    try { if (plain.length > MAX_SEMANTIC_INDEX_BYTES) throw new Error("의미 색인 저장 한도를 넘었습니다."); index = validateSemanticIndex(JSON.parse(plain.toString("utf8"))); }
    finally { plain.fill(0); }
    index.chunks = index.chunks.filter((chunk) => chunk.documentId !== documentId);
    // Other documents' unconfirmed (possibly billed) chunks keep the explicit resume consent requirement.
    index.uncertain = index.uncertain.filter((entry) => !entry.startsWith(`${documentId}:`));
    if (!index.chunks.length && !index.uncertain.length) return "empty";
    index.updatedAt = new Date().toISOString(); const bytes = Buffer.from(JSON.stringify(index), "utf8");
    try { await atomic(blobPath(profileId, blobId), encryptVaultBlob(bytes, key, aad)); } finally { bytes.fill(0); }
    return "kept";
  } catch { return "failed"; }
}

async function deleteProjectUnlocked(profileId: string, projectId: string): Promise<void> {
  safeId(projectId, "프로젝트"); const value = await db(profileId);
  if (!value.projects.some((item) => item.id === projectId)) { await sweepProjectOrphansUnlocked(profileId); return; }
  value.projects = value.projects.filter((item) => item.id !== projectId); await saveDb(profileId, value);
  await sweepProjectOrphansUnlocked(profileId);
}

async function sweepProjectOrphansUnlocked(profileId: string): Promise<void> {
  await ensure(profileId); const value = await db(profileId);
  const referenced = new Set(value.projects.flatMap((project) => [
    ...(project.semanticBlobId ? [`${project.semanticBlobId}.blob`] : []),
    ...project.documents.flatMap((doc) => [`${doc.blobId}.blob`, `${doc.indexBlobId}.blob`])]));
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
      for (const { blobId, indexBlobId, sourceHash: _hash, ...doc } of project.documents) {
        const content = decryptVaultBlob(await readEncryptedBlob(profileId, blobId), keys, `${profileId}:${blobId}`);
        const index = decryptVaultBlob(await readEncryptedBlob(profileId, indexBlobId), keys, `${profileId}:${indexBlobId}`);
        try { documents.push({ ...doc, content: content.toString("base64"), index: index.toString("base64") }); }
        finally { content.fill(0); index.fill(0); }
      }
      projects.push({ id: project.id, name: project.name, instruction: project.instruction, createdAt: project.createdAt, updatedAt: project.updatedAt, documents,
        retrieval: project.retrieval?.mode === "semantic" || project.retrieval?.rebuildRequired ? { ...LOCAL_RETRIEVAL, rebuildRequired: true } : undefined });
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
        const sourceHash = createHash("sha256").update(bytes).digest("hex");
        try {
          await atomic(blobPath(profileId, blobId), encryptVaultBlob(bytes, key, `${profileId}:${blobId}`));
          await atomic(blobPath(profileId, indexBlobId), encryptVaultBlob(indexBytes, key, `${profileId}:${indexBlobId}`));
        } finally { bytes.fill(0); indexBytes.fill(0); }
        documents.push({ id: doc.id, name: doc.name, mime: doc.mime, size: doc.size, createdAt: doc.createdAt, blobId, indexBlobId, sourceHash });
      }
      restored.push({ id: project.id, name: project.name, instruction: project.instruction, createdAt: project.createdAt, updatedAt: project.updatedAt, documents,
        retrieval: project.retrieval?.rebuildRequired ? { ...LOCAL_RETRIEVAL, rebuildRequired: true } : undefined });
    }
    await saveDb(profileId, { version: 1, projects: restored });
  });
}

/** `fingerprint` identifies the immutable document set; equal fingerprints imply equal chunk keys. */
export type RetrievalSnapshot = { settings: RetrievalSettings; chunks: RetrievalChunk[]; index: SemanticIndex | null; fingerprint: string };
const documentsFingerprint = (project: ProjectRecord) =>
  project.documents.map((doc) => `${doc.id}:${doc.sourceHash}:${doc.indexBlobId}`).sort().join("|");
async function retrievalSnapshotUnlocked(profileId: string, projectId: string): Promise<RetrievalSnapshot> {
  safeId(projectId, "프로젝트"); const value = await db(profileId);
  const project = value.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  const keys = (await loadKeyring(profileId)).keys; const chunks: RetrievalChunk[] = []; let backfilled = false;
  for (const document of project.documents) {
    const plain = decryptVaultBlob(await readEncryptedBlob(profileId, document.indexBlobId), keys, `${profileId}:${document.indexBlobId}`);
    let parsed: unknown;
    try { if (plain.length > MAX_PROJECT_INDEX_BYTES) throw new Error("문서 텍스트 한도를 넘었습니다."); parsed = JSON.parse(plain.toString("utf8")); }
    finally { plain.fill(0); }
    if (!Array.isArray(parsed) || parsed.some((text) => typeof text !== "string" || text.length > 6000)) throw new Error("문서 청크 형식이 올바르지 않습니다.");
    let sourceHash = document.sourceHash;
    if (!sourceHash) {
      const source = decryptVaultBlob(await readEncryptedBlob(profileId, document.blobId), keys, `${profileId}:${document.blobId}`);
      try { sourceHash = createHash("sha256").update(source).digest("hex"); } finally { source.fill(0); }
      document.sourceHash = sourceHash; backfilled = true;
    }
    let start = 0; let previous = "";
    (parsed as string[]).forEach((text, position) => {
      if (!text.trim() || /OCR로 읽히지|선택 가능한 텍스트가 없는 PDF/.test(text)) return;
      let overlap = Math.min(500, previous.length, text.length);
      while (overlap > 0 && !previous.endsWith(text.slice(0, overlap))) overlap--;
      start -= overlap;
      chunks.push({ documentId: document.id, name: document.name, sourceHash: sourceHash!, position, start, end: start + text.length, text });
      start += text.length; previous = text;
    });
  }
  // Records restored by older builds lack sourceHash: persist it once so later snapshots never decrypt originals.
  if (backfilled) await saveDb(profileId, value);
  let index: SemanticIndex | null = null;
  if (project.semanticBlobId) {
    const plain = decryptVaultBlob(await readEncryptedBlob(profileId, project.semanticBlobId), keys, `${profileId}:${project.semanticBlobId}`);
    try { if (plain.length > MAX_SEMANTIC_INDEX_BYTES) throw new Error(`의미 색인이 ${SEMANTIC_LIMIT_LABEL} 저장 한도를 넘었습니다.`); index = validateSemanticIndex(JSON.parse(plain.toString("utf8"))); }
    finally { plain.fill(0); }
  }
  const current = new Map(chunks.map((chunk) => [chunkKey(chunk), chunk]));
  if (index) {
    index.chunks = index.chunks.filter((chunk) => { const source = current.get(chunkKey(chunk)); return source && source.start === chunk.start && source.end === chunk.end; });
    index.uncertain = index.uncertain.filter((key) => current.has(key));
  }
  return { settings: project.retrieval ? validateRetrievalSettings(project.retrieval) : { ...LOCAL_RETRIEVAL }, chunks, index,
    fingerprint: documentsFingerprint(project) };
}
export const retrievalSnapshot = (profileId: string, projectId: string) =>
  serializeProfile(profileId, () => retrievalSnapshotUnlocked(profileId, projectId));

/**
 * Short disk-only critical sections: no network or job wait under this queue. The job's starting snapshot is the one
 * full decryption check; each save only compares the metadata fingerprint and the snapshot's chunk keys.
 */
export function saveSemanticIndex(profileId: string, projectId: string, index: SemanticIndex, signal: AbortSignal,
  expected: { fingerprint: string; chunkKeys: string[] }): Promise<RetrievalSettings> {
  return serializeProfile(profileId, async () => {
    signal.throwIfAborted(); validateSemanticIndex(index); safeId(projectId, "프로젝트");
    const value = await db(profileId); const project = value.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    const settings = project.retrieval ? validateRetrievalSettings(project.retrieval) : { ...LOCAL_RETRIEVAL };
    if (settings.mode !== "semantic" || settings.embeddingModelId !== index.modelId) throw new Error("검색 모델이 변경되어 재색인이 필요합니다.");
    const currentKeys = new Set(expected.chunkKeys);
    if (documentsFingerprint(project) !== expected.fingerprint || index.chunks.some((chunk) => !currentKeys.has(chunkKey(chunk))) ||
      index.uncertain.some((key) => !currentKeys.has(key))) throw new Error("문서가 변경되어 오래된 색인을 폐기했습니다.");
    const bytes = Buffer.from(JSON.stringify(index), "utf8");
    try {
      if (bytes.length > MAX_SEMANTIC_INDEX_BYTES) throw new Error(`의미 색인이 ${SEMANTIC_LIMIT_LABEL} 저장 한도를 넘었습니다.`);
      const blobId = project.semanticBlobId ?? randomUUID(); const key = await recoverRotation(profileId);
      signal.throwIfAborted();
      await atomic(blobPath(profileId, blobId), encryptVaultBlob(bytes, key, `${profileId}:${blobId}`));
      project.semanticBlobId = blobId;
      const indexed = new Set(index.chunks.map(chunkKey));
      if (expected.chunkKeys.every((key) => indexed.has(key))) project.retrieval!.rebuildRequired = false;
      await saveDb(profileId, value);
      return validateRetrievalSettings(project.retrieval);
    } finally { bytes.fill(0); }
  });
}
export function configureRetrieval(profileId: string, projectId: string, settings: RetrievalSettings): Promise<void> {
  return serializeProfile(profileId, async () => {
    validateRetrievalSettings(settings); safeId(projectId, "프로젝트"); const value = await db(profileId);
    const project = value.projects.find((item) => item.id === projectId); if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    const remove = settings.mode === "local" || project.retrieval?.embeddingModelId !== settings.embeddingModelId;
    const previous = remove ? project.semanticBlobId : undefined;
    if (remove) delete project.semanticBlobId;
    project.retrieval = settings; await saveDb(profileId, value);
    if (previous) await unlink(blobPath(profileId, previous)).catch(() => undefined);
  });
}
export function clearProfileRetrieval(profileId: string): Promise<void> {
  return serializeProfile(profileId, async () => {
    const value = await db(profileId); const blobs: string[] = [];
    for (const project of value.projects) {
      if (project.semanticBlobId) blobs.push(project.semanticBlobId);
      const rebuildRequired = Boolean(project.semanticBlobId || project.retrieval?.mode === "semantic" || project.retrieval?.rebuildRequired);
      delete project.semanticBlobId; project.retrieval = { ...LOCAL_RETRIEVAL, rebuildRequired };
    }
    await saveDb(profileId, value);
    for (const blob of blobs) await unlink(blobPath(profileId, blob)).catch(() => undefined);
  });
}
