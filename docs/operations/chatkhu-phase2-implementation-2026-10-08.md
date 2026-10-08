# ChatKHU Phase 2 구현 기록 — 2026-10-08

기준 `a3c0c81e4f45296080c1bb0e8dfb10489e7c7765`, branch `airkjw/chatkhu-api-expansion-20261008`의 단일 구현 worker `task_6e612314081d` / `ctx_773a6113ea39`가 Phase 2 계약·main·vault·preload·renderer·테스트를 직렬 소유한다. MCP discovery/search를 먼저 구현하고 명시적 opt-in 의미 문서 검색을 이어서 통합한다. 보정 담당은 구현자, 수락·통합과 별도 독립 검토 배정은 coordinator다. Phase 3/4·실계정 호출·push·통합·배포·버전 변경은 범위 밖이다.

완료 조건은 실제 IPC/DOM 동의·취소·preflight 경계, bounded JSON/SSE·스키마·벡터 검증, 암호화 저장/백업 회귀와 네 가지 제품 gate다. 본인 검증을 독립 검토 수락으로 기록하지 않는다.

## Composer 교체·근거 추가 경합 보정 — 좁은 독립 acceptance 대기

기준 HEAD `c41dc1c296a068b45b7aa0199bda1ec32c9a38ac`의 독립 acceptance는 기존 네 보정을 PASS로 확인했으나 템플릿 교체와 근거 추가가 같은 React commit에서 템플릿을 소실하는 P2를 재현해 `CHANGES_REQUIRED`를 유지했다. 단일 구현 worker `task_8e2d8c02deb3` / `ctx_18cf3779068c`가 `ChatPanel.tsx`의 composer 적용 경로, 실제 App/ChatPanel 회귀 테스트와 이 기록·계획을 직렬 소유했다. 제품 commit `22a2446c43b8c32d5c53760fbaf2f4caac48c3ea`는 두 효과를 하나로 합쳐 받아들인 교체를 기준 초안으로 사용한 뒤 미적용 operation ID의 근거를 결합하고 `setText` 한 번 후 두 의도를 확인한다. 교체가 없을 때만 현재 composer를 읽으며 교체·operation guard로 재렌더/StrictMode 재적용을 막는다. App·첨부/동의·저장·계약·UI/CSS는 변경하지 않았다.

원본 ignored `.orca/phase2-acceptance/acceptance-composer-race.test.tsx`를 수정하지 않고 전후 실행해 **0/2 → 2/2 PASS**를 확인했다. 실제 App의 pending template 응답+근거 버튼 동일 commit과 실제 ChatPanel mount를 기존 등록된 `tests/phase2-corrections-ui-dom.test.tsx`에 승격했다. 두 경로의 일반/StrictMode, 재렌더 후 최신 타이핑·확인 1회, batch/순차 append·중복 ID, 확인 후 같은 template 재선택 등 새 6개와 기존 8개가 **14/14 PASS**다. 원본 실제 ChatPanel의 동의 철회/전송 차단 focused fixture도 **1/1 PASS**다. `ui:check`는 이미 이 파일을 실행하므로 package 변경은 없다. 원본 reviewer fixture·보고서·receipt는 그대로 보존했다.

| 최종 제품 명령 (위 제품 commit) | 결과 |
| --- | --- |
| `npm run typecheck` | PASS, raw exit 0 |
| `npm test` | Node 256/256 + DOM 72/72 = **328/328 PASS**, raw exit 0 |
| `npm run ui:audit` | PASS, raw exit 0; light/dark 39토큰·contrast 68쌍·토큰 밖 색상 0 |
| `npm run build` | PASS, raw exit 0; Linux main/preload/renderer, 내부 typecheck 포함 |
| `git diff --check c41dc1c296a068b45b7aa0199bda1ec32c9a38ac` | PASS, raw exit 0 |

