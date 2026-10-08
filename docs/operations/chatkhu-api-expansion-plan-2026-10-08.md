# ChatKHU API 확장 실행 계획 — 2026-10-08

## 상태·범위·소유권

- 계획 기준: `418cb41e5651cc6bfb2ac17737d6c651732913fa`, 1단계 구현 기준: `609c05e9aa4d7aeb154f480521bd5edac4a76f14`, 앱 `v0.5.1`, Orca worktree `chatkhu-api-expansion-20261008`.
- 사용자가 승인한 순서: **① 네이티브 웹 검색·모델 분류 → ② 논문·법령 검색·문서 검색 → ③ 제공사 코드 실행·공식 미디어 견적 → ④ 실시간 음성**. 1단계 구현·세 지적 보정·로컬 mock gate와 별도 Sol 독립 재검토(PASS)를 완료했고 실행 책임자가 코드를 수락했다. 실계정 확인·main 통합·push·배포는 미실시이며 2~4단계는 미착수다.
- 설계 자문은 Astra, 단계별 구현·보정은 Sol 1명, 독립 검토는 별도 Sol 1명, 계획 보정·통합·사용자 보고는 실행 책임자가 소유한다. [Orca 실행 규칙](orca-execution-policy.md)에 따라 실제 Task/Dispatch를 사용하며 이전 단계 수락 후 다음 단계를 배정한다.
- 계획 Task의 수정 범위는 이 문서였으며, 수락된 후속 Task에서는 Sol 1명이 1단계 제품 소스·관련 테스트·진행 기록을 소유했다. 기존 구현 worker의 settle/release 뒤 단일 보정 Sol `ctx_e50790142144`가 같은 범위를 직렬 인계받았고 통합은 실행 책임자가 소유한다. 의존성·버전 변경, 유료 호출, push·릴리즈는 포함하지 않는다.
- Guard, Decisions 실행, usage/revoke 신규 화면, Super Agent, 제공사 fileSearchStores 연동은 범위 밖이다. `decisions` 모델 분류만 보존한다. [모델 문서](https://docs.mindlogic.ai/docs/khu/api-gateway/getting-started/models/)는 Super Agent를 API 미지원으로 명시한다.

## 코드에서 확인한 출발점

| 현재 위치 | 확인한 동작 / 변경 이유 |
| --- | --- |
| `src/shared/model-catalog.ts`, `contracts.ts` | parser는 `llm/audio/image/video`만 수용한다. 보조 모델을 버리지 않되 대화 선택지는 LLM으로 제한해야 한다. |
| `src/shared/web-search.ts`, `src/main/gateway.ts` | Gemini 접두어를 native로 간주하지만 `webGroundedMessages`는 검색 지침만 추가한다. 실제 검색 수행 증거가 없다. |
| `src/shared/advanced-chat.ts`, `provider-adapters.ts` | Claude Messages·OpenAI Responses 경로와 수동 함수 도구는 있다. Gemini는 chat 경로이며 제공사 서버 검색·코드 도구와 정규화된 인용 이벤트가 없다. |
| `src/main/gateway.ts` | Sonar bridge, deep research, `prepareSharedWebEvidence`/`appendSharedWebEvidence`가 있다. 비교 시 동일한 근거를 한 번 마련하는 의미를 유지한다. |
| `src/main/thread-context.ts`, `project-vault.ts` | 짧은 첨부는 전체 문맥, 초과분·프로젝트 문서는 어휘 점수로 검색한다. 프로젝트 원본·청크는 암호화 저장하며 임베딩·rerank는 없다. |
| `src/shared/media-capabilities.ts`, `src/renderer/src/MediaPanel.tsx` | 이미지·영상·음악 예상 비용이 정적 단가 함수에 의존한다. 생성 옵션 검증과 가격 출처를 분리해야 한다. |
| `src/main/gateway-transport.ts`, `src/shared/gateway-retry.ts` | GET/HEAD만 제한적으로 재시도한다. 과금 POST 재전송 금지는 새 경로에도 유지한다. MCP·실시간 소켓은 신규 구현이다. |

## 공통 계약과 진행 방식

1. 각 단계 시작 Task에 파일 소유자·기준 SHA·테스트·보정 담당을 기록한다. 기본 구현자 1명이 아래 단계 파일과 테스트를 직렬 편집한다. `contracts.ts`, preload/IPC, 저장 포맷, 공통 CSS, package/lockfile은 동시에 수정하지 않는다. 파일을 분리할 실익이 확인되기 전에는 구현자를 늘리지 않는다.
2. 기능 판정은 **지원 / 미지원 / 미확인**으로 나누고 근거·조회 시각을 보관한다. 실제 계정의 모델 목록·상세, 문서에 확인된 endpoint/도구 계약, 구현된 adapter가 모두 맞아야 제공사 기능을 제공한다. ID 접두어나 `owned_by`만으로 지원을 선언하지 않는다. 권한 실패는 해당 계정 범위에 한정하며 전역 미지원으로 저장하지 않는다.
3. 신규 API 조회·색인·검색·견적·세션 시작은 명시적 새로고침/확인/전송 동작에 연결한다. 렌더링·타이핑·모델 선택만으로 요청하지 않는다. 기존 로그인 조회는 유지하되 상세 조회의 무제한 fan-out을 추가하지 않는다. 계정별 캐시를 쓰고 키 교체·로그아웃 때 취소·폐기한다.
4. main이 API 키·인증·요청 URL·profile epoch·취소·요청 예산을 소유한다. renderer는 제한된 typed IPC만 사용하며 임의 URL/헤더/도구명을 전달해 실행할 수 없다. context isolation, sandbox, CSP, navigation 차단, bounded JSON/SSE, scheduler를 유지한다.
5. 인용/도구 이벤트는 타입·크기·URL을 검증해 UI/암호화 기록/내보내기에 전달한다. 외부 문서·도구 결과를 지시로 실행하지 않는다. HTML을 직접 주입하지 않는다. 공개 HTTP(S) 출처를 보존하되 외부 열기는 기존 main 정책인 HTTPS·주소 2,000자 이하로 제한하고 열 수 없는 출처는 이유를 표시한다. 토큰·원문·음성·개인정보는 진단 로그에 남기지 않는다.
6. 실패 후 모델·endpoint를 자동 교체하거나 생성 요청을 재전송하지 않는다. 취소·시간초과는 서버 실행/과금 취소 보장이 아님을 표현한다. 재시도는 사용자의 새 동작이며 이전 결과 불확실성을 안내한다.

## 1단계 — 실제 네이티브 웹 검색과 모델 분류

**결과:** 선택한 모델이 지원하는 검색 도구를 실제 요청에 연결하고, 검색 여부와 출처가 확인 가능한 답변을 만든다.

1. `ModelKind`/catalog를 `llm, embedding, rerank, decisions, realtime, audio, image, video` 8종으로 확장한다. 모델 상세 pricing의 필요한 필드만 검증해 보존한다. 알 수 없는 미래 type은 대화 모델로 승격하지 않는다. 채팅·비교는 `llm`, 미디어는 기존 종류, 보조 모델은 해당 기능 전용 selector로 분리한다. 삭제된 저장 모델도 사용자 확인 없이 새 모델로 전송하지 않도록 `resolveLiveThreadModel` 사용처를 점검한다.
2. 검색 capability 조회와 실행 계획을 첫 생성 POST 전에 확정한다. `pricing.web_search_per_1k === null`은 미지원, 필드 누락/오류는 미확인이다. 숫자값도 adapter·계정 접근 조건과 함께 판단하며 0을 미지원으로 오인하지 않는다. [서버 도구 문서](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/server-tools/)를 따른다.
3. Claude는 `/claude/v1/messages/`의 서버 검색 도구와 결과 블록·text citations, OpenAI는 `/responses/`의 검색 도구와 `web_search_call`·annotations를 연결한다. 요청 도구 버전/필드와 스트림 이벤트는 구현 착수 시 해당 문서 예제로 fixture를 고정한다. 수동 `tool_call`과 서버가 이미 실행한 결과를 구분해 이중 실행하지 않는다.
4. Gemini 전용 adapter를 추가해 `/gemini/v1beta/models/{model}:streamGenerateContent?alt=sse`와 `tools: [{google_search: {}}]`를 사용한다. `contents/systemInstruction`, 텍스트·이미지·첨부 문맥, generation 설정, usage, 종료/오류를 변환하고 `groundingMetadata`의 질의·출처와 제공되는 근거 연결을 정규화한다. 검색 문구만 삽입하는 기존 분기는 제거한다. [Gemini 네이티브 문서](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/gemini-native/)
5. 기존 검색 모드(끄기/자동/항상/딥리서치)를 유지한다. 자동 판단은 전송 시점에만 한다. 검색 준비 UI는 `모델 자체 검색`과 `Sonar 공통 검색 후 선택 모델 답변` 경로 및 추가 요청을 보여 준다. 미지원/미확인은 사용자가 선택한 Sonar bridge로 처리할 수 있으나 네이티브 실패 뒤 자동 우회하지 않는다. Sonar 권한이 없으면 검색 불가를 표시하고 몰래 무검색 답변으로 바꾸지 않는다.
6. 비교와 딥리서치는 기존 Sonar 공통 evidence를 유지한다. 비교당 검색 묶음은 한 번 준비해 모든 답변에 주고 개별 네이티브 검색은 끈다. 전 모델 bridge 사용 선택도 보존한다. 캐시 재사용·검색 미실행·검색 결과 없음은 실제 검색 성공과 구별한다. 네이티브 adapter 전환으로 지원하지 못하는 고급 설정 조합은 전송 전에 이유를 표시하고 막는다.

**파일 소유권:** 구현자 1명이 `src/shared/{contracts,model-catalog,web-search,advanced-chat,provider-adapters}.ts`, `src/main/{gateway,index,storage}.ts`, `src/preload/index.ts`, `src/renderer/src/{ModelPicker,ChatPanel,App}.tsx` 및 관련 테스트를 소유한다. 신규 `src/shared/gemini-adapter.ts` 등은 이 소유권 안에서 분리한다. 저장 필드 추가는 이전 기록·내보내기·백업 호환도 같은 Task에 포함한다.

**완료 gate:** 8종 혼합 catalog·권한 없음·상세 누락/null/0, 실제 3사 요청 body/URL/header, 분할 SSE·최종 인용·중복 인용·도구 오류·취소·usage fixture를 통과한다. `tests/catalog.test.mjs`, `web-search.test.mjs`, `phase4-gateway.test.mjs`, `gateway-transport.test.mjs`, `compare-export.test.mjs`를 보강하고 실제 ChatPanel/ModelPicker DOM에서 검색 설정·출처·비지원 상태를 검증한다. 비교는 검색 묶음 1회 및 동일 evidence, 오류 시 두 번째 유료 POST 0회를 단언한다. 기존 텍스트·이미지·PDF·수동 도구·Responses continuation 회귀가 없어야 한다.

**2026-10-08 구현 인계:** 구현 commit `b10d7dfce738c3773025bc1019ee4ebb4767c9b2` 기준으로 별도 Sol 읽기 전용 독립 검토를 시작했으며 [구현·검증 기록](chatkhu-phase1-implementation-2026-10-08.md)을 함께 인계한다. 단일 구현자는 위 파일 외에 계정별 상세 캐시·검색 capability/근거 정규화 신규 모듈, 비교 UI/암호화 기록(`AppDialogs.tsx`, `workspace-runs.ts`), 대화·비교 내보내기와 백업/실제 DOM 테스트까지 필요한 호환 변경을 소유했다. Node 223개·DOM 45개, typecheck·UI audit·Linux build가 통과했다. 실계정 호출·CI·OS 수동 검증은 미실시다.

**2026-10-08 검토 보정 인계:** 독립 검토 `ctx_eb789a92c9a7`의 `CHANGES_REQUIRED` 세 지적을 기준 HEAD `dec5d371f0d3f4d8fc0f8fa6b745e01ee08e5870`에서 보정했다. 비교의 전체 첨부 문맥·선택 모델 요청 및 일반 대화 원래 payload를 유료 Sonar 검색 전에 검증하고, 비-Claude 원문 PDF 조합을 차단한다. 짧은 추출 문서의 전체 본문·공통 근거와 기존 한도는 보존한다. Gemini의 미검증 횟수는 생략하고 Claude `pause_turn`은 부분 답변·검색 근거와 안전한 미지원 중단 사유를 저장·복원·내보내며 UI/main의 일반 이어 생성을 차단한다. 새 질문은 추가 과금 가능한 별도 요청이다. [보정 결과·명령·제약](chatkhu-phase1-implementation-2026-10-08.md#독립-검토-지적-보정-결과)에 기록한 집중 Node 59개·새 DOM 3개와 최종 Node 233개·DOM 48개, typecheck·UI audit·Linux build가 통과했다. 보정 완료·별도 Sol 독립 재검토 대기이며 실행 책임자가 수락한다. 실계정·OS·CI는 미검증이고 2단계는 미착수다.

**1단계 수락 전 확인할 결정:** Sonar 답변 모델은 검색 끄기·공통 근거 비교·딥리서치에서 전송 전에 막는다. Gateway에 검색 비활성화 계약이 없어 선택 모델을 자동 교체하거나 문서에 없는 필드를 전송하지 않는다. 일반 대화의 자동/항상 모드와 Sonar bridge는 유지하며 자동 모드의 일반 질문에서도 Sonar 자체 검색이 실행될 수 있음을 표시한다. Claude 자체 검색+수동 도구, Responses 자체 검색+sampling, Gemini 자체 검색+수동 도구/JSON Schema/타 제공사 설정처럼 구현 경로가 보존하지 못하는 조합은 첫 유료 호출 전에 이유를 표시하고 막는다.

## 2단계 — 논문·법령 검색과 동의 기반 문서 검색

**의존성:** 1단계 capability·출처·취소 계약을 재사용한다. MCP 검색을 먼저 연결하고, 로컬 검색 계약을 유지한 상태에서 원격 색인·rerank를 추가한다.

1. 명시적 `검색 도구 확인`으로 `/mcp/`의 계정별 suite 목록을 가져오고 필요한 suite만 `initialize`/`tools/list`로 발견한다. 논문·법령 suite 이름과 인자는 문서 추측으로 하드코딩하지 않는다. 검토한 읽기 전용 도구만 discovery 결과에 매핑하고, 알 수 없는 도구는 실행하지 않는다. 초기 UX는 목적·도구·검색어를 선택해 실행하고 결과를 답변 근거에 추가하는 방식이며 무제한 자율 도구 loop를 만들지 않는다.
2. main에 stateless streamable-HTTP JSON-RPC adapter를 둔다. `Accept: application/json, text/event-stream`, SSE message envelope, request id, JSON-RPC error와 tool `isError`, 크기·시간 제한을 검증한다. suite URL은 고정 Gateway origin 아래에서 조립한다. 현재 문서 한도는 키 30회/분·200회/일, 조직 1,000회/일, suite 기본 60회/분·300회/일이며 suite별 차이가 있다. 현재 0크레딧이어도 2xx 도구 실행은 오류 결과까지 호출량으로 센다. 429/503의 Retry-After를 표시하고 자동 `tools/call` 재전송은 하지 않는다. [MCP 문서](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/mcp/)
3. 결과에는 원문 URL, 제목, 제공된 발행/개정 시점과 검색 시점을 보존한다. 논문 검색 결과/초록을 원문 전체로 표현하지 않는다. 법령은 시행일·조문·버전이 제공될 때 표시하고 현행 여부 미확인은 명시한다. 원문 가져오기 도구가 실제 공개된 경우에만 사용하며 임의 URL fetch, 유료 원문 우회, 전용 fileSearchStores는 추가하지 않는다.
4. 짧은 첨부의 v0.5.1 전체 문맥 경로는 그대로 둔다. 긴 첨부와 프로젝트 문서만 `로컬 검색` 또는 사용자가 켠 `의미 검색`을 사용한다. 프로젝트 설정에 전송될 텍스트/질의, 제공 모델, 원격 처리·비용·로컬 보관 범위를 설명하고 **색인 시작 동의**를 받는다. 기존 첨부 전송 동의를 원격 색인 동의로 간주하지 않는다. 새 문서/변경분도 색인 대기 목록에서 사용자가 시작한다.
5. `/embeddings/`는 텍스트 청크와 질의를 처리한다. 원본과 파생 index는 profile/project별 로컬 암호화를 유지하고 문서 hash·청크 위치·모델 ID·차원·색인 버전을 저장한다. 모델/차원 변경은 기존 벡터와 혼합하지 않고 재색인을 요구한다. 로컬 어휘+벡터 후보를 합쳐 제한된 후보만 `/rerank/`로 전송하고 반환 index를 원본 청크에 대응한다. rerank는 별도 opt-in이며 기본 후보 20개·최종 5개 같은 앱 상한을 fixture로 고정하되 전체 문맥 예산을 우선한다. [Embeddings](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/embeddings/), [Rerank](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/rerank/)
6. 색인 취소는 완료 청크만 원자적으로 남기고 실패 POST를 자동 반복하지 않는다. 재개 시 미확정 청크의 중복 과금 가능성을 알린다. 문서 삭제/교체·프로젝트 삭제·키 교체·로그아웃에서 index와 진행 작업을 정리하고 원본 복원 가능성을 유지한다. 백업은 index 버전 검증 후 복원하거나 파생 index만 재구축 대상으로 표시한다. 미동의·미지원·실패 시 로컬 검색을 명시적으로 선택할 수 있으며 다른 유료 모델로 대체하지 않는다.

**파일 소유권:** 구현자 1명이 신규 `src/main/{mcp-client,document-retrieval}.ts`, `project-vault.ts`, `thread-context.ts`, `attachments.ts`, 관련 shared 계약·검증·backup 정책, `index.ts`/preload, `App.tsx`/`AppDialogs.tsx`/`ChatPanel.tsx`와 테스트를 소유한다. 원본 저장 암호화 방식의 불필요한 교체는 하지 않는다.

**완료 gate:** MCP discovery·schema·JSON-RPC/SSE 오류·권한 변경·호출 한도 fixture, 동의 전 네트워크 0회 DOM/IPC 테스트, 임베딩 index 순서/차원·NaN·부분 실패·rerank index 범위 테스트를 추가한다. `thread-context`, `document-text`, `backup-storage`, `backup-crypto`, `storage-limits` 회귀와 실제 프로젝트 설정/검색 결과 DOM을 검증한다. 합성 문서에 위치가 알려진 정답을 두고 짧은 문서 후반 누락 없음, 긴 문서 근거 위치 회수, 삭제·복원·profile 간 누출 없음 및 원격 호출 수 상한을 확인한다. mock 점수만으로 실서비스 검색 품질 향상을 주장하지 않는다.

## 3단계 — 제공사 코드 실행과 공식 미디어 견적

**의존성:** 1단계 provider 이벤트·capability·중복 과금 방지를 재사용하고 2단계 수락 후 진행한다. 코드 실행과 견적을 한 구현자가 순차로 완성한다.

1. 지원이 확인된 Claude Messages 서버 코드 도구와 OpenAI Responses `code_interpreter`를 고급 설정의 기본 꺼짐 기능으로 추가한다. 도구 버전, container 옵션, Claude `anthropic-beta`는 구현 시 공식 예제로 확정하며 beta를 JSON 본문에 넣지 않는다. 문서상 Claude 최소 5분·OpenAI 최소 15분 과금과 추가 토큰 비용을 실행 전에 알린다. Gemini 코드 실행은 이번 범위에서 추정 추가하지 않는다. [서버 도구 문서](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/server-tools/)
2. UI에는 서버 실행 상태·코드·표준 출력/오류·결과 요약을 구분한다. 결과는 신뢰하지 않는 데이터이며 로컬 eval/shell로 실행하지 않는다. 기존 수동 함수 도구와 구분하고 무한 continuation을 금지한다. 코드용 첨부도 외부 전송 동의를 확인한다. 산출물 다운로드 경로가 Gateway에 문서화·검증되지 않았다면 메타데이터만 표시하고 다운로드 가능으로 약속하지 않는다.
3. `비용 확인` 버튼으로 `/estimate/`를 요청한다. image/video/music에만 적용하고 TTS/STT·LLM·검색·코드 비용에는 사용하지 않는다. 실제 생성과 같은 정규화 옵션에 `kind`를 더하되 prompt·개인 문서/이미지 bytes는 불필요하게 보내지 않는다. 참조 이미지가 견적 필수인 편집 모델은 동의·Gateway 지원 계약이 확인되지 않으면 견적 불가로 표시한다. [견적 문서](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/estimate/)
4. 견적은 모델/옵션 fingerprint·계정·시각에 묶고 옵션 변경 시 무효화한다. `exact/minimum/maximum/approximate`를 `확정/최소/최대/대략`으로 구분하고 lines·note를 표시한다. 견적 성공은 생성 입력 유효성이나 성공 보장이 아니다. 견적 실패는 0크레딧으로 표시하지 않으며 `견적 없이 생성`은 별도 사용자 동작으로 허용한다. 견적과 생성은 각각 한 번의 명시적 동작이고 생성 중 중복 클릭을 차단한다.
5. 정적 이미지·영상·음악 비용 문구는 공식 견적으로 대체하되 기존 모델 옵션 제약은 유지한다. 생성 응답의 실제 credits와 견적을 구분하고 content_filter 별도 비용을 실제 생성 비용에 임의 합산하지 않는다. 기존 잔액 갱신을 재사용하며 usage 화면 신설로 범위를 넓히지 않는다.

**파일 소유권:** 구현자 1명이 `advanced-chat.ts`, `provider-adapters.ts`, `contracts.ts`, `request-validation.ts`, `src/main/{gateway,index,media-jobs}.ts`, 신규 estimate adapter, preload, `ChatPanel.tsx`, `MediaPanel.tsx`, `media-capabilities.ts`, `media-response-metadata.ts`와 관련 테스트를 소유한다.

**완료 gate:** 2사 코드 도구의 실제 payload/header·진행/성공/실패/중단/수동 도구 혼합 fixture 및 UI 실행 상태 검증, 최소 비용 안내·꺼짐 기본값을 확인한다. 견적 4종 bound·비가격 모델·권한 오류·stale response·옵션 변경·취소·계정 교체·타이핑 시 0회·생성 버튼 연타 1회 요청을 실제 MediaPanel과 transport에서 검증한다. `phase3-media`, `phase4-gateway`, `media-jobs`, `media-security`, `gateway-transport` 회귀를 유지한다.

## 4단계 — 실시간 음성 대화와 받아쓰기

**의존성:** 앞 단계의 계정별 capability·동의·취소 계약이 안정된 뒤 별도 음성 세션 상태 머신을 추가한다. OpenAI 대화 → Gemini Live → Soniox 받아쓰기 순으로 내부 작업을 나눈다.

1. 대화 모델은 `realtime` catalog에서 선택하고 Soniox 받아쓰기는 별도 용도로 표시한다. 채팅 LLM picker와 혼합하지 않는다. 상시 청취 대신 `시작/음소거/종료`와 연결·녹음·재생 상태, 경과 시간을 명확히 보여 준다. OS 마이크 권한을 사용자가 시작할 때 요청하고 거부·장치 없음·장치 변경을 처리한다.
2. renderer는 마이크 capture/playback만 담당하고 main이 세션 발급과 소켓·프로토콜 adapter를 소유하는 방식을 기본으로 한다. `/realtime/sessions/`의 60초·1회용·모델 결합 토큰은 메모리에서만 사용하고 URL/token/키를 로그·저장·renderer에 노출하지 않는다. 반환 주소는 고정 허용 WSS origin/path로 검증한다. 토큰 경로가 특정 제공사에서 미확인이라면 해당 기능을 미확인으로 남기며 실제 키를 renderer에 넘기지 않는다. [Realtime 문서](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/realtime/)
3. OpenAI `session.update`, Gemini 10초 내 `setup`, Soniox JSON 설정→바이너리 오디오→빈 **텍스트** 종료 프레임을 각각 adapter로 구현한다. 오디오 codec/sample rate·turn detection·재생 취소는 제공사 공식 protocol과 Gateway 예제로 구현 전 확정한다. IPC는 세션 ID·profile epoch·오디오 형식·프레임 크기/빈도/큐 길이를 제한하고 backpressure를 둔다.
4. 상태는 idle→권한/연결 준비→active→stopping→closed/error로 고정한다. 명시적 종료·화면 해제·로그아웃·키 교체·프로필 전환·창 종료·연결 오류에서 track, AudioContext, 소켓, timer, listener를 정리하고 늦은 이벤트를 폐기한다. 연결 끊김 후 자동 재연결/오디오 재전송은 하지 않는다. 재시작은 새 토큰과 사용자 동작이다.
5. 원본 음성은 기본 저장하지 않는다. 받아쓰기 확정문은 초안에 넣고 사용자가 전송하며, 대화 기록 보관은 명시적 설정과 기존 암호화 저장을 따른다. 외부 음성 전송·과금·임시 예약 및 Soniox 필터 차이를 안내한다. 연결 종료를 비용 0으로 표현하지 않는다.

**파일 소유권:** 구현자 1명이 신규 `src/main/realtime-session.ts`, shared protocol/validation, renderer 음성 panel/capture 모듈, `index.ts`, `session-flow.ts`, `session-transition.ts`, preload/contracts, `ChatPanel.tsx`, 저장 정책과 테스트를 소유한다. 필요한 의존성은 먼저 근거를 기록하고 한 소유자가 package/lockfile을 편집한다. 이 계획 단계에서는 추가하지 않는다.

**완료 gate:** mock WebSocket/가상 마이크·timer로 3사 handshake·오디오·종료, 만료/재사용 토큰, 1000/1008/1011/1013/4402 종료, Gemini setup timeout, Soniox 종료 프레임, bounded queue를 검증한다. 실제 음성 컴포넌트와 main IPC lifecycle을 연결해 로그아웃/취소 직후 마이크 track 종료·세션 0개·이전 프로필 이벤트 무시를 단언한다. OS별 실제 마이크 권한·입출력·장치 변경은 별도 수동 검증이며 Linux mock으로 macOS/Windows 성공을 주장하지 않는다.

## 문서 불일치와 착수 시 확인할 항목

2026-10-08에 아래 공식 문서를 공개 조회했다. 문서가 말하는 지원과 이 계정에서 검증한 지원은 다르며 이번 작업은 계정 키·유료 요청을 사용하지 않았다.

| 불확실성 | 보수적 처리 / 해소 담당 |
| --- | --- |
| [models](https://docs.mindlogic.ai/docs/khu/api-gateway/getting-started/models/)의 종류 표는 8종, 응답 필드 설명은 4종이며 상세 조회 설명도 보조 종류에 불완전하다. | 8종을 보존하되 상세 필드 누락은 unknown. 구현자는 공개 문서 fixture를 만들고 실계정 상세 형태는 별도 확인한다. |
| 일반 권장 endpoint는 OpenAI/Gemini chat을 안내하지만 [개요](https://docs.mindlogic.ai/docs/khu/api-gateway/getting-started/overview/)와 기능별 문서는 네이티브 경로를 제공한다. | 일반 채팅 권장표를 검색 지원 근거로 사용하지 않고 기능별 endpoint를 선택한다. 서버 도구 명칭·beta·스트림 세부는 구현자가 원문 코드 예제를 재확인한다. |
| 모델 이름·목록 날짜·지원 표는 바뀔 수 있고 검색 pricing은 코드 실행 지원 신호가 아니다. | live catalog와 명시적인 기능 계약을 교차 확인한다. 미확인 code capability를 검색 지원에서 유추하지 않는다. 유료 실패 호출로 탐색하지 않는다. |
| MCP suite/tool 명세, 실제 논문 원문·법령 버전 제공 범위는 계정마다 다르다. | discovery 전에는 특정 suite나 원문 다운로드 성공을 약속하지 않는다. 읽기 전용 tool schema와 결과 fixture를 구현자가 검토한다. |
| [estimate](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/estimate/)는 prompt 불필요라고 설명하지만 일부 이미지 편집은 input_images를 요구한다. | 견적을 위해 새 파일 업로드를 자동 수행하지 않는다. 지원이 확인된 옵션만 전송하고 나머지는 견적 불가로 표시한다. |
| [realtime](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/realtime/)는 토큰을 공통 설명하지만 Soniox 권한은 realtime 목록과 다르게 설명한다. | Soniox가 realtime 목록에 없다는 이유만으로 영구 미지원 처리하지 않는다. 파일 STT 권한과 session 발급 계약을 확인하며 토큰·codec 세부 미확인은 활성화 전 해소한다. |

## 공통 완료·인계·검증 경계

- 각 단계는 실제 component DOM와 main/transport fixture 회귀를 포함한다. 소스 문자열 검색이나 pure helper 테스트만으로 완료하지 않는다. 기존 `npm test`의 `ui:check`는 지정된 두 DOM 파일만 실행하므로 새 DOM 테스트는 기존 파일에 넣거나 실행 대상 편입을 담당자가 명시한다.
- 제품 통합 gate는 `npm run typecheck`, `npm test`, `npm run ui:audit`, `npm run build`다. 키보드·포커스 복귀·좁은 세로 창·두 테마·로딩/빈 결과/오류·동의 흐름도 검증하고 최초 창 비율·마지막 크기 복원을 유지한다. 동일 SHA/환경에서 성공한 검사를 이유 없이 반복하지 않는다.
- 별도 Sol이 변경 diff, endpoint/IPC/암호화/백업/개인정보/과금, 실제 테스트 근거를 독립 검토한다. 구현자가 보정하고 실행 책임자가 commit과 잔여 위험을 확인해 수락한다. 보안·중복 과금·데이터 손실 결함은 다음 단계 전에 해소한다.
- **mock 완료와 실계정 확인을 따로 기록한다.** 실계정 검증은 사용자가 허용한 계정·호출 범위·비용 상한에서 합성 질의/문서/음성만 사용한다. 1단계는 각 제공사 실제 검색·인용, 2단계는 실제 suite·임베딩/rerank 응답, 3단계는 실제 코드 실행·견적/생성 비용 구분, 4단계는 실제 연결·마이크 종료를 최소 호출로 확인한다. 미허용/권한 없음은 이유를 남기고 해당 기능을 `실계정 미검증`으로 유지한다.
- 실계정 미검증 상태에서도 구현·mock gate 통과분은 구분해 인계할 수 있으나 전 기능 실사용 완료로 보고하지 않는다. 로컬 테스트·CI·OS 수동 결과를 별도로 표시하며 이 계획은 push·배포·서명/공증을 요구하지 않는다.
- 계획 Task의 문서 검증은 로컬 경로/공식 링크 조회와 diff 점검으로 한정했다. 1단계 제품 검증은 [구현 기록](chatkhu-phase1-implementation-2026-10-08.md)에 구분한다. 완료 worker는 commit/path·핵심 결정·검증 범위·다음 소유권을 보고하며 실행 책임자가 ACK 후 재사용 또는 release한다.

| 단계 | 구현 / 독립 검토 / 실계정 | 다음 소유자 |
| --- | --- | --- |
| 계획 | 문서 작성·공개 문서/소스 대조 완료, 제품 검사 미실행 | 실행 책임자: 계획 수락·필요 보정, 1단계 배정 |
| 1단계 | 구현·보정·로컬 gate 완료 / 독립 재검토 PASS·코드 수락 / 미실시 | 실행 책임자: 작업 브랜치 보존, 2단계 순차 배정 |
| 2단계 | 미착수 / 미실시 / 미실시 | 다음 단계: 논문·법령 검색과 문서 검색 강화 |
| 3단계 | 미착수 / 미실시 / 미실시 | 2단계 수락 후 배정 |
| 4단계 | 미착수 / 미실시 / 미실시 | 3단계 수락 후 배정 |

**1단계 최종 수락:** 보정 commit `7ab363caeea25ed6a0273afa46105720388b4ca3`을 별도 Sol이 독립 재검토해 PASS로 판정했다. 실행 책임자는 세 지적 해소, 최종 Node 233개·DOM 48개 및 typecheck·UI audit·Linux build 통과 근거를 확인해 작업 브랜치의 코드를 수락했다. 상세 내용과 실계정·OS·CI 미검증 범위는 [구현 기록](chatkhu-phase1-implementation-2026-10-08.md)에 남긴다.
