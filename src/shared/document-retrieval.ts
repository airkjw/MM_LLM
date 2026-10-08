import { researchRecord } from "./research";
export const SEMANTIC_INDEX_VERSION = 1;
export const MAX_SEMANTIC_CHUNKS = 200;
export const RETRIEVAL_CANDIDATES = 20;
export const RETRIEVAL_FINAL = 5;
export const TEXT_EMBEDDING_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536, "text-embedding-3-large": 3072, "gemini-embedding-2": 3072,
  "text-embedding-v4": 1024, "qwen3.7-text-embedding": 1024, "tongyi-embedding-vision-plus": 1152
};
export const REVIEWED_RERANK_MODELS = ["qwen3-rerank"];
export type RetrievalSettings = { mode: "local" | "semantic"; embeddingModelId?: string;
  queryConsent: boolean; rerankModelId?: string; rerankConsent: boolean; rebuildRequired?: boolean };
export type RetrievalChunk = { documentId: string; name: string; sourceHash: string;
  position: number; start: number; end: number; text: string };
export type IndexedChunk = Omit<RetrievalChunk, "name" | "text"> & { vector: number[] };
export type SemanticIndex = { version: 1; modelId: string; dimension: number;
  chunks: IndexedChunk[]; uncertain: string[]; updatedAt: string };
export type RetrievalStatus = { settings: RetrievalSettings; documents: Array<{ id: string; name: string; completed: number; total: number }>;
  dimension?: number; uncertain: number; running: boolean };
export type RetrievalHit = RetrievalChunk & { score: number };
export type RetrievalResult = { hits: RetrievalHit[]; text: string; notice: string };
export const LOCAL_RETRIEVAL: RetrievalSettings = { mode: "local", queryConsent: false, rerankConsent: false };
export const chunkKey = (chunk: Pick<RetrievalChunk, "documentId" | "sourceHash" | "position">) => `${chunk.documentId}:${chunk.sourceHash}:${chunk.position}`;