집중 검사 뒤 위 최종 gate를 한 번씩 실행했다. 전체 raw stdout/stderr·exit code·명령·Linux x86_64/Node `v24.21.0`/npm `11.19.0`·소스 manifest는 ignored `.orca/phase2-composer-correction/`의 `{baseline-race,corrected-race,focused-ui,focused-consent,final-typecheck,final-test,final-ui-audit,final-build,final-diffcheck}.{stdout.txt,stderr.txt,receipt.json,source.json}`에 있다. 최종 source SHA256은 `62a57e9d3e8758779fd03c960874713b0957208f7559ad74db3a3075856c8a84`이며 모든 gate의 실행 전후 `source_unchanged:true`다. 제품 commit 이후 이 문서와 계획만 별도 문서 commit으로 갱신하며 제품 gate를 반복하지 않는다. 상세 인계·receipt 대조는 같은 디렉터리의 `report.txt`, `receipts.json`, `gate-verification.json`에 기록한다.

보정 완료는 구현자 검증이며 **좁은 별도 독립 acceptance/수락은 대기**다. 다음 소유자는 coordinator가 배정하는 별도 읽기 전용 Sol reviewer이고, 실행 책임자가 수락·ACK·release를 결정한다. 구현자는 인계 전까지 보정 소유권을 유지했다. desktop→compact의 열린 dialog focus 복귀 관찰은 보정 전부터 있던 별도 후속 항목이며 이번에 수정하거나 해결됐다고 주장하지 않는다. Linux 합성 DOM/mock 결과이고 실계정·유료 호출·실제 OS keychain·macOS 서명/공증·Windows 설치·CI는 미검증이다. Phase 3/4·의존성/버전·main 통합/push/릴리즈는 범위 밖이다.

## 독립 검토 네 지적 보정 결과 — 독립 재검토 대기

아래는 네 보정의 당시 인계 기록이다. 이후 독립 acceptance 결과와 최신 composer P2 보정 상태는 위 절에 기록한다.

독립 검토 `task_e5226f155427` / `ctx_982e157a4081`은 HEAD `46eea830edfa844756e131c0c61c089f5eeb172a`에 `CHANGES_REQUIRED`를 보고했다. 보정은 단일 구현자 `task_412fec97e470` / `ctx_a57c6619f1e5`가 같은 branch/worktree에서 직렬 소유하며 위임하지 않는다. 범위는 근거 추가의 현재 초안·첨부 보존, 챗봇에서 새 LLM 선택과 기존 초안 보존, 큰 MCP JSON의 출처 정규화/생략 안내, 선택 enum 생략의 키 제거 및 실제 컴포넌트/main/client 회귀 테스트다.

제품·실제 경로 테스트를 로컬 commit `ce929d8757ee97cfeb4c2ab84d226b3aa6fc109a`로 고정한 후 최종 gate를 실행했다. 이후 제품 소스 변경 없이 이 문서와 계획의 인계만 갱신한다. 별도 독립 재검토를 coordinator에게 인계하며 자체 수락하지 않는다. Phase 3/4·main 통합·push·릴리즈·버전/의존성 변경·실계정/유료 호출은 포함하지 않는다.

| 지적 | 보정과 실제 경로 검증 |
| --- | --- |
| 기존 질문 소실 | 템플릿 교체와 별도 operation ID/queue를 사용하는 근거 append를 추가했다. ChatPanel이 적용 시점의 현재 composer를 읽고 한 묶음의 근거들을 한 번에 결합한다. research/project 실제 App에서 각각 두 번 삽입해 기존 질문·추가 타이핑·첨부 유지, discard/자동 전송 0회를 확인했다. |
| 챗봇에서 새 LLM 미선택 | 새 target을 명시 선택하고 modelId를 설정한다. 생성 대기 중 두 클릭은 생성 1회에 결합하며 챗봇의 최신 미전송 초안은 메모리에서 보존해 돌아올 때 복원한다. 실제 App에서 표시·모델·초안 복원을 확인하고 창 닫기·패널 교체·새 선택·다른 계정 로그인 뒤의 늦은 응답이 선택/근거를 적용하지 않음을 확인했다. |
| 큰 MCP JSON 출처 소실 | 기존 2MB/60초 transport 한도 안의 완전한 텍스트를 먼저 JSON.parse하고 출처별/count 정규화 후 rawText만 30,000자로 제한한다. 실제 JSON/SSE tools/call의 41,693자 text JSON(structuredContent 없음)에서 출처 10개의 제목·URL·날짜·버전을 보존한다. raw 표시·출처 필드/count·25,000자 evidence의 실제 생략을 각각 안내한다. 짧은 결과에는 생략을 주장하지 않는다. |
| enum 생략 후 빈 값 전송 | ResearchPanel의 생략 선택은 키를 삭제한다. 실제 DOM의 query → papers → 생략 실행 인자를 검증했다. 실제 main IPC는 생략/유효 enum을 받아 tools/call 2회를 실행하며 빈 enum은 기존 검증에서 추가 tools/call 없이 거절한다. |

