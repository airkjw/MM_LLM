import assert from "node:assert/strict";
import test from "node:test";
import { availableSearchModel, hasNativeWebSearch, relevantCachedWebContext, shouldSearchWebInAuto,
  webQueryFingerprint, webSearchMode } from "../src/shared/web-search.ts";

test("native badges require account-verified detail, never a model prefix", () => {
  for (const id of ["gemini-3.8-flash", "claude-opus-5", "gpt-6-astra", "sonar-pro", "google/gemma-4-31B-it"]) {
    assert.equal(hasNativeWebSearch({ id, type: "llm" }), false);
  }
  const verified = { id: "gemini-3.8-flash", type: "llm", searchCapability: { status: "supported", provider: "gemini" } };
  assert.equal(hasNativeWebSearch(verified), true);
  assert.equal(webSearchMode(verified), "native");
  assert.equal(webSearchMode({ ...verified, searchCapability: { status: "unknown" } }), "sonar");
  assert.equal(hasNativeWebSearch({ ...verified, type: "embedding" }), false);
});

test("Sonar Pro is preferred as the search bridge with a reasoning fallback", () => {
  const model = (id) => ({ id, type: "llm" });
  assert.equal(availableSearchModel([model("sonar-reasoning-pro"), model("sonar-pro")]), "sonar-pro");
  assert.equal(availableSearchModel([model("sonar-reasoning-pro")]), "sonar-reasoning-pro");
  assert.equal(availableSearchModel([model("gpt-6-astra")]), null);
  assert.equal(availableSearchModel([{ ...model("sonar-pro"), pricing: { web_search_per_1k: null } }]), null);
});

test("auto web search distinguishes current facts from rewrite follow-ups", () => {
  assert.equal(shouldSearchWebInAuto("오늘 의료 정책 뉴스를 찾아줘"), true);
  assert.equal(shouldSearchWebInAuto("현재 환율과 근거 출처를 알려줘"), true);
  assert.equal(shouldSearchWebInAuto("짧게 다시 써줘"), false);
  assert.equal(shouldSearchWebInAuto("짧게 지금 내용 다시 써줘"), false);
  assert.equal(shouldSearchWebInAuto("위 내용을 표로 정리해줘"), false);
  assert.equal(shouldSearchWebInAuto("이미지 정책의 최신 동향"), true);
});

test("cached web research has TTL and topic fingerprints", () => {
  const now = Date.parse("2026-09-16T12:00:00Z");
  const entries = [
    { query: "오늘 원달러 환율", fingerprint: webQueryFingerprint("오늘 원달러 환율"), content: "환율 자료", createdAt: "2026-09-16T11:50:00Z" },
    { query: "병원 정책 뉴스", fingerprint: webQueryFingerprint("병원 정책 뉴스"), content: "정책 자료", createdAt: "2026-09-16T11:45:00Z" }
  ];
  assert.equal(relevantCachedWebContext(entries, "원달러 환율을 정리해줘", now), "환율 자료");
  assert.equal(relevantCachedWebContext(entries, "축구 경기 결과", now), undefined);
  assert.equal(relevantCachedWebContext(entries, "짧게 지금 내용 다시 써줘", now), "환율 자료");
  assert.equal(relevantCachedWebContext(entries, "원달러 환율", now + 31 * 60_000), undefined);
  const hospital = [{ query: "서울병원 최신 뉴스", fingerprint: webQueryFingerprint("서울병원 최신 뉴스"),
    content: "서울 자료", createdAt: "2026-09-16T11:55:00Z" }];
  assert.equal(relevantCachedWebContext(hospital, "부산병원 최신 뉴스", now), undefined);
});

import { nativeSearchProvider, searchCapabilityFromDetail, nativeSearchSettingsError, sharedEvidenceModelError } from "../src/shared/search-capability.ts";
import { ModelSearchCache, MODEL_SEARCH_CACHE_LIMIT, MODEL_SEARCH_CACHE_TTL_MS } from "../src/main/model-search-cache.ts";
import { SearchEvidenceNormalizer, safeCitation, sanitizeWebSearch, webSearchStatusLabel } from "../src/shared/search-evidence.ts";

