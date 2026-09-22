import test from "node:test";
import assert from "node:assert/strict";
import { assertThreadCapacity, assertMessageCapacity, assertStoreGrowth } from "../src/shared/storage-limits.ts";

const threads = (count) => Array.from({ length: count }, (_, i) => ({ id: String(i), messages: [] }));
test("500th conversation fits, 501st is rejected before writing", () => {
  assert.doesNotThrow(() => assertThreadCapacity(499));
  assert.throws(() => assertThreadCapacity(500), /500/);
  assert.throws(() => assertStoreGrowth(threads(501)), /500/);
});
test("legacy excess conversations can be removed incrementally", () => {
  assert.doesNotThrow(() => assertStoreGrowth(threads(502), threads(502)));
  assert.doesNotThrow(() => assertStoreGrowth(threads(501), threads(502)));
  assert.throws(() => assertStoreGrowth(threads(503), threads(502)), /500/);
});
test("reserve both question and answer before a billed request", () => {
  assert.doesNotThrow(() => assertMessageCapacity(9998));
  assert.throws(() => assertMessageCapacity(9999), /새 대화/);
  assert.throws(() => assertStoreGrowth([{ id: "a", messages: Array(10001) }]), /새 대화/);
  assert.doesNotThrow(() => assertStoreGrowth([{ id: "a", messages: Array(10001) }], [{ id: "a", messages: Array(10002) }]));
});
