import type { ChatAdvancedSettings, GatewayModel } from "./contracts";
import type { NormalizedRunEvent } from "./advanced-chat";
import type { ProviderMessage } from "./provider-adapters";
import { nativeSearchSettingsError } from "./search-capability.ts";
const record = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : undefined;

export function buildGeminiSearchRequest(model: GatewayModel, messages: ProviderMessage[], advanced: ChatAdvancedSettings): {
  provider: "gemini"; path: string; body: Record<string, unknown>;
} {
  const error = nativeSearchSettingsError("gemini", advanced); if (error) throw new Error(error);
  const system = messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => {
    if (typeof m.content !== "string") throw new Error("Gemini 시스템 지침은 텍스트여야 합니다."); return { text: m.content };
  });
  const contents = messages.filter((m) => m.role !== "system" && m.role !== "developer").map((message) => {
    if (message.role === "tool" || message.tool_calls?.length) throw new Error("Gemini 자체 검색은 수동 도구 이력을 지원하지 않습니다.");
    const parts = typeof message.content === "string" ? [{ text: message.content }] : message.content.map((block) => {
      if (block.type === "text" && typeof block.text === "string") return { text: block.text };
      const image = record(block.image_url);
      if (block.type === "image_url" && typeof image?.url === "string") {
        const match = image.url.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
        if (!match) throw new Error("Gemini 이미지 형식이 올바르지 않습니다.");
        return { inlineData: { mimeType: match[1], data: match[2] } };
      }
      // Document full text already arrives as text blocks; never silently drop an unknown attachment.
      throw new Error("Gemini 자체 검색에서 지원하지 않는 첨부 형식입니다.");
    });
    return { role: message.role === "assistant" ? "model" : "user", parts };
  });
  return { provider: "gemini", path: `/gemini/v1beta/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse`, body: {
    contents, ...(system.length ? { systemInstruction: { parts: system } } : {}), tools: [{ google_search: {} }],
    generationConfig: {
      ...(advanced.temperature !== undefined ? { temperature: advanced.temperature } : {}),
      ...(advanced.topP !== undefined ? { topP: advanced.topP } : {}),
      ...(advanced.maxOutputTokens !== undefined ? { maxOutputTokens: advanced.maxOutputTokens } : {}),
      ...(advanced.stop?.length ? { stopSequences: advanced.stop } : {}),
      ...(advanced.thinkingLevel ? { thinkingConfig: { thinkingLevel: advanced.thinkingLevel.toUpperCase() } }
        : advanced.thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget: advanced.thinkingBudget } } : {})
    }
  } };
}

export function normalizeGeminiEvent(event: Record<string, unknown>): NormalizedRunEvent[] {
  if (record(event.error)) return [{ type: "error", message: "Gemini 응답 생성이 실패했습니다. 다시 전송하기 전 이전 요청의 과금·결과를 확인해 주세요." }];
  const events: NormalizedRunEvent[] = [];
  const candidate = record(Array.isArray(event.candidates) ? event.candidates[0] : undefined);
  const content = record(candidate?.content);
  if (Array.isArray(content?.parts)) for (const raw of content.parts) {
    const part = record(raw);
    if (part?.thought === true) continue;
    if (typeof part?.text === "string") events.push({ type: "text", text: part.text });
    if (part?.functionCall) events.push({ type: "error", message: "Gemini 자체 검색에서 수동 함수 호출을 실행할 수 없습니다." });
  }
  const usage = record(event.usageMetadata);
  const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : 0;
  if (usage) {
    const inputTokens = count(usage.promptTokenCount); const reasoningTokens = count(usage.thoughtsTokenCount);
    const outputTokens = count(usage.candidatesTokenCount) + reasoningTokens;
    events.push({ type: "usage", usage: { inputTokens, outputTokens,
      totalTokens: Math.max(count(usage.totalTokenCount), inputTokens + outputTokens), reasoningTokens,
      ...(usage.cachedContentTokenCount !== undefined ? { cachedInputTokens: count(usage.cachedContentTokenCount) } : {}) } });
  }
  const finish = candidate?.finishReason;
  if (finish === "MAX_TOKENS") events.push({ type: "status", status: "incomplete" });
  else if (typeof finish === "string" && finish !== "STOP") events.push({ type: "error", message: `Gemini 응답이 중단되었습니다 (${finish.slice(0, 80)}).` });
  else if (finish === "STOP") events.push({ type: "status", status: "completed" });
  if (record(event.promptFeedback)?.blockReason) events.push({ type: "error", message: "Gemini 안전 정책에 따라 요청이 차단되었습니다." });
  return events;
}
