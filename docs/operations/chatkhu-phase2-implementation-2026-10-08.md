# ChatKHU Phase 2 구현 기록 — 2026-10-08

기준 `a3c0c81e4f45296080c1bb0e8dfb10489e7c7765`, branch `airkjw/chatkhu-api-expansion-20261008`의 단일 구현 worker `task_6e612314081d` / `ctx_773a6113ea39`가 Phase 2 계약·main·vault·preload·renderer·테스트를 직렬 소유한다. MCP discovery/search를 먼저 구현하고 명시적 opt-in 의미 문서 검색을 이어서 통합한다. 보정 담당은 구현자, 수락·통합과 별도 독립 검토 배정은 coordinator다. Phase 3/4·실계정 호출·push·통합·배포·버전 변경은 범위 밖이다.

완료 조건은 실제 IPC/DOM 동의·취소·preflight 경계, bounded JSON/SSE·스키마·벡터 검증, 암호화 저장/백업 회귀와 네 가지 제품 gate다. 본인 검증을 독립 검토 수락으로 기록하지 않는다.

## 공식 계약 확인

2026-10-08 공식 페이지 본문과 페이지에 포함된 공식 코드 예제를 함께 확인했다.

- [Gateway MCP](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/mcp/) (문서 수정 2026-09-29): `GET /v1/gateway/mcp/`의 `object:list`, `data[]`의 `slug/display_name/description/url/transport`를 사용한다. `url`은 고정 Gateway의 상대 suite 경로와 일치해야 하며 응답 URL을 fetch하지 않는다. 선택한 suite에만 POST initialize/tools/list, stateless(세션 ID 없음), Accept JSON+SSE, 단일 `event: message` envelope와 동일 JSON-RPC id를 검증한다. POST 자동 재시도 없음, 429/503 Retry-After 표시. 키·조직·suite 한도와 2xx 오류 호출 집계를 UI에 표시한다.
- [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), [transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle): 지원 프로토콜 `2025-06-18`과 도구 inputSchema/annotations 계약. 프로토콜 불일치·페이지 cursor는 실행 제한으로 표시한다. Gateway stateless 변형에는 GET/DELETE 스트림, 세션·자동 도구 loop·재연결을 추가하지 않는다.
- [Embeddings](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/embeddings/) (수정 2026-09-18): POST `/embeddings/`, 텍스트 `input[]`, model, float encoding, 응답 `data[].index/embedding`, model, usage. 인덱스로 배열 순서를 복원한다. 텍스트 청크·질의만 사용하며 임의 dimensions/이미지 OCR 지원을 가정하지 않는다.
- [Rerank](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/rerank/) (수정 2026-09-18): POST `/rerank/`, model/query/documents/top_n/return_documents, 결과 `results[].index/relevance_score` 내림차순. 요청 질의+모든 후보가 과금 대상이다. 앱은 후보 20/최종 5 상한을 사용한다.

### 실제 도구 매핑과 검토 범위

실계정 MCP discovery/tools/list는 실행하지 않았다. 공식 문서는 calendar 예제만 제공하며 논문·법령 suite ID나 인자 스키마를 제공하지 않는다. 따라서 특정 계정 도구가 검토·지원된 것으로 주장하지 않으며 suite/name/인자명을 하드코딩하지 않는다.

구현이 검토한 **스키마 패턴**은 발견한 이름에 search가 구분된 단어로 있고, `annotations.readOnlyHint:true`와 `destructiveHint:false`, `inputSchema.type:object`, `additionalProperties:false`, 필수 자유 텍스트 필드 하나, 선택 enum/boolean/0~100 내 bounded 숫자 필드만 있는 경우다. 인자명은 발견 스키마에서 그대로 만든다. 복합 스키마·추가 키·제한 없는 선택 문자열·불명확 권한·미검토 도구는 스키마 확인만 가능하다. renderer는 main이 발급한 도구 token과 검증된 인자만 전달한다. 결과의 명시적 `title/url/abstract/snippet/text` 및 제공된 날짜·버전·조문 필드만 정규화하고 원래 bounded 텍스트도 확인 가능하다. 그 밖의 응답은 원문 텍스트로 표시하며 임의 full-text fetch는 하지 않는다.

## 진행·검증

MCP discovery, schema inspection/search UI, pinned single-attempt transport, JSON/SSE/error/취소 및 stale-response 검증을 구현했다. `node --test tests/mcp-client.test.mjs`: 4/4 통과, 중간 typecheck 통과. 다음 작업은 프로젝트 의미 색인·검색·저장·복원·실제 경계 fixture이며 최종 gate와 독립 검토는 아직 미실시다.
