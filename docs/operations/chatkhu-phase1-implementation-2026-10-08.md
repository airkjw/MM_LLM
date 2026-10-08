# ChatKHU 1단계 구현·검증 기록 — 2026-10-08

수락된 [확장 계획 1단계](chatkhu-api-expansion-plan-2026-10-08.md)의 모델 분류와 실제 네이티브 웹 검색을 구현했다. 초기 제품 commit은 `b10d7dfce738c3773025bc1019ee4ebb4767c9b2`, 기준은 `609c05e9aa4d7aeb154f480521bd5edac4a76f14`다. 별도 Sol의 읽기 전용 독립 검토는 세 지적으로 `CHANGES_REQUIRED`를 반환했고, 아래 단일 보정 Sol이 수락된 지적을 수정하고 로컬 gate를 통과했다. 최종 보정 commit `7ab363caeea25ed6a0273afa46105720388b4ca3`은 별도 Sol 독립 재검토에서 PASS를 받았고 실행 책임자가 코드를 수락했다. 작업 브랜치에 보존했으며 main 통합·push·배포와 2~4단계는 미실시다.

## 동작과 범위

### 독립 검토 보정 작업

독립 검토 `ctx_eb789a92c9a7`의 수락된 세 지적만 보정한다. 기준 HEAD는
`dec5d371f0d3f4d8fc0f8fa6b745e01ee08e5870`이며 시작 시 작업 트리는 깨끗했다.
이전 구현 worker는 settle/release되었고 보정 Dispatch `ctx_e50790142144`의 단일 Sol이
shared/main/renderer/관련 테스트와 두 진행 MD를 직렬 소유한다. 실행 책임자가 수락하며
별도 Sol의 독립 재검토를 거친다.

완료 조건은 비교의 전체 첨부·선택 모델 요청과 일반 대화 원래 payload를 유료 검색 전에
검증하여 잘못된 요청의 POST가 0회임을 입증하고, Gemini의 미검증 검색 횟수를 제거하며,
Claude `pause_turn`의 안전한 중단 사유를 저장·복원·내보내고 UI/main의 일반 이어 생성을
차단하는 것이다. 부분 답변·검색 근거와 기존 max_tokens/수동 도구/Responses 흐름은
보존한다. 합성 회귀 후 네 가지 제품 검사를 실행하고 명시적 파일만 로컬 commit한다.
실계정·유료 호출·의존성/버전/workflow·push/merge/릴리즈와 2단계는 범위 밖이다.

- Catalog는 `llm, embedding, rerank, decisions, realtime, audio, image, video`를 보존한다. 대화·비교 선택지는 LLM으로 제한하고 알 수 없는 종류를 LLM으로 승격하지 않는다. 저장된 모델이 삭제되었으면 직접 모델을 선택하도록 안내하고 다른 모델로 자동 전송하지 않는다.
- 검색 기능 확인은 명시적 버튼 또는 검색을 요청한 전송에 연결했다. 선택한 계정 모델의 상세 ID·종류·`pricing.web_search_per_1k`와 구현된 공식 도구 경로가 일치해야 지원으로 판정한다. `null`은 미지원, 누락·오류·권한 거부·불일치는 미확인, `0`은 유효한 숫자다. 모델 접두어는 adapter 선택에만 사용한다.
- 상세 캐시는 main 메모리의 한 계정 epoch에 묶었다. 최대 64개, 지원/미지원 10분·미확인 30초 TTL, 동시 GET 최대 4개, 같은 모델 조회 합류를 적용했다. 키 변경·세션 교체·목록 갱신은 캐시를 폐기하고 진행 GET을 취소한다. 취소한 caller에는 늦은 결과를 전달하지 않으며 다른 caller의 공유 GET을 취소하지 않는다. 상세 JSON은 256 KiB로 제한한다.
- Claude Messages·OpenAI Responses·Gemini native 요청에 실제 검색 도구를 연결했다. Gemini의 검색 지침만 붙이던 분기는 제거했다. 짧은 문서 전체 텍스트, 이미지, Claude PDF/thinking, 기존 수동 도구 경로와 Responses continuation은 회귀 fixture로 확인했다.
- 끄기/자동/항상/딥리서치를 유지했다. 미확인/미지원 모델은 **첫 유료 호출 전에** Sonar bridge를 계획하고 경로·추가 요청을 표시한다. Sonar가 없으면 막는다. 네이티브 생성 실패 후 검색 bridge·모델·endpoint로 우회하거나 유료 POST를 재전송하지 않는다.
- 비교는 Sonar 공통 evidence 한 묶음만 준비해 모든 모델에 같은 내용을 전달하고 답변별 네이티브 검색을 끈다. 딥리서치는 기존 Sonar 계획·3~4개 질의 조사를 유지하며 UI도 해당 경로로 표시한다.
- 공개 검색 상태와 출처를 typed IPC·메시지 UI·암호화 기록·백업 복원·대화/비교 내보내기에 연결했다. 기존 저장 버전을 올리지 않았고 필드 없는 과거 기록은 검색 실행을 추정하지 않는다. 기존 창 비율/크기 복원·보안 정책·의존성·릴리즈 설정은 변경하지 않았다.

