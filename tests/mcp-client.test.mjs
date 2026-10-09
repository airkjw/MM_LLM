import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes('/src/') && specifier.startsWith('.')) {
    const url = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(url) + '.ts')) return next(url.href + '.ts', context);
  } return next(specifier, context);
}});
const { McpClient, parseMcpResponse } = await import('../src/main/mcp-client.ts');
const { reviewedSearchSchema, researchEvidence } = await import('../src/shared/research.ts');
const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; hooks.deregister(); });
const signal = () => new AbortController().signal;
const tool = { name: 'synthetic_search', annotations: { readOnlyHint: true, destructiveHint: false },
  inputSchema: { type: 'object', properties: { words: { type: 'string', maxLength: 300 }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['words'], additionalProperties: false } };
const suite = { slug: 'synthetic-research', display_name: '합성 검색', url: '/v1/gateway/mcp/synthetic-research/', transport: 'streamable-http' };
function envelope(init, result, sse = false) {
  const id = JSON.parse(init.body).id; const body = { jsonrpc: '2.0', id, result };
  return sse ? new Response(`: keepalive\r\n\r\nevent: message\r\ndata: ${JSON.stringify(body)}\r\n\r\n`, { headers: { 'content-type': 'text/event-stream' } }) : Response.json(body);
}
async function ready(call) {
  const client = new McpClient(); const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init }); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, 'Bearer synthetic');
    if (init.method === 'GET') return Response.json({ object: 'list', data: [suite] });
    const body = JSON.parse(init.body);
    if (body.method === 'initialize') return envelope(init, { protocolVersion: '2025-06-18', capabilities: { tools: {} } }, true);
    if (body.method === 'tools/list') return envelope(init, { tools: [tool, { name: 'unreviewed', inputSchema: {} }] });
    return call(init);
  };
  assert.equal(calls.length, 0);
  await client.discover('synthetic', signal());
  const tools = await client.listTools('synthetic', suite.slug, signal());
  assert.equal(calls.length, 3);
  return { client, tools, calls };
}
test('actual discovery, selected suite initialization and reviewed schema execution preserve provenance', async () => {
  const { client, tools, calls } = await ready((init) => envelope(init, { content: [{ type: 'text', text: JSON.stringify({ results: [{ title: '합성 논문', url: 'https://example.org/source', abstract: '합성 초록', published_date: '2026-01-02', effective_date: '2026-02-03' }] }) }] }, true));
  assert.equal(tools[0].executable, true); assert.equal(tools[1].executable, false);
  await assert.rejects(client.search('synthetic', tools[1].token, {}, signal()), /읽기 전용/);
  await assert.rejects(client.search('synthetic', tools[0].token, { words: '합성', url: 'https://bad' }, signal()), /발견한/);
  await assert.rejects(client.search('synthetic', tools[0].token, { words: '합성', limit: 21 }, signal()), /범위/);
  assert.equal(calls.length, 3);
  const result = await client.search('synthetic', tools[0].token, { words: '합성', limit: 5 }, signal());
  assert.equal(calls.length, 4); assert.equal(result.sources[0].title, '합성 논문'); assert.equal(result.sources[0].dates.published_date, '2026-01-02');
  assert.match(researchEvidence(result), /원문 전체가 아닙니다.*현행 여부는 미확인/);
  assert.match(researchEvidence(result), /https:\/\/example.org\/source/);
  client.clear(); await assert.rejects(client.search('synthetic', tools[0].token, { words: '합성' }, signal()), /발견/);
});
test('JSONRPC exact ID, single SSE envelope and error domains are checked', async () => {
  for (const bad of [{ jsonrpc: '2.0', id: 'other', result: {} }, { jsonrpc: '2.0', id: 'id', result: {}, error: {} }])
    await assert.rejects(parseMcpResponse(Response.json(bad), signal(), 'id'), /ID 또는 구조/);
  await assert.rejects(parseMcpResponse(Response.json({ jsonrpc: '2.0', id: 'id', error: { code: -32602, message: 'synthetic' } }), signal(), 'id'), /JSON-RPC 오류 -32602/);
  await assert.rejects(parseMcpResponse(new Response('event: other\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }), signal(), 'id'), /SSE 이벤트/);
  await assert.rejects(parseMcpResponse(new Response('event: message\ndata: {}\n\nevent: message\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }), signal(), 'id'), /envelope 수/);
  await assert.rejects(parseMcpResponse(Response.json({ jsonrpc: '2.0', id: 'id', result: {} }, { headers: { 'content-length': '3000000' } }), signal(), 'id'), /크기/);
  const { client, tools, calls } = await ready((init) => envelope(init, { content: [], isError: true }));
  await assert.rejects(client.search('synthetic', tools[0].token, { words: '합성' }, signal()), /isError/); assert.equal(calls.length, 4);
});
test('permission and quota responses expose Retry-After with exactly one call and invalidate tool permission', async () => {
  for (const status of [403, 429, 503]) {
    const { client, tools, calls } = await ready(() => new Response('', { status, headers: { 'retry-after': '17' } }));
    await assert.rejects(client.search('synthetic', tools[0].token, { words: '합성' }, signal()), new RegExp(`${status}.*Retry-After: 17`));
    await assert.rejects(client.search('synthetic', tools[0].token, { words: '합성' }, signal()), /발견/);
    assert.equal(calls.length, 4);
  }
});
test('unreviewed schemas and arbitrary suite paths never execute; stale and cancelled responses are dropped', async () => {
  for (const change of [{ annotations: { readOnlyHint: true } }, { name: 'synthetic_write' },
    { inputSchema: { ...tool.inputSchema, additionalProperties: true } },
    { inputSchema: { ...tool.inputSchema, properties: { words: { type: 'string', pattern: '.*' } } } }])
    assert.ok(reviewedSearchSchema({ ...tool, ...change }).reason);
  const { client, tools, calls } = await ready(async (init) => { client.clear(); return envelope(init, { content: [] }); });
  await assert.rejects(client.listTools('synthetic', '../other', signal()), /먼저/);
  await assert.rejects(client.search('synthetic', tools[0].token, { words: '합성' }, signal()), /변경/); assert.equal(calls.length, 4);
  const controller = new AbortController(); controller.abort(new Error('synthetic cancel'));
  await assert.rejects(client.discover('synthetic', controller.signal), /synthetic cancel/); assert.equal(calls.length, 4);
});
test('actual tools/call local key minute quota prevents the 31st paid attempt without retry', async () => {
  const { client, tools, calls } = await ready((init) => envelope(init, { content: [{ type: 'text', text: 'synthetic' }] }));
  for (let i = 0; i < 30; i++) await client.search('synthetic', tools[0].token, { words: 'synthetic' }, signal());
  await assert.rejects(client.search('synthetic', tools[0].token, { words: 'synthetic' }, signal()), /키 호출 한도/); assert.equal(calls.length, 33);
});

for (const sse of [false, true]) {
  test(`actual MCP ${sse ? 'SSE' : 'JSON'} complete >30k text JSON retains all normalized provenance before display limits`, async () => {
    const results = Array.from({ length: 10 }, (_, i) => ({ title: `Synthetic article ${i}`, url: `https://example.org/source-${i}`,
      abstract: 'A'.repeat(4000), published_date: '2026-01-02', effective_date: '2026-02-03', version: 'synthetic-v1' }));
    const text = JSON.stringify({ results });
    assert.ok(text.length > 30000 && Buffer.byteLength(text) < 2 * 1024 * 1024);
    const { client, tools, calls } = await ready((init) => envelope(init, { content: [{ type: 'text', text }] }, sse));
    const result = await client.search('synthetic', tools[0].token, { words: 'Synthetic' }, signal());
    assert.equal(result.sources.length, 10);
    for (let i = 0; i < 10; i++) {
      assert.equal(result.sources[i].title, results[i].title); assert.equal(result.sources[i].url, results[i].url);
      assert.equal(result.sources[i].text.length, 4000);
      assert.deepEqual(result.sources[i].dates, { published_date: '2026-01-02', effective_date: '2026-02-03', version: 'synthetic-v1' });
      assert.equal(result.sources[i].searchedAt, result.searchedAt);
    }
    assert.equal(result.rawText, text.slice(0, 30000)); assert.match(result.notice, /검색 텍스트 표시는 30,000자.*생략/);
    assert.doesNotMatch(result.notice, /출처 표시는 최대/);
    const evidence = researchEvidence(result); assert.match(evidence, /근거 일부 생략.*25,000자/);
    assert.match(evidence, /원문 전체가 아닙니다.*현행 여부는 미확인/); assert.ok(evidence.length < 28000);
    assert.equal(calls.filter(({ init }) => init.method === 'POST' && JSON.parse(init.body).method === 'tools\/call').length, 1);
  });
}
test('actual MCP source count/fields are bounded after complete parse and disclosed without trusting extra JSON fields', async () => {
  const sources = Array.from({ length: 31 }, () => ({ title: 'T'.repeat(501), url: 'https://example.org/source', text: 'A'.repeat(6001),
    version: 'V'.repeat(201), instructions: 'untrusted synthetic commands' }));
  const { client, tools } = await ready((init) => envelope(init, { content: [{ type: 'text', text: JSON.stringify({ results: sources }) }] }));
  const result = await client.search('synthetic', tools[0].token, { words: 'Synthetic' }, signal());
  assert.equal(result.sources.length, 30); assert.equal(result.sources[0].title.length, 500);
  assert.equal(result.sources[0].text.length, 6000); assert.equal(result.sources[0].dates.version.length, 200);
  assert.equal(Object.hasOwn(result.sources[0], 'instructions'), false); assert.match(result.notice, /출처 표시는 최대 30개.*일부를 생략/);
});
test('actual MCP small text displays and inserts without claiming truncation', async () => {
  const { client, tools } = await ready((init) => envelope(init, { content: [{ type: 'text', text: 'Synthetic short text' }] }));
  const result = await client.search('synthetic', tools[0].token, { words: 'Synthetic' }, signal());
  assert.equal(result.rawText, 'Synthetic short text'); assert.deepEqual(result.sources, []);
  assert.doesNotMatch(result.notice + researchEvidence(result), /생략/);
});

test('L5: server-declared read-only is labeled as a declaration and an absent destructiveHint stays non-executable', async () => {
  const { tools } = await ready(() => { throw new Error('unused'); });
  assert.match(tools[0].reason, /제공사가 읽기 전용으로 선언/);
  const missing = reviewedSearchSchema({ ...tool, annotations: { readOnlyHint: true } });
  assert.ok(missing.reason); assert.equal(missing.reason.includes('제공사가 읽기 전용으로 선언'), false);
  assert.equal(reviewedSearchSchema(tool).fields.length > 0, true);
});
