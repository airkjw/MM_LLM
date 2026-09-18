import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAdvancedOptionsForModel, claudeAllowsSampling, claudeDefaultThinkingMode, claudeThinkingCapabilities, providerForModel, providerRoute, validateManualToolResult,
  validateManualTools, validateStrictJsonSchema
} from "../src/shared/advanced-chat.ts";
import {
  buildChatCompletionsPayload, buildClaudeCountTokensRequest, buildClaudePayload, buildProviderRequest, buildResponsesPayload,
  ProviderEventNormalizer, PROVIDER_API_REFERENCE, validateClaudeContinuation
} from "../src/shared/provider-adapters.ts";
import {
  BACKGROUND_TTL_MS, backgroundFailure, nextBackgroundPollDelay, normalizeBackgroundStatus,
  planBackgroundReconciliation, reconcileTerminalBackground,
  responseOutputText, responseReasoningSummary, responseToolCalls, upsertBackgroundResponseRecord
} from "../src/shared/responses-lifecycle.ts";
import {
  combineResearchResults, DEEP_RESEARCH_MAX_CALLS, parseResearchPlan
} from "../src/shared/deep-research.ts";
import { RequestScheduler } from "../src/main/request-scheduler.ts";
import { createVaultKey, decryptVaultBlob, encryptVaultBlob } from "../src/main/project-vault-crypto.ts";
import { BufferedChatbotTextSanitizer, chatbotFileExpiry, detectChatbotDocument, redactChatbotPublicUrls, validateChatbotFileUrl } from "../src/shared/chatbot-files.ts";
import { assertDroppedFileBatch } from "../src/shared/drop-limits.ts";
import { completeJournaledProjectDeletion } from "../src/shared/project-delete-recovery.ts";
import { CompareTextBudget, MAX_COMPARE_RESULT_BYTES } from "../src/shared/compare-limits.ts";
import {
  boundedCompareEvidence, buildCompareSynthesisMessages, canSynthesizeCompare, COMPARE_SYNTHESIS_MODEL_ID,
  compareSynthesisCandidates, CompareSynthesisTextBudget, MAX_COMPARE_SHARED_EVIDENCE_BYTES,
  MAX_COMPARE_SYNTHESIS_RESULT_BYTES
} from "../src/shared/compare-synthesis.ts";
import { chatbotRequestBody, chatbotUsageSummary, normalizeChatbotUsage } from "../src/shared/chatbot-adapter.ts";
import { fitWorkspaceState } from "../src/shared/workspace-storage-policy.ts";

const openai = { id: "gpt-6-astra", type: "llm", owned_by: "openai" };
const claude = { id: "claude-opus-4-6", type: "llm", owned_by: "anthropic" };
const gemini = { id: "gemini-3.8-flash", type: "llm", owned_by: "google" };
const messages = [{ role: "system", content: "stable" }, { role: "user", content: "hello" }];

test("provider routing is decided before POST and chatbot ids reject path/control characters", () => {
  assert.equal(PROVIDER_API_REFERENCE.lastVerified, "2026-09-16");
  assert.equal(providerForModel(claude), "claude");
  assert.equal(providerForModel(openai, { responses: { chain: true } }), "responses");
  assert.equal(providerForModel({ ...openai, id: "gpt-6-codex" }), "responses");
  assert.equal(providerRoute("claude"), "/claude/v1/messages/");
  assert.equal(providerRoute("responses"), "/responses/");
  assert.equal(providerRoute("chatbot", "opaque:id"), "/chatbots/opaque%3Aid/chat/completions/");
  assert.throws(() => providerRoute("chatbot", "bad/id"), /형식/);
  assert.throws(() => providerRoute("chatbot", "bad\n"), /형식/);
});

test("Chat payload maps provider token and Gemini thinking fields exactly", () => {
  const payload = buildChatCompletionsPayload({ model: gemini, messages, reasoningMode: "auto",
    advanced: { maxOutputTokens: 512, topP: .8, stop: ["END"], thinkingLevel: "high" }, stream: true });
  assert.equal(payload.max_tokens, 512);
  assert.equal(payload.thinking_level, "high");
  assert.deepEqual(payload.stop, ["END"]);
  assert.equal("thinking_budget" in payload, false);
});

test("Responses chain sends latest input with previous id and structured output", () => {
  const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
  const payload = buildResponsesPayload({ model: openai, messages: [...messages, { role: "assistant", content: "old" },
    { role: "user", content: "new" }], reasoningMode: "deep", advanced: { responses: { chain: true, reasoningSummary: "auto" },
    structuredOutput: { name: "answer", schema } }, stream: true, previousResponseId: "resp_1" });
  assert.equal(payload.previous_response_id, "resp_1");
  assert.equal(payload.instructions, "stable");
  assert.equal(payload.input.length, 1);
  assert.equal(payload.input[0].content, "new");
  assert.equal(payload.reasoning.effort, "high");
  assert.equal(payload.text.format.strict, true);
});

