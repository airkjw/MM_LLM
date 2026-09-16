import { dialog, type BrowserWindow } from "electron";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import type { PickedAttachment } from "../shared/contracts";
import type { AttachmentContext } from "./storage";
import { extractDocx, extractPdf, extractXlsx } from "./document-text";
import { chunkDocument } from "./thread-context";
import { clearSensitiveEntries, deleteSensitiveEntry, sweepSensitiveEntries, wipeBuffer } from "./sensitive-cache";

export type Attachment = PickedAttachment & { bytes: Buffer; mime: string; touchedAt: number };
type AttachmentKind = PickedAttachment["kind"];
const attachments = new Map<string, Attachment>();
export const MAX_FILE_BYTES = 18 * 1024 * 1024;
export const MAX_ATTACHMENT_CACHE_BYTES = 64 * 1024 * 1024;
export const ATTACHMENT_TTL_MS = 60 * 60_000;
const ATTACHMENT_SWEEP_INTERVAL_MS = 5 * 60_000;
let sweepTimer: NodeJS.Timeout | null = null;
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const DOC_EXT = new Set([".pdf", ".docx", ".xlsx"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".mp4", ".wav", ".flac", ".ogg", ".opus", ".aiff"]);

function mimeFor(extension: string): string {
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".aiff": "audio/aiff"
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}

function attachmentKind(name: string): AttachmentKind | null {
  const extension = extname(name).toLowerCase();
  return IMAGE_EXT.has(extension) ? "image" :
    DOC_EXT.has(extension) ? "document" :
      AUDIO_EXT.has(extension) ? "audio" : null;
}

function prepareAttachment(name: string, bytes: Buffer, kinds: AttachmentKind[]): Attachment {
  const safeName = basename(name);
  const kind = attachmentKind(safeName);
  if (!safeName || safeName.length > 255 || !kind || !kinds.includes(kind)) {
    throw new Error(`${safeName || "파일"}: 지원하지 않는 파일 형식입니다.`);
  }
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`${safeName}: 파일은 18MB 이하만 첨부할 수 있습니다.`);
  const extension = extname(safeName).toLowerCase();
  if (extension === ".pdf" && !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error(`${safeName}: 실제 PDF 파일 형식이 아닙니다.`);
  }
  if ([".docx", ".xlsx"].includes(extension) && !bytes.subarray(0, 2).equals(Buffer.from("PK"))) {
    throw new Error(`${safeName}: 실제 Office 문서 형식이 아닙니다.`);
  }
  return {
    id: randomUUID(),
    name: safeName,
    kind,
    size: bytes.length,
    mime: mimeFor(extension),
    bytes,
    touchedAt: Date.now()
  };
}

function storeAttachment(selected: Attachment): PickedAttachment {
  sweepAttachments();
  const total = [...attachments.values()].reduce((sum, item) => sum + item.bytes.length, 0);
  if (attachments.size >= 20 || total + selected.bytes.length > MAX_ATTACHMENT_CACHE_BYTES) {
    throw new Error("첨부 대기 파일의 전체 크기 한도를 넘었습니다. 사용하지 않는 첨부를 제거해 주세요.");
  }
  attachments.set(selected.id, selected);
  const { bytes: _bytes, mime: _mime, touchedAt: _touchedAt, ...publicAttachment } = selected;
  return publicAttachment;
}

