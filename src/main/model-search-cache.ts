import type { SearchCapability } from "../shared/contracts";

export const MODEL_SEARCH_CACHE_LIMIT = 64;
export const MODEL_SEARCH_CACHE_TTL_MS = 10 * 60_000;
/** Memory only, one account epoch. Failed optional discovery gets a short TTL. */
export class ModelSearchCache {
  private epoch = 0;
  private generation = 0;
  private entries = new Map<string, { value: SearchCapability; expires: number }>();
  private pending = new Map<string, { controller: AbortController; promise: Promise<SearchCapability> }>();
  clear(): void {
    this.epoch++; this.generation++;
    for (const entry of this.pending.values()) entry.controller.abort(new Error("계정이 변경되어 검색 기능 확인을 중단했습니다."));
    this.entries.clear(); this.pending.clear();
  }
  /** Drops cached results only. Lookups already in flight keep running, but their result is not cached. */
  invalidate(): void { this.generation++; this.entries.clear(); }
  peek(id: string, now = Date.now()): SearchCapability | undefined {
    const entry = this.entries.get(id);
    if (!entry || entry.expires <= now) { this.entries.delete(id); return undefined; }
    return entry.value;
  }
  async get(id: string, fetchDetail: (signal: AbortSignal) => Promise<SearchCapability>, signal?: AbortSignal): Promise<SearchCapability> {
    signal?.throwIfAborted();
    const cached = this.peek(id); if (cached) return cached;
    let entry = this.pending.get(id);
    if (!entry) {
      if (this.pending.size >= 4) throw new Error("검색 기능 확인이 진행 중입니다. 잠시 후 다시 확인해 주세요.");
      const epoch = this.epoch; const generation = this.generation; const controller = new AbortController();
      const promise = fetchDetail(controller.signal).then((value) => {
        controller.signal.throwIfAborted();
        if (epoch !== this.epoch) throw new Error("계정이 변경되었습니다.");
        if (generation !== this.generation) return value;
        if (this.entries.size >= MODEL_SEARCH_CACHE_LIMIT) this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(id, { value, expires: Date.now() + (value.status === "unknown" ? 30_000 : MODEL_SEARCH_CACHE_TTL_MS) });
        return value;
      }).finally(() => { if (epoch === this.epoch) this.pending.delete(id); });
      entry = { controller, promise }; this.pending.set(id, entry);
    }
    if (!signal) return entry.promise;
    // A caller's cancellation does not cancel another caller's shared GET.
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason ?? new Error("검색 기능 확인을 중단했습니다."));
      signal.addEventListener("abort", abort, { once: true });
      entry!.promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) abort();
    });
  }
}
