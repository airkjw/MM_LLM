import type { AppSettings, ProjectSummary } from "./contracts";

export type PortableProject = Omit<ProjectSummary, "threadCount" | "documents"> & {
  documents: Array<ProjectSummary["documents"][number] & { content: string; index: string }>;
};
export type PortableBackup = {
  version: 1;
  createdAt: string;
  threads: unknown[];
  settings: AppSettings;
  projects: PortableProject[];
};

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max;
const timestamp = (value: unknown) => text(value, 40) && Number.isFinite(Date.parse(value as string));
export function decodeBackupBytes(value: unknown, limit: number): Buffer {
  if (typeof value !== "string" || value.length > Math.ceil(limit / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("백업 문서 데이터가 올바르지 않습니다.");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > limit || bytes.toString("base64") !== value) throw new Error("백업 문서 크기 또는 인코딩이 올바르지 않습니다.");
  return bytes;
}

export function validateBackup(value: unknown): PortableBackup {
  if (!record(value) || value.version !== 1 || !timestamp(value.createdAt) || !Array.isArray(value.threads) ||
    value.threads.length > 500 || !record(value.settings) || !Array.isArray(value.projects) || value.projects.length > 50 ||
    Object.keys(value).some((key) => !["version", "createdAt", "threads", "settings", "projects"].includes(key))) {
    throw new Error("지원하지 않거나 손상된 백업 구조입니다.");
  }
  if (!text(value.settings.defaultInstruction, 12000) || !["system", "light", "dark"].includes(String(value.settings.theme)) ||
    !["small", "medium", "large"].includes(String(value.settings.fontSize))) throw new Error("백업 설정이 올바르지 않습니다.");
  const ids = new Set<string>();
  for (const project of value.projects) {
    if (!record(project) || !uuid(project.id) || ids.has(project.id as string) || !text(project.name, 80) ||
      !text(project.instruction, 12000) || !timestamp(project.createdAt) || !timestamp(project.updatedAt) ||
      !Array.isArray(project.documents) || project.documents.length > 20) throw new Error("백업 프로젝트가 올바르지 않습니다.");
    ids.add(project.id as string); let total = 0; const documentIds = new Set<string>();
    for (const doc of project.documents) {
      if (!record(doc) || !uuid(doc.id) || documentIds.has(doc.id as string) || !text(doc.name, 255) ||
        !text(doc.mime, 150) || !timestamp(doc.createdAt)) throw new Error("백업 문서 정보가 올바르지 않습니다.");
      documentIds.add(doc.id as string);
      const bytes = decodeBackupBytes(doc.content, 18 * 1024 * 1024);
      if (doc.size !== bytes.length) throw new Error("백업 문서 크기가 일치하지 않습니다.");
      total += bytes.length;
      if (total > 64 * 1024 * 1024) throw new Error("백업 프로젝트가 64MB 한도를 넘었습니다.");
      const indexBytes = decodeBackupBytes(doc.index, 6 * 1024 * 1024);
      const index = JSON.parse(indexBytes.toString("utf8"));
      if (!Array.isArray(index) || index.some((chunk) => typeof chunk !== "string")) throw new Error("백업 문서 검색 데이터가 올바르지 않습니다.");
    }
  }
  const threadIds = new Set<string>();
  for (const thread of value.threads) {
    if (!record(thread) || !text(thread.id, 100) || threadIds.has(thread.id as string) || !Array.isArray(thread.messages) ||
      thread.messages.length > 10000 || thread.projectId !== undefined && !ids.has(String(thread.projectId))) {
      throw new Error("백업 대화 또는 프로젝트 연결이 올바르지 않습니다.");
    }
    threadIds.add(thread.id as string);
  }
  return value as unknown as PortableBackup;
}
