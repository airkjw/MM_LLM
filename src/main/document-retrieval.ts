import type { GatewayModel } from "../shared/contracts";
import { chunkKey, hybridCandidates, LOCAL_RETRIEVAL, MAX_SEMANTIC_CHUNKS, parseEmbeddingResponse, parseRerankResponse,
  RETRIEVAL_FINAL, retrievalResult, TEXT_EMBEDDING_DIMENSIONS,
  type RetrievalResult, type RetrievalSettings, type RetrievalStatus, type SemanticIndex } from "../shared/document-retrieval";
import { configureRetrieval, retrievalSnapshot, saveSemanticIndex, type RetrievalSnapshot } from "./project-vault";
import { researchJson, researchRequest } from "./research-transport";

function assertModels(settings: RetrievalSettings, models: GatewayModel[]): void {
  if (settings.mode !== "semantic" || !settings.queryConsent || !models.some((model) =>
    model.type === "embedding" && model.id === settings.embeddingModelId && Object.hasOwn(TEXT_EMBEDDING_DIMENSIONS, model.id))) throw new Error("현재 계정 목록에서 임베딩 모델과 질의 전송 동의를 확인해 주세요. 로컬 검색을 직접 선택할 수 있습니다.");
  if (settings.rerankConsent && !models.some((model) => model.type === "rerank" && model.id === settings.rerankModelId)) throw new Error("현재 계정에서 선택한 재정렬 모델을 확인할 수 없습니다. 설정을 직접 변경해 주세요.");
}
function status(snapshot: RetrievalSnapshot, running: boolean): RetrievalStatus {
  const completed = new Set(snapshot.index?.chunks.map(chunkKey));
  const documents = new Map<string, RetrievalStatus["documents"][number]>();
  for (const chunk of snapshot.chunks) {
    const document = documents.get(chunk.documentId) ?? { id: chunk.documentId, name: chunk.name, completed: 0, total: 0 };
    document.total++; if (completed.has(chunkKey(chunk))) document.completed++;
    documents.set(chunk.documentId, document);
  }
  return { settings: snapshot.settings, documents: [...documents.values()], dimension: snapshot.index?.dimension,
    uncertain: snapshot.index?.uncertain.length ?? 0, running };
}
export class DocumentRetrieval {
  private jobs = new Map<string, AbortController>();
  private key(profileId: string, projectId: string) { return `${profileId}:${projectId}`; }
  cancelProject(profileId: string, projectId: string): void {
    this.jobs.get(this.key(profileId, projectId))?.abort(new Error("프로젝트 또는 문서가 변경되어 검색 작업을 취소했습니다."));
  }
  cancelAll(): void { for (const job of this.jobs.values()) job.abort(new Error("계정이 변경되어 문서 검색 작업을 중단했습니다.")); }
  async status(profileId: string, projectId: string): Promise<RetrievalStatus> {
    return status(await retrievalSnapshot(profileId, projectId), this.jobs.has(this.key(profileId, projectId)));
  }
  async configure(profileId: string, projectId: string, settings: RetrievalSettings, models: GatewayModel[]) {
    if (settings.mode === "semantic") assertModels(settings, models);
    this.cancelProject(profileId, projectId); await configureRetrieval(profileId, projectId, settings);
  }
  private async job<T>(profileId: string, projectId: string, signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const key = this.key(profileId, projectId);
    if (this.jobs.has(key)) throw new Error("이 프로젝트의 검색 작업이 진행 중입니다. 완료하거나 취소한 뒤 실행해 주세요.");
    const controller = new AbortController(); this.jobs.set(key, controller);
    try { return await operation(AbortSignal.any([signal, controller.signal])); }
    finally { if (this.jobs.get(key) === controller) this.jobs.delete(key); }
  }
  private async embed(key: string, modelId: string, texts: string[], signal: AbortSignal, query: boolean) {
    const raw = await researchRequest(key, "/embeddings/", { model: modelId, input: texts, encoding_format: "float",
      ...(modelId === "gemini-embedding-2" ? { task_type: query ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT" } : {}) }, signal, researchJson);
    return parseEmbeddingResponse(raw, modelId, texts.length);
  }
  async index(key: string, profileId: string, projectId: string, models: GatewayModel[],
    indexConsent: boolean, resumeConsent: boolean, signal: AbortSignal): Promise<RetrievalStatus> {
    if (indexConsent !== true) throw new Error("첨부 전송 동의와 별도로 색인 시작 동의가 필요합니다.");
    return this.job(profileId, projectId, signal, async (bounded) => {
      const snapshot = await retrievalSnapshot(profileId, projectId); bounded.throwIfAborted();
      assertModels(snapshot.settings, models);
      if (!snapshot.chunks.length || snapshot.chunks.length > MAX_SEMANTIC_CHUNKS) throw new Error(`앱 의미 색인은 텍스트 청크 1~${MAX_SEMANTIC_CHUNKS}개를 지원합니다. 문서를 나누거나 로컬 검색을 직접 선택해 주세요.`);
      const modelId = snapshot.settings.embeddingModelId!;
      if (snapshot.index && (snapshot.index.modelId !== modelId || snapshot.index.dimension !== TEXT_EMBEDDING_DIMENSIONS[modelId])) throw new Error("모델·차원 변경 후에는 새 색인이 필요합니다.");
      const index: SemanticIndex = snapshot.index ?? { version: 1, modelId, dimension: TEXT_EMBEDDING_DIMENSIONS[modelId], chunks: [], uncertain: [], updatedAt: new Date().toISOString() };
      if (index.uncertain.length && !resumeConsent) throw new Error("이전 중단 요청의 과금 여부가 미확정입니다. 재개하면 해당 청크가 중복 과금될 수 있으므로 재개 동의가 필요합니다.");
      const completed = new Set(index.chunks.map(chunkKey));
      for (const chunk of snapshot.chunks) {
        bounded.throwIfAborted(); const id = chunkKey(chunk); if (completed.has(id)) continue;
        if (!index.uncertain.includes(id)) index.uncertain.push(id);
        index.updatedAt = new Date().toISOString();
        // Persist uncertainty BEFORE transmitting; completion is persisted after one valid response.
        await saveSemanticIndex(profileId, projectId, index, bounded);
        const [vector] = await this.embed(key, modelId, [chunk.text], bounded, false);
        bounded.throwIfAborted();
        index.chunks.push({ documentId: chunk.documentId, sourceHash: chunk.sourceHash, position: chunk.position, start: chunk.start, end: chunk.end, vector });
        index.uncertain = index.uncertain.filter((key) => key !== id); index.updatedAt = new Date().toISOString();
        await saveSemanticIndex(profileId, projectId, index, bounded); completed.add(id);
      }
      return status(await retrievalSnapshot(profileId, projectId), false);
    });
  }
  async search(key: string, profileId: string, projectId: string, models: GatewayModel[], query: string,
    signal: AbortSignal, maxChars = 40_000): Promise<RetrievalResult> {
    return this.job(profileId, projectId, signal, async (bounded) => {
      const snapshot = await retrievalSnapshot(profileId, projectId); bounded.throwIfAborted();
      if (snapshot.settings.mode === "local") {
        const words = query.toLowerCase().match(/[가-힣]{2,}|[a-z0-9]{3,}/g) ?? [];
        const hits = snapshot.chunks.map((chunk) => ({ ...chunk, score: words.reduce((sum, word) => sum + chunk.text.toLowerCase().split(word).length - 1, 0) })).sort((a, b) => b.score - a.score);
        return retrievalResult(hits, "로컬 어휘 검색 · 원격 검색 호출 없음", maxChars);
      }
      assertModels(snapshot.settings, models);
      if (!snapshot.index?.chunks.length || snapshot.index.modelId !== snapshot.settings.embeddingModelId) throw new Error("완료된 의미 색인이 없습니다. 색인을 시작하거나 로컬 검색을 직접 선택해 주세요.");
      if (maxChars < 200) return { hits: [], text: "", notice: "첨부 전체 문맥이 예산을 사용해 프로젝트 의미 검색을 생략했습니다." };
      const queryText = query.slice(0, 2000);
      const [vector] = await this.embed(key, snapshot.index.modelId, [queryText], bounded, true);
      const candidates = hybridCandidates(snapshot.chunks, snapshot.index, vector, queryText);
      let hits = candidates.slice(0, RETRIEVAL_FINAL);
      if (snapshot.settings.rerankConsent && candidates.length) {
        const modelId = snapshot.settings.rerankModelId!;
        const raw = await researchRequest(key, "/rerank/", { model: modelId, query: queryText, documents: candidates.map((chunk) => chunk.text),
          top_n: Math.min(RETRIEVAL_FINAL, candidates.length), return_documents: false }, bounded, researchJson);
        hits = parseRerankResponse(raw, modelId, candidates.length).map((position) => candidates[position]);
      }
      bounded.throwIfAborted();
      const current = await retrievalSnapshot(profileId, projectId); bounded.throwIfAborted();
      if (JSON.stringify(current.settings) !== JSON.stringify(snapshot.settings) ||
        current.chunks.map(chunkKey).join() !== snapshot.chunks.map(chunkKey).join()) throw new Error("프로젝트가 변경되어 오래된 검색 결과를 폐기했습니다.");
      const pending = snapshot.chunks.length - snapshot.index.chunks.length;
      return retrievalResult(hits, `의미+어휘 검색 · ${snapshot.index.modelId} · 질의 최대 2,000자${snapshot.settings.rerankConsent ? ` · 재정렬 ${snapshot.settings.rerankModelId} (후보 전체 과금)` : ""}${pending ? ` · 색인 대기 ${pending}청크 (완료 벡터와 로컬 어휘 후보 사용)` : ""}`, maxChars);
    });
  }
}
export { LOCAL_RETRIEVAL };
