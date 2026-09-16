import assert from "node:assert/strict";
import test from "node:test";
import {
  chatCompletionOptions, combinedSystemInstruction, reasoningSupport, responsesOptions, tokenUsageFromEvent
} from "../src/shared/chat-options.ts";
import {
  assertThreadStoreByteLength, DEFAULT_INSTRUCTION, MAX_THREAD_STORE_BYTES, normalizeAppSettings, normalizeThreadPreferences, profileMoveCleanupFilenames,
  rankThreadRecords, resolveKeyRotationHash, settingsProfileFilename
} from "../src/main/storage-logic.ts";
import { safeExportFilename, serializeThreadMarkdown } from "../src/shared/thread-export.ts";
import {
  validatedAdvancedSettings, validatedAspectRatio, validatedTtsVoice
} from "../src/shared/request-validation.ts";
import { parseCreditsChargedHeader } from "../src/shared/credit-usage.ts";
import { assertAccountSessionIdentity, SessionTransitionMutex } from "../src/main/session-transition.ts";
import { LatestRequestGate } from "../src/shared/request-generation.ts";
import { isPristineThread } from "../src/shared/thread-state.ts";
import { staleRefreshDelay } from "../src/shared/refresh-policy.ts";
import { EpochRequestCache } from "../src/shared/epoch-request-cache.ts";

test("thread store rejects an oversized or corrupt byte count before persistence", () => {
  assert.doesNotThrow(() => assertThreadStoreByteLength(MAX_THREAD_STORE_BYTES));
  assert.throws(() => assertThreadStoreByteLength(MAX_THREAD_STORE_BYTES + 1), /96MB/);
  assert.throws(() => assertThreadStoreByteLength(Number.NaN), /96MB/);
});

test("reasoning controls only emit documented parameters for adjustable models", () => {
  const gpt = { id: "gpt-5.6-luna", owned_by: "openai" };
  const gemini = { id: "gemini-3.8-flash", owned_by: "google" };
  const claude = { id: "claude-sonnet-5", owned_by: "anthropic" };
  const qwen = { id: "qwen3.8-max", owned_by: "qwen" };
  const futureGpt = { id: "gpt-7-future", owned_by: "openai" };
  assert.equal(reasoningSupport(gpt), "adjustable");
  assert.equal(reasoningSupport(gemini), "adjustable");
  assert.equal(reasoningSupport(claude), "native-required");
  assert.equal(reasoningSupport(qwen), "model-managed");
  assert.deepEqual(chatCompletionOptions(gpt, "deep", { temperature: .3, maxOutputTokens: 4000 }), {
    reasoning_effort: "high", temperature: .3, max_completion_tokens: 4000
  });
  assert.deepEqual(chatCompletionOptions(gemini, "fast", { temperature: .4 }), {
    reasoning_effort: "low", temperature: .4
  });
  assert.deepEqual(chatCompletionOptions(claude, "deep", {}), {});
  assert.deepEqual(chatCompletionOptions(qwen, "deep", { temperature: .2, maxOutputTokens: 1000 }), {
    temperature: .2, max_tokens: 1000
  });
  assert.deepEqual(chatCompletionOptions(futureGpt, "deep", { temperature: .3 }), { reasoning_effort: "high", temperature: .3 });
  assert.deepEqual(responsesOptions(gpt, "balanced", { maxOutputTokens: 2048 }), {
    reasoning: { effort: "medium" }, max_output_tokens: 2048
  });
});

test("usage parser handles Chat Completions and Responses token schemas", () => {
  assert.deepEqual(tokenUsageFromEvent({ usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } }),
    { inputTokens: 12, outputTokens: 7, totalTokens: 19 });
  assert.deepEqual(tokenUsageFromEvent({ type: "response.completed", response: {
    usage: { input_tokens: 20, output_tokens: 9, total_tokens: 29,
      input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 5 } }
  } }), { inputTokens: 20, outputTokens: 9, totalTokens: 29, cachedInputTokens: 4, reasoningTokens: 5 });
  assert.equal(tokenUsageFromEvent({ usage: { credits: 3 } }), undefined);
  assert.equal(parseCreditsChargedHeader("2.5"), 2.5);
  assert.equal(parseCreditsChargedHeader("-1"), undefined);
  assert.equal(parseCreditsChargedHeader("unknown"), undefined);
});

