import type { NativeSearchProvider, WebCitation, WebSearchExecution } from "./contracts";

export const MAX_SEARCH_CITATIONS = 64;
export const MAX_SEARCH_QUERIES = 16;
const record = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const text = (v: unknown, limit: number): string | undefined => typeof v === "string" ? v.slice(0, limit) : undefined;

export function safeCitation(value: unknown): WebCitation | undefined {
  const raw = record(value); if (!raw || typeof raw.url !== "string") return undefined;
  if (raw.url.length > 2000) throw new Error("웹 출처 주소가 안전 길이 한도를 넘었습니다.");
  if (/[\u0000-\u0020\u007f]/.test(raw.url)) return undefined;
  let url: URL; try { url = new URL(raw.url); } catch { return undefined; }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined;
  if (url.href.length > 2000) throw new Error("웹 출처 주소가 안전 길이 한도를 넘었습니다.");
  if (url.origin === "https://factchat-cloud.mindlogic.ai" && url.pathname.startsWith("/v1/public/f/")) return undefined;
  const start = raw.startIndex; const end = raw.endIndex;
  const range = Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number(start) >= 0 &&
    Number(end) > Number(start) && Number(end) <= 8 * 1024 * 1024 ? { startIndex: Number(start), endIndex: Number(end) } : {};
  return { url: url.href, title: text(raw.title, 500) || url.hostname,
    ...(typeof raw.citedText === "string" ? { citedText: text(raw.citedText, 1000) } : {}), ...range };
}

/** Match the existing main-process external-link policy without changing that boundary. */
export function citationLinkBlockReason(url: string): string | undefined {
  if (!url.startsWith("https://")) return "HTTP 출처는 열 수 없습니다. HTTPS 링크만 열 수 있습니다.";
  if (url.length > 2000) return "링크 길이가 열기 한도를 넘었습니다.";
  if (url.startsWith("https://factchat-cloud.mindlogic.ai/v1/public/f/")) return "첨부 파일은 안전한 다운로드 버튼으로만 열 수 있습니다.";
  return undefined;
}

/** Strips unknown fields and validates legacy/restored public search metadata. */
export function sanitizeWebSearch(value: unknown): WebSearchExecution | undefined {
  const raw = record(value);
  if (!raw || !["native", "sonar", "shared", "cache", "none"].includes(String(raw.route)) ||
      !["pending", "executed", "missing", "failed", "empty", "cached", "not_requested"].includes(String(raw.status))) return undefined;
  const citations = new Map<string, WebCitation>();
  for (const item of Array.isArray(raw.citations) ? raw.citations.slice(0, MAX_SEARCH_CITATIONS) : []) {
    try { const valid = safeCitation(item); if (valid) citations.set(valid.url, valid); } catch { /* invalid restored field */ }
  }
  const queries = [...new Set((Array.isArray(raw.queries) ? raw.queries : [])
    .filter((v): v is string => typeof v === "string").slice(0, MAX_SEARCH_QUERIES).map((v) => v.slice(0, 512)))];
  return { route: raw.route as WebSearchExecution["route"], status: raw.status as WebSearchExecution["status"], queries,
    citations: [...citations.values()],
    ...(["claude", "responses", "gemini", "sonar"].includes(String(raw.provider)) ? { provider: raw.provider as NativeSearchProvider } : {}),
    ...(raw.provider !== "gemini" && Number.isSafeInteger(raw.requestCount) && Number(raw.requestCount) >= 0 && Number(raw.requestCount) <= 1000
      ? { requestCount: Number(raw.requestCount) } : {}) };
}

export function webSearchStatusLabel(search: WebSearchExecution): string {
  const route = search.route === "cache" ? "이전 웹 자료" : search.route === "shared" ? "Sonar 공통 검색"
    : search.route === "sonar" ? "Sonar 검색 후 선택 모델 답변" : search.route === "native" ? "모델 자체 검색" : "웹 검색";
  const status = { pending: "준비 중", executed: "실행 확인", missing: "실행 미확인", failed: "실패", empty: "결과 없음",
    cached: "재사용 · 새 검색 없음", not_requested: "이번 질문은 검색 안 함" }[search.status];
  return `${route} · ${status}`;
}

