import type { ThreadSnapshot } from "./contracts";

function clean(value: string): string {
  return value.replace(/\u0000/g, "").trim();
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
    if (message.reasoningSummary) lines.push("", "#### 추론 요약", "", clean(message.reasoningSummary));
    if (message.attachments?.length) lines.push("", `첨부: ${message.attachments.map(clean).join(", ")}`);
    if (message.status === "incomplete") lines.push("", "> 이 답변은 생성 도중 중단되었습니다.");
    if (message.usage) lines.push("", `토큰: 입력 ${message.usage.inputTokens.toLocaleString()} · 출력 ${message.usage.outputTokens.toLocaleString()} · 합계 ${message.usage.totalTokens.toLocaleString()}${message.usage.cachedInputTokens !== undefined ? ` · 캐시 입력 ${message.usage.cachedInputTokens.toLocaleString()}` : ""}${message.usage.reasoningTokens !== undefined ? ` · 추론 ${message.usage.reasoningTokens.toLocaleString()}` : ""}`);
    if (message.credits !== undefined) lines.push("", `실제 과금: ${message.credits.toLocaleString()} 크레딧`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}
