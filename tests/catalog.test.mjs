import assert from "node:assert/strict";
import test from "node:test";
import { mockModels } from "../src/main/mock.ts";
import { modelNames } from "../src/renderer/src/model-names.ts";

test("the supplied 36 chat IDs are unique and displayable", () => {
  const llmIds = mockModels.filter((model) => model.type === "llm").map((model) => model.id);
  assert.equal(llmIds.length, 36);
  assert.equal(new Set(llmIds).size, 36);
  assert.deepEqual(new Set(llmIds), new Set(Object.keys(modelNames)));
  assert.ok(llmIds.includes("gpt-6-astra"));
  assert.ok(llmIds.includes("deepseek-v4-flash"));
});

test("media types remain separate from the 36 chat IDs", () => {
  assert.ok(mockModels.some((model) => model.type === "image"));
  assert.ok(mockModels.some((model) => model.type === "audio"));
  assert.ok(mockModels.some((model) => model.type === "video"));
});
