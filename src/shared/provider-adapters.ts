import type { ChatAdvancedSettings, GatewayModel, ManualToolCall, ReasoningMode, TokenUsage } from "./contracts";
import {
  assertAdvancedOptionsForModel, chatToolChoice, chatToolsPayload, claudeToolChoice, claudeToolsPayload, isGeminiModel, isOpenAiModel,
  claudeAllowsSampling, claudeThinkingCapabilities, parseToolArguments, providerForModel, reasoningEffortFromMode, responsesToolChoice, responsesToolsPayload, structuredOutputPayload,
  tokenUsage, type NormalizedRunEvent, type ProviderKind
} from "./advanced-chat.ts";

export const PROVIDER_API_REFERENCE = {
  lastVerified: "2026-09-16",
  chat: "https://docs.mindlogic.ai/docs/khu/api-gateway/reference/chat-completions",
  responses: "https://docs.mindlogic.ai/docs/khu/api-gateway/reference/responses-api",
  claude: "https://docs.mindlogic.ai/docs/khu/api-gateway/reference/messages-api",
  chatbot: "https://docs.mindlogic.ai/docs/khu/api-gateway/reference/chatbot-chat"
} as const;

export type ProviderMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | Array<Record<string, unknown>>;
  tool_call_id?: string;
  tool_calls?: Array<Record<string, unknown>>;
  claudeContinuation?: Array<Record<string, unknown>>;
};

