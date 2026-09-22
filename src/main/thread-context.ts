import type { InternalMessage } from "./storage";

const MAX_CHUNK_CHARS = 6_000;
const CHUNK_OVERLAP = 500;

export function chunkDocument(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + maxChars);
    if (end < normalized.length) {
      const boundary = Math.max(normalized.lastIndexOf("\n", end), normalized.lastIndexOf(". ", end));
      if (boundary > start + Math.floor(maxChars * .55)) end = boundary + 1;
    }
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks.filter(Boolean);
}

function terms(value: string): Set<string> {
  return new Set((value.toLowerCase().match(/[가-힣]{2,}|[a-z0-9]{3,}/g) ?? [])
    .filter((term) => !["그리고", "하지만", "대한", "관련", "what", "that", "with", "from"].includes(term)));
}

function scoreChunk(chunk: string, queryTerms: Set<string>, newest: boolean, index: number): number {
  const lower = chunk.toLowerCase();
  let score = newest ? 2 : 0;
  for (const term of queryTerms) {
    const count = lower.split(term).length - 1;
    score += Math.min(12, count * 4);
  }
  if (index === 0) score += 1;
  return score;
}

/** Builds bounded cross-provider context while original chunks remain encrypted on this device. */
export function buildChatContext(
  messages: InternalMessage[], query: string, maxChars = 70_000
): Array<{ role: "user" | "assistant" | "tool"; content: string | Array<Record<string, unknown>>;
  tool_call_id?: string; tool_calls?: Array<Record<string, unknown>> }> {
  let selectedMessages = messages;
  const conversationChars = messages.reduce((total, message) => total + message.text.length, 0);
  if (conversationChars > 100_000 && messages.length > 6) {
    const kept: InternalMessage[] = []; let usedConversation = 0;
    for (let index = messages.length - 1; index >= 0 && usedConversation < 85_000; index--) {
      kept.unshift(messages[index]); usedConversation += messages[index].text.length;
    }
    const first = messages.find((message) => message.role === "user");
    if (first && !kept.some((message) => message.id === first.id)) kept.unshift(first);
    selectedMessages = kept;
  }
  const compressed = selectedMessages.length < messages.length;
  const base: Array<{ role: "user" | "assistant" | "tool"; content: string | Array<Record<string, unknown>>;
    tool_call_id?: string; tool_calls?: Array<Record<string, unknown>>;
    claudeContinuation?: Array<Record<string, unknown>> }> =
    selectedMessages.flatMap((message, index): Array<{ role: "user" | "assistant" | "tool";
      content: string | Array<Record<string, unknown>>; tool_call_id?: string;
      tool_calls?: Array<Record<string, unknown>>; claudeContinuation?: Array<Record<string, unknown>> }> => {
      const results = message.manualToolResults ?? (message.manualToolResult ? [message.manualToolResult] : []);
      if (results.length) return results.map((result) => ({ role: "tool" as const, content: result.result,
        tool_call_id: result.toolCallId }));
      return [{ role: message.role,
      content: index === 0 && compressed
        ? `[긴 대화 안내: 오래된 일부 대화는 전송 크기 제한으로 제외되었습니다. 정확한 세부사항이 필요하면 원문을 다시 첨부하거나 인용해 주세요.]\n\n${message.text}`
        : message.text,
      ...(message.claudeContinuation ? { claudeContinuation: message.claudeContinuation } : {}),
      ...(message.role === "assistant" && message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({
        id: call.id, type: "function", function: { name: call.name, arguments: call.arguments }
      })) } : {}) }];
    });
  const latestUserIndex = messages.findLastIndex((message) => message.role === "user");
  if (latestUserIndex < 0) return base;
  const queryTerms = terms(query);
  const candidates: Array<{ score: number; label: string; text: string }> = [];
  const images: Array<{ dataUrl: string; newest: boolean }> = [];
  const rawPdfs: Array<{ name: string; data: string; newest: boolean }> = [];
  messages.forEach((message, messageIndex) => {
    for (const attachment of message.attachmentContext ?? []) {
      const newest = messageIndex === latestUserIndex;
      if (attachment.kind === "document") {
        const needsNativePdf = (attachment.chunks ?? []).some((chunk) =>
          /OCR로 읽히지|선택 가능한 텍스트가 없는 PDF/.test(chunk));
        if (attachment.rawPdfBase64 && needsNativePdf) {
          rawPdfs.push({ name: attachment.name, data: attachment.rawPdfBase64, newest });
        }
        (attachment.chunks ?? []).forEach((chunk, index) => candidates.push({
          score: scoreChunk(chunk, queryTerms, newest, index), label: attachment.name, text: chunk
        }));
      } else if (attachment.dataUrl) images.push({ dataUrl: attachment.dataUrl, newest });
    }
  });
  const selected: string[] = [];
  const selectedLabels = new Set<string>();
  // Try the complete extracted text first. A small document must not lose its
  // later sections to a per-document preview or relevance ranking.
  const completeBlocks: string[] = [];
  let completeSize = 0;
  for (const item of candidates) {
    const block = `[첨부 문서 관련 원문: ${item.label}]\n${item.text}\n[/첨부 문서 관련 원문]`;
    completeSize += block.length + (completeBlocks.length ? 2 : 0);
    if (completeSize > maxChars) break;
    completeBlocks.push(block);
  }
  if (completeSize <= maxChars) {
    selected.push(...completeBlocks);
    for (const item of candidates) selectedLabels.add(item.label);
  } else {
    // Only use balanced, explicitly marked excerpts when all documents together
    // exceed the context budget. Original chunks stay in encrypted local storage.
    candidates.sort((a, b) => b.score - a.score);
    const selectedKeys = new Set<string>();
    let used = 0;
    const bestMap = new Map<string, typeof candidates[number]>();
    for (const candidate of candidates) if (!bestMap.has(candidate.label)) bestMap.set(candidate.label, candidate);
    const bestByDocument = [...bestMap.values()];
    const ordered = [...bestByDocument, ...candidates];
    for (const item of ordered) {
      const key = `${item.label}\0${item.text}`;
      if (selectedKeys.has(key)) continue;
      const firstForDocument = !selectedLabels.has(item.label);
      const perDocument = firstForDocument
        ? Math.max(200, Math.min(1_500, Math.floor(maxChars / Math.max(1, bestByDocument.length)) - 100))
        : item.text.length;
      const excerpt = item.text.slice(0, perDocument);
      const block = `[첨부 문서 관련 원문: ${item.label}]\n${excerpt}${excerpt.length < item.text.length ? "\n[문서 발췌 압축됨]" : ""}\n[/첨부 문서 관련 원문]`;
      if (used + block.length > maxChars) {
        if (firstForDocument) throw new Error("첨부 문서가 너무 많아 모두 포함할 수 없습니다. 문서를 나누어 질문해 주세요.");
        continue;
      }
      if (!firstForDocument && item.score <= 2) continue;
      selected.push(block);
      selectedLabels.add(item.label);
      selectedKeys.add(key);
      used += block.length;
      if (selectedLabels.size >= bestByDocument.length && selected.length >= bestByDocument.length + 12) break;
    }
  }
  const asksForImage = /이미지|사진|그림|도표|차트|첨부.*(봐|분석)|image|photo|figure|chart/i.test(query);
  const newestImages = images.filter((item) => item.newest);
  const historicImages = asksForImage ? images.filter((item) => !item.newest).slice(-2) : [];
  const selectedImages = [...historicImages, ...newestImages];
  if (selectedImages.length > 4) {
    throw new Error("한 번의 질문에는 이미지를 최대 4개까지 전송할 수 있습니다. 이미지를 나누어 질문해 주세요.");
  }
  const imageChars = selectedImages.reduce((total, item) => total + item.dataUrl.length, 0);
  if (imageChars > 16 * 1024 * 1024) {
    throw new Error("첨부 이미지 전체 크기가 전송 한도를 넘습니다. 이미지 수나 해상도를 줄여 다시 시도해 주세요.");
  }
  const omittedDocuments = [...new Set(candidates.map((item) => item.label))]
    .filter((name) => !selectedLabels.has(name));
  const notice = omittedDocuments.length
    ? `\n\n[첨부 문서 범위 안내: 전송 한도로 다음 문서는 이번 질문에 포함되지 않았습니다: ${omittedDocuments.join(", ")}. 문서를 나누어 질문해 주세요.]`
    : "";
  const addition = selected.length ? `\n\n${selected.join("\n\n")}${notice}` : notice;
  const baseLatestUserIndex = base.findLastIndex((message) => message.role === "user");
  if (baseLatestUserIndex < 0) return base;
  const current = base[baseLatestUserIndex].content;
  const text = `${typeof current === "string" ? current : query}${addition}`;
  if (rawPdfs.length > 2) {
    throw new Error(`텍스트를 읽을 수 없는 PDF는 한 대화 요청에 최대 2개까지 Claude 원문 분석으로 보낼 수 있습니다. 나누어 질문해 주세요: ${rawPdfs.map((item) => item.name).join(", ")}`);
  }
  // OCR이 불가능한 PDF는 최초 질문뿐 아니라 후속 턴에도 명시적으로 다시 보냅니다.
  const selectedPdfs = rawPdfs;
  const binaryChars = imageChars + selectedPdfs.reduce((total, item) => total + item.data.length, 0);
  if (binaryChars > 21 * 1024 * 1024) {
    throw new Error("Claude 네이티브 이미지·PDF의 직렬화 크기가 22MB 안전 한도를 넘습니다.");
  }
  base[baseLatestUserIndex].content = selectedImages.length || selectedPdfs.length
    ? [{ type: "text", text }, ...selectedImages.map((image) => ({
      type: "image_url", image_url: { url: image.dataUrl }
    })), ...selectedPdfs.map((pdf) => ({ type: "document", title: pdf.name,
      source: { type: "base64", media_type: "application/pdf", data: pdf.data },
      cache_control: { type: "ephemeral" } }))] : text;
  return base;
}
