import assert from "node:assert/strict";
import test from "node:test";
import {
  audioLaneForModel, imageCapability, imageEstimate, imageRequestPayload, MEDIA_DOCS, musicEstimate,
  musicRequestPayload, sttEstimate, ttsRequestPayload, VIDEO_MODEL_IDS, videoCapability, videoEstimate,
  videoRequestPayload
} from "../src/shared/media-capabilities.ts";
import {
  buildMeetingReductionRound, buildMeetingSummaryPlan, formatTranscriptTimestamp,
  MAX_TRANSCRIPT_COMBINED_BYTES, parseTranscriptResult, transcriptForChat
} from "../src/shared/meeting-transcript.ts";
import {
  assertAllowedKeys, IPC_ALLOWED_KEYS, validatedImageOptions, validatedLanguageHints,
  validatedMusicOptions, validatedSpeakers, validatedVideoOptions
} from "../src/shared/request-validation.ts";
import {
  assertPendingJobResultSize, createPendingMediaJob, isPermanentMediaPollFailure,
  mediaJobIsExpired, shouldReleaseMediaSource, terminalMediaResult
} from "../src/main/media-jobs.ts";
import { MAX_STT_JSON_BYTES, readJsonResponseWithLimit } from "../src/shared/bounded-json.ts";
import { sttKickoffBilling } from "../src/shared/stt-billing.ts";
import { LatestRequestGate } from "../src/shared/request-generation.ts";
import {
  imageUsage, musicResponseMetadata, ttsTokenUsage, videoResponseMetadata
} from "../src/shared/media-response-metadata.ts";

test("image payload emits only parameters documented for the selected model", () => {
  const request = { modelId: "gemini-3.1-flash-image-preview", prompt: "hospital",
    imageAttachmentIds: [], aspectRatio: "16:9", numberOfImages: 3, imageSize: "2K",
    deidentifiedConfirmed: true };
  assert.deepEqual(imageRequestPayload(request, ["data:image/png;base64,AA=="]), {
    model: request.modelId, prompt: "hospital", number_of_images: 3, aspect_ratio: "16:9",
    image_size: "2K", input_images: ["data:image/png;base64,AA=="]
  });
  assert.deepEqual(validatedImageOptions(request.modelId, {
    aspectRatio: "16:9", numberOfImages: 4, imageSize: "4K"
  }), { aspectRatio: "16:9", numberOfImages: 4, imageSize: "4K", quality: undefined,
    background: undefined });
  assert.throws(() => validatedImageOptions(request.modelId, { numberOfImages: 5 }), /생성 개수/);
  assert.throws(() => validatedImageOptions("unknown-image", { numberOfImages: 1, aspectRatio: "16:9" }), /화면 비율/);

  const gpt = { modelId: "gpt-image-1.5", prompt: "hospital", imageAttachmentIds: [],
    numberOfImages: 1, quality: "high", imageSize: "1536x1024", background: "transparent",
    deidentifiedConfirmed: true };
  assert.deepEqual(imageRequestPayload(gpt, []), { model: "gpt-image-1.5", prompt: "hospital",
    number_of_images: 1, quality: "high", background: "transparent", size: "1536x1024" });
  assert.ok(imageCapability("gpt-image-2").sizes.includes("1024x1536"));
  assert.throws(() => validatedImageOptions("gpt-image-2", { numberOfImages: 1,
    background: "transparent" }), /배경/);
});

test("video payload maps provider-specific duration and resolution fields", () => {
  const request = { modelId: "veo-3.1-fast-generate-preview", prompt: "ward", imageAttachmentIds: [],
    aspectRatio: "9:16", durationSeconds: 8, deidentifiedConfirmed: true };
  assert.deepEqual(videoRequestPayload(request, ["data:image/png;base64,AA=="]), {
    model: request.modelId, prompt: "ward", parameters: { aspect_ratio: "9:16", duration_seconds: 8 },
    input_urls: ["data:image/png;base64,AA=="]
  });
  assert.deepEqual(validatedVideoOptions("xai/grok-imagine-video", {
    durationSeconds: 15, resolution: "720p"
  }), { aspectRatio: undefined, durationSeconds: 15, resolution: "720p", mode: undefined,
    loop: undefined, audio: undefined });
  assert.throws(() => validatedVideoOptions("veo-3.1-fast-generate-preview", { durationSeconds: 5 }), /길이/);
  assert.equal(videoRequestPayload({ modelId: "lightricks/ltx-2.5/pro", prompt: "ward",
    imageAttachmentIds: [], audio: true, deidentifiedConfirmed: true }, []).parameters.generate_audio, true);
  assert.equal(videoRequestPayload({ modelId: "fal-ai/vidu/q3", prompt: "ward",
    imageAttachmentIds: [], audio: true, deidentifiedConfirmed: true }, []).parameters.audio, true);
});