type BuildInput = {
  model: GatewayModel;
  messages: ProviderMessage[];
  reasoningMode: ReasoningMode;
  advanced: ChatAdvancedSettings;
  stream?: boolean;
  previousResponseId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commonSampling(advanced: ChatAdvancedSettings): Record<string, unknown> {
  return {
    ...(advanced.temperature !== undefined ? { temperature: advanced.temperature } : {}),
    ...(advanced.topP !== undefined ? { top_p: advanced.topP } : {}),
    ...(advanced.stop?.length ? { stop: advanced.stop } : {})
  };
}

function usesCompletionTokens(model: GatewayModel): boolean {
  return /^(?:gpt-[5-9]|o\d)/.test(model.id.toLowerCase()) || model.owned_by?.toLowerCase() === "openai";
}

function openAiContent(content: ProviderMessage["content"]): ProviderMessage["content"] {
  if (typeof content === "string") return content;
  return content.filter((block) => block.type === "text" || block.type === "image_url");
}

function openAiMessages(messages: ProviderMessage[]): ProviderMessage[] {
  return messages.map((message) => ({ ...message, content: openAiContent(message.content) }));
}

function responsesContent(content: ProviderMessage["content"], role: ProviderMessage["role"]): unknown {
  if (typeof content === "string") return content;
  return content.flatMap((block): Array<Record<string, unknown>> => {
    if (block.type === "text" && typeof block.text === "string") {
      return [{ type: role === "assistant" ? "output_text" : "input_text", text: block.text }];
    }
    if (role === "user" && block.type === "image_url" && isRecord(block.image_url) &&
      typeof block.image_url.url === "string") {
      return [{ type: "input_image", image_url: block.image_url.url }];
    }
    return [];
  });
}

export function buildChatCompletionsPayload(input: BuildInput): Record<string, unknown> {
  const { model, messages, advanced } = input;
  const effort = reasoningEffortFromMode(input.reasoningMode);
  const tools = chatToolsPayload(advanced.tools);
  return {
    model: model.id, messages: openAiMessages(messages), stream: input.stream ?? true,
    ...((input.stream ?? true) ? { stream_options: { include_usage: true } } : {}),
    ...commonSampling(advanced),
    ...(advanced.maxOutputTokens !== undefined
      ? { [usesCompletionTokens(model) ? "max_completion_tokens" : "max_tokens"]: advanced.maxOutputTokens } : {}),
    ...(effort ? { reasoning_effort: effort } : {}),
    ...(isGeminiModel(model) && advanced.thinkingLevel ? { thinking_level: advanced.thinkingLevel } : {}),
    ...(isGeminiModel(model) && advanced.thinkingLevel === undefined && advanced.thinkingBudget !== undefined
      ? { thinking_budget: advanced.thinkingBudget } : {}),
    ...(tools?.length ? { tools, ...(advanced.toolChoice ? { tool_choice: chatToolChoice(advanced.toolChoice) } : {}) } : {}),
    ...(advanced.structuredOutput ? { response_format: structuredOutputPayload(advanced.structuredOutput, "chat") } : {})
  };
}

function responseInput(messages: ProviderMessage[], chain = false): { instructions?: string; input: Array<Record<string, unknown>> } {
  const instructions = messages.filter((item) => item.role === "system" || item.role === "developer")
    .map((item) => typeof item.content === "string" ? item.content : "").filter(Boolean).join("\n\n");
  const conversation = messages.filter((item) => item.role !== "system" && item.role !== "developer");
  let selected = conversation;
  if (chain) {
    const tail: ProviderMessage[] = [];
    for (let index = conversation.length - 1; index >= 0; index--) {
      if (conversation[index].role !== "tool") { if (!tail.length) tail.unshift(conversation[index]); break; }
      tail.unshift(conversation[index]);
    }
    selected = tail;
  }
  const input = selected
    .flatMap((item): Array<Record<string, unknown>> => {
      if (item.role === "tool") return [{ type: "function_call_output", call_id: item.tool_call_id, output: item.content }];
      if (item.role === "assistant" && item.tool_calls?.length) {
        const callItems = item.tool_calls.flatMap((raw): Array<Record<string, unknown>> => {
          const fn = isRecord(raw.function) ? raw.function : undefined;
          if (typeof raw.id !== "string" || typeof fn?.name !== "string") return [];
          return [{ type: "function_call", call_id: raw.id, name: fn.name,
            arguments: parseToolArguments(fn.arguments) }];
        });
        const content = responsesContent(item.content, item.role);
        const message = typeof content === "string" && !content ? [] : [{ role: "assistant", content }];
        return [...message, ...callItems];
      }
      return [{ role: item.role, content: responsesContent(item.content, item.role) }];
    });
  return { ...(instructions ? { instructions } : {}), input };
}

export function buildResponsesPayload(input: BuildInput): Record<string, unknown> {
  const advanced = input.advanced;
  const useChain = Boolean(advanced.responses?.chain && input.previousResponseId);
  const split = responseInput(input.messages, useChain);
  const effort = reasoningEffortFromMode(input.reasoningMode);
  const tools = responsesToolsPayload(advanced.tools);
  return {
    model: input.model.id, ...split, stream: input.stream ?? !advanced.responses?.background,
    ...(advanced.maxOutputTokens !== undefined ? { max_output_tokens: advanced.maxOutputTokens } : {}),
    ...(effort || advanced.responses?.reasoningSummary ? { reasoning: {
      ...(effort ? { effort } : {}), ...(advanced.responses?.reasoningSummary ? { summary: advanced.responses.reasoningSummary } : {})
    } } : {}),
    ...(advanced.structuredOutput ? { text: structuredOutputPayload(advanced.structuredOutput, "responses") } : {}),
    ...(tools?.length ? { tools, ...(advanced.toolChoice ? { tool_choice: responsesToolChoice(advanced.toolChoice) } : {}) } : {}),
    ...(advanced.responses?.background ? { background: true } : {}),
    ...(useChain ? { previous_response_id: input.previousResponseId } : {})
  };
}

function dataUrlBlock(block: Record<string, unknown>): Record<string, unknown> | null {
  if (block.type !== "image_url" || !isRecord(block.image_url) || typeof block.image_url.url !== "string") return null;
  const match = block.image_url.url.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error("Claude에 전송할 이미지 형식이 올바르지 않습니다.");
  const bytes = Buffer.from(match[2], "base64");
  const valid = match[1] === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : match[1] === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8
      : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!valid) throw new Error("Claude에 전송할 이미지의 실제 형식이 확장자와 다릅니다.");
  return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
}

