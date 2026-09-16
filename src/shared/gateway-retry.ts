export type RetryDecisionInput = {
  status: number;
  method: string;
  attempt: number;
};

/** Retries only requests that cannot create a second billed generation. */
export function shouldRetryGateway({ status, method, attempt }: RetryDecisionInput): boolean {
  if (attempt >= 2) return false;
  const safe = ["GET", "HEAD"].includes(method.toUpperCase());
  if (!safe) return false;
  return status === 429 || status === 503;
}
