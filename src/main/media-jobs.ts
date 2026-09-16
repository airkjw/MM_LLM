import type { MediaResult, PendingMediaJob } from "../shared/contracts";

const BASE_DELAYS = { image: 5_000, video: 10_000, stt: 10_000 } as const;
export const MEDIA_JOB_MAX_AGE_MS = 24 * 60 * 60_000;
export const MAX_PENDING_JOB_RESULT_BYTES = 4 * 1024 * 1024;

export function mediaJobIsExpired(job: Pick<PendingMediaJob, "createdAt" | "expiresAt">, now = Date.now()): boolean {
  const fallback = Date.parse(job.createdAt) + MEDIA_JOB_MAX_AGE_MS;
  const expiresAt = Date.parse(job.expiresAt || new Date(fallback).toISOString());
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export function shouldReleaseMediaSource(
  job: Pick<PendingMediaJob, "sourceAudioUrl" | "createdAt" | "expiresAt">,
  status: MediaResult["status"] | undefined,
  now = Date.now()
): boolean {
  return Boolean(job.sourceAudioUrl) && (status === "failed" || mediaJobIsExpired(job, now));
}

export function isPermanentMediaPollFailure(status: number | undefined, message: string): boolean {
  return status !== undefined && [400, 401, 403, 404].includes(status) || /로컬 저장 한도/.test(message);
}

export function assertPendingJobResultSize(result: MediaResult | undefined): void {
  if (!result) return;
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_PENDING_JOB_RESULT_BYTES) {
    throw new Error("미디어 작업 결과가 로컬 저장 한도를 넘었습니다.");
  }
}

export function createPendingMediaJob(
  id: string, kind: PendingMediaJob["kind"], modelId: string, operationId: string,
  label: string, now = Date.now(), initial?: MediaResult
): PendingMediaJob {
  const createdAt = new Date(now).toISOString();
  return { id, kind, modelId, operationId, label, createdAt, updatedAt: createdAt,
    status: "processing", attempts: 0, nextPollAt: createdAt,
    expiresAt: new Date(now + MEDIA_JOB_MAX_AGE_MS).toISOString(),
    sourceAudioUrl: initial?.sourceAudioUrl, actualCredits: initial?.actualCredits,
    durationSeconds: initial?.durationSeconds, billedDurationSeconds: initial?.billedDurationSeconds,
    videoModelId: initial?.videoModelId };
}

export function nextMediaPollAt(job: PendingMediaJob, now = Date.now(), random = Math.random): string {
  const base = BASE_DELAYS[job.kind];
  const delay = Math.min(60_000, base * 2 ** Math.min(job.attempts, 4));
  const jitter = .85 + random() * .3;
  return new Date(now + Math.round(delay * jitter)).toISOString();
}

export function terminalMediaResult(job: PendingMediaJob): MediaResult | null {
  if (!job.result || !["completed", "failed"].includes(job.status)) return null;
  const sourceAudioUrl = job.result.sourceAudioUrl ?? job.sourceAudioUrl;
  const actualCredits = job.result.actualCredits ?? job.actualCredits;
  const durationSeconds = job.result.durationSeconds ?? job.durationSeconds;
  const billedDurationSeconds = job.billedDurationSeconds ?? job.result.billedDurationSeconds;
  const videoModelId = job.result.videoModelId ?? job.videoModelId;
  assertPendingJobResultSize(job.result);
  return { ...job.result,
    ...(sourceAudioUrl ? { sourceAudioUrl } : {}),
    ...(actualCredits !== undefined ? { actualCredits } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(billedDurationSeconds !== undefined ? { billedDurationSeconds } : {}),
    ...(videoModelId ? { videoModelId } : {}),
    jobId: job.id, kind: job.kind, createdAt: job.createdAt,
    elapsedMs: Date.parse(job.updatedAt) - Date.parse(job.createdAt) };
}
