export class EpochRequestCache<T> {
  private epoch = 0;
  private cached: { value: T; at: number; epoch: number } | null = null;
  private request: { epoch: number; promise: Promise<T> } | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  reset(): void {
    this.epoch += 1;
    this.cached = null;
  }

  async get(load: () => Promise<T>, force = false): Promise<T> {
    const epoch = this.epoch;
    if (!force && this.cached?.epoch === epoch && this.now() - this.cached.at < this.ttlMs) {
      return this.cached.value;
    }
    if (this.request?.epoch === epoch) return this.request.promise;

    const pending: { epoch: number; promise: Promise<T> } = {
      epoch,
      promise: Promise.resolve().then(load).then((value) => {
        if (this.epoch === epoch) this.cached = { value, at: this.now(), epoch };
        return value;
      })
    };
    this.request = pending;
    try { return await pending.promise; }
    finally { if (this.request === pending) this.request = null; }
  }
}