test("global and per-thread instructions combine with an explicit precedence rule", () => {
  assert.equal(combinedSystemInstruction("전역 근거 지침", "이 대화는 표 형식"),
    "전역 근거 지침\n\n[이 대화의 추가 지침 — 충돌 시 이 지침을 우선 적용]\n이 대화는 표 형식");
  assert.equal(combinedSystemInstruction("", "대화 지침"), "대화 지침");
});

test("legacy threads and settings migrate to safe Phase 2 defaults", () => {
  assert.deepEqual(normalizeThreadPreferences({}), {
    pinned: false, instruction: "", reasoningMode: "auto", advanced: {}
  });
  assert.deepEqual(normalizeThreadPreferences({ pinned: 1, instruction: "표로", reasoningMode: "deep",
    advanced: { temperature: 9, maxOutputTokens: 10 } }), {
    pinned: true, instruction: "표로", reasoningMode: "deep",
    advanced: { temperature: 2, maxOutputTokens: 128 }
  });
  assert.deepEqual(normalizeAppSettings(undefined), {
    defaultInstruction: DEFAULT_INSTRUCTION, theme: "system", fontSize: "medium"
  });
});

test("encrypted-thread search ranks title and pinned matches without exposing hidden payloads", () => {
  const records = [
    { title: "대기시간 분석", updatedAt: "2026-01-02", pinned: false,
      messages: [{ text: "외래 대기시간은 24분입니다." }], apiContent: "SECRET" },
    { title: "병원 지표", updatedAt: "2026-01-01", pinned: true,
      messages: [{ text: "대기시간 개선 계획" }], apiContent: "HIDDEN" }
  ];
  const results = rankThreadRecords(records, "대기시간");
  assert.equal(results.length, 2);
  assert.equal(results[0].thread.title, "대기시간 분석");
  assert.doesNotMatch(results.map((item) => item.snippet).join(" "), /SECRET|HIDDEN/);

  const spread = rankThreadRecords([{
    title: "통합 분석", updatedAt: "2026-01-03", pinned: false,
    messages: [{ text: "외래 대기시간 자료" }, { text: "환자경험 개선안" }]
  }], "대기시간 환자경험");
  assert.equal(spread.length, 1);
});

test("IPC request helpers reject unknown ratios, voices, and malformed advanced settings", () => {
  assert.equal(validatedAspectRatio("16:9"), "16:9");
  assert.equal(validatedAspectRatio(""), undefined);
  assert.throws(() => validatedAspectRatio("2:1"), /화면 비율/);
  assert.equal(validatedTtsVoice("Kore"), "Kore");
  assert.throws(() => validatedTtsVoice("../voice"), /지원하지 않는 음성/);
  assert.deepEqual(validatedAdvancedSettings({ temperature: .7, maxOutputTokens: 2048 }), {
    temperature: .7, maxOutputTokens: 2048
  });
  assert.deepEqual(validatedAdvancedSettings({ claudeThinking: { mode: "adaptive", effort: "xhigh" } }),
    { claudeThinking: { mode: "adaptive", effort: "xhigh" } });
  assert.throws(() => validatedAdvancedSettings({ temperature: "1" }), /Temperature/);
  assert.throws(() => validatedAdvancedSettings({ maxOutputTokens: 127 }), /최대 출력 토큰/);
  assert.throws(() => validatedAdvancedSettings({ temperature: 1, extra: true }), /지원하지 않는/);
});

test("key rotation recovery follows only the saved old/new hash and move cleanup includes settings", () => {
  const oldHash = "a".repeat(24); const newHash = "b".repeat(24);
  assert.equal(resolveKeyRotationHash(oldHash, newHash, oldHash), oldHash);
  assert.equal(resolveKeyRotationHash(oldHash, newHash, newHash), newHash);
  assert.throws(() => resolveKeyRotationHash(oldHash, newHash, "c".repeat(24)), /안전하게 복구/);
  assert.deepEqual(profileMoveCleanupFilenames("profile-id", oldHash), [
    "threads-profile-profile-id.enc", "jobs-profile-profile-id.enc",
    "settings-profile-profile-id.enc", `threads-${oldHash}.enc`
  ]);
  const capturedTarget = settingsProfileFilename("profile-before-queue");
  assert.equal(capturedTarget, "settings-profile-profile-before-queue.enc");
});

