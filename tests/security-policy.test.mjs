import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryGateway } from "../src/shared/gateway-retry.ts";
import { responseFailureMessage } from "../src/shared/gateway-error.ts";
import { markdownImagePresentation } from "../src/shared/markdown-security.ts";
import { activateSavedSession, transitionLogin } from "../src/main/session-flow.ts";
import { mergeUniqueRecords } from "../src/main/storage-logic.ts";
import {
  ChatStreamBudget, MAX_CHAT_CITATIONS, MAX_CHAT_DELTAS, MAX_CHAT_RESPONSE_BYTES
} from "../src/shared/stream-limits.ts";
import { clearSensitiveEntries, deleteSensitiveEntry, sweepSensitiveEntries } from "../src/main/sensitive-cache.ts";

test("only idempotent reads retry 429 and 503", () => {
  assert.equal(shouldRetryGateway({ status: 429, method: "GET", attempt: 0 }), true);
  assert.equal(shouldRetryGateway({ status: 503, method: "HEAD", attempt: 1 }), true);
  for (const method of ["POST", "PUT", "PATCH"]) {
    assert.equal(shouldRetryGateway({ status: 429, method, attempt: 0 }), false);
    assert.equal(shouldRetryGateway({ status: 503, method, attempt: 0 }), false);
  }
  assert.equal(shouldRetryGateway({ status: 429, method: "GET", attempt: 2 }), false);
});

test("Responses SSE nested failure details are retained", () => {
  assert.equal(responseFailureMessage({ response: { error: { detail: { message: "quota detail" } } } }), "quota detail");
});

test("assistant markdown images never become renderer img elements", () => {
  assert.deepEqual(markdownImagePresentation("https://tracker.example/pixel.png", "pixel"),
    { label: "pixel", externalUrl: "https://tracker.example/pixel.png" });
  assert.deepEqual(markdownImagePresentation("data:image/png;base64,AAAA", "inline"), { label: "inline" });
});

test("offline saved startup activates the private profile before networking", async () => {
  const order = [];
  await assert.rejects(activateSavedSession("saved", async () => { order.push("activate"); }, async () => {
    order.push("network"); throw new Error("offline");
  }), /offline/);
  assert.deepEqual(order, ["activate", "network"]);
});

test("failed login removes a newly written key and clears the active profile", async () => {
  const calls = []; let runtime = null;
  await assert.rejects(transitionLogin("new", null, {
    validateRemote: async () => "models",
    commitRuntime: (key) => { runtime = key; calls.push(`runtime:${key}`); },
    activate: async () => { throw new Error("registry failed"); },
    saveKey: async () => { calls.push("save"); },
    clearProfile: () => { calls.push("clear"); },
    deleteKey: async () => { calls.push("delete"); }
  }), /registry failed/);
  assert.equal(runtime, null);
  assert.deepEqual(calls, ["clear", "delete"]);
});

test("login validates before committing the shared runtime", async () => {
  const order = [];
  const value = await transitionLogin("new", null, {
    validateRemote: async (key) => { order.push(`validate:${key}`); return ["model"]; },
    commitRuntime: (key) => { order.push(`runtime:${key}`); },
    activate: async () => { order.push("activate"); },
    saveKey: async () => { order.push("save"); },
    clearProfile: () => order.push("clear"),
    deleteKey: async () => { order.push("delete"); }
  });
  assert.deepEqual(value, ["model"]);
  assert.deepEqual(order, ["validate:new", "activate", "save", "runtime:new"]);
});

test("legacy thread merge is idempotent and preserves the committed target", () => {
  const target = [{ id: "same", value: "new" }];
  const source = [{ id: "same", value: "old" }, { id: "legacy", value: "kept" }];
  const once = mergeUniqueRecords(target, source);
  const twice = mergeUniqueRecords(once, source);
  assert.deepEqual(twice, [{ id: "same", value: "new" }, { id: "legacy", value: "kept" }]);
});

test("chat stream budget caps UTF-8 bytes, deltas, citations, and URL totals", () => {
  const bytes = new ChatStreamBudget();
  bytes.acceptDelta("a".repeat(MAX_CHAT_RESPONSE_BYTES));
  assert.throws(() => bytes.acceptDelta("한"), /8MB/);

  const deltas = new ChatStreamBudget();
  for (let index = 0; index < MAX_CHAT_DELTAS; index++) deltas.acceptDelta("");
  assert.throws(() => deltas.acceptDelta(""), /조각 수/);

  const citations = new ChatStreamBudget();
  assert.equal(citations.acceptCitation("https://example.com/a"), true);
  assert.equal(citations.acceptCitation("https://example.com/a"), false);
  for (let index = 1; index < MAX_CHAT_CITATIONS; index++) citations.acceptCitation(`https://example.com/${index}`);
  assert.throws(() => citations.acceptCitation("https://example.com/overflow"), /출처 수/);
});

test("attachment cache deletion, expiry, and clear overwrite sensitive buffers", () => {
  const entries = new Map([
    ["old", { bytes: Buffer.from("patient-old"), touchedAt: 0 }],
    ["fresh", { bytes: Buffer.from("patient-fresh"), touchedAt: 9_000 }]
  ]);
  const old = entries.get("old").bytes;
  const fresh = entries.get("fresh").bytes;
  assert.equal(sweepSensitiveEntries(entries, 5_000, 10_000), 1);
  assert.ok(old.every((byte) => byte === 0));
  assert.equal(deleteSensitiveEntry(entries, "missing"), false);
  clearSensitiveEntries(entries);
  assert.ok(fresh.every((byte) => byte === 0));
  assert.equal(entries.size, 0);
});
