import type { MediaEstimateRequest, MediaQuote, QuoteBound } from "./contracts";
import { assertAllowedKeys, validatedImageOptions, validatedMusicOptions, validatedVideoOptions } from "./request-validation.ts";
import { imageRequestPayload, musicRequestPayload, videoRequestPayload } from "./media-capabilities.ts";
export const QUOTE_LABELS: Record<QuoteBound, string> = { exact: "확정", minimum: "최소", maximum: "최대", approximate: "대략" };
export const QUOTE_NOTICE = "견적 호출은 무료이며 크레딧을 예약하지 않습니다. 견적은 입력 유효성·생성 성공 보장이 아닙니다. 실제 생성 차감과 content_filter 별도 차감을 구분해 잔액에서 확인하세요.";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function normalizeEstimateRequest(value: unknown): MediaEstimateRequest {
  if (!record(value) || !["image", "video", "music"].includes(String(value.kind)) || typeof value.modelId !== "string" ||
    !value.modelId || value.modelId.length > 200 || /[\u0000-\u001f]/.test(value.modelId)) throw new Error("견적 종류·모델이 올바르지 않습니다.");
  const common = ["kind", "modelId"];
  if (value.kind === "image") {
    assertAllowedKeys(value, [...common, "numberOfImages", "aspectRatio", "quality", "imageSize", "background"], "이미지 견적");
    return { kind: "image", modelId: value.modelId, ...validatedImageOptions(value.modelId, value) };
  }
  if (value.kind === "video") {
    assertAllowedKeys(value, [...common, "aspectRatio", "durationSeconds", "resolution", "mode", "loop", "audio"], "영상 견적");
    return { kind: "video", modelId: value.modelId, ...validatedVideoOptions(value.modelId, value) };
  }
  assertAllowedKeys(value, [...common, "durationSeconds", "instrumental"], "음악 견적");
  const { durationSeconds, instrumental } = validatedMusicOptions(value.modelId, value);
  return { kind: "music", modelId: value.modelId, durationSeconds, instrumental };
}
export function estimatePayload(raw: MediaEstimateRequest): Record<string, unknown> {
  const request = normalizeEstimateRequest(raw);
  const options = request.kind === "image" ? imageRequestPayload({ ...request, prompt: "", imageAttachmentIds: [], deidentifiedConfirmed: false }, [])
    : request.kind === "video" ? videoRequestPayload({ ...request, prompt: "", imageAttachmentIds: [], deidentifiedConfirmed: false }, [])
      : musicRequestPayload({ ...request, lane: "music", prompt: "", deidentifiedConfirmed: false });
  const { prompt: _p, ...safe } = options;
  return { kind: request.kind, ...safe };
}
/** Same normalized options as generation. No private prompts/references in the fingerprint. */
export function estimateFingerprint(request: MediaEstimateRequest): string { return JSON.stringify(estimatePayload(request)); }
export function parseMediaQuote(value: unknown, request: MediaEstimateRequest, now = new Date().toISOString()): MediaQuote {
  const fail = () => { throw new Error("견적의 가격·모델·종류 또는 항목이 올바르지 않습니다. 비용을 확인할 수 없습니다."); };
  const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const bound = (v: unknown): v is QuoteBound => typeof v === "string" && Object.hasOwn(QUOTE_LABELS, v);
  const note = (v: unknown) => typeof v === "string" ? v.replace(/\u0000/g, "").slice(0, 2000) : undefined;
  if (!record(value) || value.object !== "estimate" || value.kind !== request.kind || value.model !== request.modelId ||
    !number(value.credits) || !bound(value.bound) || value.exact !== (value.bound === "exact") || !Array.isArray(value.lines) ||
    !value.lines.length || value.lines.length > 16 || value.note !== undefined && typeof value.note !== "string") return fail();
  const lines = value.lines.map(raw => {
    if (!record(raw) || ![request.kind, "content_filter"].includes(String(raw.item)) || !number(raw.credits) ||
      !bound(raw.bound) || raw.exact !== (raw.bound === "exact") || typeof raw.basis !== "string" || raw.basis.length > 100 ||
      raw.note !== undefined && typeof raw.note !== "string") return fail();
    return { item: raw.item as MediaQuote["lines"][number]["item"], credits: raw.credits, bound: raw.bound,
      exact: raw.exact as boolean, basis: raw.basis, ...(note(raw.note) ? { note: note(raw.note) } : {}) };
  });
  if (!lines.some(line => line.item === request.kind) || Math.abs(lines.reduce((sum,line)=>sum+line.credits,0)-value.credits) > .0002) return fail();
  return { kind: request.kind, modelId: request.modelId, credits: value.credits, bound: value.bound, exact: value.exact as boolean,
    lines, ...(note(value.note) ? { note: note(value.note) } : {}), fingerprint: estimateFingerprint(request), quotedAt: now };
}
