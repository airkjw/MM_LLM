export const CHATBOT_FILE_ORIGIN = "https://factchat-cloud.mindlogic.ai";
export const MAX_CHATBOT_FILE_BYTES = 50 * 1024 * 1024;
export type ChatbotFileType = { mime: string; extension: string; kind: "image" | "audio" | "video" | "document" };

export function detectChatbotDocument(bytes: Uint8Array, declared: string): ChatbotFileType | undefined {
  const header = Buffer.from(bytes.subarray(0, 64)); const lower = header.toString("utf8").trimStart().toLowerCase();
  if (declared === "application/pdf" && header.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    return { mime: declared, extension: "pdf", kind: "document" };
  }
  const office: Record<string, string> = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx"
  };
  if (office[declared] && header.subarray(0, 2).equals(Buffer.from("PK"))) {
    return { mime: declared, extension: office[declared], kind: "document" };
  }
  if (["text/plain", "text/csv"].includes(declared) && !header.includes(0) &&
    !lower.startsWith("<html") && !lower.startsWith("<!doctype") && !lower.startsWith("<svg")) {
    return { mime: declared, extension: declared === "text/csv" ? "csv" : "txt", kind: "document" };
  }
  return undefined;
}

function signedExpiry(url: URL): number | undefined {
  const compactExpiry = url.searchParams.get("e");
  if (compactExpiry && /^\d{10,13}$/.test(compactExpiry)) {
    const epoch = Number(compactExpiry); return compactExpiry.length <= 10 ? epoch * 1_000 : epoch;
  }
  const direct = url.searchParams.get("expires_at") ?? url.searchParams.get("expires");
  if (direct) {
    const numeric = Number(direct);
    if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1_000;
    const parsed = Date.parse(direct); if (Number.isFinite(parsed)) return parsed;
  }
  const signedAt = url.searchParams.get("X-Amz-Date") ?? url.searchParams.get("x-amz-date");
  const lifetime = Number(url.searchParams.get("X-Amz-Expires") ?? url.searchParams.get("x-amz-expires"));
  if (signedAt && /^\d{8}T\d{6}Z$/.test(signedAt) && Number.isFinite(lifetime)) {
    const iso = `${signedAt.slice(0, 4)}-${signedAt.slice(4, 6)}-${signedAt.slice(6, 8)}T${signedAt.slice(9, 11)}:${signedAt.slice(11, 13)}:${signedAt.slice(13, 15)}Z`;
    const start = Date.parse(iso); if (Number.isFinite(start)) return start + Math.max(0, lifetime) * 1_000;
  }
  return undefined;
}

export function redactChatbotPublicUrls(value: string): string {
  return value.replace(/https:\/\/factchat-cloud\.mindlogic\.ai\/v1\/public\/f\/[^\s<>()\]]+/gi,
    "[챗봇 첨부 파일은 아래의 안전한 다운로드 버튼을 사용하세요]");
}

/** Buffers split SSE deltas so a signed URL can never escape across chunk boundaries. */
export class BufferedChatbotTextSanitizer {
  private value = "";
  push(delta: string): void { this.value += delta; }
  flush(): string {
    const safe = redactChatbotPublicUrls(this.value); this.value = ""; return safe;
  }
}

export function validateChatbotFileUrl(value: string, now = Date.now()): { url: URL; signedExpiresAt?: number } {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("챗봇 파일 주소가 올바르지 않습니다."); }
  if (url.origin !== CHATBOT_FILE_ORIGIN || url.username || url.password || url.port ||
    !url.pathname.startsWith("/v1/public/f/") || url.pathname.length > 2_000) {
    throw new Error("허용되지 않은 챗봇 파일 주소입니다.");
  }
  const expiresAt = signedExpiry(url);
  if (expiresAt !== undefined && expiresAt <= now) throw new Error("챗봇 파일 주소가 만료되었습니다.");
  return { url, ...(expiresAt !== undefined ? { signedExpiresAt: expiresAt } : {}) };
}

export function chatbotFileExpiry(expiresIn: unknown, signedExpiresAt: number | undefined, now = Date.now()): number {
  const seconds = typeof expiresIn === "number" && Number.isFinite(expiresIn)
    ? Math.max(1, Math.min(86_400, Math.floor(expiresIn))) : 3_600;
  return Math.min(now + seconds * 1_000, signedExpiresAt ?? Number.POSITIVE_INFINITY);
}
