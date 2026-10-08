import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes('/src/') && specifier.startsWith('.')) { const url = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(url) + '.ts')) return next(url.href + '.ts', context); }
  return next(specifier, context);
}});
const { parseEmbeddingResponse, parseRerankResponse, validateSemanticIndex, hybridCandidates, retrievalResult, TEXT_EMBEDDING_DIMENSIONS, validateRetrievalSettings } = await import('../src/shared/document-retrieval.ts');
test.after(() => hooks.deregister());
const model = 'text-embedding-3-small'; const vec = () => [1, ...Array(1535).fill(0)];
test('actual embedding parser reorders exact indices and rejects dimension mixing, NaN/Infinity/zero and duplicates', () => {
  const first = vec(), second = vec(); second[0] = 0; second[1] = 1;
  assert.deepEqual(parseEmbeddingResponse({ model, data: [{ index: 1, embedding: second }, { index: 0, embedding: first }] }, model, 2), [first, second]);
  for (const vector of [[1], Array(1536).fill(0), [NaN, ...Array(1535).fill(0)], [Infinity, ...Array(1535).fill(0)], Array(3072).fill(1)])
    assert.throws(() => parseEmbeddingResponse({ model, data: [{ index: 0, embedding: vector }] }, model, 1), /차원|유한/);
  for (const index of [-1, 1, 0.2, '0']) assert.throws(() => parseEmbeddingResponse({ model, data: [{ index, embedding: vec() }] }, model, 1), /index/);
  assert.throws(() => parseEmbeddingResponse({ model, data: [{ index: 0, embedding: first }, { index: 0, embedding: second }] }, model, 2), /index/);
  assert.throws(() => parseEmbeddingResponse({ model: 'gemini-embedding-2', data: [] }, model, 0), /모델/);
});
test('actual rerank parser validates final count, original indices and finite descending scores', () => {
  const raw = { model: 'qwen3-rerank', results: [{ index: 2, relevance_score: .9 }, { index: 0, relevance_score: .7 }, { index: 1, relevance_score: .1 }] };
  assert.deepEqual(parseRerankResponse(raw, raw.model, 3), [2, 0, 1]);
  for (const patch of [{ index: 3 }, { index: -1 }, { index: 2 }, { relevance_score: NaN }, { relevance_score: Infinity }, { relevance_score: 1.1 }, { relevance_score: .99 }]) {
    const bad = structuredClone(raw); Object.assign(bad.results[1], patch); assert.throws(() => parseRerankResponse(bad, raw.model, 3), /index|점수/);
  }
  assert.throws(() => parseRerankResponse({ ...raw, results: raw.results.slice(0, 2) }, raw.model, 3), /개수/);
});
test('actual persisted index validates version/hash/positions/model dimensions and bounded allocations', () => {
  const index = { version: 1, modelId: model, dimension: 1536, chunks: [{ documentId: randomUUID(), sourceHash: 'a'.repeat(64), position: 0, start: 0, end: 4, vector: vec() }], uncertain: [], updatedAt: new Date().toISOString() };
  assert.equal(validateSemanticIndex(index), index);
  for (const patch of [{ version: 2 }, { dimension: 3072 }, { modelId: 'unknown' }, { chunks: Array(201).fill(index.chunks[0]) }, { chunks: [index.chunks[0], index.chunks[0]] }, { uncertain: Array(201).fill('x') }])
    assert.throws(() => validateSemanticIndex({ ...index, ...patch }), /색인|차원/);
  assert.throws(() => validateSemanticIndex({ ...index, chunks: [{ ...index.chunks[0], end: -1 }] }), /위치/);
  assert.throws(() => validateRetrievalSettings({ mode: 'semantic', embeddingModelId: model, queryConsent: false, rerankConsent: false }), /동의/);
});
test('actual semantic-only hybrid target beyond first 20 survives zero lexical ranks and respects excerpt budget', () => {
  const documentId = randomUUID(); const chunks = Array.from({ length: 35 }, (_, position) => ({ documentId, name: '합성', sourceHash: 'a'.repeat(64), position, start: position * 10, end: position * 10 + 10, text: position === 34 ? 'known answer 42' : 'unrelated text' }));
  const index = { version: 1, modelId: model, dimension: 1536, chunks: chunks.map((chunk) => { const v = vec(); if (chunk.position !== 34) { v[0] = 0; v[1] = 1; } const { name, text, ...source } = chunk; return { ...source, vector: v }; }), uncertain: [], updatedAt: new Date().toISOString() };
  const ranked = hybridCandidates(chunks, index, vec(), 'synonym query'); assert.equal(ranked.length, 20); assert.equal(ranked[0].position, 34);
  const result = retrievalResult(ranked, 'synthetic notice', 1000); assert.ok(result.hits.length <= 5); assert.ok(result.text.length <= 1000); assert.match(result.text, /known answer 42/);
  assert.equal(retrievalResult(ranked, 'notice', 1).text, '');
});