test("search support distinguishes null, zero, missing, malformed detail and adapter availability", () => {
  const model = { id: "gpt-6-astra", type: "llm", owned_by: "openai" };
  const capability = (pricing) => searchCapabilityFromDetail(model, { id: model.id, pricing }, "2026-10-08T00:00:00Z");
  assert.equal(capability({ web_search_per_1k: 0 }).status, "supported");
  assert.equal(capability({ web_search_per_1k: null }).status, "unsupported");
  for (const pricing of [undefined, {}, { web_search_per_1k: "0" }, { web_search_per_1k: -1 }]) {
    assert.equal(capability(pricing).status, "unknown");
  }
  assert.equal(searchCapabilityFromDetail(model, { id: model.id, type: "embedding", pricing: { web_search_per_1k: 0 } }, "now").status, "unknown");
  assert.equal(searchCapabilityFromDetail(model, { id: "other", pricing: { web_search_per_1k: 0 } }, "now").status, "unknown");
  assert.equal(searchCapabilityFromDetail({ id: "future", type: "llm" }, { id: "future", pricing: { web_search_per_1k: 0 } }, "now").status, "unsupported");
  assert.equal(nativeSearchProvider({ id: "gemma", type: "llm", owned_by: "google" }), undefined);
  assert.equal(nativeSearchProvider({ id: "gpt-6-astra", type: "embedding" }), undefined);
  assert.match(sharedEvidenceModelError({ id: "sonar-pro", type: "llm" }), /검색 끄기/);
  assert.equal(sharedEvidenceModelError(model), undefined);
  assert.match(nativeSearchSettingsError("gemini", { tools: [{}] }), /수동 도구/);
  assert.match(nativeSearchSettingsError("responses", { responses: { background: true } }), /백그라운드/);
});

test("detail cache is coalesced, bounded, expires, isolates account epochs and rejects stale completion", async () => {
  const cache = new ModelSearchCache(); let calls = 0;
  const loader = async () => { calls++; return { status: "supported", reason: "synthetic", provider: "gemini" }; };
  await Promise.all([cache.get("one", loader), cache.get("one", loader)]); assert.equal(calls, 1);
  assert.ok(cache.peek("one")); assert.equal(cache.peek("one", Date.now() + MODEL_SEARCH_CACHE_TTL_MS + 1), undefined);
  for (let i = 0; i < MODEL_SEARCH_CACHE_LIMIT + 1; i++) await cache.get(`model-${i}`, loader);
  assert.equal(cache.peek("model-0"), undefined);
  let finish; let signal;
  const pending = cache.get("slow", async (s) => { signal = s; return new Promise((resolve) => { finish = resolve; }); });
  cache.clear(); assert.equal(signal.aborted, true); assert.equal(cache.peek("model-64"), undefined);
  finish({ status: "supported", reason: "old account" }); await assert.rejects(pending, /계정이 변경/);
  await cache.get("slow", async () => ({ status: "unknown", reason: "new account" }));
  assert.equal(cache.peek("slow").status, "unknown");
  assert.equal(cache.peek("slow", Date.now() + 30_001), undefined);
});

test("detail discovery limits in-flight requests and preserves caller cancellation", async () => {
  const cache = new ModelSearchCache(); const pending = [];
  for (let i = 0; i < 4; i++) pending.push(cache.get(String(i), async (signal) => new Promise((_r, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  })));
  await assert.rejects(cache.get("fifth", async () => ({})), /진행 중/);
  cache.clear(); await Promise.allSettled(pending);
  const abort = new AbortController(); abort.abort(new Error("synthetic cancellation")); let calls = 0;
  await assert.rejects(cache.get("cancelled", async () => { calls++; return {}; }, abort.signal), /synthetic cancellation/);
  assert.equal(calls, 0);
});

