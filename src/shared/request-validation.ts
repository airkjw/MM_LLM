import type { ChatAdvancedSettings } from "./contracts";
import { imageCapability, musicCapability, TTS_VOICES, videoCapability } from "./media-capabilities.ts";
import {
  validateManualTools, validateStructuredOutput, validateToolChoice
} from "./advanced-chat.ts";

export const SUPPORTED_ASPECT_RATIOS = ["16:9", "1:1", "9:16", "4:3"] as const;
export const SUPPORTED_TTS_VOICES = TTS_VOICES;

export const IPC_ALLOWED_KEYS = {
  settingsUpdate: ["defaultInstruction", "theme", "fontSize", "favoriteModels", "recentModels"],
  threadCreate: ["modelId", "instruction", "purpose", "projectId", "target"],
  threadSettings: ["modelId", "instruction", "reasoningMode", "advanced"],
  chat: ["threadId", "modelId", "text", "attachmentIds", "regenerate",
    "regenerateAfterId", "continueIncompleteId", "toolResults"]
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allow = new Set(allowed);
  if (Object.keys(value).some((key) => !allow.has(key))) {
    throw new Error(`지원하지 않는 ${label} 설정입니다.`);
  }
}

export function validatedAspectRatio(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !(SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(value)) {
    throw new Error("화면 비율 설정이 올바르지 않습니다.");
  }
  return value;
}

export function validatedTtsVoice(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > 32 ||
    !(SUPPORTED_TTS_VOICES as readonly string[]).includes(value)) {
    throw new Error("지원하지 않는 음성입니다.");
  }
  return value;
}

export function validatedLanguageHints(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5 || !value.every((item) =>
    typeof item === "string" && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(item))) {
    throw new Error("언어 힌트는 최대 5개의 언어 코드여야 합니다.");
  }
  return [...new Set(value)];
}