test("session transitions are exclusive and invalidate earlier request generations", async () => {
  const mutex = new SessionTransitionMutex();
  let release;
  const running = mutex.run(() => new Promise((resolve) => { release = resolve; }));
  assert.equal(mutex.isActive(), true);
  assert.throws(() => mutex.assertIdle(), /계정 전환/);
  await assert.rejects(mutex.run(async () => undefined), /계정 전환/);
  release("done");
  assert.equal(await running, "done");
  mutex.assertIdle();

  const gate = new LatestRequestGate();
  const first = gate.begin(); const second = gate.begin();
  assert.equal(gate.isLatest(first), false);
  assert.equal(gate.isLatest(second), true);
  gate.invalidate();
  assert.equal(gate.isLatest(second), false);
});

test("account-bound async results reject profile, key, or generation drift", () => {
  const expected = { generation: 7, profileId: "profile-a", apiKey: "key-a" };
  assert.doesNotThrow(() => assertAccountSessionIdentity(expected, { ...expected }));
  assert.throws(() => assertAccountSessionIdentity(expected, { ...expected, generation: 8 }), /계정이 변경/);
  assert.throws(() => assertAccountSessionIdentity(expected, { ...expected, profileId: "profile-b" }), /계정이 변경/);
  assert.throws(() => assertAccountSessionIdentity(expected, { ...expected, apiKey: "key-b" }), /계정이 변경/);
});

test("only a truly pristine empty thread is reused by a template", () => {
  const base = { id: "t", title: "새 대화", modelId: "gpt-5.6-luna", createdAt: "2026-01-01",
    updatedAt: "2026-01-01", messageCount: 0, webSearchMode: "always", pinned: false,
    messages: [], attachmentConsent: false, instruction: "", reasoningMode: "auto", advanced: {} };
  assert.equal(isPristineThread(base), true);
  assert.equal(isPristineThread({ ...base, instruction: "표로" }), false);
  assert.equal(isPristineThread({ ...base, title: "이름 있음" }), false);
});

test("credit refresh is delayed to the 60 second boundary unless manually requested", () => {
  assert.equal(staleRefreshDelay(1_000, 31_000), 30_000);
  assert.equal(staleRefreshDelay(1_000, 61_000), 0);
  assert.equal(staleRefreshDelay(60_000, 60_100, true), 0);
});

test("credit cache never reuses an earlier account request after reset", async () => {
  const cache = new EpochRequestCache(60_000);
  let resolveOld; let resolveNew;
  const old = cache.get(() => new Promise((resolve) => { resolveOld = resolve; }));
  await Promise.resolve();
  cache.reset();
  const next = cache.get(() => new Promise((resolve) => { resolveNew = resolve; }));
  await Promise.resolve();
  assert.notEqual(old, next);
  resolveNew({ account: "new", remaining: 90 });
  assert.deepEqual(await next, { account: "new", remaining: 90 });
  resolveOld({ account: "old", remaining: 10 });
  assert.deepEqual(await old, { account: "old", remaining: 10 });
  assert.deepEqual(await cache.get(async () => ({ account: "unexpected" })),
    { account: "new", remaining: 90 });
});

test("Markdown export includes public status and usage but cannot serialize private API content", () => {
  const markdown = serializeThreadMarkdown({
    id: "t", title: "병원/분석", modelId: "gpt-5.6-luna", createdAt: "2026-01-01",
    updatedAt: "2026-01-02", messageCount: 2, webSearchMode: "always", pinned: false,
    attachmentConsent: false, instruction: "근거를 표시", reasoningMode: "deep", advanced: {},
    messages: [{ id: "u", role: "user", text: "분석", createdAt: "2026-01-01" },
      { id: "a", role: "assistant", text: "답변", createdAt: "2026-01-01", status: "incomplete",
        reasoningSummary: "공개된 안전 요약",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 2, reasoningTokens: 3 }, credits: 1.5 }]
  });
  assert.match(markdown, /중단되었습니다/);
  assert.match(markdown, /입력 10 · 출력 5 · 합계 15/);
  assert.match(markdown, /캐시 입력 2 · 추론 3/);
  assert.match(markdown, /실제 과금: 1.5 크레딧/);
  assert.match(markdown, /추론 요약[\s\S]*공개된 안전 요약/);
  assert.equal(safeExportFilename("병원/분석"), "병원-분석.md");
  assert.doesNotMatch(markdown, /apiContent|base64/);
});