집중 검사는 main/client **19/19**, DOM **16/16** 통과다. 최초 집중 DOM 16개 중 한 번 실패한 두 클릭 재현은 같은 effect 내 setText/getState가 이전 snapshot을 읽는 문제를 밝혔으며 현재 초안을 한 번 읽고 결합하도록 보정한 뒤 통과했다. 새 fixture `tests/phase2-corrections-ui-dom.test.tsx`는 실제 App/ChatPanel을 import하고 `npm run ui:check`에 명시 포함했다. 기존 제품 구현을 fixture로 복제하거나 실제 컴포넌트를 대체하지 않았다.

| 보정 최종 명령 | 결과 |
| --- | --- |
| `npm run typecheck` | PASS, exit 0 |
| `npm test` | Node 256/256 + DOM 66/66 = **322/322 PASS**, exit 0 |
| `npm run ui:audit` | PASS, exit 0; light/dark 39토큰·contrast 68쌍·토큰 밖 색상 0 |
| `npm run build` | PASS, exit 0; Linux main/preload/renderer, 내부 typecheck 포함 |
| `git diff --check 46eea830edfa844756e131c0c61c089f5eeb172a` | PASS, exit 0 |

최종 raw stdout/stderr·exitcode·파일별 SHA256 manifest는 ignored worktree `.orca/phase2-correction/`의 `final-{typecheck,test,ui-audit,build,diffcheck}.{stdout.txt,stderr.txt,receipt.json,source.json}`에 보관했다. 디렉터리 절대 경로는 `/home/airkjw/orca/workspaces/MM_LLM/chatkhu-api-expansion-20261008/.orca/phase2-correction/`다. 모든 최종 gate receipt는 위 제품 commit, source SHA256 `24a2b620552a62c12b3c44a9d4ff741b215f4861016f468d28ace45de353d0a0`, 실행 전후 `source_unchanged:true`를 기록한다. 로그 출력은 잘라 보관하지 않았다. 작은 `receipts.json`과 `handoff.md`가 최종 인계·원본 경로를 묶는다.

기존 동의·암호화·백업·preflight·과금 POST 무재시도·짧은 첨부 전체 문맥·native PDF·modal focus·좁은 창·light/dark 테스트도 전체 gate에 포함되어 통과했다. 챗봇 초안 보존은 이 앱 세션의 메모리 범위이며 앱 재시작 후 복원 기능을 추가하지 않는다. 검증은 Linux 합성 fixture/mock network이고 실계정 권한·서비스 relevance·실제 OS keychain·macOS 서명/공증·Windows 설치·CI는 미검증이다. 다음 소유자는 coordinator가 배정하는 별도 읽기 전용 Sol acceptance reviewer다.

## 공식 계약 확인

2026-10-08 공식 페이지 본문과 페이지에 포함된 공식 코드 예제를 함께 확인했다.

- [Gateway MCP](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/mcp/) (문서 수정 2026-09-29): `GET /v1/gateway/mcp/`의 `object:list`, `data[]`의 `slug/display_name/description/url/transport`를 사용한다. `url`은 고정 Gateway의 상대 suite 경로와 일치해야 하며 응답 URL을 fetch하지 않는다. 선택한 suite에만 POST initialize/tools/list, stateless(세션 ID 없음), Accept JSON+SSE, 단일 `event: message` envelope와 동일 JSON-RPC id를 검증한다. POST 자동 재시도 없음, 429/503 Retry-After 표시. 키·조직·suite 한도와 2xx 오류 호출 집계를 UI에 표시한다.
- [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), [transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle): 지원 프로토콜 `2025-06-18`과 도구 inputSchema/annotations 계약. 프로토콜 불일치·페이지 cursor는 실행 제한으로 표시한다. Gateway stateless 변형에는 GET/DELETE 스트림, 세션·자동 도구 loop·재연결을 추가하지 않는다.
- [Embeddings](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/embeddings/) (수정 2026-09-18): POST `/embeddings/`, 텍스트 `input[]`, model, float encoding, 응답 `data[].index/embedding`, model, usage. 인덱스로 배열 순서를 복원한다. 텍스트 청크·질의만 사용하며 임의 dimensions/이미지 OCR 지원을 가정하지 않는다.
- [Rerank](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/rerank/) (수정 2026-09-18): POST `/rerank/`, model/query/documents/top_n/return_documents, 결과 `results[].index/relevance_score` 내림차순. 요청 질의+모든 후보가 과금 대상이다. 앱은 후보 20/최종 5 상한을 사용한다.