export async function pickAttachment(
  window: BrowserWindow,
  kinds: AttachmentKind[]
): Promise<PickedAttachment | null> {
  const extensions = [
    ...(kinds.includes("document") ? ["pdf", "docx", "xlsx"] : []),
    ...(kinds.includes("image") ? ["png", "jpg", "jpeg", "webp"] : []),
    ...(kinds.includes("audio") ? ["mp3", "m4a", "mp4", "wav", "flac", "ogg", "opus", "aiff"] : [])
  ];
  const result = await dialog.showOpenDialog(window, {
    properties: ["openFile"],
    filters: [{ name: "지원 파일", extensions }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const path = result.filePaths[0];
  const details = await stat(path);
  if (!details.isFile() || details.size > MAX_FILE_BYTES) throw new Error(`${basename(path)}: 파일은 18MB 이하만 첨부할 수 있습니다.`);
  const bytes = await readFile(path);
  try { return storeAttachment(prepareAttachment(basename(path), bytes, kinds)); }
  catch (error) { wipeBuffer(bytes); throw error; }
}

export function addDroppedAttachments(
  files: Array<{ name: string; bytes: Uint8Array }>,
  kinds: AttachmentKind[]
): PickedAttachment[] {
  if (!files.length || files.length > 14) throw new Error("한 번에 파일을 1개에서 14개까지 첨부할 수 있습니다.");
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (total > MAX_ATTACHMENT_CACHE_BYTES) throw new Error("선택한 파일의 전체 크기가 너무 큽니다.");
  const prepared: Attachment[] = [];
  try {
    for (const file of files) {
      const owned = Buffer.from(file.bytes);
      try { prepared.push(prepareAttachment(file.name, owned, kinds)); }
      catch (error) { wipeBuffer(owned); throw error; }
    }
  } catch (error) {
    prepared.forEach((item) => wipeBuffer(item.bytes));
    throw error;
  }
  sweepAttachments();
  const existingBytes = [...attachments.values()].reduce((sum, item) => sum + item.bytes.length, 0);
  if (attachments.size + prepared.length > 20 || existingBytes + total > MAX_ATTACHMENT_CACHE_BYTES) {
    prepared.forEach((item) => wipeBuffer(item.bytes));
    throw new Error("첨부 대기 파일의 전체 크기 한도를 넘었습니다. 사용하지 않는 첨부를 제거해 주세요.");
  }
  return prepared.map(storeAttachment);
}

export function getAttachment(id: string): Attachment {
  sweepAttachments();
  const attachment = attachments.get(id);
  if (!attachment) throw new Error("첨부 파일을 다시 선택해 주세요.");
  attachment.touchedAt = Date.now();
  return attachment;
}

export function discardAttachments(ids: string[]): void {
  for (const id of ids) deleteSensitiveEntry(attachments, id);
}

export function clearAttachments(): void { clearSensitiveEntries(attachments); }

export function sweepAttachments(now = Date.now()): void {
  sweepSensitiveEntries(attachments, ATTACHMENT_TTL_MS, now);
}

export function startAttachmentSweeper(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepAttachments(), ATTACHMENT_SWEEP_INTERVAL_MS);
  sweepTimer.unref();
}

export function stopAttachmentSweeper(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}

export function imageDataUrls(ids: string[]): string[] {
  return ids.map((id) => getAttachment(id)).map((attachment) => {
    if (attachment.kind !== "image") throw new Error("이미지 파일만 선택할 수 있습니다.");
    return `data:${attachment.mime};base64,${attachment.bytes.toString("base64")}`;
  });
}

export async function contentForChat(
  text: string,
  ids: string[],
  onProgress?: (message: string) => void,
  signal?: AbortSignal
): Promise<{ content: string; names: string[]; attachmentContext: AttachmentContext[] }> {
  const selected = ids.map(getAttachment);
  const attachmentContext: AttachmentContext[] = [];
  for (const attachment of selected) {
    signal?.throwIfAborted();
    if (attachment.kind === "audio") throw new Error("채팅에는 오디오 파일을 첨부할 수 없습니다. 오디오 탭에서 받아쓰기를 사용해 주세요.");
    if (attachment.kind === "image") {
      attachmentContext.push({ kind: "image", name: attachment.name,
        dataUrl: `data:${attachment.mime};base64,${attachment.bytes.toString("base64")}` });
      continue;
    }
    const extension = extname(attachment.name).toLowerCase();
    let extracted = "";
    try {
      extracted = extension === ".pdf"
        ? await extractPdf(attachment.bytes, onProgress, signal)
        : extension === ".docx"
          ? await extractDocx(attachment.bytes)
          : await extractXlsx(attachment.bytes);
    } catch (error) {
      if (extension !== ".pdf" || attachment.bytes.length > 15 * 1024 * 1024) throw error;
      extracted = "[이 PDF는 로컬 OCR로 읽히지 않았습니다. Claude 네이티브 PDF 분석을 사용할 수 있습니다.]";
    }
    if (!extracted.trim() && extension === ".pdf" && attachment.bytes.length <= 15 * 1024 * 1024) {
      extracted = "[선택 가능한 텍스트가 없는 PDF입니다. Claude 네이티브 PDF 분석을 사용할 수 있습니다.]";
    }
    if (!extracted.trim()) throw new Error(`${attachment.name}: 읽을 수 있는 텍스트가 없습니다.`);
    attachmentContext.push({ kind: "document", name: attachment.name, chunks: chunkDocument(extracted),
      ...(extension === ".pdf" && attachment.bytes.length <= 15 * 1024 * 1024
        ? { rawPdfBase64: attachment.bytes.toString("base64") } : {}) });
  }
  return { content: text, names: selected.map((item) => item.name), attachmentContext };
}