test("citations are bounded, deduplicated, URL-safe and fail closed on provider floods", () => {
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.test/x", "bad", "https://example.test/\nfoo"]) {
    assert.equal(safeCitation({ url }), undefined);
  }
  const normalizer = new SearchEvidenceNormalizer("responses");
  const annotation = { type: "url_citation", url: "https://example.test/report", title: "synthetic", start_index: 0, end_index: 5 };
  normalizer.accept({ type: "response.output_text.annotation.added", annotation });
  normalizer.accept({ type: "response.output_item.done", item: { type: "message", content: [{ annotations: [annotation] }] } });
  assert.equal(normalizer.snapshot(true).citations.length, 1);
  assert.equal(normalizer.snapshot(true).status, "missing", "a link without a tool event is not execution evidence");
  for (let i = 0; i < 63; i++) normalizer.accept({ type: "response.output_text.annotation.added", annotation: { ...annotation, url: `https://example.test/${i}` } });
  // Over-limit input is truncated and flagged, never thrown: the paid response already arrived (C2/C7).
  normalizer.accept({ type: "response.output_text.annotation.added", annotation: { ...annotation, url: "https://example.test/overflow" } });
  assert.equal(normalizer.snapshot(true).citations.length, 64); assert.equal(normalizer.snapshot(true).truncated, true);
  assert.equal(safeCitation({ url: `https://example.test/${"x".repeat(2048)}` }), undefined);
  assert.deepEqual(sanitizeWebSearch({ route: "native", status: "executed", provider: "gemini", queries: ["synthetic"],
    citations: [annotation, { url: "javascript:alert(1)" }], encrypted_content: "strip" }), {
    route: "native", status: "executed", provider: "gemini", queries: ["synthetic"], citations: [{ url: "https://example.test/report", title: "synthetic" }]
  });
});

test("canonical citation length matches IPC and private file links never become public search sources", () => {
  assert.equal(safeCitation({ url: "https://factchat-cloud.mindlogic.ai/v1/public/f/synthetic-file" }), undefined);
  assert.equal(safeCitation({ url: "https://example.test/" + "x".repeat(1982) }), undefined);
  assert.equal(safeCitation({ url: "https://example.test/" + "가".repeat(300) }), undefined);
});

const claudeResult = (n, id = "srv") => ({ type: "content_block_start", content_block: { type: "web_search_tool_result", tool_use_id: id,
  content: Array.from({ length: n }, (_, i) => ({ type: "web_search_result", url: `https://example.test/r/${id}/${i}`, title: `t${i}` })) } });