### 실제 도구 매핑과 검토 범위

실계정 MCP discovery/tools/list는 실행하지 않았다. 공식 문서는 calendar 예제만 제공하며 논문·법령 suite ID나 인자 스키마를 제공하지 않는다. 따라서 특정 계정 도구가 검토·지원된 것으로 주장하지 않으며 suite/name/인자명을 하드코딩하지 않는다.

구현이 검토한 **스키마 패턴**은 발견한 이름에 search가 구분된 단어로 있고, `annotations.readOnlyHint:true`와 `destructiveHint:false`, `inputSchema.type:object`, `additionalProperties:false`, 필수 자유 텍스트 필드 하나, 선택 enum/boolean/0~100 내 bounded 숫자 필드만 있는 경우다. 인자명은 발견 스키마에서 그대로 만든다. 복합 스키마·추가 키·제한 없는 선택 문자열·불명확 권한·미검토 도구는 스키마 확인만 가능하다. renderer는 main이 발급한 도구 token과 검증된 인자만 전달한다. 결과의 명시적 `title/url/abstract/snippet/text` 및 제공된 날짜·버전·조문 필드만 정규화하고 원래 bounded 텍스트도 확인 가능하다. 그 밖의 응답은 원문 텍스트로 표시하며 임의 full-text fetch는 하지 않는다.

## 구현 결과

- `bdbf4dfad4453c2cd675aac720cb7b8c1557773f` — 계정 MCP discovery·선택 suite tools/list·스키마 패턴별 안전한 검색·출처/초록 UI.
- `9b4c0fdcb1b0141a75fea14abdb7f097774bf1db` — 의미 검색 opt-in·암호화 색인/백업 정책·대화 연결·실제 경계 테스트, MCP 취소·중복 클릭 보강.
- 제품 버전 `0.5.1`과 의존성은 유지했다. package.json 변경은 새 DOM 파일을 `ui:check`에 포함하는 것이다. push/main 통합/태그/릴리즈는 수행하지 않았다.

### 동의·네트워크 경계

모델 비교 또는 Studio Chatbot 도구 창의 **논문·법령 검색**에서 discovery, 선택한 묶음의 스키마 확인, 검색 실행을 각각 사용자가 누른다. 도구 선택·타이핑·렌더링만으로 네트워크를 호출하지 않는다. 결과는 신뢰하지 않는 근거로 대화 초안에 추가하며 자동 전송/도구 loop는 없다. URL·제목·제공 날짜·검색 시점을 보존한다.

프로젝트 설정의 **문서 검색**은 로컬 검색이 기본이다. 의미 검색은 현재 계정 catalog에서 공식 텍스트 계약과 일치하는 임베딩 모델을 직접 선택하고 질의 원격 처리에 동의한 뒤 설정을 저장한다. 색인 시작은 ConfirmProvider의 별도 동의이며 기존 첨부 전송 동의로 대체하지 않는다. rerank는 별도 checkbox·모델 선택이 필요하다. 새 문서는 대기하며 색인 버튼을 누르기 전 임베딩 요청을 만들지 않는다. 설정·상태 조회는 로컬 disk 작업이다.

대화 전송은 기존 첨부 동의, 전체 이미지/PDF 크기·개수와 선택 모델의 실제 provider payload를 먼저 검증한다. Gateway의 실제 일반/백그라운드 검색 route preflight를 재사용해 Sonar 검색 끄기·백그라운드 검색 등 불가능한 조합도 의미 검색 POST 전에 거절한다. 프로젝트 근거는 별도 슬롯에 조립해 사용자의 질문이나 동일한 인용문을 문자열 치환으로 훼손하지 않는다. 최종 payload도 다시 검증한다. 토큰 계산/preview의 projectContext는 로컬 경로를 유지한다.

