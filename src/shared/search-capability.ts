import type { ChatAdvancedSettings, GatewayModel, NativeSearchProvider, SearchCapability } from "./contracts";

/** Family matching selects a wire adapter only; it is never evidence of account support. */
export function nativeSearchProvider(model: Pick<GatewayModel, "id" | "type">): NativeSearchProvider | undefined {
  if (model.type !== "llm") return undefined;
  if (/^claude-/.test(model.id)) return "claude";
  if (/^(gpt-|o\d|codex)/.test(model.id)) return "responses";
  if (/^gemini-/.test(model.id)) return "gemini";
  if (["sonar-pro", "sonar-reasoning-pro"].includes(model.id)) return "sonar";
  return undefined;
}

export function searchCapabilityFromDetail(model: GatewayModel, detail: unknown, checkedAt: string): SearchCapability {
  const provider = nativeSearchProvider(model);
  const base = { provider, checkedAt };
  if (typeof detail !== "object" || detail === null || Array.isArray(detail) ||
      (detail as Record<string, unknown>).id !== model.id) return { ...base, status: "unknown", reason: "모델 상세 미확인" };
  const detailType = (detail as Record<string, unknown>).type;
  if (detailType !== undefined && detailType !== model.type) return { ...base, status: "unknown", reason: "모델 목록·상세 종류 불일치" };
  const pricing = (detail as Record<string, unknown>).pricing;
  const price = typeof pricing === "object" && pricing !== null && !Array.isArray(pricing)
    ? (pricing as Record<string, unknown>).web_search_per_1k : undefined;
  if (price === null) return { ...base, status: "unsupported", reason: "모델 상세: 자체 검색 미지원" };
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    return { ...base, status: "unknown", reason: "검색 가격·지원 정보 미확인" };
  }
  return provider ? { ...base, status: "supported", reason: "계정 모델 상세·공식 검색 도구 확인" }
    : { ...base, status: "unsupported", reason: "이 모델의 검색 연결 경로 미지원" };
}

export function nativeSearchSettingsError(provider: NativeSearchProvider, advanced: ChatAdvancedSettings): string | undefined {
  if (advanced.responses?.background) return "백그라운드 응답에서는 자체 웹 검색을 지원하지 않습니다. 검색을 끄거나 일반 응답을 선택해 주세요.";
  if (advanced.toolChoice === "none" || advanced.toolChoice === "required" || typeof advanced.toolChoice === "object") {
    return "자체 웹 검색과 수동 도구 선택 고정은 함께 사용할 수 없습니다. 도구 선택을 자동으로 바꿔 주세요.";
  }
  if (provider === "claude" && advanced.tools?.length) {
    return "Claude 자체 검색과 수동 도구를 함께 사용할 수 없습니다. 자체 검색을 끄거나 수동 도구를 비워 주세요.";
  }
  if (provider === "responses" && (advanced.temperature !== undefined || advanced.topP !== undefined || advanced.stop?.length)) {
    return "자체 검색의 Responses 경로에서는 Temperature·Top P·중단 문자열을 지원하지 않습니다. 해당 설정을 비워 주세요.";
  }
  if (provider === "gemini" && (advanced.tools?.length || advanced.structuredOutput || advanced.responses || advanced.claudeThinking)) {
    return "Gemini 자체 검색과 수동 도구·JSON Schema·다른 제공사 설정을 함께 사용할 수 없습니다. 해당 설정을 비워 주세요.";
  }
  return undefined;
}

export function sharedEvidenceModelError(model: Pick<GatewayModel, "id" | "type">): string | undefined {
  return nativeSearchProvider(model) === "sonar"
    ? "Sonar는 Gateway에서 검색 끄기를 보장하지 않아 공통 근거 전용 답변에 사용할 수 없습니다. 다른 대화 모델을 직접 선택해 주세요." : undefined;
}