test("Responses supports documented manual function tools and function_call_output", () => {
  const schema = { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false };
  const payload = buildResponsesPayload({ model: openai, messages: [{ role: "user", content: "find" },
    { role: "assistant", content: "", tool_calls: [{ id: "call_1", function: { name: "lookup", arguments: '{"id":1}' } }] },
    { role: "tool", tool_call_id: "call_1", content: '{"name":"A"}' }], reasoningMode: "deep",
    advanced: { tools: [{ name: "lookup", parameters: schema }], toolChoice: { name: "lookup" } }, stream: true });
  assert.deepEqual(payload.tools[0], { type: "function", name: "lookup", parameters: schema, strict: true });
  assert.deepEqual(payload.tool_choice, { type: "function", name: "lookup" });
  assert.deepEqual(payload.input.slice(-2), [
    { type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"id":1}' },
    { type: "function_call_output", call_id: "call_1", output: '{"name":"A"}' }
  ]);
  assert.doesNotThrow(() => assertAdvancedOptionsForModel(openai, { responses: { chain: true },
    tools: [{ name: "lookup", parameters: schema }] }));
});

test("Responses converts multimodal user content and reasoning+tools routes through Responses", () => {
  const schema = { type: "object", properties: {}, required: [], additionalProperties: false };
  const request = buildProviderRequest({ model: openai, messages: [{ role: "user", content: [
    { type: "text", text: "inspect" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }
  ] }], reasoningMode: "deep", advanced: { tools: [{ name: "lookup", parameters: schema }] }, stream: true });
  assert.equal(request.path, "/responses/");
  assert.deepEqual(request.body.input[0].content, [
    { type: "input_text", text: "inspect" }, { type: "input_image", image_url: "data:image/png;base64,AA==" }
  ]);
  assert.equal(request.body.reasoning.effort, "high");
});

test("Claude native payload uses top-level system/PDF/cache/thinking and never Chat stop", () => {
  const pdf = Buffer.from("%PDF-1.7\n").toString("base64");
  const built = buildClaudePayload({ model: claude, messages: [{ role: "system", content: "policy" }, { role: "user", content: [
    { type: "text", text: "read" }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf },
      cache_control: { type: "ephemeral" } }
  ] }], reasoningMode: "auto", advanced: { topP: .95, maxOutputTokens: 5000,
    claudeThinking: { mode: "adaptive", effort: "max" } }, stream: true });
  assert.equal(built.body.max_tokens, 5000);
  assert.equal(built.body.thinking.type, "adaptive");
  assert.equal(built.body.temperature, undefined);
  assert.equal(built.body.stop, undefined);
  assert.equal(built.body.top_p, .95);
  assert.equal(built.body.top_k, undefined);
  assert.equal(built.body.system[0].cache_control.type, "ephemeral");
  assert.equal(built.body.messages[0].content[1].type, "document");
  assert.ok(built.beta.includes("prompt-caching-2024-07-31"));
});

test("Claude Messages and count_tokens share a bounded prompt-cache breakpoint strategy", () => {
  const pdf = Buffer.from("%PDF-1.7\n").toString("base64");
  const pdfBlocks = Array.from({ length: 5 }, () => ({
    type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf },
    cache_control: { type: "ephemeral" }
  }));
  const input = { model: claude, messages: [{ role: "system", content: "stable policy" },
    { role: "user", content: [{ type: "text", text: "review" }, ...pdfBlocks] }],
  reasoningMode: "auto", advanced: {}, stream: true };
  const messagesPayload = buildClaudePayload(input).body;
  const countPayload = buildClaudeCountTokensRequest(input).body;
  const countBreakpoints = (value) => {
    if (Array.isArray(value)) return value.reduce((total, item) => total + countBreakpoints(item), 0);
    if (!value || typeof value !== "object") return 0;
    return (Object.hasOwn(value, "cache_control") ? 1 : 0) +
      Object.values(value).reduce((total, item) => total + countBreakpoints(item), 0);
  };
  assert.equal(countBreakpoints(messagesPayload), 2);
  assert.equal(countBreakpoints(countPayload), 2);
  assert.ok(countBreakpoints(messagesPayload) <= 4);
  assert.ok(countBreakpoints(countPayload) <= 4);
  const documents = messagesPayload.messages[0].content.filter((block) => block.type === "document");
  assert.deepEqual(documents.map((block) => Boolean(block.cache_control)), [false, false, false, false, true]);
});