짧은 첨부의 전체 문맥 경로와 네이티브 PDF 경로는 유지했다. 긴 첨부는 기존 로컬 어휘 검색을 사용한다. 의미 검색은 프로젝트 문서에 적용하며 첨부 전체 문맥 예산을 우선한 뒤 남은 예산 안에서 provenance가 있는 청크를 사용한다.

### 저장·취소·복원

파생 벡터는 프로젝트 원본 blob/텍스트 index와 분리한 기존 AES-GCM vault blob에 암호화한다. profile/project, 원본 SHA256, 청크 순번·추출 텍스트의 재구성 문자 위치, 모델 ID, 공식 기본 차원, index version 1을 저장한다. 버전·차원·유한 수·zero norm·응답 index 중복/순서·rerank index/점수 순서를 검증한다. 임베딩은 float 텍스트 배열이며 Gemini를 선택하면 문서/질의 task_type을 각각 사용한다.

앱 한도는 프로젝트 **200청크/벡터 JSON 22MB**, 청크 최대 6,000자, 질의 최대 2,000자, hybrid 후보 20개/최종 5개다. Gateway의 서비스 한도와 별개다. 어휘 점수가 양수인 후보와 벡터 후보에 RRF를 적용한다. 실제 점수 품질은 실서비스에서 검증하지 않았다. rerank는 후보 전체와 질의가 과금됨을 UI에 알린다.

색인은 한 청크씩 순차 POST하며 전송 전에 미확정 표시를 원자적으로 저장하고 유효한 완료 응답 후 vector를 저장한다. 취소/부분 실패는 이미 완료된 청크를 남긴다. 재개는 미확정 청크의 중복 과금 가능성에 별도 동의를 요구하고 완료 청크를 다시 전송하지 않는다. 실패 POST의 자동 재시도·모델 대체는 없다. network/body parse는 고정 origin·redirect 금지·60초 deadline·2MB 한도·취소를 적용하며 vault의 직렬 disk lock 밖에 있다.

문서 추가는 진행 요청을 취소하고 새 문서를 대기시킨다. 문서 제거는 해당 프로젝트의 파생 vector index를 정리하며 남은 원본은 유지한다. 프로젝트 삭제, 로그아웃/계정·키 전환 및 복원은 진행 요청/캐시를 취소·폐기한다. 로그아웃·키 교체는 파생 vector와 원격 동의를 정리하고 원본은 보존한다. 모델 변경은 재색인을 요구한다.

휴대 백업은 원본·추출 청크를 유지하고 **파생 vector를 생략**한다. 복원은 로컬 모드/재구축 필요 상태로 시작하며 query/rerank 동의와 내부 blob 참조·sourceHash는 복사하지 않는다. 원본 hash는 다시 계산한다. 복원만으로 원격 호출하지 않는다.

## 최초 구현 검증 결과 (보정 전)

모든 검증은 Linux의 격리 임시 userData와 합성 문서·mock fetch로 수행했다. Electron startup와 OS safeStorage는 fixture이며 실제 main IPC, Gateway payload/preflight, context, 암호화 blob, profile storage/backup과 실제 React 컴포넌트를 실행했다. 실제 계정·키·학생 자료·유료 API는 사용하지 않았다.

| 최종 명령 | 결과 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | Node 251/251 + DOM 57/57 = **308/308 PASS** |
| `npm run ui:audit` | PASS, light/dark 39개 토큰, contrast 68쌍, 토큰 밖 색상 0 |
| `npm run build` | PASS, Linux main/preload/renderer 빌드 (스크립트의 내부 typecheck 포함) |
| `git diff --check` | PASS |

최초 전체 test의 UI-design audit가 신규 CSS의 legacy 토큰/11px를 발견했으며 기존 color-*·text-xs 토큰으로 보정 후 최종 전체 test를 다시 실행했다. 중간 actual IPC fixture에서는 같은 대화에 실패 첨부를 계속 추가한 테스트 구성이 누적 PDF를 만들었고 각 preflight 사례를 새 합성 대화로 격리해 실제 모델 지원 경계를 검증했다. DOM fixture는 초기 좁은 창의 sidebar 상태와 CSS computed unit 표현을 환경에 맞춰 확인했다. 성공한 최종 검사 이후 제품 소스 변경은 없으며 문서·인계 기록만 갱신했다.

