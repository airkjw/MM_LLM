import { gatewayScheduler } from "./request-scheduler";

export const RESEARCH_GATEWAY = "https://factchat-cloud.mindlogic.ai/v1/gateway";
export const RESEARCH_RESPONSE_BYTES = 2 * 1024 * 1024;
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted(); let cleanup: (() => void) | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    const fail = () => reject(signal.reason); signal.addEventListener("abort", fail, { once: true });
    cleanup = () => signal.removeEventListener("abort", fail); if (signal.aborted) fail();
  })]); } finally { cleanup?.(); }
}

/** One attempt, pinned origin, no redirects or paid retries; deadline covers reading the body too. */
export async function researchRequest<T>(key: string, path: string, body: unknown | undefined,
  signal: AbortSignal, parse: (response: Response, signal: AbortSignal) => Promise<T>): Promise<T> {
  if (!/^\/(?:mcp\/(?:[a-z0-9][a-z0-9_-]{0,79}\/)?|embeddings\/|rerank\/)$/.test(path)) throw new Error("허용되지 않은 연구 API 경로입니다.");
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const release = await gatewayScheduler.acquire("standard", bounded);
  try {
    bounded.throwIfAborted();
    const response = await abortable(fetch(`${RESEARCH_GATEWAY}${path}`, { method: body === undefined ? "GET" : "POST",
      redirect: "error", signal: bounded, headers: { Authorization: `Bearer ${key}`,
        ...(path.startsWith("/mcp/") && body !== undefined ? { "MCP-Protocol-Version": "2025-06-18" } : {}),
        Accept: "application/json, text/event-stream", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), bounded);
    if (!response.ok) {
      const retry = response.headers.get("retry-after")?.slice(0, 100);
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`연구 API 오류 (${response.status}).${retry ? ` Retry-After: ${retry}.` : ""} 권한·호출 한도를 확인해 주세요. 자동 재시도하지 않았습니다.`);
    }
    // Explicit cancellation must also work with custom/mock streams that ignore fetch's signal.
    const abort = () => { void response.body?.cancel().catch(() => undefined); };
    bounded.addEventListener("abort", abort, { once: true });
    try {
      const result = await abortable(parse(response, bounded), bounded);
      bounded.throwIfAborted(); return result;
    } finally { bounded.removeEventListener("abort", abort); }
  } finally { release(); }
}

export async function researchText(response: Response, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get("content-length")) > RESEARCH_RESPONSE_BYTES || !response.body) throw new Error("연구 API 응답 크기 또는 본문이 올바르지 않습니다.");
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0; let text = "";
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      total += part.value.byteLength;
      if (total > RESEARCH_RESPONSE_BYTES) throw new Error("연구 API 응답이 2MB 한도를 넘었습니다.");
      text += decoder.decode(part.value, { stream: true });
    }
    signal.throwIfAborted(); return text + decoder.decode();
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => undefined); }
}
export const researchJson = async (response: Response, signal: AbortSignal): Promise<unknown> => JSON.parse(await researchText(response, signal));
