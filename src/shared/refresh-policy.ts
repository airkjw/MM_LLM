export const CREDIT_REFRESH_TTL_MS = 60_000;

export function staleRefreshDelay(lastRefreshAt: number, now: number, manual = false,
  ttl = CREDIT_REFRESH_TTL_MS): number {
  if (manual || !Number.isFinite(lastRefreshAt) || lastRefreshAt <= 0) return 0;
  return Math.max(0, ttl - Math.max(0, now - lastRefreshAt));
}