새로운 focused fixture는 MCP 5개, retrieval parser 4개, actual Phase 2 main IPC 9개, Phase 2 DOM 7개이며 기존 workspace DOM에 실제 App 프로젝트/검색 창 2개를 더했다. 주요 근거:

- 실제 MCP GET/선택-suite initialize/list/call, 미발견 도구/미검토 스키마 거절, JSON/SSE envelope·ID·JSON-RPC error/isError 구분, permission/429/503 Retry-After, 31번째 키/분 call 차단, stale logout 응답 폐기.
- 실제 IPC/DOM 동의 전 0회, 렌더·모델/묶음 선택·타이핑에 새 검색 호출 없음, 동기 연속 클릭 1회, 닫기/취소/늦은 응답 ownership.
- 20번째 뒤의 합성 정답이 어휘 일치 없는 의미 검색으로 최상위 회수, 20 후보/5 최종 재정렬, 벡터 모델·차원·배열 순서·NaN/Infinity/zero norm/중복 index·rerank 범위 검증.
- network가 미완료인 동안 실제 vault 상태/삭제가 완료, 취소 후 완료/미확정 청크 보존, 동의 없는 재개 0회, 완료 청크 제외 재개, 유료 실패 1회/모델 대체 없음.
- 의미 프로젝트와 잘못된 이미지/PDF·Sonar/off·백그라운드/검색 조합의 실제 chat IPC에서 **모든 유료 POST 0회**, 사용자가 project.text를 그대로 인용해도 질문 보존.
- 암호화 blob에 합성 원문/vector 키가 평문으로 없음, 문서/프로젝트 삭제·로그아웃 중단·profile 격리·백업 원본 보존/파생 재구축과 악성 내부 메타데이터 배제.
- 기존 Phase 1 실제 preflight의 짧은 문서 후반 정답 보존과 공동 검색 1회, context/document-text/backup-crypto/backup-storage/storage-limits 회귀.
- 실제 App modal에서 키보드 focus trap/Escape, 좁은 viewport·light/dark 토큰, 캐시된 프로젝트 props로 닫기/다시 열 때 저장한 semantic 모드 복원.

## 잔여 제한과 다음 소유권

- 실계정의 suite·도구 스키마·권한·서비스 응답·검색 관련도는 미검증이다. 공식 문서에서 구체화하지 않은 논문/법령 도구를 특정 ID로 매핑하거나 실행 지원을 주장하지 않는다. 현재 보수적 스키마 패턴 밖의 도구는 inspect-only다. 페이지 cursor/다른 MCP protocol 버전은 실행 제한을 표시하며 자동 확장하지 않는다.
- 검색 결과·초록을 full text로 표시하지 않고 법령 현행 여부는 미확인으로 표시한다. 임의 URL 원문 가져오기·유료 원문 우회는 없다.
- 의미 색인의 앱 상한을 넘으면 문서를 나누거나 로컬 검색을 직접 선택해야 한다. 불완전 색인 검색은 완료 벡터와 로컬 어휘 후보를 사용하며 대기 청크 수를 알린다. 미확정 요청은 실제 과금 여부를 앱이 판정할 수 없다.
- 백업/계정 전환 후 vector 재구축에는 사용자의 새 동의와 비용이 필요하다. 기존 원본은 보존한다.
- macOS 서명·공증, Windows 설치, 실제 OS keychain 환경, CI, 실서비스 relevance 검증은 수행하지 않았다. Linux mock/build 성공으로 이를 주장하지 않는다.
- 최초 독립 검토는 `CHANGES_REQUIRED`였으며 네 보정은 별도 독립 acceptance에서 PASS로 확인됐다. 같은 acceptance가 발견한 composer P2의 보정·자체 gate를 완료했으나 **최신 제품 commit의 좁은 별도 독립 acceptance/수락은 대기**다. coordinator가 settled HEAD와 원본 receipt를 별도 읽기 전용 Sol reviewer에게 인계하고 검토 결과를 수락한다. desktop→compact dialog focus 관찰은 별도 보정 전 후속 항목으로 남는다. Phase 3/4는 미착수이며 별도 Task다.
