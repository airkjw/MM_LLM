import { parseCreditsChargedHeader } from "./credit-usage.ts";

function nonNegativeNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

/** The kickoff response is the billing authority; later poll duration is only transcript metadata. */
export function sttKickoffBilling(
  started: Record<string, unknown>,
  headers: Pick<Headers, "get">
): { actualCredits?: number; billedDurationSeconds?: number } {
  return {
    actualCredits: nonNegativeNumber(started.credits_charged) ??
      parseCreditsChargedHeader(headers.get("x-credits-charged")),
    billedDurationSeconds: nonNegativeNumber(started.duration_seconds) ??
      nonNegativeNumber(headers.get("x-audio-duration-seconds"))
  };
}
