import test from "node:test";
import assert from "node:assert/strict";
import { serializeCompareAnalysis } from "../src/shared/compare-export.ts";
test("synthesis export includes evidence limitations and preserves the analysis", () => {
  const exported = serializeCompareAnalysis({ prompt: "질문", results: [{ modelId: "a" }, { modelId: "b" }],
    sharedEvidence: "private hidden context", synthesis: { modelId: "gpt-5.6-sol", status: "incomplete", text: "## 사실 검토\n추가 확인 필요" } });
  assert.match(exported, /gpt-5.6-sol/); assert.match(exported, /incomplete/);
  assert.match(exported, /## 사실 검토\n추가 확인 필요/);
  assert.doesNotMatch(exported, /private hidden context/);
  assert.throws(() => serializeCompareAnalysis({ synthesis: { text: " " } }), /결과가 없습니다/);
});

test("shared search export retains verified sources/status while omitting opaque and invalid fields", () => {
  const exported = serializeCompareAnalysis({ prompt: "synthetic", results: [{ modelId: "a" }, { modelId: "b" }],
    webSearch: { route: "shared", provider: "sonar", status: "executed", queries: ["synthetic"], requestCount: 1,
      citations: [{ url: "https://example.test/source", title: "synthetic" }, { url: "javascript:bad" }], encrypted_content: "opaque-secret" },
    synthesis: { modelId: "gpt-5.6-sol", status: "completed", text: "synthetic analysis" } });
  assert.match(exported, /Sonar 공통 검색 · 실행 확인/); assert.match(exported, /https:\/\/example.test\/source/);
  assert.doesNotMatch(exported, /opaque-secret|javascript:/);
});
