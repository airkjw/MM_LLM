import type { GatewayModel, ServerCodeResult } from "./contracts";

/** Reviewed exact aliases, 2026-10-08. Catalog presence is required by main; it is not proof of tool permission. */
export const CODE_MODELS = {
  claude: ["claude-sonnet-5", "claude-sonnet-5-5", "claude-sonnet-4-5", "claude-sonnet-4-6",
    "claude-opus-4-5", "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-opus-5", "claude-opus-5-5",
    "claude-fable-5", "claude-fable-5-1", "claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-haiku-5-5"],
  responses: ["gpt-5.4", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-astra"]
} as const;
export function serverCodeProvider(model: Pick<GatewayModel, "id">): "claude" | "responses" | undefined {
  if ((CODE_MODELS.claude as readonly string[]).includes(model.id)) return "claude";
  if ((CODE_MODELS.responses as readonly string[]).includes(model.id)) return "responses";
  return undefined;
}
export const CODE_BILLING_NOTICE = "제공사 서버에서 실행합니다. Claude 최소 5분·OpenAI 최소 15분 컨테이너 과금과 토큰 비용이 별도 적용됩니다. 계정별 정확한 요금·실행 권한은 확인되지 않았습니다.";
export const CODE_ARTIFACT_NOTICE = "Gateway 산출물 다운로드 경로가 확인되지 않아 메타데이터만 표시합니다.";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const bounded = (value: unknown, limit: number) => typeof value === "string" ? value.replace(/\u0000/g, "").slice(0, limit) : undefined;
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : undefined;
function codeInput(name: unknown, input: Record<string, unknown>): string {
  if (name !== "text_editor_code_execution") return bounded(input.command, 8192) ?? bounded(input.code, 8192) ?? "";
  const safe = Object.fromEntries(["command", "path", "file_text", "old_str", "new_str"].flatMap(key =>
    typeof input[key] === "string" ? [[key, bounded(input[key], 8192)]] : []));
  return JSON.stringify(safe).slice(0, 8192);
}
const CODE_ERRORS = ["unavailable", "execution_time_exceeded", "invalid_tool_input", "too_many_requests", "output_file_too_large", "file_not_found"];

export function sanitizeServerCode(value: unknown): ServerCodeResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const results: ServerCodeResult[] = []; const seen = new Set<string>();
  for (const raw of value.slice(0, 8)) {
    if (!record(raw) || !id(raw.id) || seen.has(raw.id as string) || !["claude", "responses"].includes(String(raw.provider)) ||
      !["executing", "completed", "failed", "cancelled"].includes(String(raw.status))) continue;
    seen.add(raw.id as string);
    const artifacts: ServerCodeResult["artifacts"] = Array.isArray(raw.artifacts) ? raw.artifacts.slice(0, 8).flatMap((a) =>
      record(a) && ["file", "image"].includes(String(a.kind)) ? [{ kind: a.kind as "file" | "image",
        ...(id(a.id) ? { id: id(a.id) } : {}), ...(bounded(a.name, 200) ? { name: bounded(a.name, 200) } : {}) }] : []) : [];
    results.push({ id: raw.id as string, provider: raw.provider as ServerCodeResult["provider"],
      status: raw.status as ServerCodeResult["status"], code: bounded(raw.code, 8192) ?? "",
      ...(typeof raw.stdout === "string" ? { stdout: bounded(raw.stdout, 8192) } : {}),
      ...(typeof raw.stderr === "string" ? { stderr: bounded(raw.stderr, 4096) } : {}),
      ...(typeof raw.outputLogs === "string" ? { outputLogs: bounded(raw.outputLogs, 8192) } : {}),
      summary: bounded(raw.summary, 1000) ?? "실행 결과 미확인", artifacts });
  }
  return results.length ? results : undefined;
}
export function mergeServerCode(previous: ServerCodeResult[] = [], next: ServerCodeResult): ServerCodeResult[] {
  const found = previous.findIndex((r) => r.id === next.id);
  return sanitizeServerCode(found < 0 ? [...previous, next] : previous.map((r, index) => index === found ? next : r)) ?? [];
}
export function settleServerCode(results: ServerCodeResult[], status: "failed" | "cancelled", summary: string): ServerCodeResult[] {
  return results.map((r) => r.status === "executing" ? { ...r, status, summary } : r);
}

