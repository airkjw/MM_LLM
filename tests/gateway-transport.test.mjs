import test from "node:test";
import assert from "node:assert/strict";
import { gatewayRequest, GatewayError, retryDelay } from "../src/main/gateway-transport.ts";

test("GET retries throttling with Retry-After, preserving authorization", async () => {
  const delays = []; let calls = 0;
  const response = await gatewayRequest("https://example.invalid/models", { headers: { Authorization: "Bearer fake" } }, {
    fetch: async (_url, init) => { assert.equal(new Headers(init.headers).get("authorization"), "Bearer fake");
      return ++calls < 3 ? new Response("busy", { status: 429, headers: { "retry-after": "2" } }) : new Response("ok"); },
    sleep: async (ms) => { delays.push(ms); }
  });
  assert.equal(await response.text(), "ok"); assert.deepEqual(delays, [2000, 2000]);
});
test("billed POST is never automatically replayed", async () => {
  let calls = 0;
  await assert.rejects(gatewayRequest("https://example.invalid/generate", { method: "POST" }, {
    fetch: async () => { calls++; return new Response("{}", { status: 503 }); }
  }), (error) => error instanceof GatewayError && error.status === 503);
  assert.equal(calls, 1);
});
test("timeout releases a hanging login request and reports retry guidance", async () => {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(gatewayRequest("https://example.invalid/models", {}, { timeoutMs: 10,
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      })
    }), /대기 시간이 초과/);
  } finally { clearInterval(keepAlive); }
});
test("caller cancellation is preserved without retry", async () => {
  const controller = new AbortController(); controller.abort(new Error("사용자 취소")); let calls = 0;
  await assert.rejects(gatewayRequest("https://example.invalid", { signal: controller.signal }, {
    fetch: async () => { calls++; return new Response(); }
  }), /사용자 취소/); assert.equal(calls, 0);
});
test("status maps to actionable errors without exposing upstream key details", async () => {
  for (const [status, message] of [[401, "API 키"], [402, "크레딧"], [403, "접근 권한"], [404, "모델 목록"], [413, "첨부 자료"]]) {
    await assert.rejects(gatewayRequest("https://example.invalid", {}, {
      fetch: async () => new Response('{"message":"secret upstream"}', { status })
    }), (error) => error.status === status && error.message.includes(message) && !error.message.includes("secret upstream"));
  }
});
test("Retry-After handles seconds, dates and bounded invalid fallback", () => {
  assert.equal(retryDelay(new Response(null, { headers: { "retry-after": "600" } }), 0), 30000);
  assert.equal(retryDelay(new Response(null, { headers: { "retry-after": "Wed, 01 Jan 2020 00:00:00 GMT" } }), 0), 0);
  assert.equal(retryDelay(new Response(null, { headers: { "retry-after": "invalid" } }), 1), 1500);
});
