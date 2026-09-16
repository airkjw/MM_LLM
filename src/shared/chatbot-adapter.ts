export type ChatbotSourceMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | Array<Record<string, unknown>>;
};
export const MAX_CHATBOT_USAGE_BYTES = 1024 * 1024;

export function normalizeChatbotUsage(value: unknown, depth = 0, state = { items: 0 }): unknown {
  if (depth > 8 || ++state.items > 2_000) throw new Error("챗봇 사용량 응답 구조가 너무 큽니다.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("챗봇 사용량 숫자가 올바르지 않습니다.");
    return value;
  }
  if (typeof value === "string") return value.slice(0, 4_000);
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new Error("챗봇 사용량 항목이 너무 많습니다.");
    return value.map((item) => normalizeChatbotUsage(item, depth + 1, state));
  }
  if (typeof value === "object" && value) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 256) throw new Error("챗봇 사용량 키가 너무 많습니다.");
    return Object.fromEntries(entries.filter(([key]) => !/(?:authorization|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|^token$|url$)/i.test(key))
      .map(([key, item]) => [key.slice(0, 100), normalizeChatbotUsage(item, depth + 1, state)]));
  }
  throw new Error("챗봇 사용량 응답 값이 올바르지 않습니다.");
}

export function chatbotUsageSummary(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>; const lines: string[] = [];
  for (const [key, label] of [["total_tokens", "총 토큰"], ["input_tokens", "입력 토큰"],
    ["output_tokens", "출력 토큰"], ["credits", "크레딧"], ["request_count", "요청 수"]] as const) {
    if (typeof record[key] === "number") lines.push(`${label}: ${record[key].toLocaleString("ko-KR")}`);
  }
  return lines;
}

/** Studio Chatbot body is intentionally limited to its documented fields. */
export function chatbotRequestBody(messages: ChatbotSourceMessage[]): {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  stream: true;
} {
  const normalized = messages.filter((item): item is ChatbotSourceMessage & { role: "user" | "assistant" } =>
    item.role === "user" || item.role === "assistant").map((item) => ({ role: item.role,
    content: typeof item.content === "string" ? item.content : item.content.filter((part) => part.type === "text")
      .map((part) => typeof part.text === "string" ? part.text : "").filter(Boolean).join("\n") }));
  return { messages: normalized, stream: true };
}