/** Untrusted provider data is projected into bounded public fields. No URLs, containers or raw envelopes survive. */
export class ServerCodeNormalizer {
  private readonly results = new Map<string, ServerCodeResult>();
  private readonly containers = new Map<string, string>();
  private readonly inputs = new Map<number, { id: string; json: string; name: unknown }>();
  private readonly provider: "claude" | "responses";
  constructor(provider: "claude" | "responses") { this.provider = provider; }
  private update(key: string | undefined, patch: Partial<ServerCodeResult>): ServerCodeResult[] {
    if (!key) return [];
    if (!this.results.has(key) && this.results.size >= 8) throw new Error("서버 코드 실행 결과는 한 턴에 최대 8개입니다.");
    const current = this.results.get(key) ?? { id: key, provider: this.provider, status: "executing", code: "", summary: "제공사 실행 중", artifacts: [] };
    const next = sanitizeServerCode([{ ...current, ...patch }])?.[0];
    if (!next) return []; this.results.set(key, next); return [next];
  }
  private claudeBlock(block: Record<string, unknown>, index = 0): ServerCodeResult[] {
    if (block.type === "server_tool_use" && ["bash_code_execution", "text_editor_code_execution", "code_execution"].includes(String(block.name))) {
      const key = id(block.id); if (!key) return [];
      if (this.inputs.size >= 8 && !this.inputs.has(index)) throw new Error("서버 도구 입력 블록이 안전 한도를 넘었습니다.");
      this.inputs.set(index, { id: key, json: "", name: block.name });
      const input = record(block.input) ? block.input : undefined;
      return this.update(key, { code: input ? codeInput(block.name, input) : "" });
    }
    if (!["bash_code_execution_tool_result", "text_editor_code_execution_tool_result", "code_execution_tool_result"].includes(String(block.type))) return [];
    const result = record(block.content) ? block.content : undefined; if (!result) return [];
    const failed = String(result.type).endsWith("_error") || ["bash_code_execution_result", "code_execution_result"].includes(String(result.type)) &&
      (!Number.isInteger(result.return_code) || result.return_code !== 0);
    const known = ["bash_code_execution_result", "code_execution_result", "text_editor_code_execution_view_result",
      "text_editor_code_execution_create_result", "text_editor_code_execution_str_replace_result"].includes(String(result.type));
    const artifacts: ServerCodeResult["artifacts"] = Array.isArray(result.content) ? result.content.slice(0, 8).flatMap((r) =>
      record(r) && id(r.file_id) ? [{ kind: "file" as const, id: id(r.file_id) }] : []) : [];
    return this.update(id(block.tool_use_id), { status: failed || !known ? "failed" : "completed",
      ...(typeof result.stdout === "string" ? { stdout: result.stdout } : {}),
      ...(typeof result.stderr === "string" ? { stderr: result.stderr } : {}), artifacts,
      summary: failed ? `서버 도구 오류: ${CODE_ERRORS.includes(String(result.error_code)) ? String(result.error_code) : Number.isInteger(result.return_code) ? `종료 코드 ${result.return_code}` : "알 수 없는 오류"}`
        : !known ? "서버 도구 결과 형식 미확인" : result.type === "text_editor_code_execution_view_result"
          ? bounded(result.content, 1000) ?? "파일 확인 완료" : "제공사 실행 완료" });
  }
  private responseItem(item: Record<string, unknown>): ServerCodeResult[] {
    if (item.type !== "code_interpreter_call") return [];
    const patch: Partial<ServerCodeResult> = {};
    if (id(item.container_id) && id(item.id) && (this.containers.size < 8 || this.containers.has(item.container_id as string))) this.containers.set(item.container_id as string, item.id as string);
    if (typeof item.code === "string") patch.code = item.code;
    if (Array.isArray(item.outputs)) {
      patch.outputLogs = item.outputs.filter((o) => record(o) && o.type === "logs" && typeof o.logs === "string")
        .slice(0, 8).map((o) => (o as Record<string, unknown>).logs).join("\n");
      patch.artifacts = [...(this.results.get(id(item.id) ?? "")?.artifacts.filter(a => a.kind === "file") ?? []),
        ...item.outputs.filter((o) => record(o) && o.type === "image").slice(0, 8).map(() => ({ kind: "image" as const }))].slice(0, 8);
    }
    const status = item.status;
    if (status === "completed") { patch.status = "completed"; patch.summary = "제공사 실행 완료 · 출력이 없으면 Gateway가 반환하지 않은 것입니다."; }
    else if (status === "failed" || status === "incomplete") { patch.status = "failed"; patch.summary = "서버 도구 실패 또는 완료 미확인"; }
    else if (status === "in_progress" || status === "interpreting") { patch.status = "executing"; patch.summary = "제공사 실행 중"; }
    return this.update(id(item.id), patch);
  }
  private artifact(annotation: unknown): ServerCodeResult[] {
    if (!record(annotation) || annotation.type !== "container_file_citation" || !id(annotation.container_id) || !id(annotation.file_id)) return [];
    const key = this.containers.get(annotation.container_id as string); const result = key ? this.results.get(key) : undefined;
    if (!key || !result || result.artifacts.some(a => a.id === annotation.file_id)) return [];
    return this.update(key, { artifacts: [...result.artifacts, { kind: "file", id: annotation.file_id as string,
      ...(bounded(annotation.filename, 200) ? { name: bounded(annotation.filename, 200) } : {}) }].slice(0, 8) });
  }
  private messageArtifacts(message: Record<string, unknown>): ServerCodeResult[] {
    if (message.type !== "message" || !Array.isArray(message.content)) return [];
    return message.content.filter(record).flatMap(c => Array.isArray(c.annotations) ? c.annotations.flatMap(a => this.artifact(a)) : []);
  }
  accept(event: Record<string, unknown>): ServerCodeResult[] {
    if (this.provider === "claude") {
      if (Array.isArray(event.content)) return event.content.filter(record).flatMap((b, i) => this.claudeBlock(b, i));
      const index = typeof event.index === "number" ? event.index : 0;
      if (event.type === "content_block_start" && record(event.content_block)) return this.claudeBlock(event.content_block, index);
      const input = this.inputs.get(index);
      if (event.type === "content_block_delta" && input && record(event.delta) && event.delta.type === "input_json_delta" && typeof event.delta.partial_json === "string") {
        input.json += event.delta.partial_json;
        if (input.json.length > 65536) throw new Error("서버 도구 입력이 안전 한도를 넘었습니다.");
        return [];
      }
      if (event.type === "content_block_stop" && input) {
        this.inputs.delete(index);
        if (!input.json) return [];
        let parsed: unknown; try { parsed = JSON.parse(input.json); } catch { return this.update(input.id, { status: "failed", summary: "서버 도구 입력 형식 오류" }); }
        return this.update(input.id, { code: record(parsed) ? codeInput(input.name, parsed) : "" });
      }
    } else {
      const out: ServerCodeResult[] = [];
      if (Array.isArray(event.output)) out.push(...event.output.filter(record).flatMap((i) => this.responseItem(i)));
      if (record(event.item)) out.push(...this.responseItem(event.item));
      if (record(event.response) && Array.isArray(event.response.output)) out.push(...event.response.output.filter(record).flatMap((i) => this.responseItem(i)));
      const output = Array.isArray(event.output) ? event.output : record(event.response) && Array.isArray(event.response.output) ? event.response.output : [];
      out.push(...output.filter(record).flatMap(i => this.messageArtifacts(i)));
      if (record(event.item)) out.push(...this.messageArtifacts(event.item));
      if (event.type === "response.output_text.annotation.added") out.push(...this.artifact(event.annotation));
      const key = id(event.item_id); const type = String(event.type);
      if (key && (type.startsWith("response.code_interpreter_call.") || type.startsWith("response.code_interpreter_call_code."))) {
        const action = type.split(".").at(-1);
        if (action === "delta" && typeof event.delta === "string") out.push(...this.update(key, { code: (this.results.get(key)?.code ?? "") + event.delta }));
        else if (action === "done" && typeof event.code === "string") out.push(...this.update(key, { code: event.code }));
        else if (["in_progress", "interpreting", "completed"].includes(action ?? "")) out.push(...this.update(key,
          { status: action === "completed" ? "completed" : "executing", summary: action === "completed" ? "제공사 실행 완료 · 출력 미확인" : "제공사 실행 중" }));
      }
      if (["response.failed", "response.incomplete", "error"].includes(String(event.type)))
        for (const r of this.results.values()) if (r.status === "executing") out.push(...this.update(r.id, { status: "failed", summary: "응답 중단 · 실행 완료 미확인" }));
      return out;
    }
    return [];
  }
}
