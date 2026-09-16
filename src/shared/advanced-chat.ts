import type {
  ChatAdvancedSettings, GatewayModel, JsonSchemaOutput, ManualToolCall, ManualToolDefinition,
  ReasoningMode, TokenUsage
} from "./contracts";

export const MAX_JSON_SCHEMA_BYTES = 64 * 1024;
export const MAX_SCHEMA_DEPTH = 16;
export const MAX_SCHEMA_KEYS = 256;
export const MAX_MANUAL_TOOLS = 4;
export const MAX_TOOL_ARGUMENT_BYTES = 64 * 1024;
export const MAX_TOOL_RESULT_BYTES = 64 * 1024;
export const MAX_TOOL_CALLS_PER_TURN = 8;

export type ProviderKind = "chat" | "responses" | "claude" | "chatbot";
export type ClaudeEffort = NonNullable<NonNullable<ChatAdvancedSettings["claudeThinking"]>["effort"]>;
export type ClaudeThinkingCapabilities = {
  adaptive: boolean; manual: boolean; canDisable: boolean; efforts: ClaudeEffort[];
};
export type NormalizedRunEvent =
  | { type: "text"; text: string }
  | { type: "reasoning_summary"; text: string }
  | { type: "progress"; message: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "credits"; credits: number }
  | { type: "files"; files: Array<Record<string, unknown>> }
  | { type: "tool_call"; call: ManualToolCall }
  | { type: "provider_state"; claudeContinuation: Array<Record<string, unknown>> }
  | { type: "status"; status: string; responseId?: string }
  | { type: "error"; message: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function finiteCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function isClaudeModel(model: Pick<GatewayModel, "id" | "owned_by">): boolean {
  return model.id.toLowerCase().startsWith("claude-") ||
    /anthropic|claude/.test(model.owned_by?.toLowerCase() ?? "");
}

export function isOpenAiModel(model: Pick<GatewayModel, "id" | "owned_by">): boolean {
  const owner = model.owned_by?.toLowerCase() ?? "";
  return /openai/.test(owner) || /^(gpt-|o\d|codex)/.test(model.id.toLowerCase());
}

export function isGeminiModel(model: Pick<GatewayModel, "id" | "owned_by">): boolean {
  return model.id.toLowerCase().startsWith("gemini-") ||
    /google|gemini/.test(model.owned_by?.toLowerCase() ?? "");
}

export function isCodexModel(model: Pick<GatewayModel, "id" | "owned_by">): boolean {
  return /(?:^|-)codex(?:-|$)/.test(model.id.toLowerCase());
}

/** Conservative KHU Messages capability matrix (verified 2026-09-16). */
export function claudeThinkingCapabilities(modelId: string): ClaudeThinkingCapabilities {
  const id = modelId.toLowerCase();
  const match = id.match(/^claude-[a-z0-9]+-(\d+)(?:[-.](\d+))?/);
  const major = Number(match?.[1] ?? 0); const minor = Number(match?.[2] ?? 0);
  const fableFive = /claude-fable-5(?:[-.]|$)/.test(id);
  const family = id.match(/^claude-(opus|sonnet|fable|mythos)-/)?.[1] ?? "";
  const efforts: ClaudeEffort[] = ["low", "medium", "high"];
  const xhigh = major >= 5 && ["fable", "mythos", "opus", "sonnet"].includes(family) ||
    family === "opus" && major === 4 && (minor === 7 || minor === 8);
  const max = major >= 5 && ["fable", "mythos", "opus"].includes(family) ||
    family === "sonnet" && (major >= 5 || major === 4 && minor === 6) ||
    family === "opus" && major === 4 && minor >= 6 && minor <= 8;
  if (xhigh) efforts.push("xhigh");
  if (max) efforts.push("max");
  if (major >= 5 || major === 4 && minor >= 7) {
    return { adaptive: true, manual: false, canDisable: !fableFive, efforts };
  }
  if (major === 4 && minor === 6) {
    return { adaptive: true, manual: true, canDisable: true, efforts };
  }
  if (major === 4 && minor === 5) {
    return { adaptive: false, manual: true, canDisable: true, efforts };
  }
  return { adaptive: false, manual: true, canDisable: true, efforts };
}

/** Claude 4.7+ rejects non-default sampling controls on the current upstream passthrough contract. */
export function claudeAllowsSampling(modelId: string): boolean {
  const match = modelId.toLowerCase().match(/^claude-[a-z0-9]+-(\d+)(?:[-.](\d+))?/);
  const major = Number(match?.[1] ?? 0); const minor = Number(match?.[2] ?? 0);
  return major < 4 || major === 4 && minor <= 6;
}

export function claudeForbidsForcedToolChoice(modelId: string): boolean {
  return /^claude-(?:fable|mythos)-5[-.]1(?:[-.]|$)/.test(modelId.toLowerCase());
}

export function claudeDefaultThinkingMode(modelId: string): "off" | "adaptive" {
  return /^claude-(?:opus|sonnet|fable|mythos)-5(?:[-.]|$)/.test(modelId.toLowerCase()) ? "adaptive" : "off";
}

/** Chooses a documented endpoint before the first POST; POST failures are never used for discovery. */
export function providerForModel(
  model: Pick<GatewayModel, "id" | "owned_by">,
  advanced: ChatAdvancedSettings = {}
): ProviderKind {
  if (isClaudeModel(model)) return "claude";
  if (isOpenAiModel(model) && (isCodexModel(model) || advanced.responses?.background ||
    advanced.responses?.chain || advanced.responses?.reasoningSummary !== undefined)) return "responses";
  return "chat";
}

export function assertAdvancedOptionsForModel(
  model: Pick<GatewayModel, "id" | "owned_by">, advanced: ChatAdvancedSettings
): void {
  const unsupported = (condition: unknown, label: string) => {
    if (condition) throw new Error(`${model.id} 모델은 ${label} 설정을 지원하지 않습니다.`);
  };
  if (isClaudeModel(model)) {
    if (advanced.temperature !== undefined && advanced.temperature > 1) {
      throw new Error("Claude 네이티브 Temperature는 0에서 1 사이여야 합니다.");
    }
    unsupported(advanced.stop?.length, "중단 문자열");
    unsupported(advanced.structuredOutput, "JSON Schema 구조화 출력");
    unsupported(advanced.thinkingLevel !== undefined || advanced.thinkingBudget !== undefined, "Gemini 사고");
    unsupported(advanced.responses, "OpenAI Responses");
    const thinking = advanced.claudeThinking;
    const capability = claudeThinkingCapabilities(model.id);
    const effectiveThinking = thinking?.mode ?? claudeDefaultThinkingMode(model.id);
    const activeThinking = effectiveThinking === "adaptive" || effectiveThinking === "manual";
    unsupported(!claudeAllowsSampling(model.id) &&
      (advanced.temperature !== undefined || advanced.topP !== undefined || advanced.topK !== undefined),
    "Temperature·Top P·Top K");
    unsupported(claudeAllowsSampling(model.id) && activeThinking &&
      (advanced.temperature !== undefined || advanced.topK !== undefined),
    "사고 모드와 Temperature·Top K의 동시 사용");
    if (claudeAllowsSampling(model.id) && activeThinking && advanced.topP !== undefined && advanced.topP < .95) {
      throw new Error("Claude 사고 모드의 Top P는 0.95에서 1 사이여야 합니다.");
    }
    unsupported(thinking?.mode === "adaptive" && !capability.adaptive, "적응형 사고");
    unsupported(thinking?.mode === "manual" && !capability.manual, "수동 사고 예산");
    unsupported(thinking?.mode === "off" && !capability.canDisable, "사고 끄기");
    unsupported(Boolean(thinking?.effort) && thinking?.mode !== "adaptive", "적응형 사고 이외의 effort");
    unsupported(Boolean(thinking?.effort) && !capability.efforts.includes(thinking!.effort!),
      `사고 강도 ${thinking?.effort ?? ""}`);
    const forcedTool = advanced.toolChoice === "required" || typeof advanced.toolChoice === "object";
    unsupported(effectiveThinking === "manual" && forcedTool,
      "수동 사고와 required·지정 도구 선택의 동시 사용");
    unsupported(claudeForbidsForcedToolChoice(model.id) && forcedTool, "required·지정 도구 선택");
    return;
  }
  unsupported(advanced.topK !== undefined, "Top K");
  unsupported(advanced.claudeThinking, "Claude 사고");
  if (!isGeminiModel(model)) unsupported(advanced.thinkingLevel !== undefined || advanced.thinkingBudget !== undefined,
    "Gemini 사고");
  if (!isOpenAiModel(model)) unsupported(advanced.responses, "OpenAI Responses");
}

export function providerRoute(provider: ProviderKind, id?: string): string {
  if (provider === "claude") return "/claude/v1/messages/";
  if (provider === "responses") return id ? `/responses/${encodeURIComponent(id)}/` : "/responses/";
  if (provider === "chatbot") {
    if (!id || id.length > 200 || /[\/\\\u0000-\u001f\u007f]/.test(id)) throw new Error("챗봇 ID 형식이 올바르지 않습니다.");
    return `/chatbots/${encodeURIComponent(id)}/chat/completions/`;
  }
  return "/chat/completions/";
}

function validateSchemaNode(value: unknown, depth: number, state: { keys: number }): void {
  if (depth > MAX_SCHEMA_DEPTH) throw new Error(`JSON Schema 깊이는 ${MAX_SCHEMA_DEPTH}단계 이하여야 합니다.`);
  if (Array.isArray(value)) {
    if (value.length > MAX_SCHEMA_KEYS) throw new Error("JSON Schema 배열 항목이 너무 많습니다.");
    value.forEach((entry) => validateSchemaNode(entry, depth + 1, state));
    return;
  }
  const object = record(value);
  if (!object) return;
  const keys = Object.keys(object);
  state.keys += keys.length;
  if (state.keys > MAX_SCHEMA_KEYS) throw new Error(`JSON Schema 키는 총 ${MAX_SCHEMA_KEYS}개 이하여야 합니다.`);
  if (object.type === "object") {
    if (object.additionalProperties !== false) {
      throw new Error("strict JSON Schema의 모든 object에는 additionalProperties: false가 필요합니다.");
    }
    if (!record(object.properties)) throw new Error("object JSON Schema에는 properties가 필요합니다.");
    const propertyNames = Object.keys(object.properties as Record<string, unknown>);
    if (!Array.isArray(object.required) || object.required.some((item) => typeof item !== "string") ||
      propertyNames.some((name) => !(object.required as unknown[]).includes(name))) {
      throw new Error("strict JSON Schema의 object는 모든 properties 이름을 required에 포함해야 합니다.");
    }
  }
  for (const child of Object.values(object)) validateSchemaNode(child, depth + 1, state);
}

export function validateStrictJsonSchema(value: unknown, label = "구조화 출력"): Record<string, unknown> {
  const schema = record(value);
  if (!schema || schema.type !== "object") throw new Error(`${label} JSON Schema의 루트는 object여야 합니다.`);
  if (byteLength(schema) > MAX_JSON_SCHEMA_BYTES) throw new Error(`${label} JSON Schema는 64KB 이하여야 합니다.`);
  validateSchemaNode(schema, 0, { keys: 0 });
  return schema;
}

export function validateStructuredOutput(value: unknown): JsonSchemaOutput | undefined {
  if (value === undefined) return undefined;
  const object = record(value);
  if (!object || typeof object.name !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(object.name)) {
    throw new Error("구조화 출력 이름은 영문자로 시작하는 64자 이하의 이름이어야 합니다.");
  }
  if (object.description !== undefined && (typeof object.description !== "string" || object.description.length > 500)) {
    throw new Error("구조화 출력 설명은 500자 이하여야 합니다.");
  }
  return { name: object.name, ...(object.description ? { description: object.description as string } : {}),
    schema: validateStrictJsonSchema(object.schema) };
}

export function validateManualTools(value: unknown): ManualToolDefinition[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_MANUAL_TOOLS) {
    throw new Error(`수동 도구는 최대 ${MAX_MANUAL_TOOLS}개까지 정의할 수 있습니다.`);
  }
  const names = new Set<string>();
  return value.map((raw) => {
    const item = record(raw);
    if (!item || typeof item.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(item.name)) {
      throw new Error("도구 이름은 영문자 또는 밑줄로 시작하는 64자 이하의 이름이어야 합니다.");
    }
    if (names.has(item.name)) throw new Error("도구 이름은 중복될 수 없습니다.");
    names.add(item.name);
    if (item.description !== undefined && (typeof item.description !== "string" || item.description.length > 1000)) {
      throw new Error("도구 설명은 1,000자 이하여야 합니다.");
    }
    if (byteLength(item.parameters) > 32 * 1024) throw new Error("도구 입력 Schema는 32KB 이하여야 합니다.");
    return { name: item.name, ...(item.description ? { description: item.description as string } : {}),
      parameters: validateStrictJsonSchema(item.parameters, "도구 입력") };
  });
}