test("Claude normalizer never exposes thinking/signature but keeps cache usage and manual tool calls", () => {
  const normalizer = new ProviderEventNormalizer("claude");
  assert.deepEqual(normalizer.accept({ type: "content_block_start", content_block: { type: "thinking" } }),
    [{ type: "progress", message: "사고 중…" }]);
  assert.deepEqual(normalizer.accept({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "secret" } }), []);
  assert.deepEqual(normalizer.accept({ type: "content_block_delta", delta: { type: "signature_delta", signature: "secret" } }), []);
  const usage = normalizer.accept({ type: "message_start", message: { usage: {
    input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 5, cache_read_input_tokens: 7
  } } }).find((event) => event.type === "usage");
  assert.deepEqual(usage.usage, { inputTokens: 10, outputTokens: 2, totalTokens: 12,
    cacheCreationInputTokens: 5, cacheReadInputTokens: 7 });
  normalizer.accept({ type: "content_block_start", content_block: { type: "tool_use", id: "t1", name: "lookup" } });
  normalizer.accept({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"id":1}' } });
  assert.equal(normalizer.accept({ type: "content_block_stop" })[0].call.arguments, '{"id":1}');
});

test("Claude hidden continuation preserves signed thinking only for provider replay", () => {
  const normalizer = new ProviderEventNormalizer("claude");
  normalizer.accept({ type: "content_block_start", content_block: { type: "thinking" } });
  normalizer.accept({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "private" } });
  normalizer.accept({ type: "content_block_delta", delta: { type: "signature_delta", signature: "signed" } });
  normalizer.accept({ type: "content_block_stop" });
  normalizer.accept({ type: "content_block_start", content_block: { type: "tool_use", id: "tool_1", name: "lookup" } });
  normalizer.accept({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{}" } });
  normalizer.accept({ type: "content_block_stop" });
  const state = normalizer.accept({ type: "message_stop" }).find((item) => item.type === "provider_state");
  assert.equal(state.claudeContinuation[0].signature, "signed");
  const payload = buildClaudePayload({ model: { ...claude, id: "claude-opus-4-6" }, messages: [
    { role: "assistant", content: "", claudeContinuation: state.claudeContinuation },
    { role: "tool", tool_call_id: "tool_1", content: "{}" }
  ], reasoningMode: "deep", advanced: { tools: [{ name: "lookup", parameters: {
    type: "object", properties: {}, required: [], additionalProperties: false
  } }], claudeThinking: { mode: "adaptive" } }, stream: true });
  assert.equal(payload.body.messages[0].content[0].thinking, "private");
  assert.equal(payload.body.messages[1].content[0].type, "tool_result");
  assert.throws(() => validateClaudeContinuation([{ type: "thinking", thinking: "x" }]), /올바르지/);
});

test("provider normalizers preserve incomplete/refusal/reasoning and merged Claude usage", () => {
  const responses = new ProviderEventNormalizer("responses");
  assert.deepEqual(responses.accept({ type: "response.refusal.delta", delta: "거절" }), [{ type: "text", text: "거절" }]);
  assert.deepEqual(responses.accept({ type: "response.reasoning_summary_text.delta", delta: "검토" }),
    [{ type: "reasoning_summary", text: "검토" }]);
  assert.deepEqual(responses.accept({ type: "response.reasoning_summary_text.done", text: "검토 완료" }),
    [{ type: "reasoning_summary", text: " 완료" }]);
  assert.equal(responses.accept({ type: "response.incomplete", response: { id: "resp_1" } })[0].status, "incomplete");
  assert.equal(responses.accept({ type: "error", error: { message: "bad" } })[0].type, "error");
  const chat = new ProviderEventNormalizer("chat");
  assert.equal(chat.accept({ choices: [{ finish_reason: "length", delta: {} }] })[0].status, "incomplete");
  const native = new ProviderEventNormalizer("claude");
  native.accept({ type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 3 } } });
  const merged = native.accept({ type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 7 } });
  assert.equal(merged.find((item) => item.type === "usage").usage.inputTokens, 10);
  assert.deepEqual(merged.find((item) => item.type === "usage").usage,
    { inputTokens: 10, outputTokens: 7, totalTokens: 17, cacheReadInputTokens: 3 });
  assert.equal(merged.find((item) => item.type === "status").status, "incomplete");
});

