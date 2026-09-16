export const MAX_COMPARE_RESULT_BYTES = 2 * 1024 * 1024;
export const MAX_COMPARE_TOTAL_BYTES = 6 * 1024 * 1024;

export class CompareTextBudget {
  private readonly perModel = new Map<string, number>();
  private total = 0;

  accept(modelId: string, delta: string): void {
    const bytes = Buffer.byteLength(delta, "utf8");
    const modelBytes = (this.perModel.get(modelId) ?? 0) + bytes;
    if (modelBytes > MAX_COMPARE_RESULT_BYTES) throw new Error("이 모델의 비교 응답이 2MB 저장 한도를 넘었습니다.");
    if (this.total + bytes > MAX_COMPARE_TOTAL_BYTES) throw new Error("모델 비교 결과 전체가 6MB 저장 한도를 넘었습니다.");
    this.perModel.set(modelId, modelBytes); this.total += bytes;
  }

  modelBytes(modelId: string): number { return this.perModel.get(modelId) ?? 0; }
  totalBytes(): number { return this.total; }
}
