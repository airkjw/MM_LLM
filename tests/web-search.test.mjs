import assert from "node:assert/strict";
import test from "node:test";
import { availableSearchModel, hasNativeWebSearch, relevantCachedWebContext, shouldSearchWebInAuto,
  webQueryFingerprint, webSearchMode } from "../src/shared/web-search.ts";

test("only documented Gemini and Sonar chat models are marked as native web search", () => {
  assert.equal(hasNativeWebSearch("gemini-3.8-flash"), true);
  assert.equal(hasNativeWebSearch("gemini-3.1-pro-preview"), true);
  assert.equal(hasNativeWebSearch("sonar-pro"), true);
  assert.equal(hasNativeWebSearch("sonar-reasoning-pro"), true);
  assert.equal(hasNativeWebSearch("gpt-6-astra"), false);
  assert.equal(hasNativeWebSearch("google/gemma-4-31B-it"), false);
  assert.equal(webSearchMode("claude-opus-5"), "sonar");
});

test("Sonar Pro is preferred as the search bridge with a reasoning fallback", () => {
  const model = (id) => ({ id, type: "llm" });
  assert.equal(availableSearchModel([model("sonar-reasoning-pro"), model("sonar-pro")]), "sonar-pro");
  assert.equal(availableSearchModel([model("sonar-reasoning-pro")]), "sonar-reasoning-pro");
  assert.equal(availableSearchModel([model("gpt-6-astra")]), null);
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