export function validateToolChoice(value: unknown, tools: ManualToolDefinition[] | undefined): ChatAdvancedSettings["toolChoice"] {
  if (value === undefined) return undefined;
  if (["auto", "none", "required"].includes(String(value))) return value as "auto" | "none" | "required";
  const object = record(value);
  if (!object || typeof object.name !== "string" || !tools?.some((tool) => tool.name === object.name)) {
    throw new Error("선택한 수동 도구가 정의되어 있지 않습니다.");
  }
  return { name: object.name };
}

export function validateManualToolResult(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_TOOL_RESULT_BYTES) {
    throw new Error("도구 결과 JSON은 64KB 이하여야 합니다.");
  }
  try { JSON.parse(value); } catch { throw new Error("도구 결과는 유효한 JSON이어야 합니다."); }
  return value;
}

export function parseToolArguments(value: unknown): string {
  const string = typeof value === "string" ? value : JSON.stringify(value ?? {});
  if (Buffer.byteLength(string, "utf8") > MAX_TOOL_ARGUMENT_BYTES) throw new Error("도구 호출 인자가 너무 큽니다.");
  try { JSON.parse(string); } catch { throw new Error("모델이 유효하지 않은 도구 호출 JSON을 반환했습니다."); }
  return string;
}

export function chatToolsPayload(tools: ManualToolDefinition[] | undefined): Array<Record<string, unknown>> | undefined {
  return tools?.map((tool) => ({ type: "function", function: {
    name: tool.name, ...(tool.description ? { description: tool.description } : {}), parameters: tool.parameters, strict: true
  } }));
}