test("H2: provider floods are truncated and flagged, never thrown after a paid response", () => {
  const claude = new SearchEvidenceNormalizer("claude");
  claude.accept(claudeResult(65));
  const snapshot = claude.snapshot(true);
  assert.equal(snapshot.citations.length, 64); assert.equal(snapshot.truncated, true); assert.equal(snapshot.status, "executed");
  // A URL that is already known may still merge beyond the cap.
  claude.accept({ type: "content_block_start", content_block: { type: "text", citations: [{ type: "web_search_result_location",
    url: "https://example.test/r/srv/0", title: "t0", cited_text: "merged" }] } });
  assert.equal(claude.snapshot(true).citations.find((c) => c.url === "https://example.test/r/srv/0").citedText, "merged");
  // 2001-char URL: dropped alone, the rest survive.
  const long = new SearchEvidenceNormalizer("claude");
  long.accept({ type: "content_block_start", content_block: { type: "web_search_tool_result", tool_use_id: "srv", content: [
    { type: "web_search_result", url: `https://example.test/${"x".repeat(1990)}`, title: "too long" },
    { type: "web_search_result", url: "https://example.test/ok", title: "ok" }] } });
  assert.deepEqual(long.snapshot(true).citations.map((c) => c.url), ["https://example.test/ok"]);
  // 17 queries, 33 calls, 33 server calls.
  const many = new SearchEvidenceNormalizer("gemini");
  many.accept({ candidates: [{ groundingMetadata: { webSearchQueries: Array.from({ length: 17 }, (_, i) => `q${i}`) } }] });
  assert.equal(many.snapshot(true).queries.length, 16); assert.equal(many.snapshot(true).truncated, true);
  const calls = new SearchEvidenceNormalizer("claude");
  for (let i = 0; i < 33; i++) {
    calls.accept({ type: "content_block_start", content_block: { type: "server_tool_use", id: `s${i}`, name: "web_search", input: { query: `q${i % 16}` } } });
    calls.accept(claudeResult(0, `s${i}`));
  }
  const many2 = calls.snapshot(true);
  assert.equal(many2.status, "empty"); assert.equal(many2.truncated, true);
  // Oversized input_json stops accumulating instead of throwing and records no query.
  const json = new SearchEvidenceNormalizer("claude");
  json.accept({ type: "content_block_start", content_block: { type: "server_tool_use", id: "big", name: "web_search", input: {} } });
  json.accept({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: `{"query":"${"x".repeat(20_000)}` } });
  json.accept({ type: "content_block_stop" });
  assert.deepEqual(json.snapshot(true).queries, []); assert.equal(json.snapshot(true).truncated, true);
  // Gemini: 65 chunks per event and 257 supports are cut, not rejected.
  const gemini = new SearchEvidenceNormalizer("gemini");
  gemini.accept({ candidates: [{ groundingMetadata: { webSearchQueries: ["q"],
    groundingChunks: Array.from({ length: 65 }, (_, i) => ({ web: { uri: `https://example.test/g/${i}`, title: "g" } })),
    groundingSupports: Array.from({ length: 257 }, () => ({ segment: { text: "s" }, groundingChunkIndices: [0] })) } }] });
  assert.equal(gemini.snapshot(true).citations.length, 64); assert.equal(gemini.snapshot(true).truncated, true);
});

test("H1: sanitizeWebSearch keeps failedCount/truncated and the label reports them", () => {
  const base = { route: "native", status: "executed", provider: "claude", queries: [], citations: [] };
  const kept = sanitizeWebSearch({ ...base, failedCount: 2, truncated: true });
  assert.equal(kept.failedCount, 2); assert.equal(kept.truncated, true);
  const dropped = sanitizeWebSearch({ ...base, failedCount: -1, truncated: "yes" });
  assert.equal(Object.hasOwn(dropped, "failedCount"), false); assert.equal(Object.hasOwn(dropped, "truncated"), false);
  for (const failedCount of [0, 1.5, 1001, "2"]) assert.equal(Object.hasOwn(sanitizeWebSearch({ ...base, failedCount }), "failedCount"), false);
  assert.equal(Object.hasOwn(sanitizeWebSearch({ ...base, truncated: false }), "truncated"), false);
  assert.match(webSearchStatusLabel(kept), /일부 검색 실패 2건/); assert.match(webSearchStatusLabel(kept), /출처 일부 생략/);
  assert.doesNotMatch(webSearchStatusLabel(sanitizeWebSearch(base)), /일부/);
});

test("H1: partial failure after a completed call is executed with failedCount; all-failed stays failed", () => {
  const partial = new SearchEvidenceNormalizer("claude");
  partial.accept(claudeResult(1, "ok"));
  partial.accept({ type: "content_block_start", content_block: { type: "web_search_tool_result", tool_use_id: "bad",
    content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } } });
  const snap = partial.snapshot(true);
  assert.equal(snap.status, "executed"); assert.equal(snap.failedCount, 1);
  const responses = new SearchEvidenceNormalizer("responses");
  responses.accept({ type: "response.web_search_call.completed", item_id: "a" });
  responses.accept({ type: "response.web_search_call.failed", item_id: "b" });
  assert.equal(responses.snapshot(true).status, "executed"); assert.equal(responses.snapshot(true).failedCount, 1);
  const all = new SearchEvidenceNormalizer("responses");
  all.accept({ type: "response.web_search_call.failed", item_id: "b" });
  assert.equal(all.snapshot(true).status, "failed"); assert.equal(all.snapshot(true).failedCount, 1);
  const streamError = new SearchEvidenceNormalizer("claude");
  streamError.accept(claudeResult(1, "ok")); streamError.accept({ type: "error", error: { type: "overloaded_error" } });
  assert.equal(streamError.snapshot(true).status, "executed", "the search ran; the aborted answer is the message status");
  assert.equal(Object.hasOwn(streamError.snapshot(true), "failedCount"), false);
});