## 공식 계약과 fixture 근거

2026-10-08 공개 문서와 공개 Markdown/HTML 코드 예제를 확인했다. 아래는 문서 계약 검증이며 계정 권한이나 실제 제공사 실행 검증이 아니다. 합성 wire fixture는 `tests/fixtures/native-search.mjs`에 있다.

| 경로 | 구현 계약 | 1차 출처 |
| --- | --- | --- |
| 모델 상세 | `/models/{encoded-id}/`, 정확한 모델 ID·종류와 필요한 pricing 필드 검증 | [Gateway 모델](https://docs.mindlogic.ai/docs/khu/api-gateway/getting-started/models/), [Gateway 서버 도구](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/server-tools/) |
| Claude | `/claude/v1/messages/`, `web_search_20250305`, `name: web_search`, `max_uses: 2`; 기존 인증/version·PDF beta 경로 유지 | [Gateway 서버 도구](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/server-tools/), [Claude web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), [Claude streaming](https://platform.claude.com/docs/en/build-with-claude/streaming) |
| OpenAI | `/responses/`, `tools: [{type: web_search}]`; `web_search_call` 상태·완료 output annotations·스트리밍 annotation 수집 | [Gateway 서버 도구](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/server-tools/), [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search) |
| Gemini | `/gemini/v1beta/models/{encoded-id}:streamGenerateContent?alt=sse`, `tools: [{google_search: {}}]`, contents/systemInstruction·inlineData·generationConfig·usage/finishReason 변환 | [Gateway Gemini native](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/gemini-native/), [Google GenerateContent](https://ai.google.dev/api/generate-content), [Google thinking](https://ai.google.dev/gemini-api/docs/thinking) |
| Sonar bridge | 기존 `/chat/completions/` 경로, 구조화 citations/search_results로 확인된 출처와 실행 상태 수집 | [Gateway chat completions](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/chat-completions/) |

Claude의 서버 도구 결과·텍스트 인용·search usage, Responses의 완료된 검색 호출, Gemini의 grounding 질의/청크/근거 연결을 각각 정규화한다. 답변 텍스트 속 URL만으로 네이티브 실행 성공을 선언하지 않는다. 검색 미실행/미확인, 도구 실패, 빈 결과, 이전 근거 재사용을 구별하며 제공사 검색이 실행되지 않으면 `missing`으로 표시한다. Sonar 구조화 실행 근거가 없는 응답도 미확인으로 남긴다.

공개 인용은 최대 64개, 질의 16개·각 512자, 네이티브 완료 호출 32개로 제한했다. URL은 HTTP(S)·자격증명 없음·최대 2,000자이며 Gateway 첨부 다운로드 주소는 공개 출처에서 제외한다. 출처 제목 500자·인용문 1,000자로 제한하고 Gemini 근거 index 범위를 검증한다. 공개 메타데이터에 Claude opaque/encrypted 필드, Gemini thought/signature와 HTML 검색 entry point를 넣지 않는다. 외부 열기는 기존 HTTPS 정책을 유지하며 HTTP 링크에는 차단 이유, 열기 실패에는 오류를 표시한다.

## 지원하지 않는 조합과 사전 차단

Coordinator와 확인한 1단계 제한이다. 모두 첫 유료 호출 전에 검사하며 사용자가 직접 모델·설정을 고르게 한다.

- Sonar는 Gateway에 검증된 검색 비활성화 계약이 없어서 검색 끄기, 공통 근거만 사용하는 비교 답변, 딥리서치 최종 답변 모델로 쓰지 않는다. 일반 대화 자동/항상 모드와 bridge 역할은 유지한다. 자동 모드 일반 질문에서도 검색 가능성을 표시한다. Sonar 자체 검색 상세가 미확인/미지원이면 다른 Sonar 검색을 먼저 수행한 후 Sonar로 답변하는 중복 경로를 만들지 않고 막는다.
- 자체 검색과 고정 수동 도구 선택, Claude 자체 검색과 수동 도구, Responses 자체 검색과 Temperature/Top P/중단 문자열, Gemini 자체 검색과 수동 도구 이력·JSON Schema·타 제공사 옵션은 막는다. Gemini 사고 강도는 자동 또는 제공사 사고 수준/예산의 명시 설정을 사용한다. 기존 검색 꺼짐/bridge의 수동 도구 경로는 유지한다.
- 백그라운드 Responses는 실제 검색이 필요한 모드와 함께 시작하지 않는다. 검색 꺼짐과 새 검색이 필요 없는 자동 모드의 기존 배경 응답 경로는 유지한다.

## 초기 제품 검증 결과

모든 결과는 Linux 로컬, 합성 자료, fetch/provider/Electron fixture 또는 DOM 환경이다. 실제 API 키·학생 자료·유료 API는 사용하지 않았다.

| 검사 | 결과·근거 |
| --- | --- |
| `npm run typecheck` | 통과. 최종 UI 문구 변경 뒤 `npm run build`에 포함된 동일 검사도 통과 |
| `npm test` | Node 223개 + 실제 컴포넌트 DOM 45개 통과, 실패/skip 0 |
| `npm run ui:audit` | 통과: 테마 각 39 token, contrast pair 68, boundary mapping 31, disabled mapping 5, token 밖 고정 색상 0 |
| `npm run build` | 통과: main/preload/renderer Linux production build |
| 변경 범위·문서 | 명시적 파일 stage, `git diff --check`, 로컬 문서 링크/fixture 참조 확인 |

핵심 회귀는 8종 catalog·null/누락/0/권한 거부·account epoch/캐시 상한·정확한 3사 URL/header/body·UTF-8 분할 SSE/최종 이벤트·최종/중복/위험 인용·도구 오류·취소·usage·Claude PDF/thinking/수동 도구·Responses continuation이다. 실제 main Gateway 모듈에 fetch fixture를 주입해 네이티브 실패 뒤 유료 POST 총 1회, 사전 차단 유료 POST 0회, 비교 Sonar 검색 1회 + 동일 근거 답변을 단언했다. 실제 백업 암호화/복원 코드와 격리한 임시 profile에서 새 메타데이터 보존·불필요한 필드 제거·다른 profile 기록 비노출도 확인했다.

실제 ChatPanel/ModelPicker DOM으로 보조 모델 제외·확인된 badge·명시적 기능 조회·미지원 bridge 계획·검색 상태/출처·HTTP 차단/열기 실패·Sonar 제한·삭제 모델 전송 차단을 확인했다. 기존 키보드·focus 복귀·동의 회귀와 360px wrapper·light/dark DOM 상태를 포함한다. 실제 OS 창의 시각적 layout 검사나 외부 브라우저 실행 성공 검증은 아니다. 초기 DOM harness의 animation-frame/부모 snapshot 동기화 실패는 harness를 보정하고 통과했으며 기대값을 낮추지 않았다.

민감정보 없는 상세 로컬 로그는 Git 제외 `.orca/phase1/`에 보관했다. 최종 제품 근거는 `npm-test-label-final.log`, `typecheck-gate.log`, `ui-audit-final.log`, `build-label-final.log`이며 앞선 실패/targeted 결과도 남겼다. Node의 기존 typeless-package 경고는 의존성/모듈 설정 변경 없이 유지했다.

## 독립 검토 지적 보정 결과

세 지적의 보정은 완료했으며 독립 재검토 대기다. 보정은 위 기준 HEAD에서 이 기록과
함께 로컬 commit으로 인계한다. 실행 책임자가 commit과 근거를 확인하고 별도 Sol에
재검토를 배정한다. 이 보정자의 검증은 독립 검토가 아니다.

| 수락된 지적 | 수정·회귀 근거 |
| --- | --- |
| P1: 비교 첨부 검증보다 유료 검색이 먼저 실행됨 | `compare:stream`은 prepared attachments로 모든 선택 모델의 문맥을 구성하고 provider body·22 MiB 한도를 검증한 뒤 공통 검색한다. 실제 IPC/첨부/저장소/Gateway fixture에서 7 MiB 이미지 2개, 원문 PDF 3개, 9 MiB 원문 PDF 2개의 always/auto/deep 요청은 POST 0회다. 마지막 선택 모델이 비-Claude인 원문 PDF 조합도 POST 0회다. 원문 `document` 블록은 검증된 Claude 경로에만 허용하며 다른 Chat/Responses 경로는 명확히 거부한다. 정상 추출 PDF 전체 본문과 Sonar 1회+동일 근거 답변을 보존한다. |
| P1 관련: 일반 대화 원래 payload의 22 MiB guard가 bridge 뒤에 있음 | 공통 `validateChatRequest`로 원래 provider payload를 bridge 전에 검증하며 근거 추가 뒤에도 최종 guard를 유지한다. 실제 Gateway fetch fixture에서 3사 oversized payload, Claude 잘못된 PDF, 비-Claude 원문 PDF의 bridge POST는 0회다. 기존 이미지·PDF·본문 한도를 낮추거나 첨부/모델을 삭제하지 않았다. |
| P2: Gemini 고정 `google_search` key가 검색 1회로 표시됨 | Gemini `requestCount`는 정규화·기존 기록 복원·UI에서 생략한다. 비어 있지 않은 3개 질의+빈/중복 질의 fixture에서 실행 상태·질의·인용을 보존하고 실제 ChatPanel DOM은 기존 `requestCount: 1` 기록도 횟수로 표시하지 않는다. 질의 수를 API 호출 수나 과금 수로 추정하지 않는다. [Google pricing](https://ai.google.dev/gemini-api/docs/google-search#pricing)의 Gemini 3 고유 비어 있지 않은 질의 과금 계약을 공개 조회했다. |
| P2: Claude `pause_turn`에 일반 이어 생성이 제시됨 | 안전한 enum `continuationUnsupportedReason: claude_pause_turn`를 정규화 이벤트·공개 메시지·암호화 기록·백업 복원·내보내기에 연결했다. 부분 답변과 검색 근거는 보존하고 server-tool opaque/encrypted 내용은 추가하지 않았다. UI는 이어 생성 버튼을 제거하고 새 질문은 별도 요청으로 추가 과금될 수 있음을 설명한다. 실제 main IPC는 이어 생성 ID가 위 사유를 가리키면 POST 0회·기록 변경 없이 거부한다. 명시적 새 질문은 새 요청 1회다. [Claude pause_turn](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool#pause_turn-stop-reason) 계약상 원래 assistant content 재전송이 필요하므로 이 단계에서는 재개를 지원하지 않는다. 자동 재시도는 없다. |

모든 최종 결과는 Linux 로컬 합성 fixture/DOM이다. 실제 main IPC 테스트는 production
handler를 그대로 등록하여 첨부 준비·문맥·Gateway·암호화 저장을 실행하며, Electron
startup/updater와 로컬 문서 추출만 fixture로 대체한다. 학생 자료나 실제 키·유료 호출은 없다.

| 보정 후 명령 | 결과·로컬 로그 (`.orca/phase1-corrections/`, Git 제외) |
| --- | --- |
| `node --test tests/phase1-main-preflight.test.mjs tests/gateway-transport.test.mjs tests/phase4-gateway.test.mjs tests/backup-storage.test.mjs` | 59개 통과, 실패/cancel/skip 0; `focused-node-final.log` |
| `npx tsx --test --test-concurrency=1 --test-name-pattern='multi-query\|paused search\|generic continuation' tests/workspace-ui-dom.test.tsx` | 새 DOM 회귀 3개 통과; `focused-dom-final.log` |
| `npm run typecheck` | 통과; `typecheck-final.log` |
| `npm test` | Node 233개 + DOM 48개 통과, 실패/cancel/skip 0; `npm-test-final.log` |
| `npm run ui:audit` | 통과: 테마 각 39 token, contrast 68, boundary 31, disabled 5, token 밖 고정 색상 0; `ui-audit-final.log` |
| `npm run build` | typecheck 포함 main/preload/renderer Linux production build 통과; `build-final.log` |
| 문서·diff | 로컬 링크 및 공식 두 계약 링크 조회, 명시적 파일 stage, `git diff --check` |

기존 max_tokens·수동 도구·Responses continuation 전체 회귀를 유지했고 main/DOM에서
일반 incomplete의 이어 생성을 추가 확인했다. 새 ChatPanel 회귀는 두 테마·360px wrapper의
중단 안내·버튼 제거·출처 보존·포커스와 명시적 새 전송을 검증한다. DOM은 OS 화면의 실제
layout/브라우저 실행 검증이 아니다. 초기 DOM 전송 fixture가 부모 snapshot을 갱신하지
않아 멈춘 검사는 해당 로컬 프로세스를 종료하고 앱과 같은 부모 갱신으로 수정했으며
성공한 최종 회귀와 구분해 `focused-dom-initial.log`에 남겼다. PDF route 추가 보정 전의
집중 검사/typecheck는 초기 로그로 구분했다. 기존 Node typeless-package 경고는 유지한다.

## 독립 재검토·수락과 남은 확인

별도 Sol은 보정 commit `7ab363caeea25ed6a0273afa46105720388b4ca3`을 `dec5d371f0d3f4d8fc0f8fa6b745e01ee08e5870`과 대조해 세 지적과 관련 회귀를 독립 재검토했고 **PASS**로 판정했다. 추가 조치가 필요한 지적은 없었다. 전체 검증 로그를 확인하고 격리된 합성 자료로 핵심 Node 11개·실제 컴포넌트 DOM 3개를 별도로 재현해 통과했다. 실행 책임자는 이 근거를 확인해 1단계 코드를 수락했다. 구현·보정·검토 worker는 인계 후 정식 release했고 다음 작업 순서는 2단계다.

실제 계정의 모델 상세·각 3사 검색/인용·Gateway 권한/스트림 형태는 미검증이다. CI, macOS/Windows 수동 UI, 서명/공증·설치·배포도 미실시다. 계정 접근과 비용 범위가 허용된 후 합성 입력으로 별도 확인해야 하며 mock 성공을 실서비스 성공으로 해석하지 않는다. 2단계는 아직 착수하지 않았다. 모든 변경은 로컬 작업 브랜치에 있으며 main 통합·push·릴리즈는 수행하지 않았다.
