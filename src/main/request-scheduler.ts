export type RequestLane = "standard" | "deep" | "chatbot" | "credit-reserving";

type Waiter = {
  lane: RequestLane;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

/**
 * Local guardrails intentionally stay below the documented gateway limits.
 * They coordinate every provider so parallel compare/research cannot stampede one API key.
 */
export class RequestScheduler {
  readonly totalConcurrency = 3;
  readonly deepConcurrency = 2;
  readonly standardPer60Seconds = 110;
  readonly chatbotPer60Seconds = 25;
  readonly creditReservingPer60Seconds = 280;
  private active = 0;
  private activeDeep = 0;
  private readonly queue: Waiter[] = [];
  private readonly timestamps: Record<"standard" | "chatbot" | "credit-reserving", number[]> = {
    standard: [], chatbot: [], "credit-reserving": []
  };
  private readonly allRequests: number[] = [];
  private timer: NodeJS.Timeout | null = null;

  acquire(lane: RequestLane = "standard", signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("요청이 취소되었습니다."));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { lane, resolve, reject, signal };
      waiter.onAbort = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        reject(signal?.reason ?? new Error("요청이 취소되었습니다."));
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.queue.push(waiter);
      this.drain();
    });
  }

  async run<T>(lane: RequestLane, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(lane, signal);
    try { return await task(); } finally { release(); }
  }

  snapshot(now = Date.now()): { active: number; activeDeep: number; queued: number;
    allRequestsInWindow: number; standardInWindow: number; chatbotInWindow: number; creditReservingInWindow: number } {
    this.prune(now);
    return { active: this.active, activeDeep: this.activeDeep, queued: this.queue.length,
      allRequestsInWindow: this.allRequests.length,
      standardInWindow: this.timestamps.standard.length,
      chatbotInWindow: this.timestamps.chatbot.length,
      creditReservingInWindow: this.timestamps["credit-reserving"].length };
  }

  private bucket(lane: RequestLane): "standard" | "chatbot" | "credit-reserving" {
    return lane === "chatbot" ? "chatbot" : lane === "credit-reserving" ? "credit-reserving" : "standard";
  }

  private limit(bucket: ReturnType<RequestScheduler["bucket"]>): number {
    return bucket === "chatbot" ? this.chatbotPer60Seconds
      : bucket === "credit-reserving" ? this.creditReservingPer60Seconds : this.standardPer60Seconds;
  }

  private prune(now: number): void {
    while (this.allRequests.length && now - this.allRequests[0] >= 60_000) this.allRequests.shift();
    for (const values of Object.values(this.timestamps)) {
      while (values.length && now - values[0] >= 60_000) values.shift();
    }
  }

  private canStart(waiter: Waiter, now: number): boolean {
    if (this.active >= this.totalConcurrency || waiter.lane === "deep" && this.activeDeep >= this.deepConcurrency) return false;
    const bucket = this.bucket(waiter.lane);
    return this.allRequests.length < this.standardPer60Seconds &&
      (bucket === "standard" || this.timestamps[bucket].length < this.limit(bucket));
  }

  private scheduleWake(now: number): void {
    if (this.timer) return;
    const due = this.queue.flatMap((waiter) => {
      const bucket = this.bucket(waiter.lane); const entries = this.timestamps[bucket];
      return [
        ...(this.allRequests.length >= this.standardPer60Seconds ? [this.allRequests[0] + 60_000] : []),
        ...(bucket !== "standard" && entries.length >= this.limit(bucket) ? [entries[0] + 60_000] : [])
      ];
    }).sort((a, b) => a - b)[0];
    if (!due) return;
    this.timer = setTimeout(() => { this.timer = null; this.drain(); }, Math.max(1, due - now));
    this.timer.unref();
  }

  private drain(): void {
    const now = Date.now(); this.prune(now);
    let started = false;
    for (let index = 0; index < this.queue.length;) {
      const waiter = this.queue[index];
      if (!this.canStart(waiter, now)) { index++; continue; }
      this.queue.splice(index, 1); waiter.signal?.removeEventListener("abort", waiter.onAbort!);
      this.active++; if (waiter.lane === "deep") this.activeDeep++;
      this.allRequests.push(now);
      const bucket = this.bucket(waiter.lane);
      if (bucket !== "standard") this.timestamps[bucket].push(now);
      else this.timestamps.standard.push(now);
      let released = false;
      waiter.resolve(() => {
        if (released) return; released = true;
        this.active--; if (waiter.lane === "deep") this.activeDeep--;
        this.drain();
      });
      started = true;
      if (this.active >= this.totalConcurrency) break;
    }
    if (!started && this.queue.length) this.scheduleWake(now);
  }
}

export const gatewayScheduler = new RequestScheduler();
