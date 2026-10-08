import type { UnsupportedContinuationReason } from "./contracts";

export function sanitizeUnsupportedContinuationReason(value: unknown): UnsupportedContinuationReason | undefined {
  return value === "claude_pause_turn" ? value : undefined;
}

export function unsupportedContinuationMessage(reason: UnsupportedContinuationReason | undefined): string | undefined {
  if (reason === "claude_pause_turn") {
    return "Claude 검색 턴이 일시 중단되었습니다. 이 검색 턴의 이어 생성은 지원하지 않습니다. 새 질문을 전송하면 별도 요청으로 추가 과금될 수 있습니다.";
  }
  return undefined;
}
