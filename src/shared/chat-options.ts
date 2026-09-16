import type {
  ChatAdvancedSettings, GatewayModel, ReasoningMode, TokenUsage
} from "./contracts";

export type ReasoningSupport = "adjustable" | "native-required" | "model-managed" | "none";

// Gateway documentation currently identifies these exact OpenAI chat IDs as accepting only temperature=1.
const FIXED_TEMPERATURE_MODELS = new Set([
  "gpt-5", "gpt-5-mini", "gpt-5.1-chat-latest", "gpt-5.2-chat-latest"
]);

function adjustableOpenAi(id: string, owner?: string): boolean {
  const value = id.toLowerCase();
  return /^(?:o\d|gpt-[5-9](?:[.-]|$))/.test(value) || /(?:^|-)codex(?:-|$)/.test(value) ||
    owner?.toLowerCase() === "openai" && /^(?:o\d|gpt-[5-9])/.test(value);
}

export function reasoningSupport(model: Pick<GatewayModel, "id" | "owned_by">): ReasoningSupport {
  const id = model.id.toLowerCase();
  if (id.startsWith("claude-") || model.owned_by?.toLowerCase().includes("anthropic")) return "native-required";
  if (adjustableOpenAi(id, model.owned_by) || id.startsWith("gemini-")) return "adjustable";
  if (/^(qwen|solar|deepseek|glm|kimi|seed)/.test(id) || id.startsWith("sonar-reasoning")) {
    return "model-managed";
  }
  return "none";
}

export function hasFixedTemperature(modelId: string): boolean {
  return FIXED_TEMPERATURE_MODELS.has(modelId.toLowerCase());
}

export function reasoningEffort(mode: ReasoningMode): "low" | "medium" | "high" | undefined {
  return mode === "fast" ? "low" : mode === "balanced" ? "medium" : mode === "deep" ? "high" : undefined;
}

export function normalizeAdvancedSettings(value: ChatAdvancedSettings | undefined): ChatAdvancedSettings {
  const result: ChatAdvancedSettings = {};
  if (typeof value?.temperature === "number" && Number.isFinite(value.temperature)) {
    result.temperature = Math.min(2, Math.max(0, value.temperature));
  }
  if (typeof value?.maxOutputTokens === "number" && Number.isFinite(value.maxOutputTokens)) {
    result.maxOutputTokens = Math.min(65_536, Math.max(128, Math.round(value.maxOutputTokens)));
  }
  return result;
}

export function chatCompletionOptions(
  model: Pick<GatewayModel, "id" | "owned_by">,
  mode: ReasoningMode,
  advanced: ChatAdvancedSettings
): Record<string, number | string> {
  const options: Record<string, number | string> = {};
  const support = reasoningSupport(model);
  const effort = reasoningEffort(mode);
  if (support === "adjustable" && effort) options.reasoning_effort = effort;

  const normalized = normalizeAdvancedSettings(advanced);
  const fixedTemperature = hasFixedTemperature(model.id);
  const openAiReasoning = adjustableOpenAi(model.id, model.owned_by);
  if (normalized.temperature !== undefined) {
    if (!fixedTemperature || normalized.temperature === 1) options.temperature = normalized.temperature;
  }
  if (normalized.maxOutputTokens !== undefined) {
    options[openAiReasoning ? "max_completion_tokens" : "max_tokens"] = normalized.maxOutputTokens;
  }
  return options;
}

export function responsesOptions(
  model: Pick<GatewayModel, "id" | "owned_by">,
  mode: ReasoningMode,
  advanced: ChatAdvancedSettings
): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  const effort = reasoningSupport(model) === "adjustable" ? reasoningEffort(mode) : undefined;
  if (effort) options.reasoning = { effort };
  const normalized = normalizeAdvancedSettings(advanced);
  if (normalized.maxOutputTokens !== undefined) options.max_output_tokens = normalized.maxOutputTokens;
  if (normalized.temperature !== undefined &&
    (!hasFixedTemperature(model.id) || normalized.temperature === 1)) options.temperature = normalized.temperature;
  return options;
}

export function combinedSystemInstruction(globalInstruction: string, threadInstruction: string): string {
  const globalValue = globalInstruction.trim();
  const threadValue = threadInstruction.trim();
  if (!threadValue) return globalValue;
  if (!globalValue) return threadValue;
  return `${globalValue}\n\n[이 대화의 추가 지침 — 충돌 시 이 지침을 우선 적용]\n${threadValue}`;
}

export function combinedProjectInstruction(globalInstruction: string, projectInstruction: string,
  threadInstruction: string): string {
  const parts: string[] = [];
  if (globalInstruction.trim()) parts.push(globalInstruction.trim());
  if (projectInstruction.trim()) parts.push(`[프로젝트 공통 지침 — 전역 지침보다 우선]\n${projectInstruction.trim()}`);
  if (threadInstruction.trim()) parts.push(`[이 대화의 추가 지침 — 충돌 시 가장 우선]\n${threadInstruction.trim()}`);
  return parts.join("\n\n");
}

function finiteCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Parses both Chat Completions and Responses usage without treating tokens as credits. */
export function tokenUsageFromEvent(event: Record<string, unknown>): TokenUsage | undefined {
  const response = record(event.response);
  const usage = record(event.usage) ?? record(response?.usage);
  if (!usage) return undefined;
  const input = finiteCount(usage.prompt_tokens) ?? finiteCount(usage.input_tokens) ?? 0;
  const output = finiteCount(usage.completion_tokens) ?? finiteCount(usage.output_tokens) ?? 0;
  const total = finiteCount(usage.total_tokens) ?? input + output;
  if (input === 0 && output === 0 && total === 0) return undefined;
  const inputDetails = record(usage.input_tokens_details) ?? record(usage.prompt_tokens_details);
  const outputDetails = record(usage.output_tokens_details) ?? record(usage.completion_tokens_details);
  const cachedInput = finiteCount(inputDetails?.cached_tokens);
  const reasoning = finiteCount(outputDetails?.reasoning_tokens);
  return { inputTokens: input, outputTokens: output, totalTokens: total,
    ...(cachedInput !== undefined ? { cachedInputTokens: cachedInput } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}) };
}