test("KHU video matrix includes all 19 current fixed-price models and their documented controls", () => {
  const expected = {
    "veo-3.1-generate-preview": [1600, [4, 6, 8], undefined, undefined, ["16:9", "9:16"]],
    "bytedance/seedance-2.5": [1165, [5, 10, 15, 30], undefined, ["480p", "720p"]],
    "fal-ai/vidu/q3": [770, undefined, [2, 16], ["360p", "540p", "720p", "1080p"]],
    "bytedance/seedance-2.0": [756, [5, 10], undefined, ["720p", "1080p"]],
    "lightricks/ltx-2.5/pro": [720, [6, 8, 10], undefined, ["720p", "1080p"]],
    "bytedance/seedance-2.0/fast": [605, [5, 10], undefined, ["720p"]],
    "veo-3.1-fast-generate-preview": [600, [4, 6, 8], undefined, undefined, ["16:9", "9:16"]],
    "lightricks/ltx-2.5/fast": [540, [6, 8, 10], undefined, ["720p", "1080p"]],
    "fal-ai/luma-dream-machine/ray-2": [500, [5, 9], undefined, ["540p", "720p", "1080p"]],
    "fal-ai/kling-video/o3": [420, undefined, [3, 15]],
    "fal-ai/kling-video/v3": [420, undefined, [3, 15]],
    "kwaivgi/kling-v2.5-turbo-pro": [350, [5, 10]],
    "pixverse/pixverse-v5": [300, [5, 8], undefined, ["360p", "480p", "540p", "720p", "1080p"]],
    "xai/grok-imagine-video": [300, undefined, [1, 15], ["480p", "720p"]],
    "minimax/hailuo-02": [270, [6], undefined, ["768p", "1080p"]],
    "bytedance/seedance-1-pro": [256, undefined, [2, 12], ["480p", "720p", "1080p"]],
    "veo-3.1-lite-generate-preview": [200, [4, 6, 8], undefined, undefined, ["16:9", "9:16"]],
    "bytedance/seedance-1.5-pro": [130, [5, 10], undefined, ["480p", "720p", "1080p"]],
    "bytedance/seedance-1.0-pro/fast": [97, [5, 10], undefined, ["480p", "720p", "1080p"]]
  };
  assert.deepEqual([...VIDEO_MODEL_IDS].sort(), Object.keys(expected).sort());
  for (const [id, [credits, durations, range, resolutions, ratios]] of Object.entries(expected)) {
    const capability = videoCapability(id);
    assert.equal(capability.creditsPerVideo, credits, id);
    assert.deepEqual(capability.durations, durations, `${id}: durations`);
    assert.deepEqual(capability.durationRange, range, `${id}: duration range`);
    assert.deepEqual(capability.resolutions, resolutions, `${id}: resolutions`);
    if (ratios) assert.deepEqual(capability.aspectRatios, ratios, `${id}: ratios`);
    assert.equal(capability.inputImageMax, 1, `${id}: image input`);
  }
  assert.equal(videoCapability("fal-ai/vidu/q3").audio, true);
  assert.equal(videoCapability("lightricks/ltx-2.5/pro").generateAudio, true);
  assert.equal(videoCapability("fal-ai/luma-dream-machine/ray-2").loop, true);
  assert.deepEqual(videoCapability("fal-ai/kling-video/o3").modes, ["standard", "pro"]);
});

test("TTS, music, and STT options use strict documented allowlists", () => {
  assert.deepEqual(ttsRequestPayload({ lane: "tts", modelId: "gemini-3.1-flash-tts-preview",
    input: "진행자: 안녕하세요", speakers: { 진행자: "Aoede", 참석자: "Charon" }, deidentifiedConfirmed: true }), {
    model: "gemini-3.1-flash-tts-preview", input: "진행자: 안녕하세요",
    speakers: { 진행자: "Aoede", 참석자: "Charon" }
  });
  assert.deepEqual(validatedSpeakers({ 진행자: "Aoede", 참석자: "Charon" }),
    { 진행자: "Aoede", 참석자: "Charon" });
  assert.throws(() => validatedSpeakers({ one: "Aoede" }), /두 명/);
  assert.deepEqual(validatedLanguageHints(["ko", "en", "ko"]), ["ko", "en"]);
  assert.throws(() => validatedLanguageHints(["ko", "en", "ja", "de", "fr", "es"]), /최대 5개/);

  const music = { lane: "music", modelId: "elevenlabs-music", prompt: "calm", lyrics: "hello",
    durationSeconds: 60, deidentifiedConfirmed: true };
  assert.deepEqual(musicRequestPayload(music), { model: "elevenlabs-music", prompt: "calm",
    lyrics: "hello", duration_seconds: 60 });
  assert.deepEqual(validatedMusicOptions("elevenlabs-music", { lyrics: "hello", durationSeconds: 180 }),
    { lyrics: "hello", durationSeconds: 180, instrumental: undefined });
  assert.throws(() => validatedMusicOptions("lyria-3-clip-preview", { lyrics: "no" }), /가사/);
  assert.throws(() => validatedMusicOptions("elevenlabs-music", { lyrics: "x", instrumental: true }), /동시에/);
});

