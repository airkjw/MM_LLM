import { sanitizeServerCode, CODE_ARTIFACT_NOTICE } from "./server-code.ts";
import { sanitizeWebSearch, webSearchStatusLabel } from "./search-evidence.ts";
import { unsupportedContinuationMessage, sanitizeUnsupportedContinuationReason } from "./chat-continuation.ts";
import type { ThreadSnapshot } from "./contracts";

function clean(value: string): string {
  return value.replace(/\u0000/g, "").trim();
}

/** Untrusted code output is fenced so it cannot render as headings or quotes; the fence outgrows any backtick run inside. */
function fenced(value: string): string[] {
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [fence, value, fence];
}

export function safeExportFilename(title: string): string {
  const base = clean(title).replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").slice(0, 80) || "MM_LLM 대화";
  return `${base}.md`;
}

/** Serializes only public message fields. API payloads, base64 data and hidden context are never accepted here. */
export function serializeThreadMarkdown(thread: ThreadSnapshot): string {
  const lines = [
    `# ${clean(thread.title) || "MM_LLM 대화"}`,
    "",
    `- 모델: ${clean(thread.modelId)}`,
    `- 생성: ${thread.createdAt}`,
    `- 수정: ${thread.updatedAt}`,
    ""
  ];
  if (thread.instruction) lines.push("## 대화 지침", "", clean(thread.instruction), "");
  lines.push("## 대화", "");
  for (const message of thread.messages) {
    lines.push(`### ${message.role === "user" ? "사용자" : "MM_LLM"}`, "", clean(message.text));
    if (message.role === "assistant") lines.push("", `생성 모델: ${message.modelId ? clean(message.modelId) : "기록 없음"} · 생성 시각: ${message.createdAt}`);
    const search = sanitizeWebSearch(message.webSearch);
    if (search) {
      lines.push("", webSearchStatusLabel(search));
      if (search.queries.length) lines.push(`검색어: ${search.queries.join(" · ")}`);
      for (const citation of search.citations) lines.push(`- <${citation.url}>`);
    }
    for (const result of sanitizeServerCode(message.serverCodeResults) ?? []) {
      lines.push("", `#### 서버 코드 실행 · ${result.provider} · ${result.status}`, "", clean(result.summary));
      if (result.code) lines.push("", "코드:", "", ...fenced(clean(result.code)));
      if (result.stdout !== undefined) lines.push("", "표준 출력:", "", ...fenced(clean(result.stdout)));
      if (result.outputLogs !== undefined) lines.push("", "도구 로그 (표준 출력·오류 구분 미제공):", "", ...fenced(clean(result.outputLogs)));
      if (result.stderr !== undefined) lines.push("", "표준 오류:", "", ...fenced(clean(result.stderr)));
      for (const artifact of result.artifacts) lines.push("", `산출물: ${artifact.kind} ${artifact.name ?? artifact.id ?? "이름 없음"}`);
      if (result.artifacts.length) lines.push("", CODE_ARTIFACT_NOTICE);
    }
    if (message.reasoningSummary) lines.push("", "#### 추론 요약", "", clean(message.reasoningSummary));
    if (message.attachments?.length) lines.push("", `첨부: ${message.attachments.map(clean).join(", ")}`);
    if (message.status === "incomplete") lines.push("", "> 이 답변은 생성 도중 중단되었습니다.");
    const continuationNotice = unsupportedContinuationMessage(sanitizeUnsupportedContinuationReason(message.continuationUnsupportedReason));
    if (continuationNotice) lines.push("", `> ${continuationNotice}`);
    if (message.usage) lines.push("", `토큰: 입력 ${message.usage.inputTokens.toLocaleString()} · 출력 ${message.usage.outputTokens.toLocaleString()} · 합계 ${message.usage.totalTokens.toLocaleString()}${message.usage.cachedInputTokens !== undefined ? ` · 캐시 입력 ${message.usage.cachedInputTokens.toLocaleString()}` : ""}${message.usage.reasoningTokens !== undefined ? ` · 추론 ${message.usage.reasoningTokens.toLocaleString()}` : ""}`);
    if (message.credits !== undefined) lines.push("", `실제 과금: ${message.credits.toLocaleString()} 크레딧`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}
