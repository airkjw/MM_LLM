import type { TokenUsage } from "./contracts.ts";
import { tokenUsageFromEvent } from "./chat-options.ts";

function nonNegativeNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function boundedText(value: unknown, max = 500): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

export function imageUsage(value: Record<string, unknown>): TokenUsage | undefined {
  return tokenUsageFromEvent(value);
}

export function ttsTokenUsage(headers: Pick<Headers, "get">): TokenUsage | undefined {
  const inputTokens = nonNegativeNumber(headers.get("x-input-tokens"));
  const outputTokens = nonNegativeNumber(headers.get("x-output-tokens"));
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  const input = inputTokens ?? 0; const output = outputTokens ?? 0;
  return { inputTokens: input, outputTokens: output, totalTokens: input + output };
}

export function musicResponseMetadata(headers: Pick<Headers, "get">): {
  durationSeconds?: number; billedDurationSeconds?: number; musicStructure?: string;
} {
  const duration = nonNegativeNumber(headers.get("x-audio-duration-seconds"));
  return { durationSeconds: duration, billedDurationSeconds: duration,
    musicStructure: boundedText(headers.get("x-music-structure"), 500) };
}

export function videoResponseMetadata(value: Record<string, unknown>): {
  videoModelId?: string; durationSeconds?: number;
} {
  return { videoModelId: boundedText(value.video_model_id, 200),
    durationSeconds: nonNegativeNumber(value.duration_seconds) };
}
