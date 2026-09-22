import type { BackgroundResponse, ChatAdvancedSettings, ManualToolCall, PublicMessage, TokenUsage } from "./contracts";
import { parseToolArguments, tokenUsage } from "./advanced-chat.ts";

export const MAX_BACKGROUND_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_BACKGROUND_OUTPUT_BYTES = 4 * 1024 * 1024;
export const BACKGROUND_POLL_DELAYS_MS = [5_000, 10_000, 20_000, 60_000] as const;
export const BACKGROUND_TTL_MS = 24 * 60 * 60_000;
export const MAX_BACKGROUND_RESPONSE_COUNT = 50;
export const MAX_REASONING_SUMMARY_BYTES = 64 * 1024;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

export function nextBackgroundPollDelay(pollCount: number): number {
  return BACKGROUND_POLL_DELAYS_MS[Math.min(Math.max(0, pollCount), BACKGROUND_POLL_DELAYS_MS.length - 1)];
}

export function normalizeBackgroundStatus(value: unknown): BackgroundResponse["status"] {
  return ["queued", "in_progress", "completed", "incomplete", "failed", "cancelled"].includes(String(value))
    ? value as BackgroundResponse["status"] : "in_progress";
}

export function responseOutputText(value: unknown): string {
  const root = record(value); if (!root) return "";
  if (typeof root.output_text === "string") return bounded(root.output_text);
  const output = Array.isArray(root.output) ? root.output : [];
  const pieces: string[] = [];
  for (const raw of output) {
    const item = record(raw); const content = Array.isArray(item?.content) ? item.content : [];
    for (const rawPart of content) {
      const part = record(rawPart);
      if ((part?.type === "output_text" || part?.type === "text") && typeof part.text === "string") pieces.push(part.text);
      if (part?.type === "refusal" && typeof part.refusal === "string") pieces.push(part.refusal);
    }
  }
  return bounded(pieces.join(""));
}

/** Extracts only the provider's explicit public reasoning summary, never hidden reasoning content. */
export function responseReasoningSummary(value: unknown): string {
  const root = record(value); if (!root) return "";
  const output = Array.isArray(root.output) ? root.output : [];
  const pieces: string[] = [];
  for (const raw of output) {
    const item = record(raw); if (item?.type !== "reasoning") continue;
    const summary = Array.isArray(item.summary) ? item.summary : [];
    for (const rawPart of summary) {
      const part = record(rawPart);
      if ((part?.type === "summary_text" || part?.type === "text") && typeof part.text === "string") {
        pieces.push(part.text);
      }
    }
  }
  const text = pieces.join("");
  if (Buffer.byteLength(text, "utf8") > MAX_REASONING_SUMMARY_BYTES) {
    throw new Error("추론 요약이 저장 한도를 넘었습니다.");
  }
  return text;
}

function bounded(value: string): string {
  if (Buffer.byteLength(value, "utf8") > MAX_BACKGROUND_OUTPUT_BYTES) {
    throw new Error("백그라운드 응답이 로컬 저장 한도를 넘었습니다.");
  }
  return value;
}

export function backgroundUsage(value: unknown): TokenUsage | undefined { return tokenUsage(value); }

export function responseToolCalls(value: unknown): ManualToolCall[] {
  const root = record(value); const output = Array.isArray(root?.output) ? root.output : [];
  const calls = output.flatMap((raw): ManualToolCall[] => {
    const item = record(raw); if (item?.type !== "function_call") return [];
    const id = typeof item.call_id === "string" ? item.call_id : typeof item.id === "string" ? item.id : "";
    const name = typeof item.name === "string" ? item.name : "";
    if (!id || id.length > 200 || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name)) {
      throw new Error("Responses 도구 호출 형식이 올바르지 않습니다.");
    }
    return [{ id, name, arguments: parseToolArguments(item.arguments), status: "waiting" }];
  });
  if (calls.length > 8) throw new Error("한 번의 응답에서 도구 호출은 최대 8개까지 받을 수 있습니다.");
  return calls;
}

export function backgroundFailure(value: unknown): string | undefined {
  const root = record(value); const error = record(root?.error);
  const incomplete = record(root?.incomplete_details);
  const message = typeof error?.message === "string" ? error.message
    : typeof root?.incomplete_details === "string" ? root.incomplete_details
      : typeof incomplete?.reason === "string" ? incomplete.reason
        : typeof incomplete?.message === "string" ? incomplete.message : undefined;
  return message?.slice(0, 2_000);
}

export function backgroundIsTerminal(status: BackgroundResponse["status"]): boolean {
  return ["completed", "incomplete", "failed", "cancelled"].includes(status);
}

