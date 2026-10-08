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

// Exercise the actual main Gateway adapter with mock HTTP; no account or paid API is used.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeEvents, openaiEvents, geminiEvents, source } from "./fixtures/native-search.mjs";
const syntheticRoot = await mkdtemp(join(tmpdir(), "mmllm-phase1-"));
globalThis.__phase1Electron = {
  app: { isPackaged: true, getVersion: () => "0.5.1", getPath: () => syntheticRoot },
  safeStorage: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async (v) => Buffer.from(`mock-vault\0${v}`),
    decryptStringAsync: async (v) => ({ result: v.toString().slice(11), shouldReEncrypt: false }) }
};
const phase1Hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron") return { url: "mmllm-phase1:electron", shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.includes("/src/")) {
      const url = new URL(specifier, context.parentURL);
      if (url.protocol === "file:" && !existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(url) + ".ts")) return next(url.href + ".ts", context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "mmllm-phase1:electron") return { format: "module", source: "export const { app, safeStorage } = globalThis.__phase1Electron;", shortCircuit: true };
    return next(url, context);
  }
});
const gateway = await import("../src/main/gateway.ts");
const originalFetch = globalThis.fetch;
test.after(async () => { globalThis.fetch = originalFetch; phase1Hooks.deregister(); await rm(syntheticRoot, { recursive: true, force: true }); });
const model = (id) => ({ id, type: "llm" });
const sonar = model("sonar-pro");
let account = 0;
const session = (models) => gateway.commitGatewaySession(`synthetic-account-${++account}`, models);
const messages = [{ role: "system", content: "synthetic policy" }, { role: "user", content: "synthetic query" }];
const generation = { reasoningMode: "auto", advanced: {} };
function sse(events) {
  const raw = events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("");
  const bytes = new TextEncoder().encode(raw);
  return new Response(new ReadableStream({ start(controller) {
    // Split in the middle of JSON and multibyte Korean text.
    for (let at = 0; at < bytes.length; at += 11) controller.enqueue(bytes.slice(at, at + 11));
    controller.close();
  } }), { headers: { "content-type": "text/event-stream" } });
}
async function collect(id, mode = "always", options = {}, controller = new AbortController()) {
  const items = [];
  for await (const item of gateway.streamChat(id, messages, "synthetic query", controller, { mode, ...options.web },
    { ...generation, ...options.generation })) items.push(item);
  return items;
}
const lastSearch = (items) => items.filter((item) => item.type === "web_search").at(-1).search;

test("actual Gateway sends exact native URL/header/body and verifies final citations after split SSE", async () => {
  for (const [id, fixture, suffix] of [["claude-sonnet-5", claudeEvents, "/claude/v1/messages/"],
    ["gpt-6-astra", openaiEvents, "/responses/"], ["gemini-3.8-flash", geminiEvents, "/gemini/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse"]]) {
    session([model(id), sonar]); const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      if (init.method !== "POST") {
        assert.equal(url, `${gateway.GATEWAY}/models/${encodeURIComponent(id)}/`);
        return Response.json({ id, pricing: { web_search_per_1k: 0 } });
      }
      assert.equal(url, gateway.GATEWAY + suffix);
      const headers = new Headers(init.headers); assert.ok(headers.get("authorization").startsWith("Bearer synthetic-"));
      if (id.startsWith("claude")) { assert.equal(headers.get("anthropic-version"), "2023-06-01"); assert.ok(headers.get("x-api-key")); }
      if (id.startsWith("gemini")) assert.ok(headers.get("x-goog-api-key"));
      const body = JSON.parse(init.body);
      assert.deepEqual(body.tools, id.startsWith("claude") ? [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }]
        : id.startsWith("gemini") ? [{ google_search: {} }] : [{ type: "web_search" }]);
      return sse(fixture);
    };
    const items = await collect(id); assert.equal(calls.length, 2); assert.equal(calls.filter((c) => c.init.method === "POST").length, 1);
    assert.equal(lastSearch(items).status, "executed"); assert.equal(lastSearch(items).citations.length, 1);
    assert.equal(lastSearch(items).citations[0].url, source.url);
    assert.equal(items.filter((i) => i.type === "tool_call").length, 0);
    assert.equal(items.filter((i) => i.type === "delta").map((i) => i.text).join(""), "합성 통계 답변");
    assert.doesNotMatch(JSON.stringify(items), /encrypted_content|synthetic hidden reasoning|untrusted HTML/);
  }
});