function claudeContent(content: ProviderMessage["content"]): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  return content.flatMap((block): Array<Record<string, unknown>> => {
    if (block.type === "text" && typeof block.text === "string") return [{ type: "text", text: block.text }];
    const image = dataUrlBlock(block); if (image) return [image];
    if (block.type === "document" && isRecord(block.source) && block.source.type === "base64" &&
      block.source.media_type === "application/pdf" && typeof block.source.data === "string") {
      const bytes = Buffer.from(block.source.data, "base64");
      if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("PDF 실제 형식이 올바르지 않습니다.");
      return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: block.source.data } }];
    }
    if (block.type === "tool_result") return [block];
    return [];
  });
}

export function buildClaudePayload(input: BuildInput): { body: Record<string, unknown>; beta: string[] } {
  const { model, advanced } = input;
  assertAdvancedOptionsForModel(model, advanced);
  const systems = input.messages.filter((item) => item.role === "system" || item.role === "developer")
    .map((item) => typeof item.content === "string" ? item.content : "").filter(Boolean);
  const system = systems.length ? [{ type: "text", text: systems.join("\n\n"),
    cache_control: { type: "ephemeral" } }] : undefined;
  const messages = input.messages.filter((item) => item.role !== "system" && item.role !== "developer")
    .map((item) => {
      if (item.role === "tool") return { role: "user", content: [
        { type: "tool_result", tool_use_id: item.tool_call_id, content: item.content }
      ] };
      if (item.role === "assistant" && item.claudeContinuation?.length) {
        return { role: "assistant", content: validateClaudeContinuation(item.claudeContinuation) };
      }
      const content = claudeContent(item.content);
      if (item.role === "assistant" && item.tool_calls?.length) {
        const textBlocks = typeof content === "string" && content ? [{ type: "text", text: content }]
          : Array.isArray(content) ? content : [];
        const toolBlocks = item.tool_calls.flatMap((raw): Array<Record<string, unknown>> => {
          const fn = isRecord(raw.function) ? raw.function : undefined;
          if (typeof raw.id !== "string" || typeof fn?.name !== "string") return [];
          let parsed: unknown = {};
          try { parsed = JSON.parse(typeof fn.arguments === "string" ? fn.arguments : "{}"); } catch { /* validated upstream */ }
          return [{ type: "tool_use", id: raw.id, name: fn.name, input: parsed }];
        });
        return { role: "assistant", content: [...textBlocks, ...toolBlocks] };
      }
      return { role: item.role, content };
    });
  const configuredMax = advanced.maxOutputTokens ?? 4096;
  const thinkingCapabilities = claudeThinkingCapabilities(model.id);
  const thinking = advanced.claudeThinking ?? (!thinkingCapabilities.canDisable
    ? { mode: "adaptive" as const, effort: "high" as const } : undefined);
  if (thinking?.mode === "adaptive" && !thinkingCapabilities.adaptive) throw new Error("이 Claude 모델은 적응형 사고를 지원하지 않습니다.");
  if (thinking?.mode === "manual" && !thinkingCapabilities.manual) throw new Error("이 Claude 모델은 수동 사고 예산을 지원하지 않습니다.");
  if (thinking?.mode === "off" && !thinkingCapabilities.canDisable) throw new Error("이 Claude 모델은 사고 모드를 끌 수 없습니다.");
  if (thinking?.effort && !thinkingCapabilities.efforts.includes(thinking.effort)) {
    throw new Error(`이 Claude 모델은 사고 강도 ${thinking.effort}를 지원하지 않습니다.`);
  }
  if (thinking?.mode === "manual" && (!thinking.budgetTokens || thinking.budgetTokens >= configuredMax)) {
    throw new Error("수동 사고 토큰 예산은 최대 출력 토큰보다 작아야 합니다.");
  }
  const mergedMessages: typeof messages = [];
  for (const message of messages) {
    const previous = mergedMessages.at(-1);
    if (message.role === "user" && previous?.role === "user" && Array.isArray(message.content) &&
      Array.isArray(previous.content) && message.content.every((block) => block.type === "tool_result") &&
      previous.content.every((block) => block.type === "tool_result")) {
      previous.content.push(...message.content); continue;
    }
    mergedMessages.push(message);
  }
  // Prompt caching allows at most four explicit breakpoints in one request.
  // Keep the system prefix stable and cache only the final static PDF prefix;
  // incoming per-document cache markers are deliberately stripped above.
  let lastPdf: Record<string, unknown> | undefined;
  for (const message of mergedMessages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "document") lastPdf = block;
    }
  }
  if (lastPdf) lastPdf.cache_control = { type: "ephemeral" };
  const tools = claudeToolsPayload(advanced.tools);
  const beta = ["prompt-caching-2024-07-31"];
  if (thinking?.mode === "manual" && /^claude-sonnet-4[-.]6(?:-|$)/.test(model.id.toLowerCase())) {
    beta.push("interleaved-thinking-2025-05-14");
  }
  const thinkingBody = thinking?.mode === "adaptive" ? { thinking: { type: "adaptive" },
    ...(thinking.effort ? { output_config: { effort: thinking.effort } } : {}) }
    : thinking?.mode === "manual" ? { thinking: { type: "enabled", budget_tokens: thinking.budgetTokens } }
      : thinking?.mode === "off" && /^claude-(?:opus|sonnet)-5(?:[-.]|$)/.test(model.id.toLowerCase())
        ? { thinking: { type: "disabled" } } : {};
  const samplingAllowed = claudeAllowsSampling(model.id);
  const thinkingActive = thinking?.mode === "adaptive" || thinking?.mode === "manual";
  return { beta, body: {
    model: model.id, messages: mergedMessages, max_tokens: configuredMax, stream: input.stream ?? true,
    ...(system ? { system } : {}), ...thinkingBody,
    ...(samplingAllowed && !thinkingActive
      ? { ...(advanced.temperature !== undefined ? { temperature: Math.min(1, advanced.temperature) } : {}) } : {}),
    ...(samplingAllowed && advanced.topP !== undefined ? { top_p: advanced.topP } : {}),
    ...(samplingAllowed && !thinkingActive && advanced.topK !== undefined ? { top_k: advanced.topK } : {}),
    ...(tools?.length ? { tools, ...(advanced.toolChoice ? { tool_choice: claudeToolChoice(advanced.toolChoice) } : {}) } : {})
  } };
}