test("L11: Gemini grounding indices refer to the same event's chunks, not an accumulated list", () => {
  const evidence = new SearchEvidenceNormalizer("gemini");
  const event = (uri, text) => ({ candidates: [{ groundingMetadata: { webSearchQueries: ["q"],
    groundingChunks: [{ web: { uri, title: uri } }],
    groundingSupports: [{ segment: { text }, groundingChunkIndices: [0] }] } }] });
  evidence.accept(event("https://example.test/a", "a"));
  evidence.accept(event("https://example.test/b", "b"));
  const cited = Object.fromEntries(evidence.snapshot(true).citations.map((c) => [c.url, c.citedText]));
  assert.deepEqual(cited, { "https://example.test/a": "a", "https://example.test/b": "b" });
});

test("L12: every sonar-family id selects the Sonar adapter while support still comes from account detail", () => {
  for (const id of ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro", "sonar-deep-research"]) {
    assert.equal(nativeSearchProvider({ id, type: "llm" }), "sonar", id);
    assert.match(sharedEvidenceModelError({ id, type: "llm" }), /검색 끄기/, id);
  }
  assert.equal(nativeSearchProvider({ id: "sonarqube-helper", type: "llm" }), undefined);
  const model = { id: "sonar-reasoning", type: "llm" };
  const status = (pricing) => searchCapabilityFromDetail(model, pricing === "missing" ? { id: model.id } : { id: model.id, pricing }, "now").status;
  assert.equal(status({ web_search_per_1k: 5 }), "supported");
  assert.equal(status({ web_search_per_1k: null }), "unsupported");
  assert.equal(status("missing"), "unknown");
});

test("L13: invalidate keeps the in-flight detail GET alive but never caches its result; clear still aborts", async () => {
  const cache = new ModelSearchCache(); let finish; let signal;
  const pending = cache.get("slow", async (s) => { signal = s; return new Promise((resolve) => { finish = resolve; }); });
  cache.invalidate(); assert.equal(signal.aborted, false);
  finish({ status: "supported", reason: "refresh did not change the account" });
  assert.equal((await pending).status, "supported");
  assert.equal(cache.peek("slow"), undefined, "a result that straddled invalidate is not cached");
  await cache.get("slow", async () => ({ status: "unknown", reason: "again" })); assert.equal(cache.peek("slow").status, "unknown");
  cache.invalidate(); assert.equal(cache.peek("slow"), undefined);
  let finishOld; const old = cache.get("old", async () => new Promise((resolve) => { finishOld = resolve; }));
  cache.clear(); finishOld({ status: "supported", reason: "x" }); await assert.rejects(old, /계정이 변경/);
});

test("call counts stay exact when one call id is delivered repeatedly beyond the old 32-id window", () => {
  const responses = new SearchEvidenceNormalizer("responses");
  for (let i = 0; i < 40; i++) {
    const item = { id: `ws_${i}`, type: "web_search_call", status: "completed", action: { query: `q${i % 16}` } };
    responses.accept({ type: "response.web_search_call.completed", item_id: item.id });
    responses.accept({ type: "response.output_item.done", item });
    responses.accept({ type: "response.completed", response: { output: [item] } });
  }
  const search = responses.snapshot(true);
  assert.equal(search.requestCount, 40); assert.equal(Object.hasOwn(search, "truncated"), false);
  const failed = new SearchEvidenceNormalizer("responses");
  for (let i = 0; i < 34; i++) {
    failed.accept({ type: "response.web_search_call.failed", item_id: `bad_${i}` });
    failed.accept({ type: "response.output_item.done", item: { id: `bad_${i}`, type: "web_search_call", status: "failed" } });
  }
  assert.equal(failed.snapshot(true).failedCount, 34); assert.equal(failed.snapshot(true).status, "failed");
});
