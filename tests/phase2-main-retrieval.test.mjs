import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = await mkdtemp(join(tmpdir(), 'mmllm-phase2-boundaries-'));
const handlers = new Map();
const window = { webContents: { mainFrame: { url: 'mmllm://app/index.html' } } };
const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
globalThis.__phase2Electron = {
  app: { isPackaged: true, getVersion: () => '0.5.1', getPath: () => root, on: () => {}, whenReady: () => new Promise(() => {}) },
  ipcMain: { on: (name, handler) => handlers.set(name, handler), handle: (name, handler) => handlers.set(name, handler) },
  protocol: { registerSchemesAsPrivileged: () => {} },
  safeStorage: { isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from(`synthetic-vault\0${value}`),
    decryptStringAsync: async (bytes) => ({ result: bytes.toString().slice(16), shouldReEncrypt: false }) },
  BrowserWindow: class {}, dialog: {}, nativeTheme: {}, screen: {}, shell: {}
};
let documentText = ''; globalThis.__phase2Document = () => documentText;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'electron') return { url: 'phase2:electron', shortCircuit: true };
    if (context.parentURL?.includes('/src/') && specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL);
      if (url.pathname.endsWith('/main/updates')) return { url: 'phase2:updates', shortCircuit: true };
      if (url.pathname.endsWith('/main/document-text')) return { url: 'phase2:document-text', shortCircuit: true };
      if (!existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(url) + '.ts')) return next(url.href + '.ts', context);
    } return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'phase2:electron') return { format: 'module', shortCircuit: true,
      source: 'export const { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, screen, shell, safeStorage } = globalThis.__phase2Electron;' };
    if (url === 'phase2:updates') return { format: 'module', shortCircuit: true, source: 'export const checkForUpdates = () => {}, currentUpdateState = () => ({}), installUpdate = () => {}, startUpdates = () => {};' };
    if (url === 'phase2:document-text') return { format: 'module', shortCircuit: true, source: 'export const configureOcrDataRoot = () => {}, extractPdf = async () => globalThis.__phase2Document(), extractDocx = extractPdf, extractXlsx = extractPdf;' };
    const loaded = next(url, context);
    return url.endsWith('/src/main/index.ts') ? { ...loaded, source: loaded.source.toString() + '\nexport function registerPhase2Fixture(window) { mainWindow = window; registerHandlers(); }\n' } : loaded;
  }
});
const main = await import('../src/main/index.ts'); const storage = await import('../src/main/storage.ts');
const gateway = await import('../src/main/gateway.ts'); const vault = await import('../src/main/project-vault.ts');
const attachments = await import('../src/main/attachments.ts'); const shared = await import('../src/shared/document-retrieval.ts');
main.registerPhase2Fixture(window);
const models = [{ id: 'gpt-6-astra', type: 'llm' }, { id: 'claude-sonnet-5', type: 'llm' }, { id: 'sonar-pro', type: 'llm' },
  { id: 'text-embedding-3-small', type: 'embedding' }, { id: 'gemini-embedding-2', type: 'embedding' }, { id: 'qwen3-rerank', type: 'rerank' }];