export type BackgroundReconciliationPlan = {
  reconcile: BackgroundResponse[];
  processedVersions: Array<{ id: string; updatedAt: string; fingerprint: string }>;
};

/** Plans reconciliation from the complete encrypted store before any TTL pruning occurs. */
export function planBackgroundReconciliation(
  jobs: BackgroundResponse[], now = Date.now()
): BackgroundReconciliationPlan {
  const reconcile: BackgroundResponse[] = [];
  const processedVersions: Array<{ id: string; updatedAt: string; fingerprint: string }> = [];
  for (const job of jobs) {
    // The provider run has a fixed lifetime. Polling or other bookkeeping updates
    // must not extend that lifetime indefinitely.
    const created = Date.parse(job.createdAt);
    const expired = !Number.isFinite(created) || now - created >= BACKGROUND_TTL_MS;
    if (backgroundIsTerminal(job.status)) {
      reconcile.push(job); processedVersions.push({ id: job.id, updatedAt: job.updatedAt,
        fingerprint: JSON.stringify(job) }); continue;
    }
    if (expired) {
      reconcile.push({ ...job, status: "incomplete",
        error: "백그라운드 응답 추적 기간(24시간)이 만료되었습니다.",
        updatedAt: new Date(now).toISOString(), nextPollAt: new Date(now).toISOString() });
      processedVersions.push({ id: job.id, updatedAt: job.updatedAt, fingerprint: JSON.stringify(job) });
    }
  }
  return { reconcile, processedVersions };
}

/**
 * Replaces or adds a background record without performing TTL pruning. Expiry
 * must always go through planBackgroundReconciliation so a thread receives an
 * explicit terminal state before its durable job record is removed.
 */
export function upsertBackgroundResponseRecord(
  jobs: BackgroundResponse[], item: BackgroundResponse
): BackgroundResponse[] {
  const next = [...jobs];
  const index = next.findIndex((entry) => entry.id === item.id);
  if (index >= 0) next[index] = item;
  else {
    if (next.length >= MAX_BACKGROUND_RESPONSE_COUNT) {
      throw new Error(`백그라운드 응답은 최대 ${MAX_BACKGROUND_RESPONSE_COUNT}개까지 추적할 수 있습니다.`);
    }
    next.unshift(item);
  }
  return next;
}

export type BackgroundReconcileMessage = PublicMessage & {
  apiContent: string | Array<Record<string, unknown>>;
  /** Encrypted idempotency marker; snapshots and exports must strip this field. */
  reconciledBackgroundResponseId?: string;
};
export type BackgroundReconcileThread = {
  messages: BackgroundReconcileMessage[];
  advanced?: ChatAdvancedSettings;
  previousResponseId?: string;
};

/** Applies a persisted terminal job without network access. Safe to call repeatedly after a crash. */
export function reconcileTerminalBackground(
  thread: BackgroundReconcileThread, job: BackgroundResponse,
  create: () => Pick<BackgroundReconcileMessage, "id" | "createdAt"> = () => ({ id: job.id, createdAt: job.updatedAt })
): boolean {
  if (!backgroundIsTerminal(job.status)) return false;
  if (thread.messages.some((message) => message.reconciledBackgroundResponseId === job.id)) return false;
  let message = thread.messages.find((item) => item.backgroundResponseId === job.id);
  if (!message) {
    const seed = create();
    message = { ...seed, role: "assistant", text: "", apiContent: "", status: "incomplete" };
    thread.messages.push(message);
  }
  const providerText = job.outputText ?? "";
  const fallback = job.status === "cancelled" ? "백그라운드 응답을 취소했습니다."
    : job.status === "failed" ? "백그라운드 응답이 실패했습니다."
      : job.status === "incomplete" ? "백그라운드 응답이 중단되었습니다."
        : "백그라운드 응답이 완료되었습니다.";
  message.text = providerText || job.error || (job.toolCalls?.length
    ? "수동 도구 실행 결과를 기다립니다." : fallback);
  // UI-only fallback text must never be replayed into a later non-chain provider request.
  message.apiContent = providerText;
  message.usage = job.usage;
  message.modelId = job.modelId;
  message.reasoningSummary = job.reasoningSummary;
  if (job.toolCalls?.length) message.toolCalls = job.toolCalls;
  message.status = job.status === "completed" ? "complete" : "incomplete";
  message.reconciledBackgroundResponseId = job.id;
  delete message.backgroundResponseId;
  if (job.status === "completed" && thread.advanced?.responses?.chain) thread.previousResponseId = job.id;
  return true;
}
