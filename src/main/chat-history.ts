import type { InternalMessage } from "./storage";
import type { TokenUsage } from "../shared/contracts";

/** Applies one streamed assistant outcome in a single storage mutation. */
export function applyAssistantOutcome(
  messages: InternalMessage[], text: string, status: "complete" | "incomplete",
  regenerateIndex: number, id: string, createdAt: string, usage?: TokenUsage, modelId?: string
): void {
  if (regenerateIndex >= 0) messages.splice(regenerateIndex + 1);
  messages.push({ id, role: "assistant", text, apiContent: text, createdAt, status, usage,
    ...(modelId ? { modelId } : {}) });
}