async function session(key = 'synthetic-phase2-account') { await storage.activateProfileForKey(key); await storage.saveKey(key); gateway.commitGatewaySession(key, models.map((m) => ({ ...m }))); }
await session(); const originalFetch = globalThis.fetch;
test.after(async () => { globalThis.fetch = originalFetch; attachments.clearAttachments(); hooks.deregister(); delete globalThis.__phase2Electron; delete globalThis.__phase2Document; await rm(root, { recursive: true, force: true }); });
const invoke = (name, ...args) => Promise.resolve().then(() => handlers.get(name)(trusted, ...args));
const remoteSettings = { mode: 'semantic', embeddingModelId: 'text-embedding-3-small', queryConsent: true, rerankConsent: false };
function vector(text, dimension = 1536) { const values = Array(dimension).fill(0); values[text.includes('synthetic-known-answer') || text === 'synonym query' ? 0 : 1] = 1; return values; }
function embedding(body) { return Response.json({ model: body.model, data: body.input.map((text, index) => ({ index, embedding: vector(text, shared.TEXT_EMBEDDING_DIMENSIONS[body.model]) })) }); }
function fetchModels(url, init) {
  if (!init?.method || init.method === 'GET') {
    if (url.endsWith('/credits/')) return Response.json({ credits: 100 });
    if (url.endsWith('/models/')) return Response.json({ data: models });
    return Response.json({ id: url.split('/').at(-2), pricing: { web_search_per_1k: 0 } });
  } throw new Error('unexpected POST');
}
async function project(text, name = 'synthetic.pdf') {
  documentText = text; const project = await invoke('projects:create', { name: '합성 연구', instruction: '' });
  const [attachment] = attachments.addDroppedAttachments([{ name, bytes: Buffer.from('%PDF-1.7\nsynthetic-' + randomUUID()) }], ['document']);
  await invoke('projects:add-document', project.id, attachment.id, true); return project.id;
}
async function stream(request) {
  const port = new EventEmitter(); const events = []; port.start = () => {};
  let complete; const done = new Promise((resolve) => { complete = resolve; });
  port.postMessage = (event) => events.push(structuredClone(event)); port.close = () => { port.emit('close'); complete(); };
  handlers.get('chat:stream')({ ...trusted, ports: [port] }, request);
  await Promise.race([done, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('chat IPC timeout')), 5000); timer.unref(); })]); return events;
}
async function thread(projectId, modelId = 'gpt-6-astra', mode = 'off') {
  const thread = await storage.createThread({ modelId, projectId }); await storage.updateThread(thread.id, (value) => { value.attachmentConsent = true; value.webSearchMode = mode; }); return thread;
}

test('real IPC has zero network before relevant consent and rejects untrusted frames/models', async () => {
  let requests = 0; globalThis.fetch = async () => { requests++; throw new Error('unexpected network'); };
  const id = await project('합성 첫 문단과 마지막 정답');
  await invoke('projects:retrieval-status', id); assert.equal(requests, 0);
  await assert.rejects(invoke('projects:retrieval-settings', id, { ...remoteSettings, queryConsent: false }), /동의/);
  await assert.rejects(invoke('projects:retrieval-settings', id, { ...remoteSettings, embeddingModelId: 'unknown' }), /올바르지/);
  await invoke('projects:retrieval-settings', id, remoteSettings); assert.equal(requests, 0);
  await assert.rejects(invoke('projects:index', randomUUID(), id, false, false), /동의/);
  await assert.rejects(Promise.resolve().then(() => handlers.get('research:discover')({ sender: {}, senderFrame: {} }, randomUUID())), /허용되지|요청/);
  await assert.rejects(invoke('projects:retrieve', randomUUID(), id, '합성'), /완료된 의미 색인/); assert.equal(requests, 0);
  const th = await thread(id); await storage.updateThread(th.id, (value) => { value.attachmentConsent = false; });
  const events = await stream({ threadId: th.id, modelId: th.modelId, text: '합성', attachmentIds: [] });
  assert.match(events.at(-1).message, /전송 확인/); assert.equal(requests, 0);
});

