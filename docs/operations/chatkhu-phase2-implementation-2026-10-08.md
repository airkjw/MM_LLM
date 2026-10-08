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

## 검증 결과

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
- **독립 검토는 미실시/수락 대기**다. 구현자는 자체 gate만 보고한다. coordinator가 이 branch의 두 feature commit과 이 기록을 별도 Sol reviewer에게 인계하고 findings가 있으면 구현자에게 보정 ownership을 배정한다. Phase 3/4는 별도 Task다.
