import assert from "node:assert/strict";
import test from "node:test";
import { mockModels } from "../src/main/mock.ts";
import { modelNames } from "../src/renderer/src/model-names.ts";
import { modelLabel, providerLabel } from "../src/renderer/src/model-names.ts";
import { isRecentlyAdded } from "../src/shared/media-capabilities.ts";
import { parseGatewayModels, resolveLiveThreadModel } from "../src/shared/model-catalog.ts";

test("runtime catalog IDs are unique and every ID has a safe display fallback", () => {
  const llmIds = mockModels.filter((model) => model.type === "llm").map((model) => model.id);
  assert.equal(new Set(llmIds).size, llmIds.length);
  assert.ok(llmIds.every((id) => modelLabel(id).length > 0));
  assert.ok(llmIds.includes("gpt-6-astra"));
  assert.equal(modelLabel("future-provider/new_model-v9"), "New Model V9");
  assert.equal(providerLabel("future-provider"), "future-provider");
  assert.ok(Object.keys(modelNames).length > 0, "friendly names remain optional display fallbacks");
});

test("catalog parser preserves documented live metadata and ignores schema drift safely", () => {
  assert.deepEqual(parseGatewayModels({ data: [
    { id: "future-model", object: "model", created: 1780000000, owned_by: "future-provider",
      profile_image_url: "https://example.test/logo.svg", type: "llm", new_field: "ignored" },
    { id: "future-stt", type: "audio", audio_client: "soniox" },
    { id: "bad", type: "tool" }, null
  ] }), [
    { id: "future-model", object: "model", created: 1780000000, owned_by: "future-provider",
      profile_image_url: "https://example.test/logo.svg", type: "llm", audio_client: undefined },
    { id: "future-stt", object: undefined, created: undefined, owned_by: undefined,
      profile_image_url: null, type: "audio", audio_client: "soniox" }
  ]);
});

test("media categories and newly-added badges derive from live metadata", () => {
  assert.ok(mockModels.some((model) => model.type === "image"));
  assert.ok(mockModels.some((model) => model.type === "audio"));
  assert.ok(mockModels.some((model) => model.type === "video"));
  const now = Date.UTC(2026, 8, 16);
  assert.equal(isRecentlyAdded(Math.floor(now / 1000) - 10 * 86400, now), true);
  assert.equal(isRecentlyAdded(Math.floor(now / 1000) - 100 * 86400, now), false);
  assert.equal(isRecentlyAdded(Math.floor(now / 1000) + 10 * 86400, now), false);
});

test("a removed stored chat model falls back only to a currently permitted live LLM", () => {
  const live = [{ id: "image-only", type: "image" }, { id: "gpt-5.6-luna", type: "llm" },
    { id: "future-llm", type: "llm" }];
  assert.deepEqual(resolveLiveThreadModel("removed-llm", live), { modelId: "gpt-5.6-luna", removed: true });
  assert.deepEqual(resolveLiveThreadModel("future-llm", live), { modelId: "future-llm", removed: false });
  assert.deepEqual(resolveLiveThreadModel("removed-llm", [{ id: "only-image", type: "image" }]),
    { modelId: "", removed: true });
});