test('actual MCP IPC requires discovery, binds schema tokens and aborts a stale selected-suite response on logout', async () => {
  let calls = 0; let releaseLate; let reached;
  const suite = { slug: 'synthetic-scholar', display_name: '합성 연구', url: '/v1/gateway/mcp/synthetic-scholar/', transport: 'streamable-http' };
  const tool = { name: 'synthetic_search', annotations: { readOnlyHint: true, destructiveHint: false }, inputSchema: { type: 'object', properties: { search_text: { type: 'string' } }, required: ['search_text'], additionalProperties: false } };
  globalThis.fetch = async (_url, init) => {
    calls++; if (init.method === 'GET') return Response.json({ object: 'list', data: [suite] });
    const body = JSON.parse(init.body); const response = (result) => Response.json({ jsonrpc: '2.0', id: body.id, result });
    if (body.method === 'initialize') return response({ protocolVersion: '2025-06-18', capabilities: { tools: {} } });
    if (body.method === 'tools/list') return response({ tools: [tool] });
    reached(); return new Promise((resolve) => { releaseLate = () => resolve(response({ content: [{ type: 'text', text: 'stale synthetic' }] })); });
  };
  await assert.rejects(invoke('research:tools', randomUUID(), suite.slug), /먼저/); assert.equal(calls, 0);
  const suites = await invoke('research:discover', randomUUID()); assert.equal(suites.length, 1); assert.equal(calls, 1);
  const tools = await invoke('research:tools', randomUUID(), suite.slug); assert.equal(calls, 3);
  await assert.rejects(invoke('research:search', randomUUID(), 'unreviewed-token', {}), /읽기 전용/); assert.equal(calls, 3);
  const pending = new Promise((resolve) => { reached = resolve; });
  const running = invoke('research:search', randomUUID(), tools[0].token, { search_text: 'synthetic' });
  const rejected = assert.rejects(running, /계정 전환/); await pending;
  await invoke('session:logout'); await rejected; releaseLate(); await session();
  await assert.rejects(invoke('research:search', randomUUID(), tools[0].token, { search_text: 'synthetic' }), /읽기 전용/); assert.equal(calls, 4);
});

test('actual long-document indexing, semantic-only later target, bounded rerank and encrypted provenance', async () => {
  const text = 'unrelated filler content. '.repeat(7000) + '\nsynthetic-known-answer = 314159\n';
  const id = await project(text); await invoke('projects:retrieval-settings', id, remoteSettings);
  let paid = 0; const bodies = [];
  globalThis.fetch = async (_url, init) => { paid++; const body = JSON.parse(init.body); bodies.push(body);
    if (body.input) return embedding(body);
    assert.ok(body.documents.length <= 20); assert.equal(body.top_n, 5); assert.equal(body.return_documents, false);
    return Response.json({ model: body.model, results: Array.from({ length: 5 }, (_, index) => ({ index, relevance_score: 1 - index / 10 })) });
  };
  const done = await invoke('projects:index', randomUUID(), id, true, false);
  const count = done.documents.reduce((sum, doc) => sum + doc.total, 0); assert.ok(count > 20); assert.equal(paid, count);
  assert.equal(done.documents[0].completed, count); assert.equal(done.uncertain, 0); assert.equal(done.dimension, 1536);
  const result = await invoke('projects:retrieve', randomUUID(), id, 'synonym query');
  assert.match(result.hits[0].text, /synthetic-known-answer = 314159/); assert.ok(result.hits[0].position > 20);
  assert.match(result.text, /원본 [a-f0-9]{64}/); assert.equal(paid, count + 1);
  await invoke('projects:retrieval-settings', id, { ...remoteSettings, rerankConsent: true, rerankModelId: 'qwen3-rerank' });
  await invoke('projects:retrieve', randomUUID(), id, 'synonym query'); assert.equal(paid, count + 3);
  assert.equal(bodies.at(-1).documents.length, 20);
  const paths = await readdir(join(root, 'private', 'project-blobs', storage.getActiveProfileId()));
  for (const path of paths) { const bytes = await readFile(join(root, 'private', 'project-blobs', storage.getActiveProfileId(), path)); assert.equal(bytes.includes(Buffer.from('synthetic-known-answer')), false); assert.equal(bytes.includes(Buffer.from('"vector"')), false); }
  const exported = await storage.exportPortableBackup(); const backup = exported.projects.find((item) => item.id === id);
  assert.deepEqual(backup.retrieval, { ...shared.LOCAL_RETRIEVAL, rebuildRequired: true });
  assert.equal(JSON.stringify(exported).includes('semanticBlobId'), false); assert.equal(JSON.stringify(exported).includes('"vector"'), false);
});