export function validateRetrievalSettings(raw: unknown): RetrievalSettings {
  if (!researchRecord(raw) || Object.keys(raw).some((key) => !["mode", "embeddingModelId", "queryConsent", "rerankModelId", "rerankConsent", "rebuildRequired"].includes(key)) ||
    !["local", "semantic"].includes(String(raw.mode)) || typeof raw.queryConsent !== "boolean" || typeof raw.rerankConsent !== "boolean" ||
    raw.rebuildRequired !== undefined && typeof raw.rebuildRequired !== "boolean" ||
    raw.embeddingModelId !== undefined && (typeof raw.embeddingModelId !== "string" || !Object.hasOwn(TEXT_EMBEDDING_DIMENSIONS, raw.embeddingModelId)) ||
    raw.rerankModelId !== undefined && !REVIEWED_RERANK_MODELS.includes(String(raw.rerankModelId)) ||
    raw.mode === "semantic" && (!raw.embeddingModelId || !raw.queryConsent) || raw.rerankConsent && (!raw.rerankModelId || raw.mode !== "semantic")) throw new Error("의미 검색 설정 또는 원격 처리 동의가 올바르지 않습니다.");
  return { mode: raw.mode as RetrievalSettings["mode"], embeddingModelId: raw.embeddingModelId as string | undefined,
    queryConsent: raw.queryConsent, rerankModelId: raw.rerankModelId as string | undefined,
    rerankConsent: raw.rerankConsent, rebuildRequired: raw.rebuildRequired as boolean | undefined };
}
export function finiteVector(raw: unknown, dimension: number): number[] {
  if (!Array.isArray(raw) || raw.length !== dimension || raw.some((value) => typeof value !== "number" || !Number.isFinite(value)) ||
    !Number.isFinite(Math.hypot(...raw)) || Math.hypot(...raw) === 0) throw new Error("임베딩 벡터 차원 또는 유한 수 형식이 올바르지 않습니다.");
  return raw as number[];
}
export function validateSemanticIndex(raw: unknown): SemanticIndex {
  if (!researchRecord(raw) || raw.version !== SEMANTIC_INDEX_VERSION || typeof raw.modelId !== "string" ||
    !Object.hasOwn(TEXT_EMBEDDING_DIMENSIONS, raw.modelId) || raw.dimension !== TEXT_EMBEDDING_DIMENSIONS[raw.modelId] ||
    !Array.isArray(raw.chunks) || raw.chunks.length > MAX_SEMANTIC_CHUNKS || !Array.isArray(raw.uncertain) || raw.uncertain.length > MAX_SEMANTIC_CHUNKS ||
    raw.uncertain.some((key) => typeof key !== "string" || key.length > 180) || typeof raw.updatedAt !== "string" || !Number.isFinite(Date.parse(raw.updatedAt))) throw new Error("의미 색인 버전·모델·차원을 확인할 수 없습니다. 재색인이 필요합니다.");
  const keys = new Set<string>();
  for (const chunk of raw.chunks) {
    if (!researchRecord(chunk) || typeof chunk.documentId !== "string" || !/^[a-f0-9-]{36}$/.test(chunk.documentId) ||
      typeof chunk.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(chunk.sourceHash) ||
      !Number.isInteger(chunk.position) || Number(chunk.position) < 0 || !Number.isInteger(chunk.start) || Number(chunk.start) < 0 ||
      !Number.isInteger(chunk.end) || Number(chunk.end) <= Number(chunk.start)) throw new Error("의미 색인의 원본 위치가 올바르지 않습니다.");
    finiteVector(chunk.vector, raw.dimension as number);
    const key = chunkKey(chunk as IndexedChunk); if (keys.has(key)) throw new Error("중복 의미 색인입니다."); keys.add(key);
  }
  return raw as SemanticIndex;
}
export function parseEmbeddingResponse(raw: unknown, modelId: string, count: number): number[][] {
  const dimension = TEXT_EMBEDDING_DIMENSIONS[modelId];
  if (!dimension || !researchRecord(raw) || raw.model !== modelId || !Array.isArray(raw.data) || raw.data.length !== count) throw new Error("임베딩 응답 모델 또는 개수가 일치하지 않습니다.");
  const vectors: number[][] = Array(count); const positions = new Set<number>();
  for (const row of raw.data) {
    if (!researchRecord(row) || !Number.isInteger(row.index) || Number(row.index) < 0 || Number(row.index) >= count || positions.has(Number(row.index))) throw new Error("임베딩 응답 index 순서가 올바르지 않습니다.");
    positions.add(Number(row.index)); vectors[Number(row.index)] = finiteVector(row.embedding, dimension);
  }
  return vectors;
}
export function parseRerankResponse(raw: unknown, modelId: string, count: number): number[] {
  if (!researchRecord(raw) || raw.model !== modelId || !Array.isArray(raw.results) || raw.results.length !== Math.min(RETRIEVAL_FINAL, count)) throw new Error("재정렬 응답 모델 또는 개수가 올바르지 않습니다.");
  const seen = new Set<number>(); let previous = Infinity;
  return raw.results.map((row) => {
    if (!researchRecord(row) || !Number.isInteger(row.index) || Number(row.index) < 0 || Number(row.index) >= count || seen.has(Number(row.index)) ||
      typeof row.relevance_score !== "number" || !Number.isFinite(row.relevance_score) || row.relevance_score < 0 || row.relevance_score > 1 || row.relevance_score > previous) throw new Error("재정렬 index 또는 점수 순서가 올바르지 않습니다.");
    seen.add(Number(row.index)); previous = row.relevance_score; return Number(row.index);
  });
}
export function hybridCandidates(chunks: RetrievalChunk[], index: SemanticIndex, queryVector: number[], query: string): RetrievalHit[] {
  finiteVector(queryVector, index.dimension);
  const words = [...new Set(query.toLowerCase().match(/[가-힣]{2,}|[a-z0-9]{3,}/g) ?? [])].slice(0, 20);
  const byKey = new Map(index.chunks.map((chunk) => [chunkKey(chunk), chunk]));
  const lexical = chunks.map((chunk) => ({ chunk, score: words.reduce((sum, word) => sum + Math.min(12, chunk.text.toLowerCase().split(word).length - 1), 0) })).sort((a, b) => b.score - a.score);
  const norm = Math.hypot(...queryVector);
  const vector = chunks.flatMap((chunk) => {
    const found = byKey.get(chunkKey(chunk)); if (!found) return [];
    const score = found.vector.reduce((sum, value, position) => sum + value * queryVector[position], 0) / (Math.hypot(...found.vector) * norm);
    if (!Number.isFinite(score)) throw new Error("벡터 검색 점수가 올바르지 않습니다.");
    return [{ chunk, score }];
  }).sort((a, b) => b.score - a.score);
  const scores = new Map<string, RetrievalHit>();
  for (const ranked of [lexical.filter((item) => item.score > 0).slice(0, RETRIEVAL_CANDIDATES), vector.slice(0, RETRIEVAL_CANDIDATES)]) ranked.forEach(({ chunk }, rank) => {
    const key = chunkKey(chunk); const previous = scores.get(key);
    scores.set(key, { ...chunk, score: (previous?.score ?? 0) + 1 / (60 + rank + 1) });
  });
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, RETRIEVAL_CANDIDATES);
}
export function retrievalResult(hits: RetrievalHit[], notice: string, maxChars = 40_000): RetrievalResult {
  const selected: RetrievalHit[] = []; const blocks: string[] = []; let used = 0;
  for (const hit of hits.slice(0, RETRIEVAL_FINAL)) {
    const block = `[프로젝트 문서: ${hit.name}; 청크 ${hit.position + 1}; 문자 ${hit.start}~${hit.end}; 원본 ${hit.sourceHash}]\n${hit.text}\n[/프로젝트 문서]`;
    if (used + block.length + 2 > maxChars) continue;
    selected.push(hit); blocks.push(block); used += block.length + 2;
  }
  return { hits: selected, notice, text: blocks.join("\n\n") };
}