export function validatedSpeakers(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("다중 화자 설정이 올바르지 않습니다.");
  const entries = Object.entries(value);
  if (entries.length < 2 || entries.length > 2 || entries.some(([name, voice]) =>
    !/^[\p{L}\p{N} _-]{1,40}$/u.test(name) ||
    typeof voice !== "string" || !(TTS_VOICES as readonly string[]).includes(voice))) {
    throw new Error("다중 화자는 이름과 지원 음성을 사용해 두 명으로 설정해 주세요.");
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export type ValidatedImageOptions = {
  numberOfImages: number; aspectRatio?: string; quality?: string; imageSize?: string; background?: string;
};
export function validatedImageOptions(modelId: string, value: Record<string, unknown>): ValidatedImageOptions {
  const capability = imageCapability(modelId);
  const count = value.numberOfImages === undefined ? 1 : value.numberOfImages;
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > (capability?.countMax ?? 1)) {
    throw new Error("이 이미지 모델이 지원하는 생성 개수가 아닙니다.");
  }
  const check = (input: unknown, allowed: readonly string[] | undefined, label: string) => {
    if (input === undefined || input === "") return undefined;
    if (typeof input !== "string" || !allowed?.includes(input)) throw new Error(`이 모델이 지원하지 않는 ${label}입니다.`);
    return input;
  };
  return { numberOfImages: count as number,
    aspectRatio: check(value.aspectRatio, capability?.aspectRatios, "화면 비율"),
    quality: check(value.quality, capability?.quality, "품질"),
    imageSize: check(value.imageSize, capability?.sizes, "이미지 크기"),
    background: check(value.background, capability?.backgrounds, "배경") };
}

export type ValidatedVideoOptions = { aspectRatio?: string; durationSeconds?: number; resolution?: string;
  mode?: "standard" | "pro"; loop?: boolean; audio?: boolean };
export function validatedVideoOptions(modelId: string, value: Record<string, unknown>): ValidatedVideoOptions {
  const capability = videoCapability(modelId);
  const aspectRatio = value.aspectRatio === undefined || value.aspectRatio === "" ? undefined : value.aspectRatio;
  if (aspectRatio !== undefined && (typeof aspectRatio !== "string" || !capability?.aspectRatios?.includes(aspectRatio))) {
    throw new Error("이 비디오 모델이 지원하지 않는 화면 비율입니다.");
  }
  const duration = value.durationSeconds;
  if (duration !== undefined && (typeof duration !== "number" || !Number.isInteger(duration) ||
    !(capability?.durations?.includes(duration) || capability?.durationRange &&
      duration >= capability.durationRange[0] && duration <= capability.durationRange[1]))) {
    throw new Error("이 비디오 모델이 지원하지 않는 길이입니다.");
  }
  const resolution = value.resolution === undefined || value.resolution === "" ? undefined : value.resolution;
  if (resolution !== undefined && (typeof resolution !== "string" || !capability?.resolutions?.includes(resolution))) {
    throw new Error("이 비디오 모델이 지원하지 않는 해상도입니다.");
  }
  const mode = value.mode === undefined || value.mode === "" ? undefined : value.mode;
  if (mode !== undefined && (typeof mode !== "string" || !capability?.modes?.includes(mode as "standard" | "pro"))) {
    throw new Error("이 비디오 모델이 지원하지 않는 생성 모드입니다.");
  }
  const optionalFlag = (key: "loop" | "audio", supported: boolean | undefined) => {
    const input = value[key];
    if (input === undefined) return undefined;
    if (typeof input !== "boolean" || !supported) throw new Error(`이 비디오 모델이 지원하지 않는 ${key} 설정입니다.`);
    return input;
  };
  return { aspectRatio: aspectRatio as string | undefined, durationSeconds: duration as number | undefined,
    resolution: resolution as string | undefined, mode: mode as "standard" | "pro" | undefined,
    loop: optionalFlag("loop", capability?.loop),
    audio: optionalFlag("audio", capability?.audio || capability?.generateAudio) };
}

export function validatedMusicOptions(modelId: string, value: Record<string, unknown>): {
  lyrics?: string; durationSeconds?: number; instrumental?: boolean;
} {
  const capability = musicCapability(modelId);
  const lyrics = value.lyrics === undefined || value.lyrics === "" ? undefined : value.lyrics;
  if (lyrics !== undefined && (typeof lyrics !== "string" || lyrics.length > 4000 || !capability?.lyrics)) {
    throw new Error("이 음악 모델은 입력한 가사를 지원하지 않습니다.");
  }
  const instrumental = value.instrumental === undefined ? undefined : value.instrumental;
  if (instrumental !== undefined && (typeof instrumental !== "boolean" || instrumental && !capability?.instrumental)) {
    throw new Error("이 음악 모델은 연주곡 설정을 지원하지 않습니다.");
  }
  if (instrumental === true && lyrics) throw new Error("연주곡과 가사를 동시에 설정할 수 없습니다.");
  const duration = value.durationSeconds;
  if (duration !== undefined && (typeof duration !== "number" || !Number.isInteger(duration) ||
    !capability?.duration || duration < capability.duration[0] || duration > capability.duration[1])) {
    throw new Error("이 음악 모델이 지원하지 않는 길이입니다.");
  }
  return { lyrics: lyrics as string | undefined, durationSeconds: duration as number | undefined,
    instrumental: instrumental as boolean | undefined };
}

export function validatedAdvancedSettings(value: unknown): ChatAdvancedSettings {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("고급 생성 설정이 올바르지 않습니다.");
  const allowed = new Set(["temperature", "maxOutputTokens", "topP", "topK", "stop", "structuredOutput",
    "thinkingLevel", "thinkingBudget", "tools", "toolChoice", "responses", "claudeThinking"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("지원하지 않는 고급 생성 설정입니다.");
  }
  const result: ChatAdvancedSettings = {};
  if (value.temperature !== undefined) {
    if (typeof value.temperature !== "number" || !Number.isFinite(value.temperature) ||
      value.temperature < 0 || value.temperature > 2) {
      throw new Error("Temperature는 0에서 2 사이의 숫자여야 합니다.");
    }
    result.temperature = value.temperature;
  }
  if (value.maxOutputTokens !== undefined) {
    if (typeof value.maxOutputTokens !== "number" || !Number.isInteger(value.maxOutputTokens) ||
      value.maxOutputTokens < 128 || value.maxOutputTokens > 65_536) {
      throw new Error("최대 출력 토큰은 128에서 65,536 사이의 정수여야 합니다.");
    }
    result.maxOutputTokens = value.maxOutputTokens;
  }
  if (value.topP !== undefined) {
    if (typeof value.topP !== "number" || !Number.isFinite(value.topP) || value.topP < 0 || value.topP > 1) {
      throw new Error("Top P는 0에서 1 사이의 숫자여야 합니다.");
    }
    result.topP = value.topP;
  }
  if (value.topK !== undefined) {
    if (!Number.isInteger(value.topK) || (value.topK as number) < 1 || (value.topK as number) > 100_000) {
      throw new Error("Top K는 1 이상의 정수여야 합니다.");
    }
    result.topK = value.topK as number;
  }
  if (value.stop !== undefined) {
    if (!Array.isArray(value.stop) || value.stop.length > 4 || value.stop.some((item) =>
      typeof item !== "string" || !item || item.length > 200)) {
      throw new Error("중단 문자열은 최대 4개이며 각각 200자 이하여야 합니다.");
    }
    result.stop = [...new Set(value.stop as string[])];
  }
  const structuredOutput = validateStructuredOutput(value.structuredOutput);
  if (structuredOutput) result.structuredOutput = structuredOutput;
  if (value.thinkingLevel !== undefined) {
    if (!["minimal", "low", "medium", "high"].includes(String(value.thinkingLevel))) {
      throw new Error("Gemini 사고 수준이 올바르지 않습니다.");
    }
    result.thinkingLevel = value.thinkingLevel as ChatAdvancedSettings["thinkingLevel"];
  }
  if (value.thinkingBudget !== undefined) {
    if (!Number.isInteger(value.thinkingBudget) || (value.thinkingBudget as number) < -1 ||
      (value.thinkingBudget as number) > 1_000_000) throw new Error("Gemini 사고 예산이 올바르지 않습니다.");
    result.thinkingBudget = value.thinkingBudget as number;
  }
  if (result.thinkingLevel !== undefined && result.thinkingBudget !== undefined) {
    throw new Error("Gemini 사고 수준과 사고 예산은 동시에 설정할 수 없습니다.");
  }
  const tools = validateManualTools(value.tools);
  if (tools) result.tools = tools;
  const toolChoice = validateToolChoice(value.toolChoice, result.tools);
  if (toolChoice) result.toolChoice = toolChoice;
  if (value.responses !== undefined) {
    if (!isRecord(value.responses)) throw new Error("Responses 설정이 올바르지 않습니다.");
    assertAllowedKeys(value.responses, ["background", "chain", "reasoningSummary"], "Responses");
    if (value.responses.background !== undefined && typeof value.responses.background !== "boolean" ||
      value.responses.chain !== undefined && typeof value.responses.chain !== "boolean" ||
      value.responses.reasoningSummary !== undefined && !["auto", "none"].includes(String(value.responses.reasoningSummary))) {
      throw new Error("Responses 설정이 올바르지 않습니다.");
    }
    result.responses = { ...(value.responses.background !== undefined ? { background: value.responses.background } : {}),
      ...(value.responses.chain !== undefined ? { chain: value.responses.chain } : {}),
      ...(value.responses.reasoningSummary !== undefined
        ? { reasoningSummary: value.responses.reasoningSummary as "auto" | "none" } : {}) };
  }
  if (value.claudeThinking !== undefined) {
    if (!isRecord(value.claudeThinking)) throw new Error("Claude 사고 설정이 올바르지 않습니다.");
    assertAllowedKeys(value.claudeThinking, ["mode", "effort", "budgetTokens"], "Claude 사고");
    if (!["off", "adaptive", "manual"].includes(String(value.claudeThinking.mode))) {
      throw new Error("Claude 사고 모드가 올바르지 않습니다.");
    }
    if (value.claudeThinking.effort !== undefined &&
      !["low", "medium", "high", "xhigh", "max"].includes(String(value.claudeThinking.effort))) {
      throw new Error("Claude 사고 강도가 올바르지 않습니다.");
    }
    if (value.claudeThinking.budgetTokens !== undefined &&
      (!Number.isInteger(value.claudeThinking.budgetTokens) || (value.claudeThinking.budgetTokens as number) < 1024 ||
        (value.claudeThinking.budgetTokens as number) > 200_000)) {
      throw new Error("Claude 수동 사고 예산은 1,024에서 200,000 사이의 정수여야 합니다.");
    }
    if (value.claudeThinking.mode === "manual" && value.claudeThinking.budgetTokens === undefined) {
      throw new Error("Claude 수동 사고에는 토큰 예산이 필요합니다.");
    }
    result.claudeThinking = { mode: value.claudeThinking.mode as "off" | "adaptive" | "manual",
      ...(value.claudeThinking.effort !== undefined
        ? { effort: value.claudeThinking.effort as "low" | "medium" | "high" | "xhigh" | "max" } : {}),
      ...(value.claudeThinking.budgetTokens !== undefined
        ? { budgetTokens: value.claudeThinking.budgetTokens as number } : {}) };
  }
  return result;
}