test("strict schemas and manual JSON tool results reject permissive or oversized shapes", () => {
  const schema = { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false };
  assert.equal(validateStrictJsonSchema(schema), schema);
  assert.throws(() => validateStrictJsonSchema({ ...schema, additionalProperties: true }), /additionalProperties/);
  assert.equal(validateManualTools([{ name: "lookup", parameters: schema }]).length, 1);
  assert.equal(validateManualToolResult('{"ok":true}'), '{"ok":true}');
  assert.throws(() => validateManualToolResult("not-json"), /유효한 JSON/);
  assert.throws(() => assertAdvancedOptionsForModel(claude, { stop: ["x"] }), /지원하지/);
});

test("provider normalizers preserve Responses lifecycle statuses and ignore unknown events", () => {
  const normalizer = new ProviderEventNormalizer("responses");
  assert.deepEqual(normalizer.accept({ type: "response.output_text.delta", delta: "hi" }), [{ type: "text", text: "hi" }]);
  assert.deepEqual(normalizer.accept({ type: "future.unknown", payload: "ignore" }), []);
  assert.deepEqual(normalizer.accept({ type: "response.completed", response: { id: "resp_9", usage: {
    input_tokens: 2, output_tokens: 3, total_tokens: 5 } } }), [
    { type: "status", status: "completed", responseId: "resp_9" },
    { type: "usage", usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } }
  ]);
  const failed = normalizer.accept({ type: "response.failed", response: { id: "resp_f", usage: {
    input_tokens: 4, output_tokens: 1, total_tokens: 5 }, error: { message: "failed" } } });
  assert.equal(failed[0].type, "usage"); assert.equal(failed[1].type, "error");
});

test("Responses terminal events recover a final-only answer without duplicating streamed text", () => {
  const finalOnly = new ProviderEventNormalizer("responses");
  assert.deepEqual(finalOnly.accept({ type: "response.completed", response: { id: "resp_final", output: [
    { type: "message", content: [{ type: "output_text", text: "최종 종합 답변" }] }
  ] } }), [
    { type: "text", text: "최종 종합 답변" },
    { type: "status", status: "completed", responseId: "resp_final" }
  ]);

  const streamed = new ProviderEventNormalizer("responses");
  assert.deepEqual(streamed.accept({ type: "response.output_text.delta", delta: "이미 받은 답변" }),
    [{ type: "text", text: "이미 받은 답변" }]);
  assert.deepEqual(streamed.accept({ type: "response.completed", response: { id: "resp_streamed", output: [
    { type: "message", content: [{ type: "output_text", text: "이미 받은 답변" }] }
  ] } }), [{ type: "status", status: "completed", responseId: "resp_streamed" }]);
});