test('actual index cancellation retains completed chunks without blocking vault and explicit resume skips completed work', async () => {
  const id = await project('synthetic content. '.repeat(900)); await invoke('projects:retrieval-settings', id, remoteSettings);
  let paid = 0; let releaseLate; let second;
  const reached = new Promise((resolve) => { second = resolve; });
  globalThis.fetch = async (_url, init) => { paid++; const body = JSON.parse(init.body);
    if (paid === 2) { second(); return new Promise((resolve) => { releaseLate = () => resolve(embedding(body)); }); }
    return embedding(body);
  };
  const requestId = randomUUID(); const running = invoke('projects:index', requestId, id, true, false);
  const rejected = assert.rejects(running, /취소/); await reached;
  const progress = await Promise.race([invoke('projects:retrieval-status', id), new Promise((_, reject) => setTimeout(() => reject(new Error('vault blocked by network')), 1000))]);
  assert.equal(progress.documents[0].completed, 1); assert.equal(progress.uncertain, 1);
  await invoke('research:cancel', requestId); await rejected; releaseLate();
  const cancelled = await invoke('projects:retrieval-status', id); assert.equal(cancelled.documents[0].completed, 1); assert.equal(cancelled.uncertain, 1);
  await assert.rejects(invoke('projects:index', randomUUID(), id, true, false), /중복 과금/); assert.equal(paid, 2);
  globalThis.fetch = async (_url, init) => { paid++; return embedding(JSON.parse(init.body)); };
  const done = await invoke('projects:index', randomUUID(), id, true, true);
  assert.equal(done.documents[0].completed, done.documents[0].total); assert.equal(done.uncertain, 0); assert.equal(paid, done.documents[0].total + 1);
});

test('actual paid errors never retry/fallback and model changes require a fresh index', async () => {
  const id = await project('synthetic content'); await invoke('projects:retrieval-settings', id, remoteSettings); let paid = 0;
  globalThis.fetch = async () => { paid++; return new Response('', { status: 503, headers: { 'retry-after': '19' } }); };
  await assert.rejects(invoke('projects:index', randomUUID(), id, true, false), /503.*Retry-After: 19/); assert.equal(paid, 1);
  assert.equal((await invoke('projects:retrieval-status', id)).uncertain, 1);
  await invoke('projects:retrieval-settings', id, { ...remoteSettings, embeddingModelId: 'gemini-embedding-2' });
  assert.equal((await invoke('projects:retrieval-status', id)).uncertain, 0);
  globalThis.fetch = async (_url, init) => { paid++; const body = JSON.parse(init.body); assert.equal(body.model, 'gemini-embedding-2'); assert.equal(body.task_type, 'RETRIEVAL_DOCUMENT'); return embedding(body); };
  await invoke('projects:index', randomUUID(), id, true, false);
  globalThis.fetch = async (_url, init) => { paid++; const body = JSON.parse(init.body); assert.equal(body.task_type, 'RETRIEVAL_QUERY'); return embedding(body); };
  await invoke('projects:retrieve', randomUUID(), id, 'synonym query'); assert.equal(paid, 3);
});

