import type { ThreadSnapshot } from "./contracts";

export function isPristineThread(thread: ThreadSnapshot | null | undefined): thread is ThreadSnapshot {
  return Boolean(thread && thread.messages.length === 0 && thread.messageCount === 0 &&
    thread.title === "새 대화" && !thread.instruction.trim() && !thread.pinned &&
    thread.webSearchMode === "always" && thread.reasoningMode === "auto" &&
    thread.advanced.temperature === undefined && thread.advanced.maxOutputTokens === undefined);
}