test("background parsing preserves partial output, failures, and bounded polling", () => {
  assert.deepEqual([0, 1, 2, 3, 99].map(nextBackgroundPollDelay), [5000, 10000, 20000, 60000, 60000]);
  assert.equal(normalizeBackgroundStatus("future"), "in_progress");
  assert.equal(responseOutputText({ output: [{ content: [{ type: "output_text", text: "partial" }] }] }), "partial");
  assert.equal(backgroundFailure({ incomplete_details: "limit" }), "limit");
  assert.equal(backgroundFailure({ incomplete_details: { reason: "max_output_tokens" } }), "max_output_tokens");
  assert.equal(responseOutputText({ output: [{ content: [{ type: "refusal", refusal: "cannot" }] }] }), "cannot");
  assert.deepEqual(responseToolCalls({ output: [{ type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" }] }),
    [{ id: "call_1", name: "lookup", arguments: "{}", status: "waiting" }]);
  assert.equal(responseReasoningSummary({ output: [{ type: "reasoning", summary: [
    { type: "summary_text", text: "공개 요약" }
  ] }] }), "공개 요약");
  const thread = { advanced: { responses: { chain: true } }, messages: [{ id: "m1", role: "assistant", text: "처리 중",
    apiContent: "", createdAt: "2026-01-01T00:00:00.000Z", backgroundResponseId: "resp_1" }] };
  const job = { id: "resp_1", threadId: "t1", modelId: "gpt-5", status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:01:00.000Z", nextPollAt: "", pollCount: 0,
    reasoningSummary: "공개 요약", toolCalls: [{ id: "call_1", name: "lookup", arguments: "{}", status: "waiting" }] };
  assert.equal(reconcileTerminalBackground(thread, job), true);
  assert.equal(thread.messages[0].text, "수동 도구 실행 결과를 기다립니다.");
  assert.equal(thread.messages[0].apiContent, "");
  assert.equal(thread.messages[0].reasoningSummary, "공개 요약");
  assert.equal(thread.messages[0].backgroundResponseId, undefined);
  assert.equal(thread.previousResponseId, "resp_1");
  assert.equal(reconcileTerminalBackground(thread, job), false);
  const crashed = { advanced: {}, messages: [{ id: "u", role: "user", text: "질문", apiContent: "질문",
    createdAt: "2026-01-01T00:00:00.000Z" }] };
  assert.equal(reconcileTerminalBackground(crashed, { ...job, id: "resp_crash" }), true);
  assert.equal(crashed.messages.length, 2);
  assert.equal(reconcileTerminalBackground(crashed, { ...job, id: "resp_crash" }), false);
  assert.equal(crashed.messages.length, 2);
});

test("background reconciliation uses immutable creation time and sees terminal crashes before pruning", () => {
  const now = Date.parse("2026-09-16T12:00:00.000Z");
  const base = { threadId: "t1", modelId: "gpt-5", createdAt: "2026-09-14T00:00:00.000Z",
    nextPollAt: "2026-09-15T00:00:00.000Z", pollCount: 2 };
  const terminal = { ...base, id: "resp_terminal", status: "completed",
    updatedAt: new Date(now - BACKGROUND_TTL_MS - 10_000).toISOString(), outputText: "늦게 복구된 결과" };
  const pending = { ...base, id: "resp_pending", status: "in_progress",
    // A recent poll must not extend the 24-hour run lifetime.
    updatedAt: new Date(now - 1_000).toISOString() };
  const active = { ...base, id: "resp_active", status: "queued", createdAt: new Date(now - 1_000).toISOString(),
    updatedAt: new Date(now - 1_000).toISOString() };
  const plan = planBackgroundReconciliation([terminal, pending, active], now);
  assert.deepEqual(plan.reconcile.map((item) => item.id), ["resp_terminal", "resp_pending"]);
  assert.equal(plan.reconcile[1].status, "incomplete");
  assert.match(plan.reconcile[1].error, /24시간/);
  assert.deepEqual(plan.processedVersions.map((item) => item.id), ["resp_terminal", "resp_pending"]);
  const threads = new Map([["resp_terminal", { advanced: {}, messages: [] }],
    ["resp_pending", { advanced: {}, messages: [] }]]);
  for (const job of plan.reconcile) reconcileTerminalBackground(threads.get(job.id), job);
  assert.equal(threads.get("resp_terminal").messages[0].text, "늦게 복구된 결과");
  assert.equal(threads.get("resp_pending").messages[0].status, "incomplete");
  assert.match(threads.get("resp_pending").messages[0].text, /만료/);
});

test("background upsert preserves unreconciled old records until reconciliation", () => {
  const old = { id: "resp_old", threadId: "t1", modelId: "gpt-5", status: "in_progress",
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-16T12:00:00.000Z",
    nextPollAt: "2026-09-16T12:00:00.000Z", pollCount: 10 };
  const fresh = { ...old, id: "resp_fresh", createdAt: "2026-09-16T12:00:00.000Z", pollCount: 0 };
  const result = upsertBackgroundResponseRecord([old], fresh);
  assert.deepEqual(result.map((item) => item.id), ["resp_fresh", "resp_old"]);
  assert.equal(result[1], old);
});

test("deep research clamps to 3–4 subqueries, deduplicates URLs, and documents max calls", () => {
  const queries = parseResearchPlan('{"queries":["official","official","study"]}', "hospital policy");
  assert.equal(queries.length, 4);
  assert.equal(DEEP_RESEARCH_MAX_CALLS, 6);
  const combined = combineResearchResults([
    { query: "a", content: "- https://example.com/x\nA" },
    { query: "b", content: "- https://example.com/x\nB" }
  ]);
  assert.equal(combined.match(/https:\/\/example.com\/x/g)?.length, 1);
  assert.match(combined, /<untrusted-web-content>/);
});

test("scheduler applies global concurrency across standard, chatbot, credit, and deep lanes", async () => {
  const scheduler = new RequestScheduler();
  const releases = await Promise.all([
    scheduler.acquire("standard"), scheduler.acquire("chatbot"), scheduler.acquire("credit-reserving")
  ]);
  assert.deepEqual(scheduler.snapshot(), { active: 3, activeDeep: 0, queued: 0, allRequestsInWindow: 3,
    standardInWindow: 1, chatbotInWindow: 1, creditReservingInWindow: 1 });
  const controller = new AbortController(); const fourth = scheduler.acquire("deep", controller.signal);
  assert.equal(scheduler.snapshot().queued, 1); controller.abort(new Error("stop"));
  await assert.rejects(fourth, /stop/); releases.forEach((release) => release());
});

test("project vault blobs are authenticated to the profile/blob AAD and reject tampering", () => {
  const key = createVaultKey(); const bytes = Buffer.from("private medical project");
  const encrypted = encryptVaultBlob(bytes, key, "profile:blob");
  assert.equal(decryptVaultBlob(encrypted, [key], "profile:blob").toString(), bytes.toString());
  assert.throws(() => decryptVaultBlob(encrypted, [key], "other:blob"));
  const tampered = Buffer.from(encrypted); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptVaultBlob(tampered, [key], "profile:blob"));
});

test("chatbot signed files require exact KHU public path, respect expiry, and verify document magic", () => {
  const now = Date.UTC(2026, 8, 16);
  const value = validateChatbotFileUrl("https://factchat-cloud.mindlogic.ai/v1/public/f/abc?expires=1790000000", now);
  assert.equal(value.url.pathname, "/v1/public/f/abc");
  assert.throws(() => validateChatbotFileUrl("https://evil.example/v1/public/f/abc", now), /허용되지/);
  assert.throws(() => validateChatbotFileUrl("https://factchat-cloud.mindlogic.ai/v1/private/f/abc", now), /허용되지/);
  assert.equal(chatbotFileExpiry(60, now + 30_000, now), now + 30_000);
  assert.equal(detectChatbotDocument(Buffer.from("%PDF-1.7"), "application/pdf").extension, "pdf");
  assert.equal(detectChatbotDocument(Buffer.from("<html>bad"), "text/plain"), undefined);
  assert.equal(validateChatbotFileUrl(`https://factchat-cloud.mindlogic.ai/v1/public/f/a?e=${Math.floor((now + 60_000) / 1000)}`, now)
    .signedExpiresAt, now + 60_000);
  assert.doesNotMatch(redactChatbotPublicUrls("[x](https://factchat-cloud.mindlogic.ai/v1/public/f/a?e=9999999999)"), /https:/);
});

test("Studio Chatbot body contains exactly messages and stream and strips hidden app context", () => {
  const body = chatbotRequestBody([{ role: "system", content: "never send" }, { role: "user", content: "hello" },
    { role: "assistant", content: [{ type: "text", text: "answer" }, { type: "image_url", image_url: { url: "secret" } }] }]);
  assert.deepEqual(body, { messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "answer" }], stream: true });
  assert.deepEqual(Object.keys(body).sort(), ["messages", "stream"]);
});

test("Studio Chatbot usage is recursively bounded and omits secret/url fields", () => {
  const value = normalizeChatbotUsage({ total_tokens: 12, nested: [{ request_count: 2 }], signed_url: "secret", api_key: "secret" });
  assert.deepEqual(value, { total_tokens: 12, nested: [{ request_count: 2 }] });
  assert.deepEqual(chatbotUsageSummary(value), ["총 토큰: 12"]);
  assert.throws(() => normalizeChatbotUsage({ a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } }), /너무 큽니다/);
});