test('actual chat semantic preflight rejects invalid images/PDFs and web routes with zero paid POSTs', async () => {
  const id = await project('synthetic project text'); await invoke('projects:retrieval-settings', id, remoteSettings);
  globalThis.fetch = async (_url, init) => embedding(JSON.parse(init.body)); await invoke('projects:index', randomUUID(), id, true, false);
  let paid = 0; globalThis.fetch = async (url, init) => { if (init?.method === 'POST') { paid++; throw new Error('unexpected paid'); } return fetchModels(url, init); };
  documentText = '';
  const cases = [['synthetic.png', 2, 7 * 1024 * 1024, '\x89PNG\r\n\x1a\n', /첨부 이미지 전체 크기/], ['synthetic.pdf', 3, 20, '%PDF-1.7\n', /PDF.*최대 2개/], ['synthetic.pdf', 1, 20, '%PDF-1.7\n', /원문 PDF는 Claude/]];
  for (const [name, count, size, prefix, error] of cases) {
    const th = await thread(id);
    const attachmentIds = attachments.addDroppedAttachments(Array.from({ length: count }, () => { const bytes = Buffer.alloc(size); Buffer.from(prefix).copy(bytes); return { name, bytes }; }), ['image', 'document']).map((item) => item.id);
    const events = await stream({ threadId: th.id, modelId: th.modelId, text: 'synthetic question', attachmentIds }); assert.match(events.at(-1).message, error); assert.equal(paid, 0);
  }
  const sonar = await thread(id, 'sonar-pro'); const unsupported = await stream({ threadId: sonar.id, modelId: sonar.modelId, text: 'synthetic', attachmentIds: [] }); assert.match(unsupported.at(-1).message, /Sonar는 검색 끄기/); assert.equal(paid, 0);
  const background = await thread(id, 'gpt-6-astra', 'always'); await storage.updateThread(background.id, (value) => { value.advanced = { responses: { background: true } }; });
  const unsupportedBackground = await stream({ threadId: background.id, modelId: background.modelId, text: 'synthetic', attachmentIds: [] }); assert.match(unsupportedBackground.at(-1).message, /백그라운드 응답과 웹 검색/); assert.equal(paid, 0);
});

test('actual chat dedicated project slot preserves a prompt quoting the exact lexical project text', async () => {
  const id = await project('synthetic quoted project text'); await invoke('projects:retrieval-settings', id, remoteSettings);
  globalThis.fetch = async (_url, init) => embedding(JSON.parse(init.body)); await invoke('projects:index', randomUUID(), id, true, false);
  const context = await vault.projectContext(storage.getActiveProfileId(), id, 'synthetic', false); const prompt = `Please analyze this exact quote:\n${context.text}\nEND_OF_QUESTION`;
  const th = await thread(id); const calls = [];
  globalThis.fetch = async (_url, init) => { const body = JSON.parse(init.body); calls.push(body); if (body.input) return embedding(body);
    assert.ok(body.messages.at(-1).content.startsWith(prompt)); assert.match(body.messages.at(-1).content, /의미\+어휘 검색/);
    return new Response('data: {"choices":[{"delta":{"content":"synthetic answer"},"finish_reason":"stop"}]}\n\n'); };
  const events = await stream({ threadId: th.id, modelId: th.modelId, text: prompt, attachmentIds: [] }); assert.equal(events.at(-1).type, 'done'); assert.equal(calls.length, 2);
});

test('actual delete during pending network cancels stale writes and preserves the remaining original documents', async () => {
  const id = await project('synthetic pending delete text'); await invoke('projects:retrieval-settings', id, remoteSettings);
  let releaseLate, started; const reached = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = async (_url, init) => { const body = JSON.parse(init.body); started(); return new Promise((resolve) => { releaseLate = () => resolve(embedding(body)); }); };
  const running = invoke('projects:index', randomUUID(), id, true, false); const rejected = assert.rejects(running, /변경/); await reached;
  const docs = (await invoke('projects:list')).find((item) => item.id === id).documents;
  await Promise.race([invoke('projects:remove-document', id, docs[0].id), new Promise((_, reject) => setTimeout(() => reject(new Error('delete hung')), 1000))]); await rejected; releaseLate();
  const done = await invoke('projects:retrieval-status', id); assert.equal(done.documents.length, 0); assert.equal(done.dimension, undefined);
  await invoke('projects:delete', id); await assert.rejects(invoke('projects:retrieval-status', id), /찾을 수 없습니다/);
});

