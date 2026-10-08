import { randomUUID } from "node:crypto";
import { MCP_LIMIT_NOTICE, researchRecord, reviewedSearchSchema, validateResearchArguments, researchSources,
  type ResearchResult, type ResearchSuite, type ResearchTool } from "../shared/research";
import { researchJson, researchRequest, researchText } from "./research-transport";

const PROTOCOL = "2025-06-18";
type CachedTool = { suite: string; tool: ResearchTool };

export async function parseMcpResponse(response: Response, signal: AbortSignal, id: string): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? "";
  let envelope: unknown;
  if (contentType.includes("application/json")) envelope = await researchJson(response, signal);
  else if (contentType.includes("text/event-stream")) {
    const text = (await researchText(response, signal)).replace(/\r\n?/g, "\n");
    const events = text.split("\n\n").filter((block) => block.split("\n").some((line) => line.startsWith("data:")));
    // Gateway documents one message envelope. Ignore only comment/heartbeat blocks.
    if (events.length !== 1) throw new Error("MCP SSE message envelope 수가 올바르지 않습니다.");
    const lines = events[0].split("\n");
    if (lines.find((line) => line.startsWith("event:"))?.slice(6).trim() !== "message") throw new Error("지원하지 않는 MCP SSE 이벤트입니다.");
    envelope = JSON.parse(lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n"));
  } else throw new Error("지원하지 않는 MCP 응답 형식입니다.");
  if (!researchRecord(envelope) || envelope.jsonrpc !== "2.0" || envelope.id !== id ||
    ("result" in envelope) === ("error" in envelope)) throw new Error("MCP JSON-RPC 응답 ID 또는 구조가 올바르지 않습니다.");
  if ("error" in envelope) {
    const error = envelope.error;
    if (!researchRecord(error) || typeof error.code !== "number" || typeof error.message !== "string") throw new Error("MCP JSON-RPC error 구조가 올바르지 않습니다.");
    throw new Error(`MCP JSON-RPC 오류 ${error.code}: ${error.message.slice(0, 500)}. 실행된 도구 오류는 사용량에 포함될 수 있습니다.`);
  }
  if (!researchRecord(envelope.result)) throw new Error("MCP result 구조가 올바르지 않습니다.");
  return envelope.result;
}