export function claudeToolsPayload(tools: ManualToolDefinition[] | undefined): Array<Record<string, unknown>> | undefined {
  return tools?.map((tool) => ({ name: tool.name, ...(tool.description ? { description: tool.description } : {}),
    input_schema: tool.parameters }));
}

export function responsesToolsPayload(tools: ManualToolDefinition[] | undefined): Array<Record<string, unknown>> | undefined {
  return tools?.map((tool) => ({ type: "function", name: tool.name,
    ...(tool.description ? { description: tool.description } : {}), parameters: tool.parameters, strict: true }));
}

export function responsesToolChoice(value: ChatAdvancedSettings["toolChoice"]): unknown {
  if (typeof value === "object") return { type: "function", name: value.name };
  return value;
}

export function chatToolChoice(value: ChatAdvancedSettings["toolChoice"]): unknown {
  return typeof value === "object" ? { type: "function", function: { name: value.name } } : value;
}

export function claudeToolChoice(value: ChatAdvancedSettings["toolChoice"]): unknown {
  if (typeof value === "object") return { type: "tool", name: value.name };
  if (value === "required") return { type: "any" };
  if (value === "auto" || value === "none") return { type: value };
  return undefined;
}

export function structuredOutputPayload(output: JsonSchemaOutput | undefined, provider: ProviderKind): unknown {
  if (!output) return undefined;
  const format = { type: "json_schema", name: output.name,
    ...(output.description ? { description: output.description } : {}), schema: output.schema, strict: true };
  return provider === "responses" ? { format } :
    { type: "json_schema", json_schema: { name: output.name,
      ...(output.description ? { description: output.description } : {}), strict: true, schema: output.schema } };
}