test("workspace policy evicts oldest compare results while preserving bookmark capacity", () => {
  const state = { bookmarks: [{ alias: "care", chatbotId: "opaque" }], compares: [
    { id: "new", text: "n".repeat(4_500_000) }, { id: "old", text: "o".repeat(4_500_000) }
  ] };
  assert.deepEqual(fitWorkspaceState(state).compares.map((item) => item.id), ["new"]);
});

test("compare results enforce per-model and aggregate encrypted-store budgets", () => {
  const budget = new CompareTextBudget(); budget.accept("a", "hello"); budget.accept("b", "world");
  assert.equal(budget.totalBytes(), 10);
  assert.throws(() => budget.accept("a", "x".repeat(MAX_COMPARE_RESULT_BYTES)), /2MB/);
});

test("compare synthesis anonymizes candidates and requires at least two usable answers", () => {
  const run = {
    id: "run", prompt: "어떤 전략이 타당한가?", modelIds: ["gpt-5.6-sol", "claude-opus-5", "gemini-3.8-flash"],
    webSearchMode: "always", createdAt: "2026-09-17T00:00:00Z", attachmentNames: ["자료.pdf"],
    sharedEvidence: "공식 근거 https://example.edu/source",
    results: [
      { modelId: "gpt-5.6-sol", status: "completed", text: "첫 번째 주장" },
      { modelId: "claude-opus-5", status: "incomplete", text: "두 번째 주장" },
      { modelId: "gemini-3.8-flash", status: "failed", text: "" }
    ]
  };
  assert.equal(COMPARE_SYNTHESIS_MODEL_ID, "gpt-5.6-sol");
  assert.deepEqual(compareSynthesisCandidates(run).map(({ label, modelId }) => ({ label, modelId })), [
    { label: "A", modelId: "gpt-5.6-sol" }, { label: "B", modelId: "claude-opus-5" }
  ]);
  assert.equal(canSynthesizeCompare(run), true);
  assert.equal(canSynthesizeCompare({ ...run, results: run.results.map((item, index) =>
    index === 0 ? { ...item, status: "running" } : item) }), false);
  const messages = buildCompareSynthesisMessages(run);
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /다수결/);
  assert.match(messages[0].content, /근거 부족/);
  assert.match(messages[1].content, /첫 번째 주장/);
  assert.match(messages[1].content, /두 번째 주장/);
  assert.doesNotMatch(messages[1].content, /gpt-5\.6-sol|claude-opus-5/);
  assert.throws(() => buildCompareSynthesisMessages({ ...run,
    results: [{ modelId: "a", status: "completed", text: "하나" }] }), /2개 이상/);
});