test('actual logout aborts indexing, clears derived state and restore/profile isolation remains local without network', async () => {
  const id = await project('synthetic isolated original'); await invoke('projects:retrieval-settings', id, remoteSettings);
  globalThis.fetch = async (_url, init) => embedding(JSON.parse(init.body)); await invoke('projects:index', randomUUID(), id, true, false);
  const backup = await storage.exportPortableBackup(); const oldProfile = storage.getActiveProfileId();
  const pendingId = await project('synthetic pending profile text'); await invoke('projects:retrieval-settings', pendingId, remoteSettings);
  let releaseLate, started; const pending = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = async (_url, init) => { const body = JSON.parse(init.body); started(); return new Promise((resolve) => { releaseLate = () => resolve(embedding(body)); }); };
  const running = invoke('projects:index', randomUUID(), pendingId, true, false); const rejected = assert.rejects(running, /계정|중단/); await pending;
  await invoke('session:logout'); await rejected; releaseLate();
  const cleaned = await vault.retrievalSnapshot(oldProfile, id); assert.equal(cleaned.index, null); assert.equal(cleaned.settings.mode, 'local'); assert.equal(cleaned.chunks.length, 1);
  assert.equal((await vault.retrievalSnapshot(oldProfile, pendingId)).index, null);
  await session('synthetic-other-account'); let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('unexpected network'); };
  assert.deepEqual(await invoke('projects:list'), []); await assert.rejects(invoke('projects:retrieval-status', id), /찾을 수 없습니다/);
  const sourceHash = cleaned.chunks[0].sourceHash;
  const poisoned = structuredClone(backup);
  poisoned.projects.find((item) => item.id === id).documents[0].sourceHash = '0'.repeat(64);
  poisoned.projects.find((item) => item.id === id).semanticBlobId = randomUUID();
  await storage.restorePortableBackup(poisoned);
  assert.equal((await vault.retrievalSnapshot(storage.getActiveProfileId(), id)).chunks[0].sourceHash, sourceHash);
  const restored = await invoke('projects:retrieval-status', id); assert.equal(restored.settings.mode, 'local'); assert.equal(restored.settings.rebuildRequired, true); assert.equal(restored.dimension, undefined);
  const result = await invoke('projects:retrieve', randomUUID(), id, 'synthetic'); assert.match(result.notice, /로컬/); assert.equal(calls, 0);
});

test('actual main MCP IPC accepts omission and a valid enum but rejects empty enum before tools/call', async () => {
  await session();
  const suite = { slug: 'synthetic-scope', display_name: 'Synthetic', url: '/v1/gateway/mcp/synthetic-scope/', transport: 'streamable-http' };
  const tool = { name: 'synthetic_search', annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, scope: { type: 'string', enum: ['papers', 'laws'] } }, required: ['query'], additionalProperties: false } };
  const executed = [];
  globalThis.fetch = async (_url, init) => {
    if (init.method === 'GET') return Response.json({ object: 'list', data: [suite] });
    const body = JSON.parse(init.body);
    const result = body.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} } }
      : body.method === 'tools/list' ? { tools: [tool] } : { content: [{ type: 'text', text: 'Synthetic evidence' }] };
    if (body.method === 'tools/call') executed.push(body.params.arguments);
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  };
  await invoke('research:discover', randomUUID()); const tools = await invoke('research:tools', randomUUID(), suite.slug);
  await invoke('research:search', randomUUID(), tools[0].token, { query: 'Synthetic' });
  await invoke('research:search', randomUUID(), tools[0].token, { query: 'Synthetic', scope: 'papers' });
  await assert.rejects(invoke('research:search', randomUUID(), tools[0].token, { query: 'Synthetic', scope: '' }), /검색 문자열 또는 선택값/);
  assert.deepEqual(executed, [{ query: 'Synthetic' }, { query: 'Synthetic', scope: 'papers' }]);
});
