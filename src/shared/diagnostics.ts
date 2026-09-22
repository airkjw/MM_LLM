export const DIAGNOSTIC_STAGES = ["general", "login", "chat", "media", "comparison", "backup", "update"] as const;
export type DiagnosticStage = typeof DIAGNOSTIC_STAGES[number];

/** Fixed fields only: never accepts errors, request bodies, paths, credentials or conversation text. */
export function diagnosticReport(input: { version: string; platform: string; arch: string; electron: string;
  stage: DiagnosticStage; modelId?: string }): string {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9._/ -]/g, "").slice(0, 200);
  return ["MM_LLM 진단 정보", `버전: ${safe(input.version)}`, `OS: ${safe(input.platform)} ${safe(input.arch)}`,
    `Electron: ${safe(input.electron)}`, `단계: ${DIAGNOSTIC_STAGES.includes(input.stage) ? input.stage : "general"}`,
    `모델: ${input.modelId ? safe(input.modelId) : "선택 없음"}`,
    "API 키, 대화 내용, 파일명, 사용자 경로는 포함하지 않습니다."].join("\n");
}
