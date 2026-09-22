import test from "node:test";
import assert from "node:assert/strict";
import { CreditRefreshQueue } from "../src/shared/credit-refresh.ts";
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
test("manual click during automatic fetch forces exactly one follow-up", async () => {
  const queue = new CreditRefreshQueue(); const held = deferred(); const calls = [];
  const refresh = async (manual) => { calls.push(manual); if (!manual) await held.promise; };
  const automatic = queue.run(false, refresh);
  const first = queue.run(true, refresh); const second = queue.run(true, refresh);
  assert.equal(first, second); held.resolve(); await Promise.all([automatic, first, second]);
  assert.deepEqual(calls, [false, true]);
});
test("reset prevents queued requests leaking across accounts", async () => {
  const queue = new CreditRefreshQueue(); const held = deferred(); const calls = [];
  const refresh = async (manual) => { calls.push(manual); await held.promise; };
  const first = queue.run(false, refresh); await Promise.resolve();
  const manual = queue.run(true, refresh); queue.reset(); held.resolve();
  await Promise.all([first, manual]); assert.deepEqual(calls, [false]);
});
test("failed automatic refresh still permits a manual follow-up", async () => {
  const queue = new CreditRefreshQueue(); const calls = [];
  const refresh = async (manual) => { calls.push(manual); if (!manual) throw new Error("offline"); };
  const first = queue.run(false, refresh); const manual = queue.run(true, refresh);
  await assert.rejects(first); await manual; assert.deepEqual(calls, [false, true]);
});