/** Only provider tool events, not answer text or links, establish native execution. */
export class SearchEvidenceNormalizer {
  private state: WebSearchExecution;
  private readonly citations = new Map<string, WebCitation>();
  private readonly queries = new Set<string>();
  private readonly calls = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly geminiChunks: Array<WebCitation | undefined> = [];
  private claudeServer: { id: string; json: string; query?: unknown } | undefined;
  private sawEmpty = false;
  private failed = false;
  constructor(provider: NativeSearchProvider) {
    this.state = { route: "native", provider, status: "pending", queries: [], citations: [] };
  }
  private addCitation(raw: unknown): void {
    const citation = safeCitation(raw); if (!citation) return;
    const old = this.citations.get(citation.url);
    if (!old && this.citations.size >= MAX_SEARCH_CITATIONS) throw new Error("웹 출처 수가 안전 한도를 넘었습니다.");
    this.citations.set(citation.url, { ...old, ...citation });
  }
  private addQuery(raw: unknown): void {
    if (typeof raw !== "string" || !raw.trim()) return;
    const query = raw.slice(0, 512);
    if (!this.queries.has(query) && this.queries.size >= MAX_SEARCH_QUERIES) throw new Error("검색 질의 수가 안전 한도를 넘었습니다.");
    this.queries.add(query);
  }
  private completedCall(id: unknown): void {
    const key = typeof id === "string" ? id.slice(0, 200) : "search";
    if (this.completed.size >= 32 && !this.completed.has(key)) throw new Error("검색 실행 수가 안전 한도를 넘었습니다.");
    this.completed.add(key);
  }
  accept(event: Record<string, unknown>): WebSearchExecution {
    const provider = this.state.provider;
    if (provider === "claude") {
      const block = record(event.content_block); const delta = record(event.delta);
      if (event.type === "content_block_start") {
        this.claudeServer = undefined;
        if (block?.type === "server_tool_use" && block.name === "web_search") {
          const id = String(block.id ?? "search").slice(0, 200); this.calls.add(id);
          if (this.calls.size > 32) throw new Error("검색 실행 수가 안전 한도를 넘었습니다.");
          this.claudeServer = { id, json: "", query: record(block.input)?.query };
        }
        if (block?.type === "web_search_tool_result") {
          if (record(block.content)?.type === "web_search_tool_result_error") this.failed = true;
          else if (Array.isArray(block.content)) {
            this.completedCall(block.tool_use_id); this.sawEmpty ||= block.content.length === 0;
            for (const result of block.content) { const r = record(result); if (r?.type === "web_search_result") this.addCitation(r); }
          }
        }
        if (block?.type === "text" && Array.isArray(block.citations)) block.citations.forEach((raw) => this.claudeCitation(raw));
      }
      if (event.type === "content_block_delta") {
        if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string" && this.claudeServer) {
          this.claudeServer.json += delta.partial_json;
          if (this.claudeServer.json.length > 16_384) throw new Error("검색 질의 인자가 너무 큽니다.");
        }
        if (delta?.type === "citations_delta") this.claudeCitation(delta.citation);
      }
      if (event.type === "content_block_stop" && this.claudeServer) {
        const server = this.claudeServer;
        if (server.json) { try { server.query = record(JSON.parse(server.json))?.query; } catch { this.failed = true; } }
        this.addQuery(server.query); this.claudeServer = undefined;
      }
      const usage = record(event.usage) ?? record(record(event.message)?.usage);
      const count = record(usage?.server_tool_use)?.web_search_requests;
      if (Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= 1000) this.state.requestCount = Number(count);
    } else if (provider === "responses") {
      if (typeof event.type === "string" && event.type.startsWith("response.web_search_call.")) {
        if (event.type.endsWith(".completed")) this.completedCall(event.item_id);
        if (event.type.endsWith(".failed")) this.failed = true;
      }
      if (event.type === "response.output_text.annotation.added") this.openAiCitation(event.annotation);
      if (record(event.item)) this.openAiItem(record(event.item)!);
      const output = record(event.response)?.output;
      if (Array.isArray(output)) for (const raw of output) { const item = record(raw); if (item) this.openAiItem(item); }
      if (event.type === "response.failed") this.failed = true;
    } else if (provider === "gemini") {
      const candidate = record(Array.isArray(event.candidates) ? event.candidates[0] : undefined);
      const grounding = record(candidate?.groundingMetadata);
      if (grounding) {
        if (Array.isArray(grounding.webSearchQueries)) for (const query of grounding.webSearchQueries) this.addQuery(query);
        if (this.queries.size) this.completedCall("google_search");
        if (Array.isArray(grounding.groundingChunks)) for (const raw of grounding.groundingChunks) {
          const web = record(record(raw)?.web); const citation = web ? safeCitation({ url: web.uri, title: web.title }) : undefined;
          if (this.geminiChunks.length >= MAX_SEARCH_CITATIONS) throw new Error("웹 출처 수가 안전 한도를 넘었습니다.");
          this.geminiChunks.push(citation); if (citation) this.addCitation(citation);
        }
        if (Array.isArray(grounding.groundingSupports)) {
          if (grounding.groundingSupports.length > 256) throw new Error("검색 근거 연결 수가 안전 한도를 넘었습니다.");
          for (const raw of grounding.groundingSupports) {
            const support = record(raw); const segment = record(support?.segment);
            if (!support || !Array.isArray(support.groundingChunkIndices)) continue;
            for (const index of support.groundingChunkIndices) {
              if (!Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= this.geminiChunks.length) continue;
              const citation = this.geminiChunks[Number(index)];
              if (citation) this.addCitation({ ...citation, citedText: text(segment?.text, 1000) });
            }
          }
        }
      }
    } else if (provider === "sonar") {
      if (Array.isArray(event.citations)) for (const url of event.citations) this.addCitation({ url });
      if (Array.isArray(event.search_results)) for (const result of event.search_results) this.addCitation(result);
      if (this.citations.size) this.completedCall("sonar");
      else if (Array.isArray(event.search_results) && event.search_results.length === 0) {
        this.completedCall("sonar"); this.sawEmpty = true;
      }
    }
    if (event.type === "error" || record(event.error)) this.failed = true;
    return this.snapshot();
  }
  private claudeCitation(raw: unknown): void {
    const c = record(raw); if (c?.type === "web_search_result_location") this.addCitation({ ...c, citedText: c.cited_text });
  }
  private openAiCitation(raw: unknown): void {
    const c = record(raw); if (c?.type !== "url_citation") return;
    const nested = record(c.url_citation) ?? c;
    this.addCitation({ ...nested, startIndex: nested.start_index, endIndex: nested.end_index });
  }
  private openAiItem(item: Record<string, unknown>): void {
    if (item.type === "web_search_call") {
      if (item.status === "failed") this.failed = true;
      if (item.status === "completed") this.completedCall(item.id);
      const action = record(item.action);
      this.addQuery(action?.query);
      if (Array.isArray(action?.queries)) action.queries.forEach((query) => this.addQuery(query));
    }
    if (item.type === "message" && Array.isArray(item.content)) for (const raw of item.content) {
      const content = record(raw); if (Array.isArray(content?.annotations)) content.annotations.forEach((a) => this.openAiCitation(a));
    }
  }
  snapshot(final = false): WebSearchExecution {
    return { ...this.state, status: this.failed ? "failed" : this.completed.size || (this.state.requestCount ?? 0) > 0
      ? this.sawEmpty && !this.citations.size ? "empty" : "executed" : final ? "missing" : "pending",
      queries: [...this.queries], citations: [...this.citations.values()],
      // Gemini grounding queries establish execution, but do not verify a provider call count.
      ...(this.state.provider === "gemini" || this.state.requestCount !== undefined ? {}
        : this.completed.size ? { requestCount: this.completed.size } : {}) };
  }
  failure(): WebSearchExecution { this.failed = true; return this.snapshot(true); }
}