test("optional denied/missing/null detail plans Sonar before the first paid call and never drops search intent", async () => {
  for (const detail of [403, { id: "gpt-6-astra" }, { id: "gpt-6-astra", pricing: { web_search_per_1k: null } }]) {
    session([model("gpt-6-astra"), sonar]); const paid = [];
    globalThis.fetch = async (_url, init) => {
      if (init.method !== "POST") return typeof detail === "number" ? new Response("{}", { status: detail }) : Response.json(detail);
      const body = JSON.parse(init.body); paid.push(body);
      if (body.model === "sonar-pro") return Response.json({ choices: [{ message: { content: "synthetic evidence" } }], citations: [source.url] });
      assert.equal(paid.length, 2); assert.match(JSON.stringify(body.messages), /synthetic evidence/); assert.equal(body.tools, undefined);
      return sse([{ choices: [{ delta: { content: "synthetic answer" }, finish_reason: "stop" }] }]);
    };
    const items = await collect("gpt-6-astra"); assert.deepEqual(paid.map((b) => b.model), ["sonar-pro", "gpt-6-astra"]);
    assert.equal(lastSearch(items).route, "sonar"); assert.equal(lastSearch(items).status, "executed");
    assert.ok(items.some((item) => item.type === "progress" && /Sonar/.test(item.message)));
  }
  session([model("gpt-6-astra")]); let paid = 0;
  globalThis.fetch = async (_url, init) => { if (init.method === "POST") paid++; return Response.json({ id: "gpt-6-astra" }); };
  await assert.rejects(collect("gpt-6-astra"), /Sonar/); assert.equal(paid, 0);
});

test("native failures never retry or switch to a bridge after a billed call", async () => {
  for (const scenario of ["http", "tool", "stream"]) {
    session([model("claude-sonnet-5"), sonar]); let paid = 0; const items = [];
    globalThis.fetch = async (_url, init) => {
      if (init.method !== "POST") return Response.json({ id: "claude-sonnet-5", pricing: { web_search_per_1k: 1 } });
      paid++;
      if (scenario === "http") return new Response("{}", { status: 503 });
      if (scenario === "stream") return sse([{ type: "error", error: { type: "overloaded_error", message: "synthetic failure" } }]);
      return sse([{ type: "content_block_start", content_block: { type: "web_search_tool_result", tool_use_id: "srv_1",
        content: { type: "web_search_tool_result_error", error_code: "unavailable" } } }, { type: "message_stop" }]);
    };
    await assert.rejects(async () => { for await (const item of gateway.streamChat("claude-sonnet-5", messages, "synthetic query", new AbortController(), { mode: "always" }, generation)) items.push(item); });
    assert.equal(paid, 1); assert.equal(lastSearch(items).status, "failed");
  }
});

test("off/auto rewrite do no detail GET, cached reuse is labeled and no native tools are attached", async () => {
  session([model("gemini-3.8-flash"), sonar]); let gets = 0;
  globalThis.fetch = async (_url, init) => {
    if (init.method !== "POST") { gets++; throw new Error("unexpected detail read"); }
    assert.equal(JSON.parse(init.body).tools, undefined);
    return sse([{ choices: [{ delta: { content: "rewrite" }, finish_reason: "stop" }] }]);
  };
  const off = await collect("gemini-3.8-flash", "off"); assert.equal(lastSearch(off).status, "not_requested");
  const auto = await collect("gemini-3.8-flash", "auto", { web: { cachedContext: "synthetic old evidence" } });
  assert.equal(lastSearch(auto).status, "cached"); assert.equal(gets, 0);
});

test("compare prepares a single identical evidence batch with zero per-model native search or detail calls", async () => {
  const ids = ["gpt-6-astra", "claude-sonnet-5", "gemini-3.8-flash"]; session([...ids.map(model), sonar]);
  const paid = []; let search;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, "POST"); const body = JSON.parse(init.body); paid.push(body);
    if (body.model === "sonar-pro") return Response.json({ choices: [{ message: { content: "identical synthetic evidence" } }], citations: [source.url] });
    const input = body.messages ?? body.input ?? body.contents;
    assert.match(JSON.stringify(input), /identical synthetic evidence/); assert.equal(body.tools, undefined);
    return body.model.startsWith("claude") ? sse([{ type: "message_stop" }]) : sse([{ choices: [{ delta: { content: "answer" }, finish_reason: "stop" }] }]);
  };
  const evidence = await gateway.prepareSharedWebEvidence("synthetic current query", "always", new AbortController(), (value) => { search = value; }, ids);
  const shared = gateway.appendSharedWebEvidence(messages, evidence, false);
  await Promise.all(ids.map(async (id) => { for await (const _item of gateway.streamChat(id, shared, "synthetic current query", new AbortController(), { mode: "off" }, generation)) { /* drain */ } }));
  assert.equal(paid.length, 4); assert.equal(paid.filter((b) => b.model === "sonar-pro").length, 1);
  assert.equal(search.status, "executed");
  // Every model gets the exact evidence text; provider-specific system layout may differ.
  const evidenceStrings = paid.slice(1).map((b) => (b.messages ?? b.input ?? b.contents).filter((m) => m.role === "user")[0].content);
  assert.deepEqual(evidenceStrings[0], evidenceStrings[1]); assert.deepEqual(evidenceStrings[1], evidenceStrings[2]);
});