test("STT parser preserves only compact speaker and timing metadata", () => {
  const parsed = parseTranscriptResult({ text: "Hello world", duration_seconds: 62.5, ignored: "secret",
    segments: [{ speaker: "Speaker 1", text: "Hello", start_ms: 1000, end_ms: 2500, confidence: .9 },
      { speaker: "Speaker 2", text: "world", start_ms: 2500, end_ms: 4000 }] });
  assert.deepEqual(parsed, { text: "Hello world", durationSeconds: 62.5, segments: [
    { speaker: "Speaker 1", text: "Hello", startMs: 1000, endMs: 2500 },
    { speaker: "Speaker 2", text: "world", startMs: 2500, endMs: 4000 }
  ] });
  assert.equal(formatTranscriptTimestamp(3_661_000), "1:01:01");
  assert.equal(transcriptForChat(parsed), "[0:01] Speaker 1: Hello\n[0:02] Speaker 2: world");
});

test("pending STT jobs persist local source and charge metadata across restart", () => {
  const created = createPendingMediaJob("j", "stt", "stt-async-v5", "opaque", "meeting", 0, {
    status: "processing", sourceAudioUrl: "mmllm://media/11111111-1111-1111-1111-111111111111",
    actualCredits: 12, durationSeconds: 120, billedDurationSeconds: 119.75
  });
  assert.equal(created.sourceAudioUrl, "mmllm://media/11111111-1111-1111-1111-111111111111");
  created.status = "completed"; created.result = { status: "completed", text: "done" };
  const result = terminalMediaResult(created);
  assert.equal(result.actualCredits, 12); assert.equal(result.durationSeconds, 120);
  assert.equal(result.billedDurationSeconds, 119.75);
  assert.equal(result.sourceAudioUrl, created.sourceAudioUrl);
});

test("STT response, transcript, persisted result, expiry, and source lifecycle are bounded", async () => {
  const oversized = new Response(new Uint8Array(MAX_STT_JSON_BYTES + 1), {
    headers: { "content-length": String(MAX_STT_JSON_BYTES + 1) }
  });
  await assert.rejects(readJsonResponseWithLimit(oversized, MAX_STT_JSON_BYTES), /저장 한도/);
  assert.throws(() => parseTranscriptResult({ text: "가".repeat(MAX_TRANSCRIPT_COMBINED_BYTES) }), /저장 한도/);
  assert.throws(() => assertPendingJobResultSize({ status: "completed", text: "x".repeat(4 * 1024 * 1024) }), /저장 한도/);
  const job = createPendingMediaJob("j", "stt", "stt", "op", "meeting", 1, {
    status: "processing", sourceAudioUrl: "mmllm://media/11111111-1111-1111-1111-111111111111"
  });
  assert.equal(mediaJobIsExpired(job, Date.parse(job.expiresAt) - 1), false);
  assert.equal(mediaJobIsExpired(job, Date.parse(job.expiresAt)), true);
  assert.equal(shouldReleaseMediaSource(job, "failed", 2), true);
  assert.equal(shouldReleaseMediaSource(job, "processing", 2), false);
  assert.equal(isPermanentMediaPollFailure(undefined, "받아쓰기 응답이 로컬 저장 한도를 넘었습니다."), true);
});

test("long meeting transcripts use user-controlled bounded map and recursive reduce drafts", () => {
  const result = { status: "completed", text: Array.from({ length: 4_000 }, (_, i) =>
    `${i}: 병원 운영 회의의 결정 사항과 실행 항목을 검토했습니다.`).join("\n") };
  assert.ok(result.text.length > 95_000);
  const plan = buildMeetingSummaryPlan(result, 20_000);
  assert.ok(plan.chunkCount > 1);
  assert.equal(plan.prompts.length, plan.chunkCount);
  assert.ok(plan.prompts.every((prompt) => prompt.length < 21_000));
  const round = buildMeetingReductionRound(["부분 요약 A".repeat(5_000), "부분 요약 B".repeat(5_000)], 20_000);
  assert.equal(round.final, false);
  assert.ok(round.prompts.every((prompt) => prompt.length < 21_000));
  const final = buildMeetingReductionRound(["짧은 부분 요약 A", "짧은 부분 요약 B"], 20_000);
  assert.equal(final.final, true); assert.equal(final.prompts.length, 1);
});

