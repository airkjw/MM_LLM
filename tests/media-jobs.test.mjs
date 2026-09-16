import assert from "node:assert/strict";
import test from "node:test";
import { createPendingMediaJob, MEDIA_JOB_MAX_AGE_MS, nextMediaPollAt, terminalMediaResult } from "../src/main/media-jobs.ts";

test("pending media jobs persist terminal results until renderer acknowledgement", () => {
  const job = createPendingMediaJob("j1", "video", "v1", "op1", "영상", 1_000);
  assert.equal(Date.parse(job.expiresAt) - Date.parse(job.createdAt), MEDIA_JOB_MAX_AGE_MS);
  job.status = "completed"; job.updatedAt = new Date(9_000).toISOString();
  job.result = { status: "completed", videoUrl: "https://example.test/video.mp4" };
  assert.deepEqual(terminalMediaResult(job), { status: "completed", videoUrl: "https://example.test/video.mp4",
    jobId: "j1", kind: "video", createdAt: job.createdAt, elapsedMs: 8_000 });
});

test("media polling has bounded exponential backoff with jitter", () => {
  const job = createPendingMediaJob("j1", "image", "i1", "op1", "이미지", 0);
  job.attempts = 20;
  assert.equal(Date.parse(nextMediaPollAt(job, 1_000, () => .5)), 61_000);
});