export function tokenUsage(value: unknown): TokenUsage | undefined {
  const event = record(value); const response = record(event?.response);
  const message = record(event?.message);
  const usage = record(event?.usage) ?? record(response?.usage) ?? record(message?.usage);
  if (!usage) return undefined;
  const input = finiteCount(usage.input_tokens) ?? finiteCount(usage.prompt_tokens) ?? 0;
  const output = finiteCount(usage.output_tokens) ?? finiteCount(usage.completion_tokens) ?? 0;
  const total = finiteCount(usage.total_tokens) ?? input + output;
  if (!input && !output && !total) return undefined;
  const cacheCreation = finiteCount(usage.cache_creation_input_tokens);
  const cacheRead = finiteCount(usage.cache_read_input_tokens);
  const inputDetails = record(usage.input_tokens_details) ?? record(usage.prompt_tokens_details);
  const outputDetails = record(usage.output_tokens_details) ?? record(usage.completion_tokens_details);
  const cachedInput = finiteCount(inputDetails?.cached_tokens);
  const reasoning = finiteCount(outputDetails?.reasoning_tokens);
  return { inputTokens: input, outputTokens: output, totalTokens: total,
    ...(cacheCreation !== undefined ? { cacheCreationInputTokens: cacheCreation } : {}),
    ...(cacheRead !== undefined ? { cacheReadInputTokens: cacheRead } : {}),
    ...(cachedInput !== undefined ? { cachedInputTokens: cachedInput } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}) };
}

export function claudeCacheUsage(value: unknown): { creation: number; read: number } | undefined {
  const root = record(value); const usage = record(root?.usage) ?? record(record(root?.message)?.usage);
  if (!usage) return undefined;
  const creation = finiteCount(usage.cache_creation_input_tokens) ?? 0;
  const read = finiteCount(usage.cache_read_input_tokens) ?? 0;
  return creation || read ? { creation, read } : undefined;
}

export function reasoningEffortFromMode(mode: ReasoningMode): "low" | "medium" | "high" | undefined {
  return mode === "fast" ? "low" : mode === "balanced" ? "medium" : mode === "deep" ? "high" : undefined;
}
