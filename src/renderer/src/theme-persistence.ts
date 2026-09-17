export type ThemePreference = "system" | "light" | "dark";

type Waiter = {
  version: number;
  resolve: () => void;
  reject: (error: unknown) => void;
};

/**
 * Serialize writes while coalescing a burst to its latest requested theme.
 * A failed write never updates `persisted`, so the same theme remains retryable.
 */
export class ThemePersistence {
  private persisted: ThemePreference | null = null;
  private desired: ThemePreference | null = null;
  private version = 0;
  private running: Promise<void> | null = null;
  private waiters: Waiter[] = [];
  private readonly save: (theme: ThemePreference) => Promise<void>;

  constructor(save: (theme: ThemePreference) => Promise<void>) { this.save = save; }

  sync(theme: ThemePreference): Promise<void> {
    if (!this.running && this.persisted === theme) return Promise.resolve();

    this.desired = theme;
    const version = ++this.version;
    const result = new Promise<void>((resolve, reject) => this.waiters.push({ version, resolve, reject }));
    this.start();
    return result;
  }

  private start(): void {
    if (this.running) return;
    const run = Promise.resolve().then(() => this.drain());
    this.running = run.finally(() => {
      this.running = null;
      // Keep this guard so the serializer remains correct if drain gains a final await later.
      if (this.desired) this.start();
    });
  }

  private async drain(): Promise<void> {
    while (this.desired) {
      const theme = this.desired;
      const coveredVersion = this.version;
      this.desired = null;

      if (this.persisted === theme) {
        this.resolveThrough(coveredVersion);
        continue;
      }

      try {
        await this.save(theme);
        this.persisted = theme;
        this.resolveThrough(coveredVersion);
      } catch (error) {
        this.rejectThrough(coveredVersion, error);
      }
    }
  }

  private resolveThrough(version: number): void {
    this.settleThrough(version, (waiter) => waiter.resolve());
  }

  private rejectThrough(version: number, error: unknown): void {
    this.settleThrough(version, (waiter) => waiter.reject(error));
  }

  private settleThrough(version: number, settle: (waiter: Waiter) => void): void {
    const covered = this.waiters.filter((waiter) => waiter.version <= version);
    this.waiters = this.waiters.filter((waiter) => waiter.version > version);
    for (const waiter of covered) settle(waiter);
  }
}