test("compare synthesis bounds persisted evidence and generated output", () => {
  const evidence = boundedCompareEvidence("가".repeat(MAX_COMPARE_SHARED_EVIDENCE_BYTES));
  assert.ok(Buffer.byteLength(evidence, "utf8") <= MAX_COMPARE_SHARED_EVIDENCE_BYTES);
  assert.match(evidence, /이후 내용 생략/);
  const budget = new CompareSynthesisTextBudget(); budget.accept("정상 결과");
  assert.equal(budget.totalBytes(), Buffer.byteLength("정상 결과"));
  assert.throws(() => budget.accept("x".repeat(MAX_COMPARE_SYNTHESIS_RESULT_BYTES)), /256KB/);
});

test("provider request shapes keep Claude and Responses routes isolated", () => {
  const claudeRequest = buildProviderRequest({ model: claude, messages, reasoningMode: "auto", advanced: {}, stream: true });
  assert.equal(claudeRequest.path, "/claude/v1/messages/");
  assert.equal(claudeRequest.headers["anthropic-version"], "2023-06-01");
  const count = buildClaudeCountTokensRequest({ model: claude, messages, reasoningMode: "auto", advanced: {}, stream: false });
  assert.equal(count.path, "/claude/v1/messages/count_tokens/");
  assert.match(count.headers["anthropic-beta"], /token-counting-2024-11-01/);
  assert.equal("max_tokens" in count.body, false);
  assert.equal("stream" in count.body, false);
  const responseRequest = buildProviderRequest({ model: { ...openai, id: "gpt-6-codex" }, messages,
    reasoningMode: "auto", advanced: {}, stream: true });
  assert.equal(responseRequest.path, "/responses/");
});