export function buildProviderRequest(input: BuildInput): {
  provider: ProviderKind; path: string; body: Record<string, unknown>; headers?: Record<string, string>;
} {
  const provider = isOpenAiModel(input.model) && input.advanced.tools?.length &&
    reasoningEffortFromMode(input.reasoningMode) ? "responses" : providerForModel(input.model, input.advanced);
  if (provider === "responses") return { provider, path: "/responses/", body: buildResponsesPayload(input) };
  if (provider === "claude") {
    const built = buildClaudePayload(input);
    return { provider, path: "/claude/v1/messages/", body: built.body,
      headers: { "anthropic-version": "2023-06-01", "anthropic-beta": built.beta.join(",") } };
  }
  return { provider, path: "/chat/completions/", body: buildChatCompletionsPayload(input) };
}

export function buildClaudeCountTokensRequest(input: BuildInput): {
  path: "/claude/v1/messages/count_tokens/"; body: Record<string, unknown>; headers: Record<string, string>;
} {
  const built = buildClaudePayload({ ...input, stream: false });
  const { max_tokens: _max, stream: _stream, ...body } = built.body;
  const beta = [...new Set([...built.beta, "token-counting-2024-11-01"])];
  return { path: "/claude/v1/messages/count_tokens/", body,
    headers: { "anthropic-version": "2023-06-01", "anthropic-beta": beta.join(",") } };
}

type PartialTool = { id: string; name: string; arguments: string };

