export function parseCreditsChargedHeader(raw: string | null | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export type CreditBucket = { quota?: number; used?: number; remaining?: number } | undefined;

function nonNegativeFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** UI-safe balance semantics. No transport error is ever inferred to mean a zero balance. */
export function creditPresentation(bucket: CreditBucket) {
  const used = nonNegativeFinite(bucket?.used);
  const remaining = nonNegativeFinite(bucket?.remaining);
  const explicitQuota = nonNegativeFinite(bucket?.quota);
  const derivedQuota = used !== undefined && remaining !== undefined && Number.isFinite(used + remaining)
    && used + remaining > 0 ? used + remaining : undefined;
  // A remaining balance larger than an explicit quota is contradictory. Keep the useful balance,
  // but suppress the ratio instead of drawing a misleading over-full progress bar.
  const quota = explicitQuota !== undefined && explicitQuota > 0 &&
    (remaining === undefined || remaining <= explicitQuota) ? explicitQuota
    : explicitQuota === undefined ? derivedQuota : undefined;
  const ratio = quota && remaining !== undefined ? remaining / quota : undefined;
  return {
    quota,
    used,
    remaining,
    empty: remaining === 0,
    low: ratio !== undefined && ratio > 0 && ratio <= 0.1
  };
}

export type CreditBalanceLike = {
  total?: CreditBucket; monthly_allocated?: CreditBucket; purchased?: CreditBucket;
} | undefined;

function finiteSum(values: number[]): number | undefined {
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number.isFinite(total) ? total : undefined;
}

/** Prefer the API total, then truthfully aggregate available monthly/purchased balances. */
export function creditBalancePresentation(balance: CreditBalanceLike) {
  const total = creditPresentation(balance?.total);
  if (total.remaining !== undefined) return { ...total, source: "total" as const };
  const monthlyExists = balance?.monthly_allocated !== undefined;
  const purchasedExists = balance?.purchased !== undefined;
  const monthly = creditPresentation(balance?.monthly_allocated);
  const purchased = creditPresentation(balance?.purchased);

  // One known component is a subtotal, not proof of the whole balance. In particular,
  // monthly=0 with no purchased bucket must never be announced as an empty account.
  if (monthlyExists !== purchasedExists) {
    const part = monthlyExists ? monthly : purchased;
    if (part.remaining === undefined) return { ...total, source: "unknown" as const };
    return {
      quota: undefined, used: undefined, remaining: part.remaining,
      empty: false, low: false, source: monthlyExists ? "monthly" as const : "purchased" as const
    };
  }
  if (!monthlyExists || monthly.remaining === undefined || purchased.remaining === undefined) {
    return { ...total, source: "unknown" as const };
  }
  const remaining = finiteSum([monthly.remaining, purchased.remaining]);
  if (remaining === undefined) return { ...total, source: "unknown" as const };
  const quotaSum = monthly.quota !== undefined && purchased.quota !== undefined
    ? finiteSum([monthly.quota, purchased.quota]) : undefined;
  const used = monthly.used !== undefined && purchased.used !== undefined
    ? finiteSum([monthly.used, purchased.used]) : undefined;
  const quota = quotaSum !== undefined && quotaSum > 0 && remaining <= quotaSum ? quotaSum : undefined;
  const ratio = quota && remaining <= quota ? remaining / quota : undefined;
  return {
    quota: ratio === undefined ? undefined : quota,
    used,
    remaining,
    empty: remaining === 0,
    low: ratio !== undefined && ratio > 0 && ratio <= 0.1,
    source: "components" as const
  };
}