test("Sonar incompatible answer roles and native unsupported settings block before paid calls", async () => {
  session([sonar, model("gpt-6-astra"), model("gemini-3.8-flash")]); let paid = 0;
  globalThis.fetch = async (_url, init) => {
    if (init.method === "POST") paid++;
    const id = _url.includes("gemini") ? "gemini-3.8-flash" : "gpt-6-astra";
    return Response.json({ id, pricing: { web_search_per_1k: 0 } });
  };
  await assert.rejects(collect("sonar-pro", "off"), /검색 끄기/);
  await assert.rejects(collect("sonar-pro", "deep"), /검색 끄기/);
  await assert.rejects(gateway.prepareSharedWebEvidence("synthetic", "always", new AbortController(), undefined, ["gpt-6-astra", "sonar-pro"]), /공통 근거/);
  await assert.rejects(collect("gpt-6-astra", "always", { generation: { advanced: { temperature: .5 } } }), /Temperature/);
  await assert.rejects(collect("gemini-3.8-flash", "always", { generation: { advanced: { tools: [{ name: "manual" }] } } }), /수동 도구/);
  await assert.rejects(gateway.startBackgroundResponse("synthetic-thread", "gpt-6-astra", messages, new AbortController(),
    { ...generation, advanced: { responses: { background: true } } }, undefined, { query: "current synthetic", mode: "always" }), /백그라운드/);
  assert.equal(paid, 0);
});

test("cancellation suppresses stale native output without a second paid call", async () => {
  session([model("gemini-3.8-flash"), sonar]); let paid = 0; const abort = new AbortController(); let cancelled = false;
  globalThis.fetch = async (_url, init) => {
    if (init.method !== "POST") return Response.json({ id: "gemini-3.8-flash", pricing: { web_search_per_1k: 0 } });
    paid++; return new Response(new ReadableStream({ pull(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"stale output"}]}}]}\n\n'));
      abort.abort(new Error("synthetic user cancellation"));
    }, cancel() { cancelled = true; } }));
  };
  const items = [];
  await assert.rejects(async () => { for await (const item of gateway.streamChat("gemini-3.8-flash", messages, "synthetic", abort, { mode: "always" }, generation)) items.push(item); }, /synthetic user cancellation/);
  assert.equal(paid, 1); assert.equal(cancelled, true); assert.equal(items.filter((item) => item.type === "delta").length, 0);
});

test("account switch aborts pending model detail and drops previous capability", async () => {
  session([model("gpt-6-astra"), sonar]); let started; const ready = new Promise((resolve) => { started = resolve; }); let aborted = false;
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    started(); init.signal.addEventListener("abort", () => { aborted = true; reject(init.signal.reason); }, { once: true });
  });
  const pending = gateway.checkModelSearch("gpt-6-astra"); await ready;
  session([model("gpt-6-astra"), sonar]); await assert.rejects(pending, /계정/); assert.equal(aborted, true);
  globalThis.fetch = async () => Response.json({ id: "gpt-6-astra", pricing: { web_search_per_1k: null } });
  assert.equal((await gateway.checkModelSearch("gpt-6-astra")).status, "unsupported");
  gateway.setGatewayKey(null); assert.deepEqual(gateway.currentModels(), []);
});

test("Sonar auto preserves ordinary questions with explicit native execution metadata", async () => {
  session([sonar]); let paid = 0;
  globalThis.fetch = async (_url, init) => {
    if (init.method !== "POST") return Response.json({ id: "sonar-pro", pricing: { web_search_per_1k: 0 } });
    paid++; assert.equal(JSON.parse(init.body).model, "sonar-pro");
    return sse([{ citations: [source.url], choices: [{ delta: { content: "synthetic ordinary answer" }, finish_reason: "stop" }] }]);
  };
  const items = await collect("sonar-pro", "auto"); assert.equal(paid, 1); assert.equal(lastSearch(items).status, "executed");
});