function mergeUsage(previous: TokenUsage | undefined, next: TokenUsage): TokenUsage {
  if (!previous) return next;
  const inputTokens = next.inputTokens || previous.inputTokens;
  const outputTokens = next.outputTokens || previous.outputTokens;
  const mergedTotal = inputTokens + outputTokens;
  const reportedTotal = Math.max(previous.totalTokens, next.totalTokens);
  const cacheCreationInputTokens = next.cacheCreationInputTokens ?? previous.cacheCreationInputTokens;
  const cacheReadInputTokens = next.cacheReadInputTokens ?? previous.cacheReadInputTokens;
  const cachedInputTokens = next.cachedInputTokens ?? previous.cachedInputTokens;
  const reasoningTokens = next.reasoningTokens ?? previous.reasoningTokens;
  return { inputTokens, outputTokens, totalTokens: Math.max(mergedTotal, reportedTotal),
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}) };
}

const MAX_CLAUDE_CONTINUATION_BYTES = 256 * 1024;
export function validateClaudeContinuation(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 24) throw new Error("Claude 내부 연속 상태가 올바르지 않습니다.");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_CLAUDE_CONTINUATION_BYTES) {
    throw new Error("Claude 내부 연속 상태가 저장 한도를 넘었습니다.");
  }
  return value.map((raw) => {
    if (!isRecord(raw)) throw new Error("Claude 내부 연속 상태가 올바르지 않습니다.");
    if (raw.type === "text" && typeof raw.text === "string") return { type: "text", text: raw.text };
    if (raw.type === "thinking" && typeof raw.thinking === "string" && typeof raw.signature === "string" && raw.signature.length > 0) {
      return { type: "thinking", thinking: raw.thinking, signature: raw.signature };
    }
    if (raw.type === "redacted_thinking" && typeof raw.data === "string") return { type: "redacted_thinking", data: raw.data };
    if (raw.type === "tool_use" && typeof raw.id === "string" && raw.id.length <= 200 &&
      typeof raw.name === "string" && raw.name.length <= 64 && isRecord(raw.input)) {
      return { type: "tool_use", id: raw.id, name: raw.name, input: raw.input };
    }
    throw new Error("Claude 내부 연속 상태 블록이 올바르지 않습니다.");
  });
}

/** Stateful, provider-specific SSE normalizer. Unknown events are intentionally ignored. */
export class ProviderEventNormalizer {
  private readonly tools = new Map<number, PartialTool>();
  private claudeTool: PartialTool | null = null;
  private claudeBlock: Record<string, unknown> | null = null;
  private readonly claudeBlocks: Array<Record<string, unknown>> = [];
  private responseToolCount = 0;
  private responseRefusalDelta = false;
  private responseReasoningSummary = "";
  private claudeToolCount = 0;
  private claudeUsage: TokenUsage | undefined;
  readonly provider: ProviderKind;
  constructor(provider: ProviderKind) { this.provider = provider; }

  accept(event: Record<string, unknown>): NormalizedRunEvent[] {
    if (this.provider === "responses") return this.responses(event);
    if (this.provider === "claude") return this.claude(event);
    return this.chat(event);
  }