/** Only discovered suite paths and reviewed tool tokens ever reach tools/call. */
export class McpClient {
  private suites: ResearchSuite[] = [];
  private tools = new Map<string, CachedTool>();
  private epoch = 0;
  private calls: number[] = [];
  clear(): void { this.epoch++; this.suites = []; this.tools.clear(); this.calls = []; }
  private assertEpoch(epoch: number, signal: AbortSignal): void {
    signal.throwIfAborted(); if (epoch !== this.epoch) throw new Error("계정 또는 검색 도구가 변경되어 응답을 폐기했습니다.");
  }
  async discover(key: string, signal: AbortSignal): Promise<ResearchSuite[]> {
    this.tools.clear(); this.suites = []; const epoch = ++this.epoch;
    const raw = await researchRequest(key, "/mcp/", undefined, signal, researchJson);
    this.assertEpoch(epoch, signal);
    if (!researchRecord(raw) || raw.object !== "list" || !Array.isArray(raw.data) || raw.data.length > 100) throw new Error("MCP 묶음 목록 형식이 문서 계약과 다릅니다.");
    const suites = raw.data.map((item): ResearchSuite => {
      if (!researchRecord(item) || typeof item.slug !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(item.slug) ||
        item.url !== `/v1/gateway/mcp/${item.slug}/` || item.transport !== "streamable-http" || typeof item.display_name !== "string") throw new Error("MCP 묶음 경로 또는 전송 계약을 확인하지 못했습니다.");
      return { slug: item.slug, title: item.display_name.slice(0, 200), description: typeof item.description === "string" ? item.description.slice(0, 1000) : "" };
    });
    if (new Set(suites.map((item) => item.slug)).size !== suites.length) throw new Error("중복 MCP 묶음입니다.");
    this.suites = suites; return suites;
  }
  private async rpc(key: string, suite: string, method: string, params: unknown, signal: AbortSignal) {
    const id = randomUUID();
    return researchRequest(key, `/mcp/${suite}/`, { jsonrpc: "2.0", id, method, params }, signal,
      (response, bounded) => parseMcpResponse(response, bounded, id));
  }
  async listTools(key: string, suite: string, signal: AbortSignal): Promise<ResearchTool[]> {
    if (!this.suites.some((item) => item.slug === suite)) throw new Error("먼저 이 계정의 검색 도구를 확인해 주세요.");
    const epoch = this.epoch;
    for (const [token, item] of this.tools) if (item.suite === suite) this.tools.delete(token);
    const initialized = await this.rpc(key, suite, "initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "MM_LLM", version: "0.5.1" } }, signal);
    this.assertEpoch(epoch, signal);
    if (initialized.protocolVersion !== PROTOCOL || !researchRecord(initialized.capabilities) || !researchRecord(initialized.capabilities.tools)) throw new Error("MCP 프로토콜 또는 tools capability를 확인하지 못했습니다.");
    const raw = await this.rpc(key, suite, "tools/list", {}, signal); this.assertEpoch(epoch, signal);
    if (!Array.isArray(raw.tools) || raw.tools.length > 100) throw new Error("MCP 도구 목록이 올바르지 않습니다.");
    // A cursor is surfaced; no automatic pagination or suite fan-out.
    return raw.tools.map((item): ResearchTool => {
      if (!researchRecord(item) || typeof item.name !== "string" || item.name.length > 200) throw new Error("MCP 도구 정보가 올바르지 않습니다.");
      const review = reviewedSearchSchema(item);
      const schema = JSON.stringify(item.inputSchema ?? {});
      const tool: ResearchTool = { token: randomUUID(), name: item.name,
        description: typeof item.description === "string" ? item.description.slice(0, 1500) : "",
        schema: schema.slice(0, 16000), executable: !review.reason && schema.length <= 16000 && !raw.nextCursor,
        reason: raw.nextCursor ? "목록이 일부만 반환되어 실행 검토를 완료하지 못했습니다." : review.reason,
        fields: review.fields };
      this.tools.set(tool.token, { suite, tool }); return tool;
    });
  }
  async search(key: string, token: string, args: unknown, signal: AbortSignal): Promise<ResearchResult> {
    const item = this.tools.get(token); const epoch = this.epoch;
    if (!item?.tool.executable) throw new Error("발견·검토한 읽기 전용 검색 도구만 실행할 수 있습니다.");
    const arguments_ = validateResearchArguments(item.tool.fields, args);
    const now = Date.now(); this.calls = this.calls.filter((time) => now - time < 86_400_000);
    if (this.calls.length >= 200 || this.calls.filter((time) => now - time < 60_000).length >= 30) throw new Error("이 앱에서 키 호출 한도에 도달했습니다. 다른 앱·조직·묶음 사용량은 Gateway가 판정합니다.");
    this.calls.push(now);
    let raw: Record<string, unknown>;
    try { raw = await this.rpc(key, item.suite, "tools/call", { name: item.tool.name, arguments: arguments_ }, signal); }
    catch (error) {
      // Permission/quota changes require rediscovery, with no automatic tool replay.
      this.tools.delete(token); throw error;
    }
    this.assertEpoch(epoch, signal);
    if (raw.isError === true) throw new Error("MCP 도구 실행 오류 (isError). 이 실행은 사용량에 포함될 수 있습니다. 자동 재시도하지 않았습니다.");
    if (!Array.isArray(raw.content) || raw.content.length > 100 || raw.isError !== undefined && typeof raw.isError !== "boolean") throw new Error("MCP 도구 응답 구조가 올바르지 않습니다.");
    const rawText = raw.content.flatMap((block) => researchRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n").slice(0, 30000);
    let structured: unknown = raw.structuredContent;
    if (!structured) { try { structured = JSON.parse(rawText); } catch { /* Plain text is still untrusted evidence. */ } }
    const searchedAt = new Date().toISOString();
    return { id: randomUUID(), suite: item.suite, tool: item.tool.name,
      query: String(arguments_[item.tool.fields.find((field) => field.required)!.name]), searchedAt,
      sources: researchSources(structured, searchedAt), rawText,
      notice: "검색 결과·초록은 원문 전체가 아닙니다. 법령 현행 여부는 미확인입니다. 제공된 날짜·조문·버전만 표시합니다." };
  }
}
export { MCP_LIMIT_NOTICE };
