/** Coalesces refreshes while guaranteeing one forced refresh after an automatic request. */
export class CreditRefreshQueue {
  private running: { manual: boolean; promise: Promise<void> } | null = null;
  private forced: Promise<void> | null = null;
  private generation = 0;

  reset(): void { this.generation++; this.running = null; this.forced = null; }

  run(manual: boolean, refresh: (manual: boolean) => Promise<void>): Promise<void> {
    if (this.running) {
      if (!manual || this.running.manual) return this.running.promise;
      if (!this.forced) {
        const generation = this.generation;
        const finish = () => generation === this.generation ? this.run(true, refresh) : Promise.resolve();
        const queued = this.running.promise.then(finish, finish);
        this.forced = queued;
        void queued.finally(() => { if (this.forced === queued) this.forced = null; }).catch(() => undefined);
      }
      return this.forced;
    }
    const promise = Promise.resolve().then(() => refresh(manual));
    this.running = { manual, promise };
    void promise.finally(() => {
      if (this.running?.promise === promise) this.running = null;
    }).catch(() => undefined);
    return promise;
  }
}
