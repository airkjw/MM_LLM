import { dialog, type BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import type { PickedAttachment } from "../shared/contracts";
import { extractDocx, extractPdf, extractXlsx } from "./document-text";

type Attachment = PickedAttachment & { bytes: Buffer; mime: string };
const attachments = new Map<string, Attachment>();
const MAX_FILE_BYTES = 18 * 1024 * 1024;
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const DOC_EXT = new Set([".pdf", ".docx", ".xlsx"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".mp4", ".wav", ".flac", ".ogg", ".opus", ".aiff"]);

function mimeFor(extension: string): string {
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
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

export async function pickAttachment(
  window: BrowserWindow,
  kinds: Array<"document" | "image" | "audio">
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
  const extension = extname(path).toLowerCase();
  const kind = IMAGE_EXT.has(extension) ? "image" :
    DOC_EXT.has(extension) ? "document" :
      AUDIO_EXT.has(extension) ? "audio" : null;
  if (!kind || !kinds.includes(kind)) throw new Error("지원하지 않는 파일 형식입니다.");
  const bytes = await readFile(path);
  if (bytes.length > MAX_FILE_BYTES) throw new Error("파일은 18MB 이하만 첨부할 수 있습니다.");
  const selected: Attachment = {
    id: randomUUID(),
    name: basename(path),
    kind,
    size: bytes.length,
    mime: mimeFor(extension),
    bytes
  };
  if (attachments.size >= 20) {
    const oldest = attachments.keys().next().value;
    if (oldest) attachments.delete(oldest);
  }
  attachments.set(selected.id, selected);
  const { bytes: _bytes, mime: _mime, ...publicAttachment } = selected;
  return publicAttachment;
}

export function getAttachment(id: string): Attachment {
  const attachment = attachments.get(id);
  if (!attachment) throw new Error("첨부 파일을 다시 선택해 주세요.");
  return attachment;
}

export function discardAttachments(ids: string[]): void {
  for (const id of ids) attachments.delete(id);
}

export function imageDataUrls(ids: string[]): string[] {
  return ids.map((id) => getAttachment(id)).map((attachment) => {
    if (attachment.kind !== "image") throw new Error("이미지 파일만 선택할 수 있습니다.");
    return `data:${attachment.mime};base64,${attachment.bytes.toString("base64")}`;
  });
}

export async function contentForChat(
  text: string,
  ids: string[]
): Promise<{ content: string | Array<Record<string, unknown>>; names: string[] }> {
  const selected = ids.map(getAttachment);
  const documents: string[] = [];
  const images: string[] = [];
  for (const attachment of selected) {
    if (attachment.kind === "audio") throw new Error("채팅에는 오디오 파일을 첨부할 수 없습니다. 오디오 탭에서 받아쓰기를 사용해 주세요.");
    if (attachment.kind === "image") {
      images.push(`data:${attachment.mime};base64,${attachment.bytes.toString("base64")}`);
      continue;
    }
    const extension = extname(attachment.name).toLowerCase();
    const extracted = extension === ".pdf"
      ? await extractPdf(attachment.bytes)
      : extension === ".docx"
        ? await extractDocx(attachment.bytes)
        : await extractXlsx(attachment.bytes);
    if (!extracted.trim()) throw new Error(`${attachment.name}: 읽을 수 있는 텍스트가 없습니다.`);
    documents.push(`[첨부 문서: ${attachment.name}]\n${extracted.slice(0, 160_000)}\n[/첨부 문서]`);
  }
  const textContent = [text, ...documents].filter(Boolean).join("\n\n");
  const content = images.length
    ? [
      { type: "text", text: textContent || "첨부 이미지를 분석해 주세요." },
      ...images.map((url) => ({ type: "image_url", image_url: { url } }))
    ]
    : textContent;
  return { content, names: selected.map((item) => item.name) };
}