  private chat(event: Record<string, unknown>): NormalizedRunEvent[] {
    const events: NormalizedRunEvent[] = [];
    const usage = tokenUsage(event); if (usage) events.push({ type: "usage", usage });
    if (typeof event.credits === "number" && Number.isFinite(event.credits) && event.credits >= 0) {
      events.push({ type: "credits", credits: event.credits });
    }
    if (Array.isArray(event.files)) events.push({ type: "files", files: event.files.filter(isRecord) });
    if (isRecord(event.error)) events.push({ type: "error",
      message: typeof event.error.message === "string" ? event.error.message : "모델 호출이 실패했습니다." });
    const choices = Array.isArray(event.choices) ? event.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : undefined;
    const delta = isRecord(choice?.delta) ? choice.delta : undefined;
    if (typeof delta?.content === "string" && delta.content) events.push({ type: "text", text: delta.content });
    if (Array.isArray(delta?.tool_calls)) {
      for (const raw of delta.tool_calls) {
        if (!isRecord(raw)) continue; const item = raw;
        const index = typeof item.index === "number" ? item.index : 0;
        const fn = isRecord(item.function) ? item.function : undefined;
        const previous = this.tools.get(index) ?? { id: "", name: "", arguments: "" };
        if (typeof item.id === "string") previous.id += item.id;
        if (typeof fn?.name === "string") previous.name += fn.name;
        if (typeof fn?.arguments === "string") previous.arguments += fn.arguments;
        if (Buffer.byteLength(previous.arguments, "utf8") > 64 * 1024) throw new Error("도구 호출 인자가 너무 큽니다.");
        this.tools.set(index, previous);
      }
    }
    if (choice?.finish_reason === "tool_calls") {
      if (this.tools.size > 8) throw new Error("한 번의 응답에서 도구 호출은 최대 8개까지 받을 수 있습니다.");
      for (const item of this.tools.values()) events.push({ type: "tool_call", call: {
        id: item.id, name: item.name, arguments: parseToolArguments(item.arguments), status: "waiting"
      } });
      this.tools.clear();
    }
    if (choice?.finish_reason === "length") events.push({ type: "status", status: "incomplete" });
    return events;
  }

