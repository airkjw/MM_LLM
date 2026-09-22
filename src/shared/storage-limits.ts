export const MAX_THREADS = 500;
export const MAX_MESSAGES_PER_THREAD = 10_000;

/** Reading remains possible for old over-limit stores so users can export and delete records. */
export function assertThreadCapacity(count: number): void {
  if (count >= MAX_THREADS) throw new Error(`대화는 최대 ${MAX_THREADS}개까지 저장할 수 있습니다. 기존 대화를 내보낸 뒤 삭제해 주세요.`);
}

export function assertMessageCapacity(count: number, additional = 2): void {
  if (count + additional > MAX_MESSAGES_PER_THREAD) {
    throw new Error(`한 대화에는 메시지를 ${MAX_MESSAGES_PER_THREAD.toLocaleString("ko-KR")}개까지 저장할 수 있습니다. 새 대화에서 계속해 주세요.`);
  }
}

/** A cleanup mutation may reduce an old over-limit store, but may never grow it. */
export function assertStoreGrowth(
  next: Array<{ id: string; messages: unknown[] }>,
  previous: Array<{ id: string; messages: unknown[] }> = []
): void {
  if (next.length > MAX_THREADS && next.length > previous.length) assertThreadCapacity(next.length);
  const prior = new Map(previous.map((thread) => [thread.id, thread.messages.length]));
  for (const thread of next) {
    if (thread.messages.length > MAX_MESSAGES_PER_THREAD && thread.messages.length > (prior.get(thread.id) ?? 0)) {
      assertMessageCapacity(thread.messages.length, 0);
    }
  }
}
