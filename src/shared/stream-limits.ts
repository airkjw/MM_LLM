export const MAX_CHAT_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_CHAT_DELTAS = 100_000;
export const MAX_CHAT_CITATIONS = 256;
export const MAX_CITATION_URL_BYTES = 8 * 1024;
export const MAX_CITATION_TOTAL_BYTES = 256 * 1024;

export class ChatStreamLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatStreamLimitError";
  }
}

export class ChatStreamBudget {
  private responseBytes = 0;
  private deltaCount = 0;
  private citationBytes = 0;
  private readonly citations = new Set<string>();

  acceptDelta(value: string): void {
    if (++this.deltaCount > MAX_CHAT_DELTAS) {
      throw new ChatStreamLimitError("답변 조각 수가 안전 한도를 넘어 생성을 중단했습니다. 작성된 부분은 저장했습니다.");
    }
    this.responseBytes += Buffer.byteLength(value, "utf8");
    if (this.responseBytes > MAX_CHAT_RESPONSE_BYTES) {
      throw new ChatStreamLimitError("답변 크기가 8MB 안전 한도를 넘어 생성을 중단했습니다. 작성된 부분은 저장했습니다.");
    }
  }

  /** Returns false for a duplicate citation. */
  acceptCitation(value: string): boolean {
    if (this.citations.has(value)) return false;
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > MAX_CITATION_URL_BYTES) {
      throw new ChatStreamLimitError("웹 출처 주소가 안전 길이 한도를 넘어 생성을 중단했습니다. 작성된 부분은 저장했습니다.");
    }
    if (this.citations.size >= MAX_CHAT_CITATIONS || this.citationBytes + bytes > MAX_CITATION_TOTAL_BYTES) {
      throw new ChatStreamLimitError("웹 출처 수 또는 전체 길이가 안전 한도를 넘어 생성을 중단했습니다. 작성된 부분은 저장했습니다.");
    }
    this.citations.add(value);
    this.citationBytes += bytes;
    return true;
  }
}