  private responses(event: Record<string, unknown>): NormalizedRunEvent[] {
    const events: NormalizedRunEvent[] = [];
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      events.push({ type: "text", text: event.delta });
    }
    if (event.type === "response.refusal.delta" && typeof event.delta === "string") {
      this.responseRefusalDelta = true;
      events.push({ type: "text", text: event.delta });
    }
    if (event.type === "response.refusal.done" && !this.responseRefusalDelta && typeof event.refusal === "string") {
      events.push({ type: "text", text: event.refusal });
    }
    if (event.type === "response.reasoning_summary_text.delta" && typeof event.delta === "string") {
      this.responseReasoningSummary += event.delta;
      if (Buffer.byteLength(this.responseReasoningSummary, "utf8") > 64 * 1024) {
        throw new Error("추론 요약이 저장 한도를 넘었습니다.");
      }
      events.push({ type: "reasoning_summary", text: event.delta });
    }
    if (event.type === "response.reasoning_summary_text.done") {
      const complete = typeof event.text === "string" ? event.text : "";
      const suffix = complete && complete.startsWith(this.responseReasoningSummary)
        ? complete.slice(this.responseReasoningSummary.length)
        : this.responseReasoningSummary ? "" : complete;
      if (suffix) {
        this.responseReasoningSummary += suffix;
        if (Buffer.byteLength(this.responseReasoningSummary, "utf8") > 64 * 1024) {
          throw new Error("추론 요약이 저장 한도를 넘었습니다.");
        }
        events.push({ type: "reasoning_summary", text: suffix });
      }
    }
    const response = isRecord(event.response) ? event.response : undefined;
    const responseId = typeof response?.id === "string" ? response.id : undefined;
    if (["response.queued", "response.in_progress", "response.completed", "response.incomplete"].includes(String(event.type))) {
      events.push({ type: "status", status: String(event.type).slice("response.".length), responseId });
    }
    if (event.type === "response.output_item.done" && isRecord(event.item) && event.item.type === "function_call") {
      if (++this.responseToolCount > 8) throw new Error("한 번의 응답에서 도구 호출은 최대 8개까지 받을 수 있습니다.");
      events.push({ type: "tool_call", call: { id: String(event.item.call_id ?? event.item.id ?? ""),
        name: String(event.item.name ?? ""), arguments: parseToolArguments(event.item.arguments), status: "waiting" } });
    }
    const usage = tokenUsage(event); if (usage) events.push({ type: "usage", usage });
    if (event.type === "response.failed") {
      const error = isRecord(response?.error) ? response!.error as Record<string, unknown>
        : isRecord(event.error) ? event.error : undefined;
      events.push({ type: "error", message: typeof error?.message === "string" ? error.message : "응답 생성이 실패했습니다." });
    }
    if (event.type === "error") {
      const error = isRecord(event.error) ? event.error : undefined;
      events.push({ type: "error", message: typeof error?.message === "string" ? error.message : "Responses 연결이 실패했습니다." });
    }
    return events;
  }

  private claude(event: Record<string, unknown>): NormalizedRunEvent[] {
    const events: NormalizedRunEvent[] = [];
    if (event.type === "content_block_start" && isRecord(event.content_block)) {
      if (event.content_block.type === "tool_use") {
        this.claudeTool = { id: String(event.content_block.id ?? ""), name: String(event.content_block.name ?? ""), arguments: "" };
        this.claudeBlock = { type: "tool_use", id: this.claudeTool.id, name: this.claudeTool.name, input: {} };
      } else if (event.content_block.type === "thinking") {
        this.claudeBlock = { type: "thinking", thinking: "", signature: "" };
        events.push({ type: "progress", message: "사고 중…" });
      } else if (event.content_block.type === "redacted_thinking" && typeof event.content_block.data === "string") {
        this.claudeBlock = { type: "redacted_thinking", data: event.content_block.data };
      } else if (event.content_block.type === "text") this.claudeBlock = { type: "text", text: "" };
    }
    if (event.type === "content_block_delta" && isRecord(event.delta)) {
      if (event.delta.type === "text_delta" && typeof event.delta.text === "string") {
        events.push({ type: "text", text: event.delta.text });
        if (this.claudeBlock?.type === "text") this.claudeBlock.text = String(this.claudeBlock.text ?? "") + event.delta.text;
      } else if (event.delta.type === "input_json_delta" && typeof event.delta.partial_json === "string" && this.claudeTool) {
        this.claudeTool.arguments += event.delta.partial_json;
        if (Buffer.byteLength(this.claudeTool.arguments, "utf8") > 64 * 1024) throw new Error("도구 호출 인자가 너무 큽니다.");
      } else if (event.delta.type === "thinking_delta") {
        // Deliberately do not expose, persist, or export raw thinking/signature blocks.
        if (this.claudeBlock?.type === "thinking" && typeof event.delta.thinking === "string") {
          this.claudeBlock.thinking = String(this.claudeBlock.thinking ?? "") + event.delta.thinking;
        }
      } else if (event.delta.type === "signature_delta" && this.claudeBlock?.type === "thinking" &&
        typeof event.delta.signature === "string") {
        this.claudeBlock.signature = String(this.claudeBlock.signature ?? "") + event.delta.signature;
      }
    }
    if (event.type === "content_block_stop" && this.claudeBlock) {
      if (this.claudeTool) {
        if (++this.claudeToolCount > 8) throw new Error("한 번의 응답에서 도구 호출은 최대 8개까지 받을 수 있습니다.");
        const args = parseToolArguments(this.claudeTool.arguments || "{}");
        this.claudeBlock.input = JSON.parse(args);
        events.push({ type: "tool_call", call: { ...this.claudeTool, arguments: args, status: "waiting" } });
        this.claudeTool = null;
      }
      this.claudeBlocks.push(this.claudeBlock); this.claudeBlock = null;
    }
    if (event.type === "message_start" || event.type === "message_delta") {
      const usage = tokenUsage(event); if (usage) {
        this.claudeUsage = mergeUsage(this.claudeUsage, usage); events.push({ type: "usage", usage: this.claudeUsage });
      }
    }
    if (event.type === "message_delta" && isRecord(event.delta) && event.delta.stop_reason === "max_tokens") {
      events.push({ type: "status", status: "incomplete" });
    }
    if (event.type === "message_stop" && this.claudeBlocks.some((block) => block.type === "tool_use") &&
      this.claudeBlocks.some((block) => block.type === "thinking" || block.type === "redacted_thinking")) {
      events.push({ type: "provider_state", claudeContinuation: validateClaudeContinuation(this.claudeBlocks) });
    }
    if (event.type === "error") {
      const error = isRecord(event.error) ? event.error : undefined;
      events.push({ type: "error", message: typeof error?.message === "string" ? error.message : "Claude 호출이 실패했습니다." });
    }
    return events;
  }
}