test("STT kickoff billing prefers kickoff body then documented headers and poll cannot overwrite it", () => {
  assert.deepEqual(sttKickoffBilling({ credits_charged: 12.5, duration_seconds: 119.75 },
    new Headers({ "x-credits-charged": "99", "x-audio-duration-seconds": "999" })), {
    actualCredits: 12.5, billedDurationSeconds: 119.75
  });
  assert.deepEqual(sttKickoffBilling({}, new Headers({ "x-credits-charged": "6.5",
    "x-audio-duration-seconds": "65.25" })), { actualCredits: 6.5, billedDurationSeconds: 65.25 });
  const job = createPendingMediaJob("j", "stt", "stt", "op", "meeting", 0,
    { status: "processing", billedDurationSeconds: 65.25, durationSeconds: 65 });
  job.status = "completed"; job.result = { status: "completed", durationSeconds: 66,
    billedDurationSeconds: 999, text: "done" };
  assert.equal(terminalMediaResult(job).billedDurationSeconds, 65.25);
});

test("official audio client routing treats only Soniox as STT and two documented clients as music", () => {
  assert.equal(audioLaneForModel({ id: "future-audio", type: "audio", audio_client: "future" }), "tts");
  assert.equal(audioLaneForModel({ id: "google-tts", type: "audio", audio_client: "google" }), "tts");
  assert.equal(audioLaneForModel({ id: "stt", type: "audio", audio_client: "soniox" }), "stt");
  assert.equal(audioLaneForModel({ id: "music", type: "audio", audio_client: "google_lyria3" }), "music");
  assert.equal(audioLaneForModel({ id: "music", type: "audio", audio_client: "elevenlabs" }), "music");
});

test("documented synchronous media and video polling metadata are retained compactly", () => {
  assert.deepEqual(imageUsage({ usage: { input_tokens: 7, output_tokens: 9, total_tokens: 16 } }),
    { inputTokens: 7, outputTokens: 9, totalTokens: 16 });
  assert.deepEqual(ttsTokenUsage(new Headers({ "x-input-tokens": "10", "x-output-tokens": "25" })),
    { inputTokens: 10, outputTokens: 25, totalTokens: 35 });
  assert.deepEqual(musicResponseMetadata(new Headers({ "x-audio-duration-seconds": "12.5",
    "x-music-structure": "<instrumental> [[A0]]" })), {
    durationSeconds: 12.5, billedDurationSeconds: 12.5, musicStructure: "<instrumental> [[A0]]"
  });
  assert.deepEqual(videoResponseMetadata({ video_model_id: "assigned-model-123", duration_seconds: 8 }),
    { videoModelId: "assigned-model-123", durationSeconds: 8 });
});

test("media request generations reject stale results after a lane or screen switch", () => {
  const gate = new LatestRequestGate(); const oldSubmit = gate.begin();
  gate.invalidate(); const currentSubmit = gate.begin();
  assert.equal(gate.isLatest(oldSubmit), false);
  assert.equal(gate.isLatest(currentSubmit), true);
});

test("settings, create-thread, thread-settings, and chat IPC objects reject unknown top-level keys", () => {
  for (const [label, keys] of Object.entries(IPC_ALLOWED_KEYS)) {
    const valid = Object.fromEntries(keys.map((key) => [key, undefined]));
    assert.doesNotThrow(() => assertAllowedKeys(valid, keys, label));
    assert.throws(() => assertAllowedKeys({ ...valid, injected: true }, keys, label), /지원하지 않는/);
  }
});

test("price estimates are versioned and unknown prices stay honest", () => {
  assert.match(imageEstimate("gpt-image-2", 2), /106/);
  assert.match(videoEstimate("veo-3.1-fast-generate-preview"), /600/);
  assert.match(musicEstimate("elevenlabs-music", 60), /150/);
  assert.match(sttEstimate(90), /9.0/);
  assert.match(videoEstimate("future-video"), /확인할 수 없습니다/);
  for (const entry of Object.values(MEDIA_DOCS)) {
    assert.match(entry.url, /^https:\/\/docs\.mindlogic\.ai\//);
    assert.equal(entry.lastVerified, "2026-09-16");
  }
});