test("Claude thinking matrix follows KHU current generations", () => {
  assert.deepEqual(claudeThinkingCapabilities("claude-haiku-4-5-20251001"),
    { adaptive: false, manual: true, canDisable: true, efforts: ["low", "medium", "high"] });
  assert.equal(claudeThinkingCapabilities("claude-sonnet-4-6").manual, true);
  assert.deepEqual(claudeThinkingCapabilities("claude-sonnet-5"),
    { adaptive: true, manual: false, canDisable: true, efforts: ["low", "medium", "high", "xhigh", "max"] });
  assert.equal(claudeThinkingCapabilities("claude-fable-5").canDisable, false);
  assert.deepEqual(claudeThinkingCapabilities("claude-opus-4-6").efforts,
    ["low", "medium", "high", "max"]);
  assert.deepEqual(claudeThinkingCapabilities("claude-opus-4-8").efforts,
    ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(claudeThinkingCapabilities("claude-mythos-5-1").efforts,
    ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(claudeDefaultThinkingMode("claude-opus-5"), "adaptive");
  assert.equal(claudeDefaultThinkingMode("claude-mythos-5-1"), "adaptive");
  assert.equal(claudeDefaultThinkingMode("claude-sonnet-4-6"), "off");
  assert.equal(claudeAllowsSampling("claude-opus-5"), false);
  assert.equal(claudeAllowsSampling("claude-opus-4-8"), false);
  assert.throws(() => assertAdvancedOptionsForModel({ ...claude, id: "claude-sonnet-4-6" }, {
    claudeThinking: { mode: "manual", budgetTokens: 1024 }, tools: [{ name: "lookup", parameters: {
      type: "object", properties: {}, required: [], additionalProperties: false
  } }], toolChoice: "required" }), /required/);
  assert.doesNotThrow(() => assertAdvancedOptionsForModel({ ...claude, id: "claude-sonnet-4-6" }, {
    claudeThinking: { mode: "adaptive", effort: "max" }, tools: [{ name: "lookup", parameters: {
      type: "object", properties: {}, required: [], additionalProperties: false
    } }], toolChoice: "required", topP: .95 }));
  const adaptiveForced = buildClaudePayload({ model: { ...claude, id: "claude-sonnet-4-6" }, messages,
    reasoningMode: "auto", advanced: { claudeThinking: { mode: "adaptive", effort: "max" },
      tools: [{ name: "lookup", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } }],
      toolChoice: "required", topP: .95 }, stream: true });
  assert.deepEqual(adaptiveForced.body.tool_choice, { type: "any" });
  assert.equal(adaptiveForced.body.top_p, .95);
  assert.throws(() => assertAdvancedOptionsForModel({ ...claude, id: "claude-fable-5-1" }, {
    tools: [{ name: "lookup", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } }],
    toolChoice: { name: "lookup" }
  }), /지정 도구/);
  assert.throws(() => assertAdvancedOptionsForModel({ ...claude, id: "claude-opus-4-6" }, {
    claudeThinking: { mode: "adaptive", effort: "max" }, topK: 40
  }), /Top K/);
  assert.throws(() => assertAdvancedOptionsForModel({ ...claude, id: "claude-opus-4-6" }, {
    claudeThinking: { mode: "adaptive", effort: "max" }, topP: .9
  }), /0.95/);
  assert.throws(() => assertAdvancedOptionsForModel({ ...claude, id: "claude-opus-4-8" }, {
    claudeThinking: { mode: "adaptive", effort: "xhigh" }, topP: .95
  }), /Top P/);
  const oldOffSampling = buildClaudePayload({ model: { ...claude, id: "claude-opus-4-6" }, messages,
    reasoningMode: "auto", advanced: { claudeThinking: { mode: "off" }, temperature: .4, topP: .8, topK: 20 }, stream: true });
  assert.equal(oldOffSampling.body.temperature, .4);
  assert.equal(oldOffSampling.body.top_p, .8);
  assert.equal(oldOffSampling.body.top_k, 20);
  assert.throws(() => assertAdvancedOptionsForModel({ ...claude, id: "claude-opus-5" }, {
    claudeThinking: { mode: "off" }, temperature: 0.5 }), /Temperature/);
  const opus5 = buildClaudePayload({ model: { ...claude, id: "claude-opus-5" }, messages,
    reasoningMode: "auto", advanced: { claudeThinking: { mode: "off" } }, stream: true });
  assert.deepEqual(opus5.body.thinking, { type: "disabled" });
  assert.equal(opus5.body.temperature, undefined);
  assert.throws(() => buildClaudePayload({ model: { ...claude, id: "claude-fable-5" }, messages,
    reasoningMode: "auto", advanced: { claudeThinking: { mode: "off" } }, stream: true }), /사고 끄기/);
});

test("drop preflight and chatbot sanitizer bound memory before bytes and hide split signed URLs", () => {
  assert.doesNotThrow(() => assertDroppedFileBatch([{ name: "a.pdf", size: 18 * 1024 * 1024 }]));
  assert.throws(() => assertDroppedFileBatch([{ name: "a.pdf", size: 18 * 1024 * 1024 + 1 }]), /18MB/);
  assert.throws(() => assertDroppedFileBatch(Array.from({ length: 4 }, (_, index) => ({
    name: `${index}.pdf`, size: 17 * 1024 * 1024
  }))), /64MB/);
  const sanitizer = new BufferedChatbotTextSanitizer();
  sanitizer.push("부분 답변 [파일](https://factchat-cloud.mindlogic.ai/v1/pub");
  sanitizer.push("lic/f/secret?e=9999999999) 끝");
  const safe = sanitizer.flush();
  assert.match(safe, /부분 답변/); assert.match(safe, /안전한 다운로드 버튼/);
  assert.doesNotMatch(safe, /secret|https:/);
});

test("journaled project deletion resumes idempotently after a crash", async () => {
  const linked = new Set(["t1", "t2"]); let vaultExists = true; let journalExists = true; let failOnce = true;
  const ops = {
    listLinkedThreadIds: async () => [...linked],
    unlinkThread: async (id) => { linked.delete(id); },
    deleteVault: async () => { if (failOnce) { failOnce = false; throw new Error("crash"); } vaultExists = false; },
    clearJournal: async () => { journalExists = false; }
  };
  await assert.rejects(completeJournaledProjectDeletion(ops), /crash/);
  assert.deepEqual([...linked], []); assert.equal(vaultExists, true); assert.equal(journalExists, true);
  await completeJournaledProjectDeletion(ops);
  assert.equal(vaultExists, false); assert.equal(journalExists, false);
});
