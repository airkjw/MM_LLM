import { shouldRetryGateway } from "../shared/gateway-retry.ts";
import { readJsonResponseWithLimit } from "../shared/bounded-json.ts";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export class GatewayError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const aborted = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", aborted); resolve(); }, ms);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

export function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1000));
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(30_000, Math.max(0, date - Date.now()));
  }
  return Math.min(8_000, 750 * 2 ** attempt);
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const json = await readJsonResponseWithLimit(response, 64 * 1024) as Record<string, unknown>;
    const detail = isRecord(json.detail) ? json.detail.message : json.detail;
    const error = isRecord(json.error) ? json.error.message : json.error;
    return [detail, error, json.message].find((item) => typeof item === "string" && item.trim()) as string ?? "";
  } catch { return ""; }
}

export async function gatewayRequest(url: string, init: RequestInit = {}, options: { fetch?: typeof fetch; timeoutMs?: number; sleep?: typeof abortableDelay } = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const timeout = AbortSignal.timeout(options.timeoutMs ?? (["GET", "HEAD"].includes(method) ? 30_000 : 10 * 60_000));
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const fetcher = options.fetch ?? fetch;
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { response = await fetcher(url, { ...init, signal }); }
    catch (error) {
      if (init.signal?.aborted) throw init.signal.reason;
      if (timeout.aborted) throw new Error("응답 대기 시간이 초과되었습니다. 연결을 확인한 뒤 다시 시도해 주세요. 생성 요청은 서버에서 처리되었을 수 있습니다.");
      throw new Error("서버에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.", { cause: error });
    }
    if (!shouldRetryGateway({ status: response.status, method, attempt })) break;
    await response.body?.cancel().catch(() => undefined);
    await (options.sleep ?? abortableDelay)(retryDelay(response, attempt), signal);
  }
  if (!response.ok) {
    const detail = await errorDetail(response);
    const suffix = detail ? ` (${detail.slice(0, 500)})` : "";
    if (response.status === 400) throw new GatewayError(400, `입력 형식이나 모델 설정을 확인해 주세요.${suffix}`);
    if (response.status === 401) throw new GatewayError(401, "API 키가 유효하지 않습니다.");
    if (response.status === 402) throw new GatewayError(402, "크레딧 잔액이 부족합니다.");
    if (response.status === 403) throw new GatewayError(403, "이 모델 또는 Gateway API에 대한 접근 권한이 없습니다.");
    if (response.status === 404) throw new GatewayError(404, "모델 또는 작업을 찾을 수 없습니다. 모델 목록을 새로고침해 주세요.");
    if (response.status === 413) throw new GatewayError(413, "첨부 자료가 API의 25MB 한도를 넘었습니다.");
    if (response.status === 429) throw new GatewayError(429, `요청이 많아 잠시 제한됐습니다. 잠시 후 다시 시도해 주세요.${suffix}`);
    throw new GatewayError(response.status, `ChatKHU API 오류 (${response.status}). 잠시 후 다시 시도해 주세요.${suffix}`);
  }
  return response;
}
