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
import { SearchEvidenceNormalizer, safeCitation, sanitizeWebSearch } from "../src/shared/search-evidence.ts";

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
  assert.throws(() => normalizer.accept({ type: "response.output_text.annotation.added", annotation: { ...annotation, url: "https://example.test/overflow" } }), /출처 수/);
  assert.throws(() => safeCitation({ url: `https://example.test/${"x".repeat(2048)}` }), /길이/);
  assert.deepEqual(sanitizeWebSearch({ route: "native", status: "executed", provider: "gemini", queries: ["synthetic"],
    citations: [annotation, { url: "javascript:alert(1)" }], encrypted_content: "strip" }), {
    route: "native", status: "executed", provider: "gemini", queries: ["synthetic"], citations: [{ url: "https://example.test/report", title: "synthetic" }]
  });
});

test("canonical citation length matches IPC and private file links never become public search sources", () => {
  assert.equal(safeCitation({ url: "https://factchat-cloud.mindlogic.ai/v1/public/f/synthetic-file" }), undefined);
  assert.throws(() => safeCitation({ url: "https://example.test/" + "x".repeat(1982) }), /길이/);
  assert.throws(() => safeCitation({ url: "https://example.test/" + "가".repeat(300) }), /길이/);
});
