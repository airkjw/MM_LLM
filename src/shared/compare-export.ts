import type { CompareRun } from "./contracts";

export function serializeCompareAnalysis(run: CompareRun): string {
  if (!run.synthesis?.text.trim()) throw new Error("내보낼 종합분석 결과가 없습니다.");
  return ["# 모델 답변 종합분석", "", `질문: ${run.prompt}`, "",
    `분석 모델: ${run.synthesis.modelId}`, `분석 대상: ${run.results.map((item, i) => `${String.fromCharCode(65 + i)} · ${item.modelId}`).join(", ")}`,
    `상태: ${run.synthesis.status}`, "", "> 모델 간 합의는 사실 확인을 보장하지 않습니다. 근거와 불확실성을 함께 확인해 주세요.", "",
    run.synthesis.text, ""].join("\n");
}
