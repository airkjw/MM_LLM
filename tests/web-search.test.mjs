import assert from "node:assert/strict";
import test from "node:test";
import { availableSearchModel, hasNativeWebSearch, webSearchMode } from "../src/shared/web-search.ts";

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
