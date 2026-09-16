export type AccountSessionIdentity = { generation: number; profileId: string; apiKey: string };

export function assertAccountSessionIdentity(
  expected: AccountSessionIdentity, current: AccountSessionIdentity
): void {
  if (expected.generation !== current.generation || expected.profileId !== current.profileId ||
    expected.apiKey !== current.apiKey) {
    throw new Error("계정이 변경되어 요청 결과를 적용하지 않았습니다.");
  }
}

export class SessionTransitionMutex {
  private activeToken: number | null = null;
  private generation = 0;

  isActive(): boolean { return this.activeToken !== null; }
  currentGeneration(): number { return this.generation; }

  assertIdle(): void {
    if (this.activeToken !== null) throw new Error("계정 전환이 끝난 뒤 다시 시도해 주세요.");
  }

  assertGeneration(expected: number): void {
    if (this.activeToken !== null || this.generation !== expected) {
      throw new Error("계정이 변경되어 요청 결과를 적용하지 않았습니다.");
    }
  }

  async run<T>(operation: (generation: number) => Promise<T>): Promise<T> {
    this.assertIdle();
    const token = ++this.generation;
    this.activeToken = token;
    try { return await operation(token); }
    finally { if (this.activeToken === token) this.activeToken = null; }
  }
}
